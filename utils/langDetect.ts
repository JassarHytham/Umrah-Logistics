
// Detect language from the structural journey markers each parser relies on,
// not from the mere presence of Arabic characters: the real portal leaves
// some UI values (e.g. a "Transporter Type" dropdown option) untranslated
// even on English-mode pages, and a single leaked Arabic word must not flip
// an otherwise-English capture to the Arabic parser.
export const detectCaptureLang = (text: string): 'ar' | 'en' => {
  const hasArabicMarkers = text.includes('رحلة الوصول') || text.includes('رحلة المغادرة');
  if (hasArabicMarkers) return 'ar';
  const hasEnglishMarkers = text.includes('Arrival Journey') || text.includes('Departure Journey');
  if (hasEnglishMarkers) return 'en';
  return /[؀-ۿ]/.test(text) ? 'ar' : 'en';
};
