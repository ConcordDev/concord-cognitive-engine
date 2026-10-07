'use client';

/**
 * Cognitive Replay — one moment.
 *
 * moment-list is the card. Choose a moment calls moment-choose, then
 * shows the title only after moment-list contains that id and the same
 * title, and shows the line only after moment-detail returns that same
 * line. A blank title is not sent. A blank line is not sent. Title and
 * line live in cognitive_replay_moments, so a server restart still
 * lists them. Role and brain are not rendered. The inspector tabs are
 * other macros. They are not on this screen.
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { lensRun } from '@/lib/api/client';

interface MomentRow {
  id: string;
  title: string;
  line: string;
}

type Phase = 'loading' | 'ready' | 'error';

function rowsFrom(rows: unknown): { id: string; title: string }[] {
  if (!Array.isArray(rows)) return [];
  const out: { id: string; title: string }[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = (row as { id?: string }).id;
    const title = (row as { title?: string }).title;
    if (typeof id !== 'string' || !id) continue;
    if (typeof title !== 'string' || !title.trim()) continue;
    out.push({ id, title: title.trim() });
  }
  return out;
}

function lineFrom(moment: unknown): string {
  if (!moment || typeof moment !== 'object') return '';
  const line = (moment as { line?: unknown }).line;
  return typeof line === 'string' ? line : '';
}

function isWarming(message: string): boolean {
  return /service_overloaded|event_loop_lag|status code 503/i.test(message);
}

async function runReplay<T>(name: string, input: Record<string, unknown>, fallback: string): Promise<T> {
  let last = fallback;
  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await lensRun<T>('cognitive-replay', name, input);
    if (response.data?.ok && response.data.result) return response.data.result;
    last = response.data?.error || last;
    if (!isWarming(last) || attempt === 7) throw new Error(last);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(last);
}

async function readMoments(): Promise<MomentRow[]> {
  const listed = await runReplay<{ moments?: unknown }>('moment-list', {}, 'Could not read the moment.');
  const slim = rowsFrom(listed.moments);
  const out: MomentRow[] = [];
  for (const row of slim) {
    const detail = await runReplay<{ moment?: unknown }>(
      'moment-detail',
      { id: row.id },
      'Could not read the moment.',
    );
    out.push({ id: row.id, title: row.title, line: lineFrom(detail.moment) });
  }
  return out;
}

export default function CognitiveReplayPage() {
  useLensNav('cognitive-replay');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [phase, setPhase] = useState<Phase>('loading');
  const [moments, setMoments] = useState<MomentRow[]>([]);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [line, setLine] = useState('');
  const [busy, setBusy] = useState(false);

  const pull = useCallback(async () => readMoments(), []);

  useEffect(() => {
    let cancelled = false;
    pull().then((rows) => {
      if (cancelled) return;
      setMoments(rows);
      setPhase('ready');
    }).catch((err) => {
      if (cancelled) return;
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the moment.');
    });
    return () => { cancelled = true; };
  }, [pull]);

  const load = useCallback(() => {
    setPhase('loading');
    setLoadError('');
    setActionError('');
    pull().then((rows) => {
      setMoments(rows);
      setPhase('ready');
    }).catch((err) => {
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the moment.');
    });
  }, [pull]);

  const chooseMoment = useCallback(async () => {
    if (busy || phase !== 'ready') return;
    if (!composing) {
      setComposing(true);
      setActionError('');
      return;
    }
    const trimmed = title.trim();
    const said = line.trim();
    if (!trimmed) {
      setActionError('A title is required.');
      return;
    }
    if (!said) {
      setActionError('A line is required.');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      const created = await runReplay<{ momentId?: string }>(
        'moment-choose',
        { title: trimmed, line: said },
        'Could not choose that moment.',
      );
      const id = created.momentId;
      if (!id) throw new Error('Could not choose that moment.');
      const rows = await readMoments();
      const row = rows.find((item) => item.id === id);
      if (!row || row.title !== trimmed || row.line !== said) {
        throw new Error('Chosen, but the moment did not read it back.');
      }
      setMoments(rows);
      setTitle('');
      setLine('');
      setComposing(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not choose that moment.');
    } finally {
      setBusy(false);
    }
  }, [busy, composing, line, phase, title]);

  useLensCommand(
    [{ id: 'replay-choose', keys: 'n', description: 'Choose a moment', category: 'actions', action: () => { void chooseMoment(); } }],
    { lensId: 'cognitive-replay' },
  );

  const empty = phase === 'ready' && moments.length === 0 && !composing;

  return (
    <LensShell lensId="cognitive-replay" asMain={false}>
      <div data-lens-theme="cognitive-replay" className="relative min-h-full bg-black px-8 pb-28 pt-6">
        <p className="text-[14px] text-zinc-500">Cognitive Replay</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          Replay the moment{who ? `, ${who}` : ''}
        </h1>

        <section
          aria-label="Moment"
          className="flex min-h-[22rem] items-center justify-center rounded-2xl border border-white/10 bg-zinc-950 px-6 py-5"
        >
          {phase === 'loading' && (
            <p data-testid="cr-loading" role="status" aria-busy="true" className="text-[14px] text-zinc-500">
              Opening the moment.
            </p>
          )}
          {phase === 'error' && (
            <div data-testid="cr-error" role="alert">
              <p className="text-[14px] text-zinc-300">{loadError || 'Could not load the moment.'}</p>
              <button type="button" onClick={load} className="mt-4 text-[14px] text-zinc-100 underline">
                Retry
              </button>
            </div>
          )}
          {empty && (
            <p data-testid="cr-empty" className="text-[14px] text-zinc-400">No moment chosen.</p>
          )}
          {phase === 'ready' && moments.length > 0 && (
            <ul data-testid="cr-moments" className="w-full space-y-6 self-start">
              {moments.map((moment) => (
                <li key={moment.id}>
                  <h2 className="font-vault text-[1.5rem] leading-8 text-zinc-100">{moment.title}</h2>
                  {moment.line ? (
                    <p data-testid="cr-line" className="mt-3 text-[15px] text-zinc-300">{moment.line}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {phase === 'ready' && composing && (
            <div className="w-full space-y-4 self-start">
              <label className="block text-[14px] text-zinc-400">
                Title
                <input
                  data-testid="cr-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 font-vault text-[1.25rem] text-zinc-100 outline-none"
                  autoFocus
                />
              </label>
              <label className="block text-[14px] text-zinc-400">
                Line
                <input
                  data-testid="cr-line-input"
                  value={line}
                  onChange={(event) => setLine(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') { event.preventDefault(); void chooseMoment(); }
                  }}
                  className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 text-[15px] text-zinc-100 outline-none"
                />
              </label>
            </div>
          )}
        </section>

        {actionError ? (
          <p role="alert" className="mt-4 text-[14px] text-zinc-300">{actionError}</p>
        ) : null}

        <button
          type="button"
          onClick={() => { void chooseMoment(); }}
          disabled={phase !== 'ready' || busy}
          className="fixed bottom-8 right-8 z-30 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          Choose a moment
        </button>
      </div>
    </LensShell>
  );
}
