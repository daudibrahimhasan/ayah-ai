/**
 * Standard Juz (Para) mapping for the Quran.
 * Each entry is [surahId, ayahId] marking the START of that Juz.
 * Index 0 = Juz 1, Index 29 = Juz 30.
 */
const JUZ_BOUNDARIES: [number, number][] = [
  [1, 1],    // Juz 1:  Al-Fatiha 1
  [2, 142],  // Juz 2:  Al-Baqarah 142
  [2, 253],  // Juz 3:  Al-Baqarah 253
  [3, 93],   // Juz 4:  Ali 'Imran 93
  [4, 24],   // Juz 5:  An-Nisa 24
  [4, 148],  // Juz 6:  An-Nisa 148
  [5, 82],   // Juz 7:  Al-Ma'idah 82
  [6, 111],  // Juz 8:  Al-An'am 111
  [7, 88],   // Juz 9:  Al-A'raf 88
  [8, 41],   // Juz 10: Al-Anfal 41
  [9, 93],   // Juz 11: At-Tawbah 93
  [11, 6],   // Juz 12: Hud 6
  [12, 53],  // Juz 13: Yusuf 53
  [15, 1],   // Juz 14: Al-Hijr 1
  [17, 1],   // Juz 15: Al-Isra 1
  [18, 75],  // Juz 16: Al-Kahf 75
  [21, 1],   // Juz 17: Al-Anbya 1
  [23, 1],   // Juz 18: Al-Mu'minun 1
  [25, 21],  // Juz 19: Al-Furqan 21
  [27, 56],  // Juz 20: An-Naml 56
  [29, 46],  // Juz 21: Al-'Ankabut 46
  [33, 31],  // Juz 22: Al-Ahzab 31
  [36, 28],  // Juz 23: Ya-Sin 28
  [39, 32],  // Juz 24: Az-Zumar 32
  [41, 47],  // Juz 25: Fussilat 47
  [46, 1],   // Juz 26: Al-Ahqaf 1
  [51, 31],  // Juz 27: Adh-Dhariyat 31
  [58, 1],   // Juz 28: Al-Mujadila 1
  [67, 1],   // Juz 29: Al-Mulk 1
  [78, 1],   // Juz 30: An-Naba 1
];

/**
 * Given a surah ID and ayah number, returns the Juz (Para) number (1-30).
 */
export const getJuz = (surahId: number, ayahId: number): number => {
  for (let i = JUZ_BOUNDARIES.length - 1; i >= 0; i--) {
    const [startSurah, startAyah] = JUZ_BOUNDARIES[i];
    if (surahId > startSurah || (surahId === startSurah && ayahId >= startAyah)) {
      return i + 1; // Juz numbers are 1-based
    }
  }
  return 1;
};
