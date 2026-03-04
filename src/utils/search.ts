/**
 * Fuzzy search for Quranic text matching.
 * Strips diacritics, then uses n-gram overlap scoring 
 * instead of exact substring matching.
 */

export const stripDiacritics = (text: string): string => {
  // Remove Arabic diacritics (tashkeel) + Quranic marks
  return text.replace(/[\u064B-\u0652\u06D6-\u06ED\u0670\u0640]/g, "").trim();
};

interface Verse {
  id: number;
  text: string;
}

interface Chapter {
  id: number;
  name: string;
  transliteration: string;
  verses: Verse[];
}

/**
 * Breaks text into word-level n-grams and computes overlap ratio.
 */
const computeWordOverlap = (a: string, b: string): number => {
  const wordsA = a.split(/\s+/).filter(w => w.length > 1);
  const wordsB = b.split(/\s+/).filter(w => w.length > 1);
  
  if (wordsA.length === 0 || wordsB.length === 0) return 0;
  
  let matches = 0;
  for (const word of wordsA) {
    if (wordsB.some(bWord => bWord.includes(word) || word.includes(bWord))) {
      matches++;
    }
  }
  
  // Score = matched words / total unique words
  return matches / Math.max(wordsA.length, wordsB.length);
};

/**
 * Character-level longest common subsequence ratio
 */
const computeCharOverlap = (a: string, b: string): number => {
  const shorter = a.length < b.length ? a : b;
  const longer = a.length >= b.length ? a : b;
  
  if (shorter.length === 0) return 0;
  
  let matchCount = 0;
  let searchStart = 0;
  
  for (const char of shorter) {
    const idx = longer.indexOf(char, searchStart);
    if (idx !== -1) {
      matchCount++;
      searchStart = idx + 1;
    }
  }
  
  return matchCount / longer.length;
};

export const findBestMatch = (transcribedText: string, quranData: Chapter[]) => {
  const strippedTranscribed = stripDiacritics(transcribedText);
  
  console.log('[Search] Looking for:', `"${strippedTranscribed}"`);
  console.log('[Search] Scanning', quranData.length, 'surahs...');
  
  if (!strippedTranscribed || strippedTranscribed.length < 3) {
    console.log('[Search] Transcription too short, skipping.');
    return null;
  }
  
  let bestMatch = null;
  let highestScore = 0;
  
  for (const surah of quranData) {
    for (const verse of surah.verses) {
      const strippedVerse = stripDiacritics(verse.text);
      
      // Compute combined score using word overlap + character overlap
      const wordScore = computeWordOverlap(strippedTranscribed, strippedVerse);
      const charScore = computeCharOverlap(strippedTranscribed, strippedVerse);
      
      // Also check direct substring containment (bonus)
      let containsBonus = 0;
      if (strippedVerse.includes(strippedTranscribed) || strippedTranscribed.includes(strippedVerse)) {
        containsBonus = 0.3;
      }
      
      const totalScore = (wordScore * 0.5) + (charScore * 0.3) + containsBonus;
      
      if (totalScore > highestScore && totalScore > 0.15) {
        highestScore = totalScore;
        bestMatch = {
          surah: { id: surah.id, name: surah.name },
          ayat: verse.id,
          arabicText: verse.text,
          confidence: Math.min(99, Math.round(totalScore * 100))
        };
      }
    }
  }
  
  if (bestMatch) {
    console.log('[Search] ✅ Best match:', bestMatch.surah.name, 'Ayat', bestMatch.ayat, 
      '| Confidence:', bestMatch.confidence + '%');
  } else {
    console.log('[Search] ❌ No match found above threshold.');
  }
  
  return bestMatch;
};
