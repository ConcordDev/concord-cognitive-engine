'use client';

/**
 * AnalysisWorkbench — the media-literacy engine bench for the Intelligence
 * Desk. Runs the three REAL deterministic `news` analysis macros over a set
 * of selected headlines:
 *
 *   • biasDetection    — loaded-language density, sentiment asymmetry,
 *                        source diversity (entropy), per-source bias profile
 *   • eventExtraction  — who/what/when/where, entity mentions, timeline
 *   • narrativeTracking — framing similarity across time windows
 *
 * All output traces to server/domains/news.js. Nothing here is fabricated:
 * when no headlines are selected, the bench shows an honest empty state; when
 * a macro returns `{ message }` (e.g. "No articles to analyze"), that honest
 * message is surfaced verbatim.
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Scale, CalendarClock, GitBranch, Loader2, AlertTriangle, Gauge,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  runBiasDetection, runEventExtraction, runNarrativeTracking,
  headlineToAnalysisArticle,
  type Headline, type BiasResult, type EventResult, type NarrativeResult,
} from './intel-api';

type Engine = 'bias' | 'events' | 'narrative';

const ENGINES: Array<{ id: Engine; label: string; icon: typeof Scale; blurb: string }> = [
  { id: 'bias', label: 'Bias', icon: Scale, blurb: 'Loaded language, sentiment asymmetry & source diversity' },
  { id: 'events', label: 'Events', icon: CalendarClock, blurb: 'Who / what / when / where + entity mentions' },
  { id: 'narrative', label: 'Narrative', icon: GitBranch, blurb: 'Framing shifts across time windows' },
];

const LEVEL_TONE: Record<string, string> = {
  low: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  moderate: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  high: 'text-red-300 bg-red-500/10 border-red-500/30',
  stable: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  evolving: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  volatile: 'text-red-300 bg-red-500/10 border-red-500/30',
};

export function AnalysisWorkbench({ selected }: { selected: Headline[] }) {
  const [engine, setEngine] = useState<Engine>('bias');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bias, setBias] = useState<BiasResult | null>(null);
  const [events, setEvents] = useState<EventResult | null>(null);
  const [narrative, setNarrative] = useState<NarrativeResult | null>(null);

  const count = selected.length;

  async function run(which: Engine) {
    setEngine(which);
    if (count === 0) return;
    setRunning(true);
    setError(null);
    const articles = selected.map(headlineToAnalysisArticle);
    try {
      if (which === 'bias') {
        const env = await runBiasDetection(articles);
        if (env.ok && env.result) setBias(env.result);
        else setError(env.error || 'bias detection failed');
      } else if (which === 'events') {
        const env = await runEventExtraction(articles);
        if (env.ok && env.result) setEvents(env.result);
        else setError(env.error || 'event extraction failed');
      } else {
        const env = await runNarrativeTracking(articles);
        if (env.ok && env.result) setNarrative(env.result);
        else setError(env.error || 'narrative tracking failed');
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Engine selector */}
      <div className="grid grid-cols-3 gap-1.5">
        {ENGINES.map((e) => {
          const Icon = e.icon;
          const active = engine === e.id;
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => run(e.id)}
              disabled={running}
              title={e.blurb}
              className={cn(
                'flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-[11px] font-medium transition-colors disabled:opacity-50',
                active
                  ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200'
                  : 'border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200',
              )}
            >
              {running && active ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
              {e.label}
            </button>
          );
        })}
      </div>

      <p className="text-[11px] text-zinc-500">
        {count === 0
          ? 'Select headlines from the feed (＋) to build an analysis set.'
          : `Analyzing ${count} selected headline${count !== 1 ? 's' : ''} · deterministic engine`}
      </p>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-2.5 py-2 text-xs text-red-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      {count === 0 ? (
        <EmptyState
          compact
          icon={<Gauge className="h-6 w-6 text-zinc-600" />}
          title="No analysis set"
          description="Add live headlines to the set, then run bias, event, or narrative analysis on the real text."
        />
      ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={engine}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            {engine === 'bias' && <BiasView r={bias} />}
            {engine === 'events' && <EventsView r={events} />}
            {engine === 'narrative' && <NarrativeView r={narrative} />}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}

function LevelPill({ level }: { level?: string }) {
  if (!level) return null;
  return (
    <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide', LEVEL_TONE[level] || 'text-zinc-300 bg-zinc-800 border-zinc-700')}>
      {level}
    </span>
  );
}

const BAR_TONE: Record<'cyan' | 'emerald', string> = {
  cyan: 'bg-cyan-500/70',
  emerald: 'bg-emerald-500/70',
};

function Bar({ value, label, tone = 'cyan' }: { value: number; label: string; tone?: 'cyan' | 'emerald' }) {
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-zinc-400">{label}</span>
        <span className="font-mono text-zinc-300">{value.toFixed(3)}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
        <div className={cn('h-full rounded-full', BAR_TONE[tone])} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function BiasView({ r }: { r: BiasResult | null }) {
  if (!r) return <RunHint />;
  if (r.message) return <MessageNote text={r.message} />;
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-400">Overall bias</span>
        <span className="font-mono text-cyan-300">{r.overallBiasScore.toFixed(3)}</span>
        <LevelPill level={r.biasLevel} />
        <span className="ml-auto text-[11px] text-zinc-500">{r.articlesAnalyzed} analyzed</span>
      </div>
      <Bar value={r.sourceDiversity.normalizedDiversity} label={`Source diversity — ${r.sourceDiversity.assessment}`} tone="emerald" />
      {r.sourceBiasProfiles.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Per-source bias</p>
          {r.sourceBiasProfiles.slice(0, 6).map((s) => (
            <div key={s.source} className="flex items-center justify-between rounded bg-zinc-900/60 px-2 py-1 text-xs">
              <span className="truncate text-zinc-300">{s.source || 'unknown'}</span>
              <span className="ml-2 shrink-0 font-mono text-amber-300">{s.avgBiasScore.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EventsView({ r }: { r: EventResult | null }) {
  if (!r) return <RunHint />;
  if (r.message) return <MessageNote text={r.message} />;
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-zinc-400">Events</span>
        <span className="font-mono text-cyan-300">{r.eventsExtracted}</span>
        <span className="ml-auto text-[11px] text-zinc-500">{r.articlesProcessed} processed</span>
      </div>
      {r.topEntities.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {r.topEntities.slice(0, 10).map((e, i) => (
            <span key={i} className="rounded border border-cyan-500/20 bg-cyan-500/5 px-1.5 py-0.5 text-[11px] text-cyan-200">
              {e.entity} <span className="text-cyan-500/70">×{e.mentions}</span>
            </span>
          ))}
        </div>
      )}
      {r.timeline.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Timeline</p>
          {r.timeline.slice(0, 6).map((t, i) => (
            <div key={i} className="rounded bg-zinc-900/60 px-2 py-1 text-[11px] text-zinc-300">
              <span className="line-clamp-1">{t.sentence || t.action || '—'}</span>
            </div>
          ))}
        </div>
      )}
      {r.eventsExtracted === 0 && (
        <p className="text-[11px] text-zinc-500">
          No structured events found — headline text is short. Pull articles to DTUs (with full summaries)
          for richer extraction.
        </p>
      )}
    </div>
  );
}

function NarrativeView({ r }: { r: NarrativeResult | null }) {
  if (!r) return <RunHint />;
  if (r.message) return <MessageNote text={r.message} />;
  return (
    <div className="space-y-3 text-sm">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-zinc-400">Stability</span>
        <span className="font-mono text-cyan-300">{r.narrativeStability.toFixed(3)}</span>
        <LevelPill level={r.stabilityLevel} />
        <span className="ml-auto text-[11px] text-zinc-500">{r.shiftCount} shift{r.shiftCount !== 1 ? 's' : ''}</span>
      </div>
      <Bar value={r.narrativeStability} label="Framing consistency" tone="cyan" />
      {r.windows.length < 2 && (
        <p className="text-[11px] text-zinc-500">
          Narrative tracking compares framing across time windows — add more headlines spanning a wider
          time range for a meaningful signal.
        </p>
      )}
    </div>
  );
}

function RunHint() {
  return <p className="py-4 text-center text-xs text-zinc-500">Select an engine to run it on the analysis set.</p>;
}
function MessageNote({ text }: { text: string }) {
  return <p className="rounded-md border border-zinc-800 bg-zinc-900/50 px-2.5 py-2 text-xs text-zinc-400">{text}</p>;
}
