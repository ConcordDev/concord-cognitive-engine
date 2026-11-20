/**
 * Typed client for the Situation Room (news.situation in
 * server/domains/news-situation.js) and the reader macros in news.js.
 * Shapes list only fields the server returns.
 */

import { lensRun } from '@/lib/api/client';

export type Envelope<T> = { ok: true; result: T } | { ok: false; error: string; message: string };

export async function news<T>(action: string, input: Record<string, unknown> = {}): Promise<Envelope<T>> {
  try {
    const r = await lensRun<T>('news', action, input);
    const d = r.data;
    if (!d?.ok) {
      const error = String(d?.error || 'failed');
      return { ok: false, error, message: d?.message || error.replace(/_/g, ' ') };
    }
    return { ok: true, result: (d.result ?? ({} as T)) as T };
  } catch (e) {
    return { ok: false, error: 'network', message: (e as Error)?.message || 'The request did not reach the server.' };
  }
}

export const CATEGORIES = ['top', 'world', 'politics', 'business', 'science', 'health', 'tech', 'sports', 'entertainment'] as const;
export type Category = (typeof CATEGORIES)[number];
export const DEFAULT_CATEGORIES: Category[] = ['top', 'world', 'business', 'politics', 'science', 'health', 'tech'];

export interface Place { key: string; terms: string[] }
export interface Story {
  id: string;
  kind: 'live' | 'library';
  title: string;
  url: string | null;
  source: string;
  category: string;
  at: string;
  places: Place[];
  basis: 'mentioned' | 'outlet' | null;
  outletCountry: string | null;
  clusterId: string;
  coverage: number;
}
export interface Region { key: string; count: number; mentioned: number; outlet: number; sources: number; last3h: number; latest: string | null; categories: Record<string, number> }
export interface Arc { a: string; b: string; count: number }
export interface Bucket { at: string; count: number; placed: number }
export interface Situation {
  window: { hours: number; from: string; to: string };
  feed: { status: 'fresh' | 'stale' | 'unavailable'; reasons: string[]; fetchedAt: string | null; categories: Record<string, { status: string; reason: string | null }>; sources: { id: string; name: string; status: string }[] };
  stories: Story[];
  regions: Region[];
  arcs: Arc[];
  timeline: Bucket[];
  counts: { stories: number; placed: number; mentioned: number; outlet: number; unplaced: number; undated: number; live: number; library: number };
}

export function fetchSituation(hours: number, categories: Category[]) {
  return news<Situation>('situation', { hours, categories });
}

/** Library article (news.js articleView). */
export interface LibArticle { id: string; title: string; source: string; topic: string; summary: string | null; url: string | null; publishedAt: string; saved?: boolean; read?: boolean }

export function since(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

export function utcClock(d = new Date()): string {
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
}

/** Heat level 0..5 for a count, on a log scale against the busiest region. */
export function heatOf(count: number, max: number): number {
  if (!count || !max) return 0;
  if (max <= 1) return 3;
  return Math.max(1, Math.min(5, Math.ceil((Math.log(count + 1) / Math.log(max + 1)) * 5)));
}

/** Plain-language reason a story sits where it does on the map. */
export function basisLine(s: Story, placeName: (k: string) => string): string {
  if (s.basis === 'mentioned') {
    const terms = s.places.flatMap((p) => p.terms).slice(0, 4);
    return `Placed because the story names ${terms.map((t) => `“${t}”`).join(', ')}.`;
  }
  if (s.basis === 'outlet') return `Placed by where the outlet is based (${s.outletCountry || placeName(s.places[0]?.key || '')}). The story itself names no place.`;
  return 'Not on the map: the story names no place and its outlet country is unknown.';
}

export const FEED_REASON: Record<string, string> = {
  warming: 'The feed is warming up; the first pull is still on its way.',
  upstream_backoff: 'The news sources are rate-limiting us; showing what was last pulled.',
};
