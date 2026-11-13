// NewsArticleDate.test.ts
//
// FIX-news-003: reader surfaces sliced the ISO string's UTC date
// while the live feed renders the same instant locally — one story,
// two dates (Oct 31 beside the title, Nov 1 in the metadata).
// formatArticleDate renders the parsed instant in local time.
// The second test is a SOURCE pin (named as such): the IntelDesk
// pull handler must pass the headline's own summary into
// news.article-add instead of null.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatArticleDate } from '@/components/news/article-date';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('formatArticleDate (FIX-news-003)', () => {
  it('renders the local date of the instant, not the UTC slice', () => {
    vi.stubEnv('TZ', 'America/New_York');
    // 2026-11-01T02:30:00Z is Oct 31, 9:30 PM in New York.
    expect(formatArticleDate('2026-11-01T02:30:00.000Z')).toBe('Oct 31, 2026');
    vi.unstubAllEnvs();
  });

  it('falls back to the raw date characters for unparseable values', () => {
    expect(formatArticleDate('not-a-date-at-all')).toBe('not-a-date');
    expect(formatArticleDate(null)).toBe('');
    expect(formatArticleDate(undefined)).toBe('');
  });

  it('SOURCE PIN: the pull handler passes the headline summary through', () => {
    const src = readFileSync(join(root, 'components/news/intel/IntelDesk.tsx'), 'utf8');
    expect(src).toContain('summary: h.summary ?? h.snippet ?? null');
    expect(src).not.toContain('summary: null,');
  });
});
