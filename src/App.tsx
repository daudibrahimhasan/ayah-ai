import { useState, useRef, useEffect } from 'react'
import { Music, Ticket, Search, User, Settings, History, Bookmark, Loader2, Share2, ArrowRightCircle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { pipeline, env } from '@huggingface/transformers'
import surahsData from './assets/data/surahs.json'
import quranFull from './assets/data/quran_full.json'
import quranEn from './assets/data/quran_en.json'
import { findBestMatch } from './utils/search'
import { getJuz } from './utils/juz'
import './App.css'

// Configure transformers.js v3 to fetch from Hugging Face Hub
env.allowLocalModels = false;
env.useBrowserCache = typeof caches !== 'undefined'; // Only if Cache API available

interface MatchResult {
  surah: { id: number; name: string };
  ayat: number;
  arabicText: string;
  confidence: number;
  juz: number;
  transliteration: string;
  translation?: string;
}

function App() {
  const [currentPage, setCurrentPage] = useState(1);
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [modelLoading, setModelLoading] = useState(true);
  const [modelError, setModelError] = useState<string | null>(null);
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioChunks = useRef<Float32Array[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transcriber = useRef<any>(null);

  useEffect(() => {
    const initModel = async () => {
      try {
        setModelLoading(true);
        setModelError(null);
        transcriber.current = await pipeline(
          'automatic-speech-recognition',
          'eventhorizon0/tarteel-ai-onnx-whisper-base-ar-quran',
          {
            dtype: 'fp32',  // Full precision for accurate Arabic transcription
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            progress_callback: (p: any) => {
              if (p.status === 'progress' && p.progress != null) {
                setProgress(Math.round(p.progress));
              }
            }
          }
        );
        console.log('[Ayah] ✅ Model loaded successfully!');
        setModelLoading(false);
      } catch (err) {
        console.error('Model Error:', err);
        setModelError(String(err));
        setModelLoading(false);
      }
    };
    initModel();
  }, []);

  const startListening = async () => {
    if (modelLoading || isProcessing) {
      console.log('[Ayah] Blocked: modelLoading=', modelLoading, 'isProcessing=', isProcessing);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { echoCancellation: true, noiseSuppression: true } 
      });
      streamRef.current = stream;
      
      // Capture raw PCM at 16kHz — exactly what Whisper expects
      const audioCtx = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioCtx;
      audioChunks.current = [];
      
      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      
      processor.onaudioprocess = (e) => {
        const data = e.inputBuffer.getChannelData(0);
        audioChunks.current.push(new Float32Array(data));
      };
      
      source.connect(processor);
      processor.connect(audioCtx.destination);
      
      setIsListening(true);
      setStatusText('LISTENING...');
      console.log('[Ayah] 🎙️ Recording raw PCM at 16kHz...');
      
      // Stop after 7 seconds
      setTimeout(() => {
        processor.disconnect();
        source.disconnect();
        audioCtx.close();
        stream.getTracks().forEach(t => t.stop());
        setIsListening(false);
        
        // Merge all chunks into one Float32Array
        const totalLength = audioChunks.current.reduce((sum, c) => sum + c.length, 0);
        const merged = new Float32Array(totalLength);
        let offset = 0;
        for (const chunk of audioChunks.current) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        
        console.log('[Ayah] Captured', merged.length, 'samples (', (merged.length / 16000).toFixed(1), 'seconds)');
        handleRecognition(merged);
      }, 7000);
    } catch (err) {
      console.error("Mic Access Denied:", err);
      setStatusText('Mic access denied!');
      setTimeout(() => setStatusText(''), 3000);
    }
  }

  const handleRecognition = async (audioData: Float32Array) => {
    if (!transcriber.current) {
      console.error('[Ayah] No model loaded!');
      setStatusText('Model not loaded. Refresh page.');
      return;
    }
    setIsProcessing(true);
    setMatchResult(null);
    setStatusText('Running AI recognition...');
    
    try {
      console.log('[Ayah] Running Whisper on', audioData.length, 'samples...');
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const output = await (transcriber.current as any)(audioData, {
        return_timestamps: false,
      });
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const transcribedText = Array.isArray(output) ? output[0].text : (output as any).text;
      console.log('[Ayah] ✅ Whisper output:', `"${transcribedText}"`);
      
      if (!transcribedText || transcribedText.trim().length === 0) {
        console.log('[Ayah] ❌ Empty transcription');
        setStatusText('No speech detected. Try again.');
        setTimeout(() => { setStatusText(''); setIsProcessing(false); }, 3000);
        return;
      }
      
      setStatusText('Searching Quran...');
      console.log('[Ayah] 3/3 Searching Quran database...');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bestMatch = findBestMatch(transcribedText, quranFull as any);
      
      if (bestMatch) {
         const surahData = (quranFull as { id: number; name: string; transliteration: string }[]).find(s => s.id === bestMatch.surah.id);
         // Look up English translation from local data (offline)
         const enSurah = (quranEn as { id: number; verses: { id: number; translation: string }[] }[]).find(s => s.id === bestMatch.surah.id);
         const enVerse = enSurah?.verses.find(v => v.id === bestMatch.ayat);
         
         setMatchResult({
           ...bestMatch,
           juz: getJuz(bestMatch.surah.id, bestMatch.ayat),
           transliteration: surahData?.transliteration || String(bestMatch.surah.id),
           translation: enVerse?.translation || undefined
         });
         setStatusText('');
         console.log('[Ayah] ✅ Match found!');
      } else {
         setStatusText(`Heard: "${transcribedText.slice(0, 50)}" — No Quran match`);
         console.log('[Ayah] ❌ No match for:', `"${transcribedText}"`);
         setTimeout(() => setStatusText(''), 5000);
      }
    } catch (err) {
      console.error('[Ayah] Pipeline Error:', err);
      setStatusText(`Error: ${String(err).slice(0, 80)}`);
      setTimeout(() => setStatusText(''), 5000);
    }
    setIsProcessing(false);
  };

  const handleDragEnd = (_: unknown, info: { offset: { x: number } }) => {
    const threshold = 50;
    if (info.offset.x > threshold && currentPage > 0) {
      setCurrentPage(currentPage - 1);
    } else if (info.offset.x < -threshold && currentPage < 2) {
      setCurrentPage(currentPage + 1);
    }
  };

  return (
    <div className="shazam-wrapper" style={{
      height: '100vh',
      width: '100vw',
      overflow: 'hidden',
      position: 'relative',
      background: 'var(--background)'
    }}>
      
      {/* MODEL LOADING OVERLAY */}
      <AnimatePresence>
        {(modelLoading || modelError) && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="model-loading-overlay"
            style={{
              position: 'absolute', inset: 0, zIndex: 100,
              background: 'var(--mint-bg-start)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              color: 'white', gap: '1rem'
            }}
          >
            {modelError ? (
              <>
                <h3 style={{ fontWeight: 800 }}>Model failed to load</h3>
                <p style={{ fontSize: '0.85rem', opacity: 0.7, maxWidth: '300px', textAlign: 'center' }}>
                  {modelError.slice(0, 120)}
                </p>
                <button 
                  onClick={() => window.location.reload()}
                  style={{
                    marginTop: '1rem', padding: '1rem 2rem', borderRadius: '20px',
                    background: 'white', color: 'var(--mint-primary)', border: 'none',
                    fontWeight: 800, fontSize: '1rem', cursor: 'pointer'
                  }}
                >
                  Retry
                </button>
              </>
            ) : (
              <>
                <Loader2 className="animate-spin" size={48} />
                <h3 style={{ fontWeight: 800 }}>Downloading Ayah AI Model...</h3>
                <div style={{ width: '200px', height: '6px', background: 'rgba(255,255,255,0.2)', borderRadius: '3px', overflow: 'hidden' }}>
                  <motion.div 
                    animate={{ width: `${progress}%` }}
                    style={{ height: '100%', background: 'white' }}
                  />
                </div>
                <p style={{ fontSize: '0.8rem', opacity: 0.8 }}>{progress}% complete (~145MB)</p>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* BACKGROUND SWIPE LAYER */}
      <motion.div 
        drag="x"
        dragConstraints={{ left: -window.innerWidth * 2, right: 0 }}
        dragElastic={0.2}
        onDragEnd={handleDragEnd}
        animate={{ x: -currentPage * window.innerWidth }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className="shazam-page-wrapper"
      >
        
        {/* PAGE 0: LIBRARY */}
        <div className="page-container" style={{ padding: '2rem' }}>
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3rem' }}>
            <div style={{ background: 'rgba(255,255,255,0.2)', padding: '0.8rem', borderRadius: '50%' }}><User size={24} /></div>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700 }}>Ayah Library</h2>
            <div style={{ background: 'rgba(255,255,255,0.2)', padding: '0.8rem', borderRadius: '50%' }}><Settings size={24} /></div>
          </header>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.9rem', opacity: 0.8 }}>RECITATION HISTORY</span>
                <span style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.6)' }}>See all</span>
             </div>
             <div style={{ background: 'rgba(255,255,255,0.15)', padding: '2rem', borderRadius: '24px', textAlign: 'center' }}>
                <History size={48} style={{ opacity: 0.2, marginBottom: '1rem' }} />
                <p style={{ fontWeight: 600 }}>Your recognition history will appear here.</p>
             </div>
          </div>
        </div>

        {/* PAGE 1: HOME (THE MAIN BUTTON) */}
        <div className="page-container" style={{ position: 'relative' }}>
          <header style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '1.2rem 1.8rem',
            alignItems: 'flex-start',
            zIndex: 10
          }}>
            <button onClick={() => setCurrentPage(0)} style={{ border: 'none', background: 'none', color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer' }}>
              <Music size={26} strokeWidth={2.5} />
              <span style={{ fontSize: '0.7rem', fontWeight: 700 }}>Library</span>
            </button>
            <div style={{ display: 'flex', gap: '6px', paddingTop: '10px' }}>
              <div className={`dot ${currentPage === 0 ? 'active' : ''}`} />
              <div className={`dot ${currentPage === 1 ? 'active' : ''}`} />
              <div className={`dot ${currentPage === 2 ? 'active' : ''}`} />
            </div>
            <button onClick={() => setCurrentPage(2)} style={{ border: 'none', background: 'none', color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer' }}>
              <Ticket size={26} strokeWidth={2.5} />
              <span style={{ fontSize: '0.7rem', fontWeight: 700 }}>Quran</span>
            </button>
          </header>

          <main style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', marginTop: '-5rem' }}>
            <motion.h2 
              className="tap-text"
              style={{ opacity: (isListening || isProcessing) ? 0 : 1 }}
              initial={{ opacity: 0.8 }}
              animate={{ opacity: [0.8, 1, 0.8] }}
              transition={{ repeat: Infinity, duration: 2 }}
            >
              Tap to Ayah
            </motion.h2>
            <div className={`shazam-btn-halo ${(!isListening && !isProcessing) ? 'floating-shazam' : 'listening-pulse'}`}>
              <button 
                className="shazam-btn-inner"
                onClick={startListening}
                style={{ 
                  border: 'none', outline: 'none', cursor: 'pointer',
                  opacity: modelLoading ? 0.5 : 1
                }}
              >
                <div style={{ color: 'var(--mint-primary)' }}>
                  {isProcessing ? (
                    <Loader2 className="animate-spin" size={60} />
                  ) : (
                    <svg width="100" height="100" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                      {/* Flowing Alif — the vertical backbone */}
                      <path 
                        d="M50 15 C50 15, 50 45, 50 60 Q50 78, 38 82" 
                        stroke="currentColor" strokeWidth="7" strokeLinecap="round" fill="none"
                      />
                      {/* Right sound wave arc */}
                      <path 
                        d="M58 30 Q72 50, 58 70" 
                        stroke="currentColor" strokeWidth="5" strokeLinecap="round" fill="none" opacity="0.7"
                      />
                      {/* Outer right sound wave */}
                      <path 
                        d="M66 22 Q85 50, 66 78" 
                        stroke="currentColor" strokeWidth="4" strokeLinecap="round" fill="none" opacity="0.4"
                      />
                      {/* Left sound wave arc */}
                      <path 
                        d="M42 30 Q28 50, 42 70" 
                        stroke="currentColor" strokeWidth="5" strokeLinecap="round" fill="none" opacity="0.7"
                      />
                      {/* Outer left sound wave */}
                      <path 
                        d="M34 22 Q15 50, 34 78" 
                        stroke="currentColor" strokeWidth="4" strokeLinecap="round" fill="none" opacity="0.4"
                      />
                      {/* Madda arc crown ـٓ */}
                      <path 
                        d="M40 12 Q50 5, 60 12" 
                        stroke="currentColor" strokeWidth="4" strokeLinecap="round" fill="none"
                      />
                      {/* Decorative nuqta (dot) */}
                      <circle cx="50" cy="90" r="4" fill="currentColor" />
                    </svg>
                  )}
                </div>
              </button>
            </div>
            <div style={{ 
              marginTop: '2rem', fontSize: '1.1rem', fontWeight: 600, 
              minHeight: '4em', textAlign: 'center',
              maxWidth: '300px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.8rem',
            }}>
              {/* Animated sound wave bars */}
              {(isListening || isProcessing) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '3px', height: '30px' }}>
                  {[0, 1, 2, 3, 4].map(i => (
                    <motion.div
                      key={i}
                      animate={{ 
                        height: isListening 
                          ? [8, 24, 12, 28, 8] 
                          : [6, 14, 10, 18, 6]
                      }}
                      transition={{ 
                        repeat: Infinity, 
                        duration: 0.8 + i * 0.15, 
                        ease: 'easeInOut' 
                      }}
                      style={{ 
                        width: '4px', borderRadius: '2px', 
                        background: 'white', opacity: 0.9 
                      }}
                    />
                  ))}
                </div>
              )}
              {/* Status text with pulse */}
              <motion.span
                animate={{ opacity: statusText ? [0.6, 1, 0.6] : 0 }}
                transition={{ repeat: Infinity, duration: 1.5 }}
                style={{ fontSize: '1rem' }}
              >
                {statusText || '\u00A0'}
              </motion.span>
            </div>
          </main>

          <footer style={{ display: 'flex', justifyContent: 'center', paddingBottom: '4rem' }}>
            <div className="bottom-search-btn"><Search size={22} color="white" strokeWidth={3} /></div>
          </footer>
        </div>

        {/* PAGE 2: QURAN INDEX */}
        <div className="page-container" style={{ padding: '2rem' }}>
           <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
              <h2 style={{ fontSize: '1.8rem', fontWeight: 900 }}>Quran Index</h2>
              <div className="bottom-search-btn" style={{ background: 'rgba(255,255,255,0.1)' }}><Search size={20} /></div>
           </header>
           <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {(quranFull as { id: number; name: string; transliteration: string; verses: { id: number; text: string }[] }[]).map(s => {
                const surahMeta = surahsData.find(m => m.number === s.id);
                return (
                  <motion.div 
                    key={s.id} 
                    id={`surah-${s.id}`} 
                    whileTap={{ scale: 0.98 }}
                    onClick={() => console.log(`Open Surah ${s.id}`)}
                    style={{ background: 'rgba(255,255,255,0.15)', padding: '1rem 1.2rem', borderRadius: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', direction: 'rtl', cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                      <span style={{ opacity: 0.5, fontSize: '0.8rem', minWidth: '24px', textAlign: 'center' }}>{s.id}</span>
                      <div>
                        <h3 style={{ fontWeight: 800, fontFamily: 'Amiri, serif', fontSize: '1.1rem' }}>{s.name}</h3>
                        <p style={{ fontSize: '0.7rem', opacity: 0.5, fontFamily: 'var(--font-main)' }}>{s.transliteration} · {s.verses.length} Ayah</p>
                      </div>
                    </div>
                    <span style={{ fontSize: '0.75rem', opacity: 0.5 }}>Page {surahMeta?.page || '—'}</span>
                  </motion.div>
                );
              })}
           </div>
        </div>

      </motion.div>

      {/* RESULT MODAL */}
      <AnimatePresence>
        {matchResult && (
          <motion.div 
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            drag="y"
            dragConstraints={{ top: 0 }}
            onDragEnd={(_, info) => { if (info.offset.y > 100) setMatchResult(null); }}
            style={{
              position: 'absolute', inset: 0, zIndex: 110,
              background: 'white', borderRadius: '32px 32px 0 0',
              padding: '2rem', color: 'var(--mint-primary)',
              display: 'flex', flexDirection: 'column',
              boxShadow: '0 -20px 40px rgba(0,0,0,0.1)'
            }}
          >
            <div style={{ width: '40px', height: '5px', background: '#eee', borderRadius: '3px', alignSelf: 'center', marginBottom: '2rem' }} />
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
              <div style={{ background: 'var(--mint-bg-start)', color: 'white', width: '40px', height: '40px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900 }}>
                {matchResult.surah.id}
              </div>
              <div>
                <h3 style={{ fontWeight: 800, fontSize: '1.4rem' }}>{matchResult.transliteration}</h3>
                <p style={{ opacity: 0.7 }}>Ayah {matchResult.ayat} · Juz {matchResult.juz}</p>
              </div>
              <div style={{ marginLeft: 'auto', background: '#F0FBF6', padding: '0.5rem 1rem', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 700 }}>
                {matchResult.confidence}% match
              </div>
            </div>

            <div style={{ 
              background: '#F0FBF6', padding: '1.5rem 2rem', borderRadius: '24px', 
              marginBottom: '1.5rem', maxHeight: '40vh', overflowY: 'auto'
            }}>
              {/* Arabic text */}
              <p style={{ 
                fontSize: '1.6rem', fontWeight: 700, fontFamily: 'Amiri, serif', 
                lineHeight: 1.8, textAlign: 'right', direction: 'rtl',
                borderBottom: matchResult.translation ? '1px solid rgba(16,185,129,0.15)' : 'none',
                paddingBottom: matchResult.translation ? '1rem' : 0,
                marginBottom: matchResult.translation ? '1rem' : 0,
              }}>
                {matchResult.arabicText}
              </p>
              
              {/* English Translation */}
              {matchResult.translation ? (
                <p style={{ 
                  fontSize: '1rem', lineHeight: 1.7, color: '#555',
                  fontStyle: 'italic', textAlign: 'left'
                }}>
                  "{matchResult.translation}"
                </p>
              ) : (
                <p style={{ fontSize: '0.85rem', opacity: 0.4, textAlign: 'center', paddingTop: '0.5rem' }}>
                  Loading translation...
                </p>
              )}
            </div>

            <button 
              onClick={() => {
                // Navigate to Quran index and scroll to matched surah
                setMatchResult(null);
                setCurrentPage(2);
                setTimeout(() => {
                  const el = document.getElementById(`surah-${matchResult.surah.id}`);
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.style.background = 'rgba(255,255,255,0.4)';
                    setTimeout(() => { el.style.background = 'rgba(255,255,255,0.15)'; }, 2000);
                  }
                }, 500);
              }}
              style={{
                background: 'var(--mint-bg-start)', color: 'white',
                border: 'none', padding: '1.5rem', borderRadius: '24px',
                fontWeight: 900, fontSize: '1.1rem', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem'
              }}
            >
              Open {matchResult.transliteration} : {matchResult.ayat} <ArrowRightCircle />
            </button>

            <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
               <button style={{ flex: 1, padding: '1.2rem', borderRadius: '20px', border: '2px solid #eee', background: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontWeight: 700 }}><Bookmark size={20} /> Bookmark</button>
               <button style={{ flex: 1, padding: '1.2rem', borderRadius: '20px', border: '2px solid #eee', background: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontWeight: 700 }}><Share2 size={20} /> Share</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* FIXED NAVIGATION HINT (Bottom line like iOS) */}
      <div style={{ position: 'absolute', bottom: '1.5rem', left: '50%', transform: 'translateX(-50%)', width: '135px', height: '5px', background: 'white', borderRadius: '2.5px', opacity: 0.3 }}></div>

    </div>
  )
}

export default App
