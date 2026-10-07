'use client';

/**
 * Narrative trail — the next step.
 *
 * The 11 authored cinematics are bundled
 * (concord-frontend/content/cinematics/*.json) and registered with the
 * client director. There is no server macro for this lens.
 *
 * Begin the walk opens the first sequence. The panel shows that
 * sequence's name and authored comment only after it is the open step.
 * The open id is stored in localStorage and read back on the next load.
 * The next step advances one sequence and calls playSequence with the
 * sequence trigger.
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

const OPEN_KEY = 'concordia:narrative-walk:open';
const WATCHED_KEY = 'concordia:narrative-walk:watched';

type Phase = 'loading' | 'ready' | 'error';

interface Step {
  id: string;
  trigger: string;
  name: string;
  comment: string;
}

function readStoredId(): string | null {
  try {
    const raw = localStorage.getItem(OPEN_KEY);
    return raw && raw.trim() ? raw : null;
  } catch {
    return null;
  }
}

function readWatched(): string[] {
  try {
    const raw = localStorage.getItem(WATCHED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeJournal(openId: string, watched: string[]) {
  const next = watched.includes(openId) ? watched : [...watched, openId];
  try {
    localStorage.setItem(OPEN_KEY, openId);
    localStorage.setItem(WATCHED_KEY, JSON.stringify(next));
  } catch { /* quota */ }
  return next;
}

export default function NarrativeWalkLensPage() {
  useLensNav('narrative-walk');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [phase, setPhase] = useState<Phase>('loading');
  const [catalog, setCatalog] = useState<Step[]>([]);
  const [open, setOpen] = useState<Step | null>(null);
  const [watched, setWatched] = useState<string[]>([]);
  const [actionError, setActionError] = useState('');

  const load = useCallback(() => {
    setPhase('loading');
    setActionError('');
    let cancelled = false;
    Promise.all([
      import('@/lib/world-lens/cinematic-sequences-registry'),
      import('@/lib/world-lens/cinematic-director'),
    ]).then(([reg, director]) => {
      if (cancelled) return;
      reg.ensureCinematicsRegistered();
      const list: Step[] = director.listSequences().map((seq) => {
        const comment = (seq as unknown as { comment?: string }).comment;
        return {
          id: seq.id,
          trigger: seq.trigger || seq.id,
          name: seq.name || seq.id,
          comment: typeof comment === 'string' ? comment : '',
        };
      }).filter((step) => step.id);
      const stored = readStoredId();
      const restored = stored ? list.find((step) => step.id === stored) ?? null : null;
      setCatalog(list);
      setOpen(restored);
      setWatched(readWatched());
      setPhase('ready');
    }).catch(() => {
      if (!cancelled) setPhase('error');
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => load(), [load]);

  const show = useCallback(async (step: Step) => {
    setActionError('');
    const journal = writeJournal(step.id, readWatched());
    const stored = readStoredId();
    if (stored !== step.id) {
      setActionError('Opened, but the trail did not read it back.');
      return;
    }
    setWatched(journal);
    setOpen(step);
    try {
      const director = await import('@/lib/world-lens/cinematic-director');
      void director.playSequence(step.trigger, { source: 'narrative-walk-lens' });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'The director did not start this step.');
    }
  }, []);

  const beginOrAdvance = useCallback(() => {
    if (!catalog.length) return;
    if (!open) {
      void show(catalog[0]);
      return;
    }
    const index = catalog.findIndex((step) => step.id === open.id);
    const next = catalog[index + 1];
    if (next) void show(next);
  }, [catalog, open, show]);

  const atEnd = !!open && catalog.findIndex((step) => step.id === open.id) === catalog.length - 1;
  const cta = open && !atEnd ? 'The next step' : 'Begin the walk';

  useLensCommand(
    [{ id: 'narrative-begin', keys: 'b', description: cta, category: 'actions', action: beginOrAdvance }],
    { lensId: 'narrative-walk' },
  );

  return (
    <LensShell lensId="narrative-walk" asMain={false}>
      <div data-lens-theme="narrative-walk" className="relative min-h-full bg-black px-8 pb-28 pt-6">
        <p className="text-[14px] text-zinc-500">Narrative trail</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          The next step{who ? `, ${who}` : ''}
        </h1>

        <section
          aria-label="Trail"
          className="flex min-h-[22rem] flex-col justify-center rounded-2xl border border-white/10 bg-zinc-950 px-6 py-16"
        >
          {phase === 'loading' && (
            <p data-testid="narrative-loading" role="status" aria-busy="true" className="text-[14px] text-zinc-500">
              Opening the trail.
            </p>
          )}
          {phase === 'error' && (
            <div data-testid="narrative-error" role="alert" className="text-center">
              <p className="text-[14px] text-zinc-300">Could not load the narrative library.</p>
              <button type="button" onClick={load} className="mt-4 text-[14px] text-zinc-100 underline">
                Retry
              </button>
            </div>
          )}
          {phase === 'ready' && !open && (
            <div data-testid="narrative-empty">
              <p className="text-[14px] text-zinc-500">No walk open.</p>
              <div className="mt-6 h-px w-2/3 bg-white/10" aria-hidden="true" />
              <div className="mt-3 h-px w-1/2 bg-white/10" aria-hidden="true" />
            </div>
          )}
          {phase === 'ready' && open && (
            <div data-testid="narrative-step">
              <h2 className="font-vault text-[1.5rem] text-zinc-100">{open.name}</h2>
              {open.comment ? (
                <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-zinc-400">{open.comment}</p>
              ) : null}
            </div>
          )}
          {actionError ? (
            <p role="alert" className="mt-4 text-[14px] text-zinc-300">{actionError}</p>
          ) : null}
        </section>

        <button
          type="button"
          onClick={beginOrAdvance}
          disabled={phase !== 'ready' || catalog.length === 0 || atEnd}
          className="fixed bottom-8 right-8 z-30 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          {cta}
        </button>
      </div>
    </LensShell>
  );
}
