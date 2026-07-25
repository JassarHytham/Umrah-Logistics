import { describe, it, expect } from 'vitest';
import { detectCaptureLang } from '../utils/langDetect';

describe('detectCaptureLang', () => {
  it('returns "ar" for pure Arabic text', () => {
    expect(detectCaptureLang('رحلة الوصول تاريخ الوصول')).toBe('ar');
  });

  it('returns "en" for pure English text', () => {
    expect(detectCaptureLang('Arrival Journey Arrival Date')).toBe('en');
  });

  it('returns "ar" for mixed content containing any Arabic characters', () => {
    expect(detectCaptureLang('Arrival Journey رحلة الوصول')).toBe('ar');
  });
});
