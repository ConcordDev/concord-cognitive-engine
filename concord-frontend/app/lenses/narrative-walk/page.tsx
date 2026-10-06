'use client';

/**
 * /lenses/narrative-walk — Phase CA4 walking-sim READER lens.
 *
 * Self-contained authored-narrative reader. There is NO backend macro
 * surface — the 11 authored cinematic sequences are bundled at build
 * time (concord-frontend/content/cinematics/*.json) and registered with
 * the client-side cinematic-director. verify-lens-backends reports
 * NO-BACKEND-CALL for this lens BY DESIGN: a reader surfaces authored
 * content, it does not call an API.
 *
 * The walking-sim claim: a narrative-trail lens where you pick from
 * authored story beats (boss arrival, war declared, town captured,
 * kingdom takeover, rebellion fired, vela reveal, ark archive unlock,
 * heir acceded, concordia deep cold, quest-lattice/ecology realised),
 * watch them play as a Firewatch-style "walk through the story", and a
 * watched-journal builds up in localStorage.
 *
 * UX states (reader gate): loading (role=status while the catalog
 * imports), error (role=alert if the bundled content fails to load),
 * empty (no sequences registered — should never happen with bundled
 * JSON, but surfaced honestly), and populated (reading).
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { BookOpen, Play, Check, RefreshCcw, AlertTriangle, Film, Clock, Footprints, Eye, Layers } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'concordia:narrative-walk:watched';

type LoadState = 'loading' | 'ready' | 'error';
type Filter = 'all' | 'unwatched' | 'watched';

interface CinematicSummary {
  id: string;
  /** Event name the director matches a sequence against (NOT the id). */
  trigger: string;
  name: string;
  /** Authored scene blurb (sourced from the JSON `comment` field). */
  summary?: string;
  shotCount: number;
  durationMs: number;
}

