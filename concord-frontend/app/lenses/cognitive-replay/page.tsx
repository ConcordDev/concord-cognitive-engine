'use client';

/**
 * Moments — the member's moment journal.
 *
 * This lens presents as the moment journal it is (Lead ruling
 * 2026-11-01: the rename path — the journal function works and its
 * persistence is live; the name was the defect, not the feature).
 * Nothing here is recorded from the member's sessions and nothing is
 * replayed: a moment is a line the member writes, kept with the date
 * it was added.
 *
 * moment-list is the card. Add a moment calls moment-choose, then
 * shows the title only after moment-list contains that id and the same
 * title, and shows the line only after moment-detail returns that same
 * line. Edits go through moment-update under the same read-back rule;
 * deletes are two-step and call moment-delete. A blank title is not
 * sent. A blank line is not sent. Title and line live in
 * cognitive_replay_moments, so a server restart still lists them.
 * Role and brain are not rendered. The inspector tabs are other
 * macros. They are not on this screen.
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { lensRun } from '@/lib/api/client';

interface MomentRow {
  id: string;
  title: string;
  line: string;
  createdAt: string;
}

type Phase = 'loading' | 'ready' | 'error';

function rowsFrom(rows: unknown): { id: string; title: string; createdAt: string }[] {
  if (!Array.isArray(rows)) return [];
  const out: { id: string; title: string; createdAt: string }[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = (row as { id?: string }).id;
    const title = (row as { title?: string }).title;
    if (typeof id !== 'string' || !id) continue;
    if (typeof title !== 'string' || !title.trim()) continue;
    const createdAt = (row as { createdAt?: unknown }).createdAt;
    out.push({ id, title: title.trim(), createdAt: typeof createdAt === 'string' ? createdAt : '' });
  }
  return out;
}

function lineFrom(moment: unknown): string {
  if (!moment || typeof moment !== 'object') return '';
  const line = (moment as { line?: unknown }).line;
  return typeof line === 'string' ? line : '';
}

function formatMomentDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
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
    out.push({ id: row.id, title: row.title, line: lineFrom(detail.moment), createdAt: row.createdAt });
  }
  return out;
}

export default function CognitiveReplayPage() {
  useLensNav('cognitive-replay');
  const [phase, setPhase] = useState<Phase>('loading');
  const [moments, setMoments] = useState<MomentRow[]>([]);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [composing, setComposing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
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
      setLoadError(err instanceof Error ? err.message : 'Could not load your moments.');
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
      setLoadError(err instanceof Error ? err.message : 'Could not load your moments.');
    });
  }, [pull]);

  const closeComposer = useCallback(() => {
    setComposing(false);
    setEditingId(null);
    setTitle('');
    setLine('');
    setActionError('');
  }, []);

  const addMoment = useCallback(async () => {
    if (busy || phase !== 'ready') return;
    if (!composing) {
      setComposing(true);
      setEditingId(null);
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
      if (editingId) {
        await runReplay<{ momentId?: string }>(
          'moment-update',
          { id: editingId, title: trimmed, line: said },
          'Could not save that moment.',
        );
        const rows = await readMoments();
        const row = rows.find((item) => item.id === editingId);
        if (!row || row.title !== trimmed || row.line !== said) {
          throw new Error('Saved, but the moment did not read it back.');
        }
        setMoments(rows);
      } else {
        const created = await runReplay<{ momentId?: string }>(
          'moment-choose',
          { title: trimmed, line: said },
          'Could not save that moment.',
        );
        const id = created.momentId;
        if (!id) throw new Error('Could not save that moment.');
        const rows = await readMoments();
        const row = rows.find((item) => item.id === id);
        if (!row || row.title !== trimmed || row.line !== said) {
          throw new Error('Saved, but the moment did not read it back.');
        }
        setMoments(rows);
      }
      closeComposer();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not save that moment.');
    } finally {
      setBusy(false);
    }
  }, [busy, closeComposer, composing, editingId, line, phase, title]);

  const startEdit = useCallback((moment: MomentRow) => {
    setEditingId(moment.id);
    setTitle(moment.title);
    setLine(moment.line);
    setComposing(true);
    setConfirmDeleteId(null);
    setActionError('');
  }, []);

  const deleteMoment = useCallback(async (moment: MomentRow) => {
    if (confirmDeleteId !== moment.id) {
      setConfirmDeleteId(moment.id);
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      await runReplay<{ deleted?: string }>(
        'moment-delete',
        { id: moment.id },
        'Could not delete that moment.',
      );
      const rows = await readMoments();
      if (rows.some((item) => item.id === moment.id)) {
        throw new Error('Deleted, but the moment still reads back.');
      }
      setMoments(rows);
      setConfirmDeleteId(null);
      if (editingId === moment.id) closeComposer();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not delete that moment.');
    } finally {
      setBusy(false);
    }
  }, [closeComposer, confirmDeleteId, editingId]);

  useLensCommand(
    [{ id: 'moments-add', keys: 'n', description: 'Add a moment', category: 'actions', action: () => { void addMoment(); } }],
    { lensId: 'cognitive-replay' },
  );

  const empty = phase === 'ready' && moments.length === 0 && !composing;

  return (
    <LensShell lensId="cognitive-replay" asMain={false}>
      <div data-lens-theme="cognitive-replay" className="relative min-h-full bg-black px-8 pb-28 pt-6">
        <h1 className="mb-2 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">Moments</h1>
        <p className="mb-5 text-[14px] text-zinc-400">Your moment journal — a line worth keeping, with the date it was kept.</p>

        <section
          aria-label="Moments"
          className="flex min-h-[22rem] items-center justify-center rounded-2xl border border-white/10 bg-zinc-950 px-6 py-5"
        >
          {phase === 'loading' && (
            <p data-testid="cr-loading" role="status" aria-busy="true" className="text-[14px] text-zinc-500">
              Opening your moments.
            </p>
          )}
          {phase === 'error' && (
            <div data-testid="cr-error" role="alert">
              <p className="text-[14px] text-zinc-300">{loadError || 'Could not load your moments.'}</p>
              <button type="button" onClick={load} className="mt-4 text-[14px] text-zinc-100 underline">
                Retry
              </button>
            </div>
          )}
          {empty && (
            <p data-testid="cr-empty" className="text-[14px] text-zinc-400">No moments yet.</p>
          )}
          {phase === 'ready' && moments.length > 0 && (
            <ul data-testid="cr-moments" className="w-full space-y-6 self-start">
              {moments.map((moment) => (
                <li key={moment.id}>
                  <h2 className="font-vault text-[1.5rem] leading-8 text-zinc-100">{moment.title}</h2>
                  {formatMomentDate(moment.createdAt) ? (
                    <p data-testid="cr-date" className="mt-1 text-[13px] text-zinc-500">{formatMomentDate(moment.createdAt)}</p>
                  ) : null}
                  {moment.line ? (
                    <p data-testid="cr-line" className="mt-3 text-[15px] text-zinc-300">{moment.line}</p>
                  ) : null}
                  <div className="mt-2 flex gap-4 text-[13px]">
                    <button
                      type="button"
                      data-testid="cr-edit"
                      onClick={() => startEdit(moment)}
                      disabled={busy}
                      className="text-zinc-400 underline hover:text-zinc-200 disabled:opacity-60"
                    >
                      Edit
                    </button>
                    {confirmDeleteId === moment.id ? (
                      <>
                        <button
                          type="button"
                          data-testid="cr-delete-confirm"
                          onClick={() => { void deleteMoment(moment); }}
                          disabled={busy}
                          className="text-red-300 underline disabled:opacity-60"
                        >
                          {`Delete "${moment.title}"?`}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          disabled={busy}
                          className="text-zinc-400 underline hover:text-zinc-200 disabled:opacity-60"
                        >
                          Keep
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        data-testid="cr-delete"
                        onClick={() => { void deleteMoment(moment); }}
                        disabled={busy}
                        className="text-zinc-400 underline hover:text-zinc-200 disabled:opacity-60"
                      >
                        Delete
                      </button>
                    )}
                  </div>
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
                    if (event.key === 'Enter') { event.preventDefault(); void addMoment(); }
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

        {composing ? (
          <button
            type="button"
            onClick={closeComposer}
            disabled={busy}
            className="fixed bottom-8 right-44 z-30 text-[14px] text-zinc-300 underline disabled:opacity-60"
          >
            Cancel
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => { void addMoment(); }}
          disabled={phase !== 'ready' || busy}
          className="fixed bottom-8 right-8 z-30 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          {composing ? 'Save moment' : 'Add a moment'}
        </button>
      </div>
    </LensShell>
  );
}
