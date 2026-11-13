/**
 * article-date — one date rendering for reader surfaces.
 *
 * FIX-news-003: the live feed renders a story's instant in LOCAL time
 * (toLocaleString) while the reader card and detail modal sliced the
 * ISO string's UTC date — so the same story read Oct 31 beside its
 * title and Nov 1 in its metadata. Reader surfaces format the parsed
 * instant locally, like the feed; an unparseable value falls back to
 * its raw leading date characters rather than inventing one.
 */
export function formatArticleDate(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
