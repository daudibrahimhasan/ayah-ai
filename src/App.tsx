import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { pipeline, env } from '@huggingface/transformers'
import quranFull from './assets/data/quran_full.json'
import quranEn from './assets/data/quran_en.json'
import surahsData from './assets/data/surahs.json'
import pageMapping from './assets/data/quran_page_mapping.json'
import { findBestMatch } from './utils/search'
import { getJuz } from './utils/juz'
import './index.css'

// ── Configure Transformers.js ─────────────────────────────
env.allowLocalModels = false
env.useBrowserCache = typeof caches !== 'undefined'

// ── Types ─────────────────────────────────────────────────
interface MatchResult {
  surah: { id: number; name: string }
  ayat: number
  arabicText: string
  confidence: number
  juz: number
  transliteration: string
  translation?: string
}

interface Bookmark {
  id: string
  surahId: number
  surahName: string
  surahTranslit: string
  ayatNum: number
  arabicText: string
  translation?: string
  savedAt: number
  pdfPage: number
}

interface HistoryEntry {
  id: string
  surahId: number
  surahName: string
  surahTranslit: string
  ayatNum: number
  confidence: number
  recognizedAt: number
  pdfPage: number
}

type Screen = 'home' | 'library' | 'quran' | 'profile' | 'surah-detail' | 'pdf'

// ── Helper: get PDF page from mapping ────────────────────
const getPageMapping = () => pageMapping as Record<string, { surah_number: number; surah_name: string; page: number }>
const getPdfPage = (surahId: number): number => {
  const m = getPageMapping()
  return m[String(surahId)]?.page ?? 1
}

// ── Helper: confidence badge colour ──────────────────────
const confidenceClass = (c: number) => c >= 80 ? 'confidence-high' : c >= 50 ? 'confidence-mid' : 'confidence-low'
const confidenceLabel  = (c: number) => `${c}%`

// ── Helper: format date ───────────────────────────────────
const fmtDate = (ts: number) =>
  new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

// ── LocalStorage helpers ──────────────────────────────────
const LS_BOOKMARKS = 'ayah:bookmarks'
const LS_HISTORY   = 'ayah:history'
function loadLS<T>(key: string, fallback: T): T {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback } catch { return fallback }
}
const saveLS = (key: string, val: unknown) => { try { localStorage.setItem(key, JSON.stringify(val)) } catch { /* ignore */ } }

// ════════════════════════════════════════════════════════════
// WAVEFORM COMPONENT
// ════════════════════════════════════════════════════════════
const WAVE_HEIGHTS = [8, 14, 20, 28, 18, 26, 32, 22, 28, 16, 24, 10, 18, 8]

