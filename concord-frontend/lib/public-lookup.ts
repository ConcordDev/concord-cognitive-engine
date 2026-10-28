/**
 * public-lookup — client for the server's `public-lookup` domain (server/domains/public-lookup.js).
 * Wikipedia / Wikidata / Commons / StackExchange / HN Algolia are read through the server's shared
 * feed-cache instead of from the browser, so every widget shares one cache entry and one polite
 * upstream client. Failures are honest: nothing cached + upstream down => this throws, and the
 * caller's existing error state renders; a served-from-cache-after-expiry answer carries
 * `stale: true` and its `fetchedAt`, readable with `lookupMeta(data)`.
 */
import { lensRun } from '@/lib/api/client';

export interface LookupMeta {
  stale: boolean;
  /** epoch ms of the upstream fetch that produced this data */
  fetchedAt: number | null;
}

const META = new WeakMap<object, LookupMeta>();

/** Freshness of a value returned by publicLookup (undefined for anything else). */
export function lookupMeta(data: unknown): LookupMeta | undefined {
  return data && typeof data === 'object' ? META.get(data as object) : undefined;
}

/** Tie the freshness of a looked-up payload to a value derived from it (e.g. its `.search` array). */
export function carryLookupMeta<T extends object>(from: unknown, to: T): T {
  const m = lookupMeta(from);
  if (m) META.set(to, m);
  return to;
}

export type LookupAction =
  | 'wiki-summary' | 'wiki-search' | 'wiki-onthisday'
  | 'wikidata-entity' | 'wikidata-search' | 'commons-search'
  | 'se-search' | 'hn-search'
  | 'nvd-cves' | 'eonet-events' | 'gutendex-books' | 'sketchfab-search'
  | 'usgs-quakes' | 'fema-disasters' | 'restcountries-region' | 'sunrise-sunset'
  | 'imgflip-memes' | 'onionoo-summary' | 'npm-search' | 'openrouter-models';

/** Run a public-lookup action; resolves to the upstream JSON, throws on failure (bad params, unavailable). */
export async function publicLookup<T = unknown>(action: LookupAction, params: Record<string, unknown>): Promise<T> {
  const res = await lensRun<{ data: T; fetchedAt: number | null; stale: boolean }>('public-lookup', action, params);
  const out = res.data;
  if (!out?.ok || !out.result || out.result.data == null) {
    throw new Error(out?.error || `${action} unavailable`);
  }
  const { data, stale, fetchedAt } = out.result;
  if (data && typeof data === 'object') META.set(data as object, { stale: !!stale, fetchedAt: fetchedAt ?? null });
  return data;
}

/** Wikipedia page summary (REST). `title` is the page title as the old direct call used it. */
export function wikiSummary<T = unknown>(title: string, lang = 'en'): Promise<T> {
  return publicLookup<T>('wiki-summary', { lang, title });
}
