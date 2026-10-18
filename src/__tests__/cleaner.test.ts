import { describe, it, expect } from 'vitest';
import {
  cleanDescription,
  stripHtmlTags,
  decodeHtmlEntities,
  normalizeWhitespace,
  detectMalformedEncoding,
} from '../cleaner.js';

describe('Description Cleaner & Normalizer', () => {
  it('strips basic HTML tags and preserves paragraph breaks', () => {
    const html = '<p>First paragraph.</p><p>Second paragraph with <strong>bold</strong> and <em>italic</em>.</p>';
    const cleaned = cleanDescription(null, html);
    expect(cleaned.text).toBe('First paragraph.\n\nSecond paragraph with bold and italic.');
  });

  it('handles unordered list tags with bullet points', () => {
    const html = '<p>Features:</p><ul><li>Feature A</li><li>Feature B</li><li>Feature C</li></ul>';
    const cleaned = cleanDescription(null, html);
    expect(cleaned.text).toContain('• Feature A');
    expect(cleaned.text).toContain('• Feature B');
    expect(cleaned.text).toContain('• Feature C');
  });

  it('preserves Arabic and English text perfectly without distortion', () => {
    const arabicEnglish =
      '<p>عطر فاخر بحجم 100 مل - Exclusive Luxury Perfume 100ml</p>' +
      '<ul>' +
      '<li>المكونات العليا: البرغموت والياسمين (Top Notes: Bergamot & Jasmine)</li>' +
      '<li>ثبات يدوم حتى 24 ساعة (Lasts up to 24 hours)</li>' +
      '</ul>';

    const cleaned = cleanDescription(null, arabicEnglish);

    expect(cleaned.text).toContain('عطر فاخر بحجم 100 مل - Exclusive Luxury Perfume 100ml');
    expect(cleaned.text).toContain('المكونات العليا: البرغموت والياسمين (Top Notes: Bergamot & Jasmine)');
    expect(cleaned.text).toContain('ثبات يدوم حتى 24 ساعة (Lasts up to 24 hours)');
    expect(cleaned.isMalformed).toBe(false);
  });

  it('preserves numbers, dimensions, percentages, and prices', () => {
    const textWithSpecs = 'Dimensions: 15.5cm x 10cm x 5.2cm. Weight: 250g. Battery: 5000mAh (85% efficiency). Price: 199.99 SAR.';
    const cleaned = cleanDescription(textWithSpecs);
    expect(cleaned.text).toBe(textWithSpecs);
  });

  it('decodes HTML entities correctly', () => {
    const raw = 'iPhone 15 Pro &amp; Max &bull; 256GB &quot;Space Black&quot; &#39;Special Edition&#39; &copy; 2026';
    const decoded = decodeHtmlEntities(raw);
    expect(decoded).toBe('iPhone 15 Pro & Max • 256GB "Space Black" \'Special Edition\' © 2026');
  });

  it('detects Unicode replacement character (U+FFFD)', () => {
    const corruptedText = 'Defective string with \uFFFD replacement symbol';
    const check = detectMalformedEncoding(corruptedText);
    expect(check.isMalformed).toBe(true);
    expect(check.reasons[0]).toContain('U+FFFD');
  });

  it('prefers native plain description over descriptionHtml when plain description exists', () => {
    const plain = 'Native plain description without any HTML tags.';
    const html = '<p>HTML description that should be ignored.</p>';
    const cleaned = cleanDescription(plain, html);
    expect(cleaned.text).toBe('Native plain description without any HTML tags.');
  });

  it('normalizes excessive consecutive line breaks to max 2', () => {
    const messy = 'Line 1\n\n\n\n\nLine 2\r\n\r\n\r\nLine 3';
    const normalized = normalizeWhitespace(messy);
    expect(normalized).toBe('Line 1\n\nLine 2\n\nLine 3');
  });
});
