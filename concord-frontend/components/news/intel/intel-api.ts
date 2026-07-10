'use client';

/**
 * intel-api — typed client wrappers for the News/Intelligence backend.
 *
 * Every call here maps to a REAL registered `news` macro (see
 * server/domains/news.js). No mock data, no fabricated fields.
 *
 *   headlines / daily-briefing  → live GDELT Project feed (globalThis.fetch
 *                                 to api.gdeltproject.org, no key required)
 *   biasDetection / eventExtraction / narrativeTracking
 *                               → deterministic text-analysis engines that
 *                                 read `artifact.data.articles` (passed as
 *                                 the `articles` input field)
 *
 * The `/api/lens/run` route wraps the input's own fields into the macro's
 * virtual-artifact `data`, so `runDomain('news', 'biasDetection', { articles })`
 * lands as `artifact.data.articles` inside the handler.
 */

import { apiHelpers } from '@/lib/api/client';

export interface Headline {
  id: string;
  category: string;
  title: string;
  url: string;
  source: string;
  sourceCountry?: string | null;
  language?: string;
  publishedAt: string;
  socialImageUrl?: string | null;
}

export interface MacroEnvelope<T> {
  ok: boolean;
  result?: T;
  error?: string;
}

/**
 * Robust macro caller. The `/api/lens/run` route sometimes double-wraps a
 * `{ ok, result }` envelope inside `data.result`; this collapses both shapes
 * to a single `{ ok, result }`. (Same normalization the existing
 * GdeltHeadlines component uses.)
 */
export async function callNewsMacro<T>(
  action: string,
  input: Record<string, unknown> = {},
): Promise<MacroEnvelope<T>> {
  try {
    const r = await apiHelpers.lens.runDomain('news', action, { input });
    const data = (r as { data?: { ok: boolean; result?: T; error?: string } }).data;
    if (!data) return { ok: false, error: 'empty response' };
    if (data.ok && data.result && typeof data.result === 'object' && 'ok' in (data.result as object)) {
      return data.result as unknown as MacroEnvelope<T>;
    }
    return data as MacroEnvelope<T>;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'request failed' };
  }
}

// ── Live feed (GDELT) ────────────────────────────────────────────────────

export const NEWS_CATEGORIES = [
  'top', 'world', 'business', 'tech', 'science',
  'politics', 'sports', 'health', 'entertainment',
] as const;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

export function fetchHeadlines(category: NewsCategory, limit = 30) {
  return callNewsMacro<{ headlines: Headline[]; category: string; count: number; source: string }>(
    'headlines',
    { category, limit },
  );
}

export interface DailyBriefing {
  greeting: string;
  date: string;
  topStories: { heading: string; bullets: string[] };
  business: { heading: string; bullets: string[] };
  tech: { heading: string; bullets: string[] };
  science: { heading: string; bullets: string[] };
  closing: string;
  source: string;
}

export function fetchDailyBriefing() {
  return callNewsMacro<DailyBriefing>('daily-briefing', {});
}

// ── Analysis workbench engines ───────────────────────────────────────────

/** The shape each analysis engine expects per article. */
export interface AnalysisArticle {
  title: string;
  body: string;
  source?: string;
  date?: string;
}

export interface BiasResult {
  articlesAnalyzed: number;
  overallBiasScore: number;
  biasLevel: 'low' | 'moderate' | 'high';
  sourceDiversity: {
    uniqueSources: number;
    entropy: number;
    normalizedDiversity: number;
    assessment: string;
  };
  sourceBiasProfiles: Array<{
    source: string;
    articleCount: number;
    avgBiasScore: number;
    avgSentiment: number;
    consistency: number;
  }>;
  articleAnalyses: Array<Record<string, unknown>>;
  message?: string;
}

export interface EventResult {
  articlesProcessed: number;
  eventsExtracted: number;
  events: Array<Record<string, unknown>>;
  timeline: Array<{ when?: string; action?: string; who?: string[]; where?: string; sentence?: string }>;
  clusters: Array<Record<string, unknown>>;
  topEntities: Array<{ entity: string; mentions: number }>;
  message?: string;
}

export interface NarrativeResult {
  narrativeStability: number;
  stabilityLevel: 'stable' | 'evolving' | 'volatile';
  windows: Array<Record<string, unknown>>;
  narrativeShifts: Array<Record<string, unknown>>;
  shiftCount: number;
  message?: string;
}

export function runBiasDetection(articles: AnalysisArticle[]) {
  return callNewsMacro<BiasResult>('biasDetection', { articles });
}
export function runEventExtraction(articles: AnalysisArticle[]) {
  return callNewsMacro<EventResult>('eventExtraction', { articles });
}
export function runNarrativeTracking(articles: AnalysisArticle[]) {
  return callNewsMacro<NarrativeResult>('narrativeTracking', { articles });
}

/** Map a live headline into the analysis-article shape the engines read. */
export function headlineToAnalysisArticle(h: Headline): AnalysisArticle {
  return { title: h.title, body: h.title, source: h.source, date: h.publishedAt };
}
