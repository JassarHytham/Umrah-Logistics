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

  it('returns "en" for an English-mode capture with a stray untranslated Arabic UI value', () => {
    // Real portal behavior: the "Transporter Type" dropdown's selected value
    // is rendered in Arabic ("خارجي" = External) even on English-mode pages.
    // A single leaked Arabic word must not flip the whole capture to Arabic.
    const text = 'Arrival Journey Arrival Date 2026-07-15 Departure Journey Transporter * خارجي';
    expect(detectCaptureLang(text)).toBe('en');
  });
});
