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
 *
 * Lifecycle (S1, Shape A): the walker can step BACK to the previous
 * sequence, START OVER mid-walk, and — at the final sequence, where the
 * panel states the ending — WALK IT AGAIN, which restarts the trail
 * and clears the journal. Completion is an ending, not a lockout. The
 * counter counts steps WALKED (the journal records a step when it is
 * stepped onto), and says so.
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { KeepRecordActions } from '@/components/lens/KeepRecordActions';
import type { KeptRecord } from '@/components/lens/recordKeep';

const OPEN_KEY = 'concordia:narrative-walk:open';
const WATCHED_KEY = 'concordia:narrative-walk:watched';

type Phase = 'loading' | 'ready' | 'error';

interface Step {
  id: string;
  trigger: string;
  name: string;
  /** User-facing story prose for the beat (the sequence's summary). */
  summary: string;
  /** Internal authoring note — NEVER rendered. Read only for the
   *  set-eyebrow derivation below. */
  comment: string;
}

/**
 * The two authored sets splice into one playlist, and every beat's
 * internal authoring comment already says which set it belongs to
 * ("Phase W — fires when…" / "Concordia Phase 15 — bespoke
 * cinematic…"). The eyebrow is derived from that self-label — nothing
 * is invented for a beat whose comment carries neither. The comment
 * itself is production copy (sprint/spec terms, trigger conditions,
 * shot direction) and is never shown to the walker; the beat's body
 * is its summary, the human-facing blurb the sequence type reserves
 * for catalog UIs.
 */
function setLabel(step: Step): string | null {
  if (step.comment.startsWith('Phase W')) return 'Event template';
  if (step.comment.includes('Concordia Phase 15')) return 'Concordia cinematic';
  return null;
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
  const [phase, setPhase] = useState<Phase>('loading');
  const [catalog, setCatalog] = useState<Step[]>([]);
  const [open, setOpen] = useState<Step | null>(null);
  const [watched, setWatched] = useState<string[]>([]);
  const [actionError, setActionError] = useState('');
  const [note, setNote] = useState('');

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
          summary: typeof seq.summary === 'string' ? seq.summary : '',
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
    setNote('');
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

  const restart = useCallback(() => {
    try {
      localStorage.removeItem(OPEN_KEY);
      localStorage.removeItem(WATCHED_KEY);
    } catch { /* storage unavailable — state below still resets */ }
    setOpen(null);
    setWatched([]);
    setActionError('');
    setNote('The trail is open again. Begin when you are ready.');
  }, []);

  const goBack = useCallback(() => {
    if (!open) return;
    const index = catalog.findIndex((step) => step.id === open.id);
    const prev = catalog[index - 1];
    if (prev) void show(prev);
  }, [catalog, open, show]);

  const openIndex = open ? catalog.findIndex((step) => step.id === open.id) : -1;
  const atEnd = !!open && openIndex === catalog.length - 1;
  // Count only journal ids still in the catalog (a renamed sequence drops out).
  const watchedCount = catalog.filter((step) => watched.includes(step.id)).length;
  const cta = atEnd ? 'Walk it again' : open ? 'The next step' : 'Begin the walk';
  const primaryAction = atEnd ? restart : beginOrAdvance;

  // The completed walk, keepable as a private DTU through the
  // platform's record-keep handoff — the record of a walk belongs to
  // the walker. Built only at the ending, from the real catalog.
  const walkRecord: KeptRecord | null = atEnd && catalog.length > 0 ? {
    title: 'Narrative trail — a completed walk',
    body: [
      'Walked the Narrative trail to its end.',
      '',
      'The beats, in order:',
      ...catalog.map((step, i) => `${i + 1}. ${step.name}`),
      '',
      `Completed: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
    ].join('\n'),
    tags: ['narrative-walk', 'walk-record'],
    source: 'narrative-walk',
    createdFrom: 'narrative-walk completion',
    machine: { lens: 'narrative-walk', steps: catalog.map((step) => step.id), stepsWalked: watchedCount },
    draftTitle: 'My completed Narrative trail walk',
  } : null;

  useLensCommand(
    [
      { id: 'narrative-begin', keys: 'b', description: cta, category: 'actions', action: primaryAction },
      { id: 'narrative-back', keys: 'p', description: 'The step before', category: 'actions', action: goBack },
      { id: 'narrative-restart', keys: 'r', description: 'Start over', category: 'actions', action: restart },
    ],
    { lensId: 'narrative-walk' },
  );

  return (
    <LensShell lensId="narrative-walk" asMain={false}>
      <DepthBadge lensId="narrative-walk" size="sm" className="ml-2" />
      <div data-lens-theme="narrative-walk" className="relative min-h-full bg-black px-8 pb-28 pt-6">
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">Narrative trail</h1>

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
              <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-zinc-400">
                Eleven authored story beats from the turning points of Concordia. Walk them in
                order — you can step back at any point, and when the trail ends you can walk it again.
              </p>
              <div className="mt-6 h-px w-2/3 bg-white/10" aria-hidden="true" />
              <div className="mt-3 h-px w-1/2 bg-white/10" aria-hidden="true" />
            </div>
          )}
          {phase === 'ready' && open && (
            <div data-testid="narrative-step">
              {setLabel(open) ? (
                <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500">{setLabel(open)}</p>
              ) : null}
              <h2 className="font-vault text-[1.5rem] text-zinc-100">{open.name}</h2>
              {open.summary ? (
                <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-zinc-400">{open.summary}</p>
              ) : null}
              <p data-testid="narrative-progress" className="mt-6 text-[13px] tabular-nums text-zinc-500">
                Step {openIndex + 1} of {catalog.length} · {watchedCount} walked
              </p>
              {atEnd && (
                <div className="mt-6">
                  <p className="max-w-xl text-[14px] leading-relaxed text-zinc-300">
                    The trail ends here — you have walked all {catalog.length} beats. The walk is yours to
                    walk again whenever you like.
                  </p>
                  {walkRecord && (
                    <div className="mt-4">
                      <KeepRecordActions record={walkRecord} saveLabel="Keep the walk record" />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {actionError ? (
            <p role="alert" className="mt-4 text-[14px] text-zinc-300">{actionError}</p>
          ) : null}
        </section>

        {phase === 'ready' && open && (
          <div className="mt-4 flex flex-wrap items-center gap-4">
            {openIndex > 0 && (
              <button type="button" onClick={goBack} className="text-[13px] text-zinc-400 underline decoration-zinc-600 underline-offset-4 transition-colors hover:text-zinc-100">
                The step before
              </button>
            )}
            {!atEnd && (
              <button type="button" onClick={restart} className="text-[13px] text-zinc-400 underline decoration-zinc-600 underline-offset-4 transition-colors hover:text-zinc-100">
                Start over
              </button>
            )}
          </div>
        )}
        {note ? (
          <p role="status" className="mt-4 text-[13px] text-zinc-400">{note}</p>
        ) : null}

        <button
          type="button"
          onClick={primaryAction}
          disabled={phase !== 'ready' || catalog.length === 0}
          className="fixed bottom-8 right-8 z-30 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          {cta}
        </button>
      </div>
    </LensShell>
  );
}
