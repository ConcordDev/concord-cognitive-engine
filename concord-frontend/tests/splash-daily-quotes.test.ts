import { describe, expect, it } from 'vitest';
import { DAILY_QUOTES, quoteForDate, utcDayNumber } from '@/lib/splash/daily-quotes';

describe('splash daily quote', () => {
  it('has a curated list of ~30 complete, unique quotes', () => {
    expect(DAILY_QUOTES.length).toBeGreaterThanOrEqual(28);
    const texts = new Set<string>();
    for (const q of DAILY_QUOTES) {
      expect(q.text.trim()).not.toBe('');
      expect(q.author.trim()).not.toBe('');
      expect(q.source.trim()).not.toBe('');
      expect(texts.has(q.text)).toBe(false);
      texts.add(q.text);
    }
  });

  it('includes the two quotes the design was approved with', () => {
    const pairs = DAILY_QUOTES.map((q) => `${q.text} | ${q.author}`);
    expect(pairs).toContain('Talent is equally distributed; opportunity is not. | Leila Janah');
    expect(pairs).toContain(
      'Alone we can do so little; together we can do so much. | Helen Keller'
    );
  });

  it('is stable for the whole UTC day and changes at UTC midnight', () => {
    const start = new Date('2026-10-08T00:00:00.000Z');
    const end = new Date('2026-10-08T23:59:59.999Z');
    const next = new Date('2026-10-09T00:00:00.000Z');
    expect(utcDayNumber(start)).toBe(utcDayNumber(end));
    expect(quoteForDate(start)).toBe(quoteForDate(end));
    expect(utcDayNumber(next)).toBe(utcDayNumber(start) + 1);
    expect(quoteForDate(next)).not.toBe(quoteForDate(start));
  });

  it('cycles through every quote exactly once per period', () => {
    const base = Date.UTC(2026, 0, 1);
    const seen = new Set<string>();
    for (let d = 0; d < DAILY_QUOTES.length; d++) {
      seen.add(quoteForDate(new Date(base + d * 86_400_000)).text);
    }
    expect(seen.size).toBe(DAILY_QUOTES.length);
  });
});
