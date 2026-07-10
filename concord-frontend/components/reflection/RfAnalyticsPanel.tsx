'use client';

/**
 * RfAnalyticsPanel — real analysis of the user's own saved journal entries,
 * wired correctly to the three `reflection` domain analysis macros
 * (`insightExtraction`, `growthMetrics`, `habitTracking`).
 *
 * These three macros were previously reachable from TWO other places on
 * this page — `JournalActionPanel`'s "Insights/Growth/Habits" buttons and
 * the page-level "Reflection Domain Actions" strip — and BOTH were broken:
 *
 *  - `JournalActionPanel` called `insightExtraction`/`growthMetrics` with
 *    `{ entry, mood }` / `{ window, currentEntry }` — the macros read
 *    `artifact.data.entries` (plural, an array), so those calls always hit
 *    the "not enough data" honest-empty branch, and the panel rendered
 *    fields (`mood`, `patterns`, `takeaways`, `trends`, `summary`) that the
 *    real macro response never contains at all — a fantasy response shape.
 *  - The page-level strip called through the *generic* per-lens DTU-artifact
 *    system (`useLensData('reflection','entry',...)` /
 *    `useRunArtifact('reflection')`), which has no creation flow anywhere
 *    on this page, so `reflectionArtifacts[0]?.id` was always undefined and
 *    the buttons were permanently disabled — dead UI.
 *
 * This panel fixes both: it pulls the user's REAL saved entries via
 * `entry-list`, maps them to the exact shape the macros expect
 * (`{ text, date, tags, mood }`), and renders the REAL response shape.
 * `habitTracking` needs `{ habits: [{ name, completions }] }` and the
 * journal domain has no separate habit-tracking substrate — so habits are
 * honestly DERIVED from the user's own recurring entry tags (a tag used on
 * 2+ entries becomes a "habit" whose completions are the dates it was
 * tagged). This is disclosed in the UI, not presented as a dedicated habit
 * tracker.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Lightbulb, TrendingUp, Activity, RefreshCw, Info } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Entry { id: string; text: string; date: string; tags: string[]; mood: string | null }

interface InsightsResult {
  message?: string;
  entriesAnalyzed?: number;
  themes?: { theme: string; tfidfScore: number; documentFrequency: number; prevalence: number }[];
  recurringPhrases?: { phrase: string; occurrences: number }[];
  themeCoOccurrences?: { themes: string; count: number }[];
  moodThemeCorrelation?: { mood: string; entryCount: number; associatedThemes: string[] }[] | null;
  topTags?: { tag: string; count: number; prevalence: number }[] | null;
}
interface GrowthResult {
  message?: string;
  entriesAnalyzed?: number;
  sentiment?: { overall: number; trend: string; slope: number };
  vocabularyDiversity?: { avgTTR: number; trend: string; totalUniqueTerms: number };
  topicExpansion?: { expansionRatio: number | null };
  entryDepth?: { avgWordCount: number; trend: string };
}
interface HabitProfile { name: string; currentStreak: number; longestStreak: number; consistency: number; peakDay?: string }
interface HabitsResult {
  message?: string;
  totalHabits?: number;
  overallConsistency?: number;
  habitProfiles?: HabitProfile[];
  stackingRecommendations?: { habits: [string, string]; coOccurrenceRate: number; recommendation: string }[];
  strongest?: string;
  needsAttention?: string[];
}

const TREND_COLOR: Record<string, string> = {
  improving: 'text-emerald-300', expanding: 'text-emerald-300', deepening: 'text-emerald-300',
  declining: 'text-rose-300', contracting: 'text-rose-300', shallowing: 'text-rose-300',
  stable: 'text-amber-300', consistent: 'text-amber-300',
};

export function RfAnalyticsPanel() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [insights, setInsights] = useState<InsightsResult | null>(null);
  const [growth, setGrowth] = useState<GrowthResult | null>(null);
  const [habits, setHabits] = useState<HabitsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const derivedHabitTags = useMemo(() => {
    const byTag = new Map<string, Entry[]>();
    for (const e of entries) {
      for (const t of e.tags || []) {
        if (!byTag.has(t)) byTag.set(t, []);
        byTag.get(t)!.push(e);
      }
    }
    return [...byTag.entries()].filter(([, list]) => list.length >= 2);
  }, [entries]);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const listRes = await lensRun<{ entries: Entry[] }>('reflection', 'entry-list', { limit: 200 });
      const list = listRes.data?.result?.entries || [];
      setEntries(list);

      const asEntries = list.map((e) => ({ text: e.text, date: e.date, tags: e.tags, mood: e.mood || undefined }));

      const [insightsRes, growthRes] = await Promise.all([
        lensRun<InsightsResult>('reflection', 'insightExtraction', { entries: asEntries, topN: 10 }),
        lensRun<GrowthResult>('reflection', 'growthMetrics', { entries: asEntries, windowSize: 5 }),
      ]);
      setInsights(insightsRes.data?.result || null);
      setGrowth(growthRes.data?.result || null);

      const byTag = new Map<string, Entry[]>();
      for (const e of list) {
        for (const t of e.tags || []) {
          if (!byTag.has(t)) byTag.set(t, []);
          byTag.get(t)!.push(e);
        }
      }
      const derivedHabits = [...byTag.entries()]
        .filter(([, es]) => es.length >= 2)
        .map(([tag, es]) => ({ name: tag, completions: es.map((e) => ({ date: e.date })) }));
      if (derivedHabits.length > 0) {
        const habitsRes = await lensRun<HabitsResult>('reflection', 'habitTracking', { habits: derivedHabits });
        setHabits(habitsRes.data?.result || null);
      } else {
        setHabits(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void run(); }, [run]);

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }
  if (error) {
    return (
      <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-[12px] text-rose-300">
        {error}
        <button type="button" onClick={run} className="ml-2 underline">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-[11px] text-zinc-400">
          <Info className="w-3.5 h-3.5 text-indigo-400" />
          Computed from your {entries.length} saved {entries.length === 1 ? 'entry' : 'entries'} — real TF-IDF theme extraction, sentiment/vocabulary trend regression, and tag-derived habit consistency. No entries yet? Write some in the Entries tab first.
        </p>
        <button type="button" onClick={run}
          className="flex items-center gap-1 rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 shrink-0 ml-2">
          <RefreshCw className="w-3 h-3" /> Recompute
        </button>
      </div>

      {/* Insights */}
      <section className="rounded-xl border border-yellow-500/20 bg-zinc-900/70 p-3 space-y-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-yellow-200">
          <Lightbulb className="w-3.5 h-3.5" /> Themes & patterns
        </h3>
        {insights?.message ? (
          <p className="text-[11px] text-zinc-400 italic">{insights.message}</p>
        ) : insights?.themes?.length ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              {insights.themes.slice(0, 10).map((t) => (
                <span key={t.theme} className="rounded bg-yellow-500/10 px-2 py-0.5 text-[10px] text-yellow-200">
                  {t.theme} <span className="text-zinc-400">{Math.round(t.prevalence * 100)}%</span>
                </span>
              ))}
            </div>
            {insights.recurringPhrases && insights.recurringPhrases.length > 0 && (
              <p className="text-[11px] text-zinc-300">
                <span className="text-yellow-200 font-semibold">Recurring phrases: </span>
                {insights.recurringPhrases.slice(0, 5).map((p) => `"${p.phrase}" (×${p.occurrences})`).join(', ')}
              </p>
            )}
            {insights.moodThemeCorrelation && insights.moodThemeCorrelation.length > 0 && (
              <div className="text-[11px] text-zinc-300 space-y-0.5">
                <span className="text-yellow-200 font-semibold">Mood ↔ theme: </span>
                {insights.moodThemeCorrelation.map((m) => (
                  <div key={m.mood}>{m.mood} ({m.entryCount}): {m.associatedThemes.join(', ')}</div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="text-[11px] text-zinc-400 italic">No themes surfaced yet.</p>
        )}
      </section>

      {/* Growth */}
      <section className="rounded-xl border border-cyan-500/20 bg-zinc-900/70 p-3 space-y-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-cyan-200">
          <TrendingUp className="w-3.5 h-3.5" /> Growth over time
        </h3>
        {growth?.message ? (
          <p className="text-[11px] text-zinc-400 italic">{growth.message}</p>
        ) : growth?.sentiment ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric label="Sentiment" value={growth.sentiment.trend} tone={TREND_COLOR[growth.sentiment.trend]} />
            <Metric label="Vocabulary" value={growth.vocabularyDiversity?.trend ?? '—'} tone={TREND_COLOR[growth.vocabularyDiversity?.trend ?? '']} />
            <Metric label="Entry depth" value={growth.entryDepth?.trend ?? '—'} tone={TREND_COLOR[growth.entryDepth?.trend ?? '']} />
            <Metric label="Avg words/entry" value={String(growth.entryDepth?.avgWordCount ?? 0)} />
          </div>
        ) : (
          <p className="text-[11px] text-zinc-400 italic">No growth signal yet.</p>
        )}
      </section>

      {/* Habits (derived from tags) */}
      <section className="rounded-xl border border-purple-500/20 bg-zinc-900/70 p-3 space-y-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-purple-200">
          <Activity className="w-3.5 h-3.5" /> Habit consistency <span className="text-[10px] font-normal text-zinc-500">(derived from tags used 2+ times)</span>
        </h3>
        {derivedHabitTags.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">
            Tag entries with the same word (e.g. #meditation, #run) at least twice to see habit consistency here — there is no separate habit tracker in this domain, so this reuses your real entry tags rather than inventing one.
          </p>
        ) : habits?.habitProfiles?.length ? (
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-400">
              <span>Overall consistency: <span className="text-purple-200 font-mono">{Math.round((habits.overallConsistency ?? 0) * 100)}%</span></span>
              {habits.strongest && <span>Strongest: <span className="text-emerald-300">#{habits.strongest}</span></span>}
            </div>
            {habits.habitProfiles.map((h) => (
              <div key={h.name} className="flex items-center justify-between rounded bg-zinc-950/50 px-2 py-1 text-[11px]">
                <span className="text-zinc-200">#{h.name}</span>
                <span className="flex items-center gap-2 font-mono">
                  <span className="text-orange-300">🔥{h.currentStreak}d</span>
                  <span className={cn(h.consistency > 0.5 ? 'text-emerald-300' : 'text-amber-300')}>{Math.round(h.consistency * 100)}%</span>
                </span>
              </div>
            ))}
            {habits.stackingRecommendations && habits.stackingRecommendations.length > 0 && (
              <p className="text-[10px] text-zinc-400">
                Often co-occur: {habits.stackingRecommendations.slice(0, 3).map((s) => s.habits.join(' + ')).join(' · ')}
              </p>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-zinc-400 italic">{habits?.message || 'No habit signal yet.'}</p>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded bg-zinc-950/50 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={cn('text-xs font-semibold capitalize', tone || 'text-zinc-200')}>{value}</div>
    </div>
  );
}
