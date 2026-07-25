
export const detectCaptureLang = (text: string): 'ar' | 'en' =>
  /[؀-ۿ]/.test(text) ? 'ar' : 'en';