function WaveformBars({ active }: { active: boolean }) {
  return (
    <div className="waveform">
      {WAVE_HEIGHTS.map((h, i) => (
        <div
          key={i}
          className={`wave-bar ${active ? 'active' : ''}`}
          style={{
            height: `${h}px`,
            animation: `wave 1.4s ease-in-out ${(i * 0.1).toFixed(1)}s infinite`,
          }}
        />
      ))}
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// STATUS BAR
// ════════════════════════════════════════════════════════════
function StatusBar() {
  const [time, setTime] = useState(() => {
    const now = new Date()
    return `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`
  })
  useEffect(() => {
    const id = setInterval(() => {
      const now = new Date()
      setTime(`${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`)
    }, 10000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="status-bar">
      <span className="status-time">{time}</span>
      <div className="status-icons">
        {/* Signal bars */}
        <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
          <rect x="0" y="9" width="3" height="5" rx="1" fill="white" opacity="0.4"/>
          <rect x="5" y="6" width="3" height="8" rx="1" fill="white" opacity="0.6"/>
          <rect x="10" y="3" width="3" height="11" rx="1" fill="white" opacity="0.8"/>
          <rect x="15" y="0" width="3" height="14" rx="1" fill="white"/>
        </svg>
        {/* WiFi */}
        <svg width="16" height="13" viewBox="0 0 16 13" fill="white">
          <circle cx="8" cy="11.5" r="1.5"/>
          <path d="M4.5 7.5C5.6 6.4 6.7 5.8 8 5.8s2.4.6 3.5 1.7" stroke="white" fill="none" strokeWidth="1.5" strokeLinecap="round"/>
          <path d="M1.5 4.5C3.2 2.8 5.5 1.8 8 1.8s4.8 1 6.5 2.7" stroke="white" fill="none" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        {/* Battery */}
        <div className="battery">
          <div className="battery-body">
            <div className="battery-fill"/>
          </div>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// HOME SCREEN
// ════════════════════════════════════════════════════════════
interface HomeScreenProps {
  isListening: boolean
  isProcessing: boolean
  modelLoading: boolean
  statusText: string
  lastResult: MatchResult | null
  onMicTap: () => void
  onLibrary: () => void
  onQuran: () => void
  onOpenResult: () => void
  onOpenPDF: (surahId: number, surahName: string) => void
  showResult: boolean
}

function HomeScreen({
  isListening, isProcessing, modelLoading, statusText,
  lastResult, onMicTap, onLibrary, onQuran, onOpenResult, onOpenPDF, showResult
}: HomeScreenProps) {
  const isActive = isListening || isProcessing

  return (
    <div className="screen" style={{ zIndex: 5 }}>
      {/* Background */}
      <div className="screen-bg" />
      <div className="gloss" />

      {/* Dynamic Island */}
      <div className="island" />

      {/* Status Bar */}
      <StatusBar />

      {/* Top Nav */}
      <div className="top-nav">
        <button className="nav-btn" onClick={onLibrary} aria-label="Library">
          <div className="nav-icon">
            {/* Bookmark icon */}
            <svg viewBox="0 0 24 24"><path d="M5 3h14a1 1 0 011 1v17l-8-4-8 4V4a1 1 0 011-1z"/></svg>
          </div>
          <span className="nav-label">Library</span>
        </button>

        <div className="dots-row">
          <div className="dot"/>
          <div className="dot active"/>
          <div className="dot"/>
        </div>

        <button className="nav-btn" onClick={onQuran} aria-label="Quran">
          <div className="nav-icon">
            {/* Open book icon */}
            <svg viewBox="0 0 24 24"><path d="M2 6s2-2 6-2 6 4 6 4 2-4 6-4 6 2 6 2v14s-2-1-6-1-6 3-6 3-2-3-6-3-6 1-6 1V6z"/></svg>
          </div>
          <span className="nav-label">Quran</span>
        </button>
      </div>

      {/* Prompt */}
      {!isActive && !showResult && (
        <div className="prompt-section animate-in">
          <div className="prompt-arabic">بِسْمِ اللهِ الرَّحْمٰنِ الرَّحِيْمِ</div>
        </div>
      )}
      {isListening && (
        <div className="prompt-section animate-in">
          <div className="prompt-arabic">جارٍ الاستماع...</div>
          <div className="prompt-main">Listening...</div>
        </div>
      )}
      {isProcessing && !isListening && (
        <div className="prompt-section animate-in">
          <div className="prompt-arabic">يتعرف...</div>
          <div className="prompt-main">Identifying...</div>
        </div>
      )}

      {/* Mic Button */}
      <div className="mic-wrap">
        {/* Pulse rings - active state: bright, full opacity */}
        {isActive && (
          <>
            <div className="mic-pulse-ring" style={{ animation: 'pulseRing 2.4s ease-out infinite' }}/>
            <div className="mic-pulse-ring" style={{ animation: 'pulseRing 2.4s ease-out 0.8s infinite' }}/>
          </>
        )}
        {/* Idle rings - subtle scale+fade always on */}
        {!isActive && (
          <>
            <div className="mic-pulse-ring" style={{ animation: 'pulseRing 2.4s ease-out infinite', opacity: 0.55 }}/>
            <div className="mic-pulse-ring" style={{ animation: 'pulseRing 2.4s ease-out 0.8s infinite', opacity: 0.35 }}/>
          </>
        )}

        <button
          className={`mic-btn ${!isActive && !modelLoading ? 'idle' : ''} ${modelLoading ? 'disabled' : ''}`}
          onClick={onMicTap}
          disabled={modelLoading || isProcessing}
          aria-label="Tap to identify Ayah"
        >
          {isProcessing ? (
            <div className="mic-spinner" />
          ) : (
            <div className="mic-logo">
              <span className="mic-logo-arabic">آية</span>
              <span className="mic-logo-latin">Ayah</span>
            </div>
          )}
        </button>
      </div>

      {/* Waveform */}
      <WaveformBars active={isActive} />

      {/* Status label */}
      <div className="status-label">
        <span className={isActive ? 'active' : ''}>
          {statusText || (isListening ? 'Listening for Quranic recitation...' : 'Tap to Identify Ayah')}
        </span>
      </div>



      {/* Last Result Card */}
      {lastResult && !isActive && (
        <div
          className="last-result animate-in"
          onClick={() => lastResult.confidence > 0 ? onOpenResult() : onOpenPDF(lastResult.surah.id, lastResult.transliteration)}
          role="button"
          tabIndex={0}
        >
          <div className="last-result-left">
            <div className="result-dot">
              <span>{lastResult.surah.id}</span>
            </div>
            <div>
              <div className="result-surah">{lastResult.transliteration} · Ayah {lastResult.ayat}</div>
              <div className="result-ayat-preview">{lastResult.arabicText}</div>
            </div>
          </div>
          <button
            className="result-open-btn"
            onClick={(e) => { e.stopPropagation(); onOpenPDF(lastResult.surah.id, lastResult.transliteration) }}
          >
            PDF
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </div>
      )}

      {/* Home bar */}
      <div className="home-bar"/>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// LIBRARY SCREEN (Bookmarks)
// ════════════════════════════════════════════════════════════
function LibraryScreen({
  bookmarks, onBack, onDelete, onOpenPDF
}: {
  bookmarks: Bookmark[]
  onBack: () => void
  onDelete: (id: string) => void
  onOpenPDF: (surahId: number, surahName: string) => void
}) {
  return (
    <div className="screen light-screen animate-in">
      <div className="light-header">
        <button className="back-btn" onClick={onBack} aria-label="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <h1 className="screen-title">Library</h1>
        <span style={{ fontSize: 13, color: 'var(--text-gray)', fontFamily: 'Nunito', fontWeight: 700 }}>
          {bookmarks.length} saved
        </span>
      </div>

      <div className="screen-scroll">
        {bookmarks.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            </div>
            <div className="empty-title">No bookmarks yet</div>
            <div className="empty-sub">Bookmark any Ayah from the results screen or Quran browser to save it here.</div>
          </div>
        ) : (
          <div className="bookmark-grid">
            {bookmarks.map(bk => (
              <div key={bk.id} className="bookmark-card" onClick={() => onOpenPDF(bk.surahId, bk.surahTranslit)}>
                <button
                  className="bk-delete-btn"
                  onClick={(e) => { e.stopPropagation(); onDelete(bk.id) }}
                  aria-label="Delete bookmark"
                >×</button>
                <div className="bk-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/>
                  </svg>
                </div>
                <div className="bk-surah">{bk.surahTranslit}</div>
                <div className="bk-ayat">Ayah {bk.ayatNum}</div>
                <div className="bk-arabic">{bk.arabicText.slice(0, 60)}{bk.arabicText.length > 60 ? '...' : ''}</div>
                <div className="bk-date">{fmtDate(bk.savedAt)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// QURAN BROWSER SCREEN
// ════════════════════════════════════════════════════════════
type QuranChapter = {
  id: number
  name: string
  transliteration: string
  verses: { id: number; text: string }[]
}
type SurahMeta = {
  number: number
  name?: string
  englishName?: string
  englishNameTranslation?: string
  numberOfAyahs?: number
  revelationType?: string
  page?: number
}

function QuranBrowserScreen({
  onBack, onSurahDetail, onReadPDF
}: {
  onBack: () => void
  onSurahDetail: (surah: QuranChapter) => void
  onReadPDF: (surahId: number, surahName: string) => void
}) {
  const [search, setSearch] = useState('')
  const allSurahs = quranFull as QuranChapter[]
  const filtered = search.trim()
    ? allSurahs.filter(s =>
        s.transliteration.toLowerCase().includes(search.toLowerCase()) ||
        s.name.includes(search) ||
        String(s.id).startsWith(search)
      )
    : allSurahs

  return (
    <div className="screen light-screen animate-in">
      <div className="light-header">
        <button className="back-btn" onClick={onBack}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <h1 className="screen-title">Quran</h1>
        <span style={{ fontSize: 13, color: 'var(--text-gray)', fontFamily: 'Nunito', fontWeight: 700 }}>
          114 Surahs
        </span>
      </div>

      {/* Search */}
      <div className="search-bar">
        <div className="search-wrap">
          <svg className="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="22" y2="22"/>
          </svg>
          <input
            className="search-input"
            placeholder="Search by name or number..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoComplete="off"
          />
        </div>
      </div>

      <div className="screen-scroll">
        {filtered.map(surah => {
          const meta = (surahsData as SurahMeta[]).find(m => m.number === surah.id)
          const revType = meta?.revelationType?.toLowerCase() ?? ''
          return (
            <div key={surah.id} className="clay-card surah-card">
              <div className="surah-number-badge">{surah.id}</div>
              <div className="surah-info">
                <span className="surah-name-arabic">{surah.name}</span>
                <div className="surah-meta">
                  {surah.transliteration} · {surah.verses.length} Ayah
                  {' '}<span className={`rev-badge ${revType === 'meccan' ? 'meccan' : 'medinan'}`}>
                    {revType === 'meccan' ? 'Meccan' : 'Medinan'}
                  </span>
                </div>
              </div>
              <div className="surah-actions">
                <button className="pill-btn primary" onClick={() => onReadPDF(surah.id, surah.transliteration)}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                    <polyline stroke="white" strokeWidth="2" fill="none" points="14 2 14 8 20 8"/>
                  </svg>
                  PDF
                </button>
                <button className="pill-btn secondary" onClick={() => onSurahDetail(surah)}>
                  Browse
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// SURAH DETAIL SCREEN
// ════════════════════════════════════════════════════════════
function SurahDetailScreen({
  surah, bookmarks, onBack, onBookmark, onViewPDF, onReadPDF
}: {
  surah: QuranChapter
  bookmarks: Bookmark[]
  onBack: () => void
  onBookmark: (surahId: number, ayatNum: number, arabicText: string) => void
  onViewPDF: (surahId: number, surahName: string) => void
  onReadPDF: (surahId: number, surahName: string) => void
}) {
  const enSurah = (quranEn as { id: number; verses: { id: number; translation: string }[] }[]).find(s => s.id === surah.id)

  return (
    <div className="screen light-screen animate-in">
      <div className="light-header">
        <button className="back-btn" onClick={onBack}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <div style={{ flex: 1 }}>
          <h1 className="screen-title" style={{ fontSize: 18 }}>{surah.transliteration}</h1>
          <div style={{ fontFamily: 'Amiri, serif', fontSize: 15, color: 'var(--mint-deep)', marginTop: 2 }}>{surah.name}</div>
        </div>
        <button className="pill-btn primary" onClick={() => onReadPDF(surah.id, surah.transliteration)} style={{ borderRadius: 12 }}>
          📖 PDF
        </button>
      </div>

      <div className="screen-scroll">
        {surah.verses.map(verse => {
          const translation = enSurah?.verses.find(v => v.id === verse.id)?.translation
          const isBookmarked = bookmarks.some(b => b.surahId === surah.id && b.ayatNum === verse.id)
          return (
            <div key={verse.id} className="ayat-card">
              <div className="ayat-number-row">
                <div className="ayat-num-badge">{verse.id}</div>
                <div className="ayat-actions">
                  <button
                    className={`icon-btn ${isBookmarked ? 'bookmarked' : ''}`}
                    onClick={() => onBookmark(surah.id, verse.id, verse.text)}
                    aria-label={isBookmarked ? 'Bookmarked' : 'Bookmark'}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill={isBookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                      <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/>
                    </svg>
                  </button>
                  <button className="icon-btn" onClick={() => onViewPDF(surah.id, surah.transliteration)} aria-label="View in PDF">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>
                  </button>
                </div>
              </div>
              <p className="ayat-arabic">{verse.text}</p>
              {translation && <p className="ayat-translation">{translation}</p>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// PROFILE SCREEN
// ════════════════════════════════════════════════════════════
function ProfileScreen({
  history, onBack, onClearHistory, onOpenPDF
}: {
  history: HistoryEntry[]
  onBack: () => void
  onClearHistory: () => void
  onOpenPDF: (surahId: number, surahName: string) => void
}) {
  return (
    <div className="screen light-screen animate-in">
      <div className="light-header">
        <button className="back-btn" onClick={onBack}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <h1 className="screen-title">Profile</h1>
      </div>

      <div className="screen-scroll">
        {/* Recognition History */}
        <div className="profile-section">
          <div className="profile-section-title">Recognition History</div>
          {history.length === 0 ? (
            <div className="empty-state" style={{ padding: '24px' }}>
              <div className="empty-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                </svg>
              </div>
              <div className="empty-title" style={{ fontSize: 15 }}>No history yet</div>
              <div className="empty-sub">Your identified Ayat will appear here automatically.</div>
            </div>
          ) : (
            history.slice(0, 50).map(entry => (
              <div key={entry.id} className="history-item" onClick={() => onOpenPDF(entry.surahId, entry.surahTranslit)}>
                <div className="history-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                    <path d="M19 10v2a7 7 0 01-14 0v-2"/>
                  </svg>
                </div>
                <div className="history-info">
                  <div className="history-surah">{entry.surahTranslit} · Ayah {entry.ayatNum}</div>
                  <div className="history-meta">{fmtDate(entry.recognizedAt)}</div>
                </div>
                <div className={`history-confidence ${confidenceClass(entry.confidence)}`}>
                  {confidenceLabel(entry.confidence)}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Settings */}
        <div className="profile-section">
          <div className="profile-section-title">Settings</div>
          {history.length > 0 && (
            <div className="settings-item danger" onClick={onClearHistory}>
              <div className="settings-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                </svg>
              </div>
              <span className="settings-label">Clear History</span>
              <span className="settings-value">{history.length} entries</span>
            </div>
          )}
        </div>

        {/* About */}
        <div className="profile-section">
          <div className="profile-section-title">About</div>
          <div className="settings-item" style={{ cursor: 'default' }}>
            <div className="settings-icon" style={{ background: 'var(--mint-xlt)' }}>
              <span style={{ fontFamily: 'Amiri, serif', fontSize: 18, color: 'var(--mint-deep)' }}>آية</span>
            </div>
            <div>
              <div className="settings-label">Ayah v1.0</div>
              <div className="settings-value">Quran Ayah Recognition</div>
            </div>
          </div>
          <div className="settings-item" style={{ cursor: 'default' }}>
            <div className="settings-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              </svg>
            </div>
            <div>
              <div className="settings-label">Quran PDF</div>
              <div className="settings-value">ClearQuran (CC Licensed)</div>
            </div>
          </div>
          <div className="settings-item" style={{ cursor: 'default' }}>
            <div className="settings-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/>
              </svg>
            </div>
            <div>
              <div className="settings-label">AI Model</div>
              <div className="settings-value">tarteel-ai/whisper-base-ar-quran</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// RESULT MODAL
// ════════════════════════════════════════════════════════════
function ResultModal({
  result, bookmarks, onClose, onOpenPDF, onBookmark
}: {
  result: MatchResult
  bookmarks: Bookmark[]
  onClose: () => void
  onOpenPDF: (surahId: number, surahName: string) => void
  onBookmark: (surahId: number, ayatNum: number, arabicText: string, translation?: string) => void
}) {
  const isBookmarked = bookmarks.some(b => b.surahId === result.surah.id && b.ayatNum === result.ayat)

  const handleDragEnd = (_: unknown, info: { offset: { y: number } }) => {
    if (info.offset.y > 80) onClose()
  }

  return (
    <motion.div
      className="result-modal"
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', damping: 28, stiffness: 300 }}
      drag="y"
      dragConstraints={{ top: 0 }}
      dragElastic={0.2}
      onDragEnd={handleDragEnd}
      style={{ position: 'absolute', inset: 0, zIndex: 50 }}
    >
      <div className="modal-drag-handle" />

      <div className="modal-scroll">
        {/* Surah header */}
        <div className="modal-surah-header">
          <div className="modal-surah-badge">{result.surah.id}</div>
          <div className="modal-surah-info">
            <div className="modal-surah-name">{result.transliteration}</div>
            <div className="modal-surah-sub">Ayah {result.ayat} · Juz {result.juz}</div>
          </div>
          <div className={`modal-confidence ${confidenceClass(result.confidence)}`}>
            {confidenceLabel(result.confidence)}
          </div>
        </div>

        {/* Arabic + Translation */}
        <div className="modal-arabic-box">
          <p className="modal-arabic-text">{result.arabicText}</p>
          {result.translation ? (
            <p className="modal-translation">{result.translation}</p>
          ) : (
            <p style={{ fontSize: 13, color: 'var(--text-gray)', textAlign: 'center' }}>Loading translation...</p>
          )}
        </div>

        {/* Primary CTA */}
        <button
          className="modal-primary-btn"
          onClick={() => onOpenPDF(result.surah.id, result.transliteration)}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
          Open in Quran PDF
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>

        {/* Secondary actions */}
        <div className="modal-secondary-btns">
          <button
            className={`modal-sec-btn ${isBookmarked ? 'bookmarked' : ''}`}
            onClick={() => onBookmark(result.surah.id, result.ayat, result.arabicText, result.translation)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill={isBookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
              <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/>
            </svg>
            {isBookmarked ? 'Saved' : 'Bookmark'}
          </button>
          <button className="modal-sec-btn" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
            Dismiss
          </button>
        </div>
      </div>
    </motion.div>
  )
}

// ════════════════════════════════════════════════════════════
// PDF VIEWER SCREEN
// ════════════════════════════════════════════════════════════
type PageMap = Record<string, { surah_number: number; surah_name: string; page: number }>

function PDFViewerScreen({
  surahId, surahName, onBack
}: {
  surahId: number
  surahName: string
  onBack: () => void
}) {
  const pdfPage = getPdfPage(surahId)
  const totalPages = 668
  const [showJumpSheet, setShowJumpSheet] = useState(false)
  const [jumpSearch, setJumpSearch] = useState('')
  const [currentPage] = useState(pdfPage)
  const progress = Math.round((currentPage / totalPages) * 100)
  const pdfSrc = `/src/assets/pdf/quran-arabic-english-clearquran.pdf#page=${pdfPage}`

  const allSurahs = quranFull as QuranChapter[]
  const mapping = pageMapping as PageMap

  const jumpFiltered = jumpSearch.trim()
    ? allSurahs.filter(s => s.transliteration.toLowerCase().includes(jumpSearch.toLowerCase()) || s.name.includes(jumpSearch) || String(s.id).startsWith(jumpSearch))
    : allSurahs

  return (
    <div className="screen pdf-screen animate-in">
      {/* Header */}
      <div className="pdf-header">
        <button className="pdf-back-btn" onClick={onBack} aria-label="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <span className="pdf-surah-name">{surahName}</span>
        <span className="pdf-page-indicator">Page {pdfPage} / {totalPages}</span>
      </div>

      {/* Progress bar */}
      <div className="pdf-progress-bar">
        <div className="pdf-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      {/* PDF iframe */}
      <iframe
        className="pdf-frame"
        src={pdfSrc}
        title={`Quran PDF — ${surahName}`}
      />

      {/* Jump FAB */}
      <button className="pdf-fab" onClick={() => setShowJumpSheet(true)} aria-label="Jump to Surah">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 6s2-2 6-2 6 4 6 4 2-4 6-4 6 2 6 2v14s-2-1-6-1-6 3-6 3-2-3-6-3-6 1-6 1V6z"/>
        </svg>
      </button>

      {/* Jump sheet */}
      <AnimatePresence>
        {showJumpSheet && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 15 }}
              onClick={() => setShowJumpSheet(false)}
            />
            <motion.div
              className="jump-sheet"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            >
              <div className="jump-sheet-handle" />
              <div className="jump-sheet-title">Jump to Surah</div>
              <div style={{ padding: '0 4px 12px' }}>
                <input
                  className="search-input"
                  placeholder="Search by name or number..."
                  value={jumpSearch}
                  onChange={e => setJumpSearch(e.target.value)}
                  style={{ width: '100%', padding: '10px 14px', borderRadius: 12, border: '1.5px solid rgba(62,180,137,0.2)', outline: 'none', background: 'var(--clay-bg)' }}
                />
              </div>
              {jumpFiltered.map(s => (
                <div
                  key={s.id}
                  className={`jump-surah-item ${surahId === s.id ? 'active' : ''}`}
                  onClick={() => {
                    const page = mapping[String(s.id)]?.page ?? 1
                    // Navigate iframe to new page
                    const iframe = document.querySelector('.pdf-frame') as HTMLIFrameElement
                    if (iframe) {
                      iframe.src = `/src/assets/pdf/quran-arabic-english-clearquran.pdf#page=${page}`
                    }
                    setShowJumpSheet(false)
                  }}
                >
                  <span className="jump-surah-num">{s.id}</span>
                  <span className="jump-surah-name">{s.transliteration}</span>
                  <span className="jump-surah-arabic">{s.name}</span>
                </div>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

// ════════════════════════════════════════════════════════════
// MAIN APP
// ════════════════════════════════════════════════════════════
export default function App() {
  // ── Navigation ──────────────────────────────────────────
  const [screen, setScreen] = useState<Screen>('home')
  const [prevScreen, setPrevScreen] = useState<Screen>('home')
  const [showResult, setShowResult] = useState(false)

  // ── AI / Recognition ────────────────────────────────────
  const [isListening, setIsListening]   = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [modelLoading, setModelLoading] = useState(true)
  const [modelError, setModelError]     = useState<string | null>(null)
  const [progress, setProgress]         = useState(0)
  const [statusText, setStatusText]     = useState('')
  const [matchResult, setMatchResult]   = useState<MatchResult | null>(null)

  // ── Bookmarks & History ─────────────────────────────────
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => loadLS<Bookmark[]>(LS_BOOKMARKS, []))
  const [history, setHistory]     = useState<HistoryEntry[]>(() => loadLS<HistoryEntry[]>(LS_HISTORY, []))

  // ── PDF ─────────────────────────────────────────────────
  const [pdfSurahId,   setPdfSurahId]   = useState(1)
  const [pdfSurahName, setPdfSurahName] = useState('Al-Fatiha')

  // ── Quran Browser ───────────────────────────────────────
  const [selectedSurah, setSelectedSurah] = useState<QuranChapter | null>(null)

  // ── Refs ────────────────────────────────────────────────
  const audioChunks  = useRef<Float32Array[]>([])
  const streamRef    = useRef<MediaStream | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transcriber  = useRef<any>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const audioCtxRef  = useRef<AudioContext | null>(null)

  // ── Load model ──────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      try {
        setModelLoading(true)
        setModelError(null)
        transcriber.current = await pipeline(
          'automatic-speech-recognition',
          'eventhorizon0/tarteel-ai-onnx-whisper-base-ar-quran',
          {
            dtype: 'fp32',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            progress_callback: (p: any) => {
              if (p.status === 'progress' && p.progress != null)
                setProgress(Math.round(p.progress))
            }
          }
        )
        setModelLoading(false)
      } catch (err) {
        setModelError(String(err))
        setModelLoading(false)
      }
    }
    init()
  }, [])

  // ── Persist to localStorage ─────────────────────────────
  useEffect(() => { saveLS(LS_BOOKMARKS, bookmarks) }, [bookmarks])
  useEffect(() => { saveLS(LS_HISTORY,   history)   }, [history])

  // ── Navigation helpers ───────────────────────────────────
  const goTo = (s: Screen) => { setPrevScreen(screen); setScreen(s) }
  const goBack = () => setScreen(prevScreen === screen ? 'home' : prevScreen)

  // ── Open PDF ─────────────────────────────────────────────
  const openPDF = useCallback((surahId: number, surahName: string) => {
    setPdfSurahId(surahId)
    setPdfSurahName(surahName)
    setShowResult(false)
    goTo('pdf')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen])

  // ── Mic / Recognition ────────────────────────────────────
  const startListening = async () => {
    if (modelLoading || isProcessing || isListening) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true }
      })
      streamRef.current = stream
      const audioCtx = new AudioContext({ sampleRate: 16000 })
      audioCtxRef.current = audioCtx
      audioChunks.current = []
      const source = audioCtx.createMediaStreamSource(stream)
      const processor = audioCtx.createScriptProcessor(4096, 1, 1)
      processorRef.current = processor
      processor.onaudioprocess = (e) => {
        audioChunks.current.push(new Float32Array(e.inputBuffer.getChannelData(0)))
      }
      source.connect(processor)
      processor.connect(audioCtx.destination)
      setIsListening(true)
      setStatusText('Listening...')

      setTimeout(() => {
        processor.disconnect()
        source.disconnect()
        audioCtx.close()
        stream.getTracks().forEach(t => t.stop())
        setIsListening(false)
        const totalLength = audioChunks.current.reduce((s, c) => s + c.length, 0)
        const merged = new Float32Array(totalLength)
        let offset = 0
        for (const chunk of audioChunks.current) { merged.set(chunk, offset); offset += chunk.length }
        handleRecognition(merged)
      }, 7000)
    } catch {
      setStatusText('Mic access denied!')
      setTimeout(() => setStatusText(''), 3000)
    }
  }

  const handleRecognition = async (audioData: Float32Array) => {
    if (!transcriber.current) return
    setIsProcessing(true)
    setMatchResult(null)
    setStatusText('Identifying...')
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const output = await (transcriber.current as any)(audioData, { return_timestamps: false })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = Array.isArray(output) ? output[0].text : (output as any).text
      if (!text?.trim()) {
        setStatusText('No recitation detected. Try again.')
        setTimeout(() => setStatusText(''), 3000)
        setIsProcessing(false)
        return
      }
      setStatusText('Searching Quran...')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const best = findBestMatch(text, quranFull as any)
      if (best) {
        const surahData = (quranFull as { id: number; name: string; transliteration: string }[]).find(s => s.id === best.surah.id)
        const enSurah   = (quranEn as { id: number; verses: { id: number; translation: string }[] }[]).find(s => s.id === best.surah.id)
        const enVerse   = enSurah?.verses.find(v => v.id === best.ayat)
        const result: MatchResult = {
          ...best,
          juz: getJuz(best.surah.id, best.ayat),
          transliteration: surahData?.transliteration || String(best.surah.id),
          translation: enVerse?.translation
        }
        setMatchResult(result)
        setShowResult(true)
        setStatusText('')
        // Auto-log to history
        const entry: HistoryEntry = {
          id: `${Date.now()}-${Math.random()}`,
          surahId: best.surah.id,
          surahName: best.surah.name,
          surahTranslit: surahData?.transliteration || String(best.surah.id),
          ayatNum: best.ayat,
          confidence: best.confidence,
          recognizedAt: Date.now(),
          pdfPage: getPdfPage(best.surah.id)
        }
        setHistory(prev => [entry, ...prev].slice(0, 100))
      } else {
        setStatusText(`Heard recitation — no Quran match found.`)
        setTimeout(() => setStatusText(''), 5000)
      }
    } catch (err) {
      setStatusText(`Error: ${String(err).slice(0, 60)}`)
      setTimeout(() => setStatusText(''), 5000)
    }
    setIsProcessing(false)
  }

  // ── Bookmark helpers ──────────────────────────────────────
  const addBookmark = (surahId: number, ayatNum: number, arabicText: string, translation?: string) => {
    const already = bookmarks.some(b => b.surahId === surahId && b.ayatNum === ayatNum)
    if (already) {
      // Remove if already bookmarked (toggle)
      setBookmarks(prev => prev.filter(b => !(b.surahId === surahId && b.ayatNum === ayatNum)))
      return
    }
    const surahData = (quranFull as { id: number; name: string; transliteration: string }[]).find(s => s.id === surahId)
    const bk: Bookmark = {
      id: `${Date.now()}-${Math.random()}`,
      surahId,
      surahName: surahData?.name ?? '',
      surahTranslit: surahData?.transliteration ?? String(surahId),
      ayatNum,
      arabicText,
      translation,
      savedAt: Date.now(),
      pdfPage: getPdfPage(surahId)
    }
    setBookmarks(prev => [bk, ...prev])
  }

  const deleteBookmark = (id: string) => setBookmarks(prev => prev.filter(b => b.id !== id))
  const clearHistory   = () => setHistory([])

  // ════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════
  return (
    <div className="app-root">
      <div className="shell">

        {/* ── MODEL LOADING OVERLAY ── */}
        <AnimatePresence>
          {(modelLoading || modelError) && (
            <motion.div
              className="loading-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.5 } }}
              style={{ zIndex: 100 }}
            >
              <div className="loading-logo-arabic">آية</div>
              <div className="loading-logo-latin">Ayah</div>
              <div className="loading-subtitle">
                {modelError ? 'Failed to load AI model' : 'Loading AI recognition model...'}
              </div>
              {modelError ? (
                <>
                  <div className="loading-error">{modelError.slice(0, 120)}</div>
                  <button className="retry-btn" onClick={() => window.location.reload()}>Retry</button>
                </>
              ) : (
                <>
                  <div className="loading-bar-track">
                    <div className="loading-bar-fill" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="loading-percent">{progress}% · ~145 MB</div>
                  <div style={{ fontSize: 12, opacity: 0.6, marginTop: 12 }}>Hear it. Know it. Read it.</div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── SCREENS ── */}
        <AnimatePresence mode="wait">

          {/* HOME */}
          {screen === 'home' && (
            <HomeScreen
              key="home"
              isListening={isListening}
              isProcessing={isProcessing}
              modelLoading={modelLoading}
              statusText={statusText}
              lastResult={matchResult}
              showResult={showResult}
              onMicTap={startListening}
              onLibrary={() => goTo('library')}
              onQuran={() => goTo('quran')}
              onOpenResult={() => setShowResult(true)}
              onOpenPDF={openPDF}
            />
          )}

          {/* LIBRARY */}
          {screen === 'library' && (
            <motion.div
              key="library"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              style={{ position: 'absolute', inset: 0, zIndex: 20 }}
            >
              <LibraryScreen
                bookmarks={bookmarks}
                onBack={() => setScreen('home')}
                onDelete={deleteBookmark}
                onOpenPDF={openPDF}
              />
            </motion.div>
          )}

          {/* QURAN BROWSER */}
          {screen === 'quran' && (
            <motion.div
              key="quran"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              style={{ position: 'absolute', inset: 0, zIndex: 20 }}
            >
              <QuranBrowserScreen
                onBack={() => setScreen('home')}
                onSurahDetail={(s) => { setSelectedSurah(s); goTo('surah-detail') }}
                onReadPDF={openPDF}
              />
            </motion.div>
          )}

          {/* SURAH DETAIL */}
          {screen === 'surah-detail' && selectedSurah && (
            <motion.div
              key="surah-detail"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              style={{ position: 'absolute', inset: 0, zIndex: 30 }}
            >
              <SurahDetailScreen
                surah={selectedSurah}
                bookmarks={bookmarks}
                onBack={goBack}
                onBookmark={addBookmark}
                onViewPDF={openPDF}
                onReadPDF={openPDF}
              />
            </motion.div>
          )}

          {/* PROFILE */}
          {screen === 'profile' && (
            <motion.div
              key="profile"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              style={{ position: 'absolute', inset: 0, zIndex: 20 }}
            >
              <ProfileScreen
                history={history}
                onBack={() => setScreen('home')}
                onClearHistory={clearHistory}
                onOpenPDF={openPDF}
              />
            </motion.div>
          )}

          {/* PDF VIEWER */}
          {screen === 'pdf' && (
            <motion.div
              key="pdf"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 280 }}
              style={{ position: 'absolute', inset: 0, zIndex: 60 }}
            >
              <PDFViewerScreen
                surahId={pdfSurahId}
                surahName={pdfSurahName}
                onBack={goBack}
              />
            </motion.div>
          )}

        </AnimatePresence>

        {/* ── RESULT MODAL (overlay on home) ── */}
        <AnimatePresence>
          {showResult && matchResult && screen === 'home' && (
            <ResultModal
              result={matchResult}
              bookmarks={bookmarks}
              onClose={() => setShowResult(false)}
              onOpenPDF={openPDF}
              onBookmark={addBookmark}
            />
          )}
        </AnimatePresence>

        {/* ── BOTTOM NAV (home screen) ── */}
        {screen === 'home' && !showResult && (
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            zIndex: 15, paddingBottom: 24, paddingLeft: 16, paddingRight: 16,
            display: 'flex', justifyContent: 'center'
          }}>
            <div className="bottom-nav-glass">
              <button
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
                onClick={() => goTo('profile')}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
                <span style={{ fontSize: 10, fontFamily: 'Nunito, sans-serif', fontWeight: 700 }}>Profile</span>
              </button>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--mint-glow)' }}/>
              <button
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
                onClick={() => goTo('quran')}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 6s2-2 6-2 6 4 6 4 2-4 6-4 6 2 6 2v14s-2-1-6-1-6 3-6 3-2-3-6-3-6 1-6 1V6z"/>
                </svg>
                <span style={{ fontSize: 10, fontFamily: 'Nunito, sans-serif', fontWeight: 700 }}>Quran</span>
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