function formatDuration(ms: number): string {
  if (!ms || ms <= 0) return '—';
  const s = ms / 1000;
  return s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${s.toFixed(1)}s`;
}

export default function NarrativeWalkLensPage() {
  useLensNav('narrative-walk');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [filter, setFilter] = useState<Filter>('all');
  const [catalog, setCatalog] = useState<CinematicSummary[]>([]);
  const [watched, setWatched] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const listRef = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      import('@/lib/world-lens/cinematic-sequences-registry'),
      import('@/lib/world-lens/cinematic-director'),
    ]).then(([reg, director]) => {
      if (cancelled) return;
      reg.ensureCinematicsRegistered();
      const list = director.listSequences().map((s) => {
        // The authored JSONs carry a human-facing `comment`; the
        // CinematicSequence type doesn't declare it, so read it via index.
        const comment = (s as unknown as { comment?: string }).comment;
        const summary = (s as { summary?: string }).summary;
        const shots = Array.isArray(s.shots) ? s.shots : [];
        const durationMs = s.duration_ms || shots.reduce((sum, sh) => sum + (sh.duration_ms || 0), 0);
        return {
          id: s.id,
          // The director resolves a sequence by its TRIGGER, not its id —
          // pass `trigger` to playSequence (4 of the 11 have id !== trigger).
          trigger: s.trigger || s.id,
          name: s.name || s.id,
          summary: summary || comment,
          shotCount: shots.length,
          durationMs,
        };
      });
      setCatalog(list);
      setLoadState('ready');
    }).catch(() => {
      if (!cancelled) setLoadState('error');
    });
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setWatched(new Set(JSON.parse(raw)));
    } catch { /* corrupt cache */ }
    return () => { cancelled = true; };
  }, []);

  const play = useCallback(async (entry: CinematicSummary) => {
    setBusy(entry.id);
    try {
      const director = await import('@/lib/world-lens/cinematic-director');
      // Match on trigger — playSequence resolves via findSequenceForTrigger.
      await director.playSequence(entry.trigger, { source: 'narrative-walk-lens' });
      setWatched((prev) => {
        const next = new Set(prev);
        next.add(entry.id);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(next))); } catch { /* quota */ }
        return next;
      });
    } catch { /* sequence missing or broken */ }
    finally { setBusy(null); }
  }, []);

  const clearWatched = useCallback(() => {
    setWatched(new Set());
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* quota */ }
  }, []);

  const beginWalk = useCallback(() => {
    const next = catalog.find((c) => !watched.has(c.id)) ?? catalog[0];
    if (next) void play(next);
  }, [catalog, watched, play]);

  useLensCommand(
    [
      { id: 'filter-all', keys: '1', description: 'All chapters', category: 'navigation', action: () => setFilter('all') },
      { id: 'filter-unwatched', keys: '2', description: 'Unwatched chapters', category: 'navigation', action: () => setFilter('unwatched') },
      { id: 'filter-watched', keys: '3', description: 'Watched chapters', category: 'navigation', action: () => setFilter('watched') },
      { id: 'begin-walk', keys: 'b', description: 'Begin the walk (next unwatched chapter)', category: 'actions', action: beginWalk },
    ],
    { lensId: 'narrative-walk' },
  );

  const shown = catalog
    .map((c, idx) => ({ c, idx }))
    .filter(({ c }) => filter === 'all' || (filter === 'watched') === watched.has(c.id));

  // Keyboard nav: arrow keys move focus between story-beat play buttons.
  const onListKeyDown = useCallback((e: React.KeyboardEvent<HTMLOListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const root = listRef.current;
    if (!root) return;
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button[data-beat-play]'));
    const idx = buttons.findIndex((b) => b === document.activeElement);
    if (idx === -1) return;
    e.preventDefault();
    const nextIdx = e.key === 'ArrowDown'
      ? Math.min(buttons.length - 1, idx + 1)
      : Math.max(0, idx - 1);
    buttons[nextIdx]?.focus();
  }, []);

  return (
    <LensShell lensId="narrative-walk" asMain={false}>
      <FirstRunTour lensId="narrative-walk" />
      <DepthBadge lensId="narrative-walk" size="sm" className="ml-2" />
      <div data-lens-theme="narrative-walk" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Narrative trail</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              The next step{who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <span className="text-[13px] text-zinc-500" aria-live="polite">{watched.size} / {catalog.length} watched</span>
            <button
              type="button"
              onClick={clearWatched}
              disabled={watched.size === 0}
              aria-label="Reset watched journal"
              title="Reset watched journal"
              className="rounded-full border border-white/10 bg-white/[0.03] p-2 text-zinc-400 transition-colors hover:text-zinc-100 disabled:opacity-30"
            >
              <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Chapter filter">
          {([
            ['all', 'All chapters', Layers, '1', catalog.length],
            ['unwatched', 'Unwatched', Footprints, '2', catalog.length - watched.size],
            ['watched', 'Watched', Eye, '3', watched.size],
          ] as const).map(([id, label, Icon, k, n]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              aria-current={filter === id ? 'page' : undefined}
              title={`${label} (${k})`}
              className={cn(
                'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                filter === id ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
              <span className="font-mono text-[11px] text-white/40">{n}</span>
              <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{k}</kbd>
            </button>
          ))}
        </nav>

        <section>
          {/* LOADING state — content imports async (Next dynamic import). */}
          {loadState === 'loading' && (
            <div role="status" aria-live="polite" className="py-12 text-center text-[12px] text-slate-500">
              <Film className="mx-auto mb-2 h-5 w-5 animate-pulse text-violet-400/60" aria-hidden="true" />
              Loading the cinematic library…
            </div>
          )}

          {/* ERROR state — bundled content failed to register. */}
          {loadState === 'error' && (
            <div role="alert" className="mx-auto max-w-md rounded-xl border border-red-500/30 bg-red-500/5 p-6 text-center">
              <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-red-400" aria-hidden="true" />
              <p className="text-sm font-medium text-red-200">Could not load the narrative library</p>
              <p className="mt-1 text-[12px] text-slate-400">The authored cinematic sequences failed to register. Try reloading the page.</p>
            </div>
          )}

          {/* EMPTY state — no sequences registered (bundled content missing). */}
          {loadState === 'ready' && catalog.length === 0 && (
            <div className="mx-auto max-w-md rounded-xl border border-violet-500/20 bg-zinc-950/60 p-8 text-center">
              <BookOpen className="mx-auto mb-2 h-6 w-6 text-violet-400/50" aria-hidden="true" />
              <p className="text-sm font-medium text-violet-100">No story beats yet</p>
              <p className="mt-1 text-[12px] text-slate-400">No authored cinematic sequences are available to walk through.</p>
            </div>
          )}

          {/* POPULATED state — the reading surface. */}
          {loadState === 'ready' && catalog.length > 0 && (
            <ol
              ref={listRef}
              onKeyDown={onListKeyDown}
              aria-label="Authored story beats"
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
            >
              {shown.map(({ c, idx }) => {
                const seen = watched.has(c.id);
                return (
                  <li
                    key={c.id}
                    className={`rounded-2xl border p-4 transition ${seen ? 'border-teal-400/30 bg-teal-400/5' : 'border-white/10 bg-[#111]'}`}
                  >
                    <header className="mb-1 flex items-center justify-between">
                      <span className="text-[10px] text-zinc-500">CH {idx + 1}</span>
                      {seen && <Check size={12} className="text-teal-300" aria-label="Watched" />}
                    </header>
                    <h2 className="font-vault text-lg text-zinc-100">{c.name}</h2>
                    {c.summary && <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">{c.summary}</p>}
                    <div className="mt-2 flex items-center gap-3 text-[10px] text-slate-500">
                      <span className="inline-flex items-center gap-1"><Film size={10} aria-hidden="true" />{c.shotCount} shot{c.shotCount === 1 ? '' : 's'}</span>
                      <span className="inline-flex items-center gap-1"><Clock size={10} aria-hidden="true" />{formatDuration(c.durationMs)}</span>
                    </div>
                    <button
                      data-beat-play
                      onClick={() => play(c)}
                      disabled={busy === c.id}
                      aria-label={`${seen ? 'Re-watch' : 'Play'} ${c.name}`}
                      className="mt-3 inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-[12px] text-zinc-100 hover:bg-white/15 disabled:opacity-40"
                    >
                      <Play size={11} aria-hidden="true" />
                      {busy === c.id ? 'Playing…' : seen ? 'Re-watch' : 'Play'}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {loadState === 'ready' && catalog.length > 0 && shown.length === 0 && (
            <p className="rounded-2xl border border-white/10 bg-[#111] p-6 text-[14px] text-zinc-400">
              {filter === 'watched' ? 'No chapters watched yet. Begin the walk to start your journal.' : 'Every chapter is watched. Re-watch any from All chapters.'}
            </p>
          )}
        </section>

        <CrossLensRecentsPanel lensId="narrative-walk" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={beginWalk}
          disabled={loadState !== 'ready' || catalog.length === 0 || busy !== null}
          title="Begin the walk (B)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          <Play className="h-4 w-4" />
          {busy ? 'Playing…' : watched.size > 0 && watched.size < catalog.length ? 'Continue the walk' : 'Begin the walk'}
        </button>
      </div>
    </LensShell>
  );
}
