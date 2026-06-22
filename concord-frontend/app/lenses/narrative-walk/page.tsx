'use client';

/**
 * /lenses/narrative-walk — Phase CA4 walking-sim lens.
 *
 * 11 authored cinematics already register via the cinematic-director
 * (boss arrival, war declared, town captured, kingdom takeover,
 * rebellion fired, vela reveal, ark archive unlock, heir acceded,
 * concordia deep cold, quest-lattice/ecology realised). The walking
 * sim claim is: a narrative-trail lens where you pick from authored
 * story beats, watch them play, and a watched-journal builds up.
 *
 * Mounts the cinematic catalog as a story journal. Each entry can be
 * played manually for a Firewatch-style "walk through the story"
 * experience inside Concordia.
 */

import { useEffect, useState, useCallback } from 'react';
import { BookOpen, Play, Check, RefreshCcw } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';

const STORAGE_KEY = 'concordia:narrative-walk:watched';

interface CinematicSummary {
  id: string;
  name: string;
  summary?: string;
}

export default function NarrativeWalkLensPage() {
  const [catalog, setCatalog] = useState<CinematicSummary[]>([]);
  const [watched, setWatched] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      import('@/lib/world-lens/cinematic-sequences-registry'),
      import('@/lib/world-lens/cinematic-director'),
    ]).then(([reg, director]) => {
      if (cancelled) return;
      reg.ensureCinematicsRegistered();
      const list = director.listSequences().map((s) => ({
        id: s.id,
        name: s.name || s.id,
        summary: (s as { summary?: string }).summary,
      }));
      setCatalog(list);
    }).catch(() => {});
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setWatched(new Set(JSON.parse(raw)));
    } catch { /* corrupt cache */ }
    return () => { cancelled = true; };
  }, []);

  const play = useCallback(async (id: string) => {
    setBusy(id);
    try {
      const director = await import('@/lib/world-lens/cinematic-director');
      await director.playSequence(id, { source: 'narrative-walk-lens' });
      const next = new Set(watched);
      next.add(id);
      setWatched(next);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(next)));
    } catch { /* sequence missing or broken */ }
    finally { setBusy(null); }
  }, [watched]);

  const clearWatched = useCallback(() => {
    setWatched(new Set());
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return (
    <LensShell lensId="narrative-walk" asMain={false}>
      <ManifestActionBar />
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-violet-950/10 text-slate-100">
        <header className="border-b border-violet-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-screen-2xl items-center gap-3">
            <div className="rounded-lg border border-violet-500/40 bg-violet-500/10 p-2">
              <BookOpen className="h-5 w-5 text-violet-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">Narrative trail</h1>
              <p className="mt-0.5 truncate text-xs text-slate-400">Authored story beats. Walk through the world as a film.</p>
            </div>
            <span className="text-[10px] text-slate-500">{watched.size} / {catalog.length} watched</span>
            <button onClick={clearWatched} aria-label="Clear watched" className="rounded-full border border-violet-500/30 bg-violet-500/10 p-1.5 text-violet-300 hover:bg-violet-500/20">
              <RefreshCcw className="h-3.5 w-3.5" />
            </button>
          </div>
        </header>

        <section className="mx-auto max-w-screen-2xl px-4 py-5 sm:px-6">
          {catalog.length === 0 ? (
            <p className="py-12 text-center text-[12px] text-slate-500">Cinematic library loading…</p>
          ) : (
            <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {catalog.map((c, idx) => {
                const seen = watched.has(c.id);
                return (
                  <li key={c.id} className={`rounded-xl border p-3 transition ${seen ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-violet-500/20 bg-zinc-950/60'}`}>
                    <header className="mb-1 flex items-center justify-between">
                      <span className="text-[10px] text-violet-300/60">CH {idx + 1}</span>
                      {seen && <Check size={12} className="text-emerald-300" />}
                    </header>
                    <h2 className="text-sm font-medium text-violet-100">{c.name}</h2>
                    {c.summary && <p className="mt-1 text-[11px] text-slate-400">{c.summary}</p>}
                    <button
                      onClick={() => play(c.id)}
                      disabled={busy === c.id}
                      className="mt-3 inline-flex items-center gap-1 rounded bg-violet-500/20 px-2 py-1 text-[11px] text-violet-100 hover:bg-violet-500/30 disabled:opacity-40"
                    >
                      <Play size={11} />
                      {seen ? 'Re-watch' : 'Play'}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </main>
    </LensShell>
  );
}
