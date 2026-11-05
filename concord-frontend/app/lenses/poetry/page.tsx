'use client';

/**
 * Poetry — one poem.
 *
 * poem-list is the page. Save poem calls poem-create, then shows the
 * title only after poem-list contains that id and the same title, and
 * shows the lines only after poem-detail returns that same body. A blank
 * title is not sent. A blank body is not sent. Title and body are stored
 * in poetry_poems, so a server restart still lists them. Form and status
 * stay off this screen. The notebook views are other macros. They are
 * not on this screen.
 *
 * D1 (poetry review, 2026-11-03): the commit used to be an unlabelled
 * re-click of "+ New poem" — a button whose label never said "save",
 * with no draft recovery on reload. The floating button now relabels to
 * "Save poem" while composing, and the in-progress title/body are
 * mirrored to localStorage so a reload restores the draft instead of
 * losing it.
 * D2: Edit and Delete are real, wired to poem-update/poem-delete
 * (two-click confirm on delete, same shape as the rest of the family).
 * D3: a truthful line/word count is shown per poem, computed from the
 * same body text the page already holds — no separate macro call.
 * D5: the shared Export (JSON/CSV) and the ↓.dtu control both read
 * through poetry.js's registered export provider (see
 * lib/lens-export.js); the ↓.dtu control itself is the DTUExportButton
 * below.
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { lensRun } from '@/lib/api/client';

interface Poem {
  id: string;
  title: string;
  body: string;
}

type Phase = 'loading' | 'ready' | 'error';

const DRAFT_KEY = 'concord:poetry:draft:v1';

function readDraft(): { title: string; body: string } | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { title?: unknown; body?: unknown };
    const title = typeof parsed.title === 'string' ? parsed.title : '';
    const body = typeof parsed.body === 'string' ? parsed.body : '';
    if (!title.trim() && !body.trim()) return null;
    return { title, body };
  } catch {
    return null;
  }
}

function writeDraft(title: string, body: string): void {
  try {
    if (!title.trim() && !body.trim()) {
      window.localStorage.removeItem(DRAFT_KEY);
      return;
    }
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ title, body }));
  } catch {
    // a draft is a convenience, never required for Save poem to work
  }
}

function clearDraft(): void {
  try { window.localStorage.removeItem(DRAFT_KEY); } catch { /* best effort */ }
}

function counts(body: string): { lines: number; words: number } {
  const lines = body.split('\n').filter((line) => line.trim()).length;
  const words = body.split(/\s+/).filter((word) => word.trim()).length;
  return { lines, words };
}

function poemsFrom(rows: unknown): { id: string; title: string }[] {
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

function isWarming(message: string): boolean {
  return /service_overloaded|event_loop_lag|status code 503/i.test(message);
}

async function runPoetry<T>(name: string, input: Record<string, unknown>, fallback: string): Promise<T> {
  let last = fallback;
  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await lensRun<T>('poetry', name, input);
    if (response.data?.ok && response.data.result) return response.data.result;
    last = response.data?.error || last;
    if (!isWarming(last) || attempt === 7) throw new Error(last);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(last);
}

// poem-list is a small read. A 503 here is the admission gate refusing
// PROTECTED calls while boot lag is over 900ms, not a failed poem query.
// Retry on that gate only. Any other error surfaces immediately.
async function readPoems(): Promise<Poem[]> {
  const listed = await runPoetry<{ poems?: unknown }>('poem-list', {}, 'Could not read the poem.');
  const slim = poemsFrom(listed.poems);
  const out: Poem[] = [];
  for (const poem of slim) {
    const detail = await runPoetry<{ poem?: { body?: unknown; title?: unknown } }>(
      'poem-detail',
      { id: poem.id },
      'Could not read the poem.',
    );
    const body = detail.poem?.body;
    if (typeof body !== 'string') throw new Error('Could not read the poem.');
    out.push({ id: poem.id, title: poem.title, body });
  }
  return out;
}

function LineNumbers({ count }: { count: number }) {
  const n = Math.max(4, count);
  return (
    <ol className="w-10 shrink-0 select-none border-r border-white/10 py-4 text-right font-mono text-[13px] text-zinc-600">
      {Array.from({ length: n }, (_, index) => (
        <li key={index + 1} className="h-7 px-2 leading-7">{index + 1}</li>
      ))}
    </ol>
  );
}

export default function PoetryPage() {
  useLensNav('poetry');
  const [phase, setPhase] = useState<Phase>('loading');
  const [poems, setPoems] = useState<Poem[]>([]);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');

  const [deleteArmedId, setDeleteArmedId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const pull = useCallback(async () => readPoems(), []);

  useEffect(() => {
    let cancelled = false;
    pull().then((rows) => {
      if (cancelled) return;
      setPoems(rows);
      setPhase('ready');
    }).catch((err) => {
      if (cancelled) return;
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the poem.');
    });
    return () => { cancelled = true; };
  }, [pull]);

  // D1: restore an uncommitted draft once, on mount — a reload with
  // unsaved text no longer loses it.
  useEffect(() => {
    const draft = readDraft();
    if (draft) {
      setTitle(draft.title);
      setBody(draft.body);
      setComposing(true);
    }
  }, []);

  // D1: mirror in-progress text to the draft while composing. Cleared
  // explicitly on a successful save or an explicit Cancel.
  useEffect(() => {
    if (!composing) return;
    writeDraft(title, body);
  }, [composing, title, body]);

  const load = useCallback(() => {
    setPhase('loading');
    setLoadError('');
    setActionError('');
    pull().then((rows) => {
      setPoems(rows);
      setPhase('ready');
    }).catch((err) => {
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the poem.');
    });
  }, [pull]);

  const openPoem = useCallback(() => {
    if (busy || phase !== 'ready') return;
    setEditingId(null);
    setComposing(true);
    setActionError('');
  }, [busy, phase]);

  const cancelCompose = useCallback(() => {
    setComposing(false);
    setTitle('');
    setBody('');
    setActionError('');
    clearDraft();
  }, []);

  const savePoem = useCallback(async () => {
    if (busy || phase !== 'ready') return;
    const trimmed = title.trim();
    const lines = body.trim();
    if (!trimmed) {
      setActionError('A title is required.');
      return;
    }
    if (!lines) {
      setActionError('A line is required.');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      const created = await runPoetry<{ poem?: { id?: string } }>(
        'poem-create',
        { title: trimmed, body: lines },
        'Could not save that poem.',
      );
      const id = created.poem?.id;
      if (!id) throw new Error('Could not save that poem.');
      const rows = await readPoems();
      const row = rows.find((item) => item.id === id);
      if (!row || row.title !== trimmed || row.body !== lines) {
        throw new Error('Saved, but the poem did not read it back.');
      }
      setPoems(rows);
      setTitle('');
      setBody('');
      setComposing(false);
      clearDraft();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not save that poem.');
    } finally {
      setBusy(false);
    }
  }, [body, busy, phase, title]);

  const primaryAction = useCallback(() => {
    if (composing) { void savePoem(); } else { openPoem(); }
  }, [composing, openPoem, savePoem]);

  useLensCommand(
    [{ id: 'poetry-new', keys: 'n', description: '+ New poem', category: 'actions', action: primaryAction }],
    { lensId: 'poetry' },
  );

  const startEdit = useCallback((poem: Poem) => {
    setComposing(false);
    setDeleteArmedId(null);
    setEditingId(poem.id);
    setEditTitle(poem.title);
    setEditBody(poem.body);
    setEditError('');
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditTitle('');
    setEditBody('');
    setEditError('');
  }, []);

  const saveEdit = useCallback(async (id: string) => {
    if (editBusy) return;
    const trimmed = editTitle.trim();
    const lines = editBody.trim();
    if (!trimmed) {
      setEditError('A title is required.');
      return;
    }
    if (!lines) {
      setEditError('A line is required.');
      return;
    }
    setEditBusy(true);
    setEditError('');
    try {
      const updated = await runPoetry<{ poem?: { id?: string } }>(
        'poem-update',
        { id, title: trimmed, body: lines },
        'Could not save that edit.',
      );
      if (!updated.poem?.id) throw new Error('Could not save that edit.');
      const rows = await readPoems();
      const row = rows.find((item) => item.id === id);
      if (!row || row.title !== trimmed || row.body !== lines) {
        throw new Error('Saved, but the poem did not read it back.');
      }
      setPoems(rows);
      setEditingId(null);
      setEditTitle('');
      setEditBody('');
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Could not save that edit.');
    } finally {
      setEditBusy(false);
    }
  }, [editBody, editBusy, editTitle]);

  const requestDelete = useCallback((id: string) => {
    setEditingId(null);
    setDeleteError('');
    setDeleteArmedId(id);
  }, []);

  const cancelDelete = useCallback(() => {
    setDeleteArmedId(null);
    setDeleteError('');
  }, []);

  const confirmDelete = useCallback(async (id: string) => {
    if (deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError('');
    try {
      const result = await runPoetry<{ deleted?: string }>('poem-delete', { id }, 'Could not delete that poem.');
      if (result.deleted !== id) throw new Error('Could not delete that poem.');
      const rows = await readPoems();
      if (rows.some((item) => item.id === id)) {
        throw new Error('Deleted, but the poem is still listed.');
      }
      setPoems(rows);
      setDeleteArmedId(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not delete that poem.');
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteBusy]);

  const empty = phase === 'ready' && poems.length === 0 && !composing;

  return (
    <LensShell lensId="poetry" asMain={false}>
      <div data-lens-theme="poetry" className="relative min-h-full bg-black px-8 pb-28 pt-6">
        <div className="mb-5 mt-1 flex items-center justify-between gap-4">
          <h1 className="font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">Poetry</h1>
          <DTUExportButton domain="poetry" data={{}} compact />
        </div>

        <section
          aria-label="Poem"
          className="min-h-[22rem] rounded-2xl border border-white/10 bg-zinc-950"
        >
          {phase === 'loading' && (
            <p data-testid="po-loading" role="status" aria-busy="true" className="px-6 py-5 text-[14px] text-zinc-500">
              Opening the poem.
            </p>
          )}
          {phase === 'error' && (
            <div data-testid="po-error" role="alert" className="px-6 py-5">
              <p className="text-[14px] text-zinc-300">{loadError || 'Could not load the poem.'}</p>
              <button type="button" onClick={load} className="mt-4 text-[14px] text-zinc-100 underline">
                Retry
              </button>
            </div>
          )}
          {empty && (
            <div data-testid="po-empty" className="flex min-h-[20rem]">
              <LineNumbers count={4} />
              <div className="px-4 py-4 font-mono text-[14px]">
                <p className="h-7 leading-7 text-zinc-500">{'// the page is empty.'}</p>
                <p className="h-7" />
                <p className="flex h-7 items-center">
                  <span data-testid="po-caret" className="inline-block h-4 w-2 bg-teal-400" />
                </p>
              </div>
            </div>
          )}
          {phase === 'ready' && poems.length > 0 && (
            <ul data-testid="po-poems">
              {poems.map((poem) => {
                const lines = poem.body.split('\n');
                const stats = counts(poem.body);
                const editingThis = editingId === poem.id;
                return (
                  <li key={poem.id} className="border-b border-white/10 px-6 py-5 last:border-b-0">
                    {editingThis ? (
                      <div className="space-y-4">
                        <label className="block text-[14px] text-zinc-400">
                          Title
                          <input
                            data-testid="po-edit-title"
                            value={editTitle}
                            onChange={(event) => setEditTitle(event.target.value)}
                            className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 font-vault text-[1.25rem] text-zinc-100 outline-none"
                            autoFocus
                          />
                        </label>
                        <label className="block text-[14px] text-zinc-400">
                          Lines
                          <textarea
                            data-testid="po-edit-body"
                            value={editBody}
                            onChange={(event) => setEditBody(event.target.value)}
                            rows={6}
                            className="mt-1 w-full resize-none border-b border-white/15 bg-transparent pb-2 font-mono text-[14px] text-zinc-100 outline-none"
                          />
                        </label>
                        {editError ? <p role="alert" className="text-[14px] text-zinc-300">{editError}</p> : null}
                        <div className="flex gap-4">
                          <button
                            type="button"
                            data-testid="po-edit-save"
                            onClick={() => { void saveEdit(poem.id); }}
                            disabled={editBusy}
                            className="text-[14px] text-teal-400 underline disabled:opacity-60"
                          >
                            {editBusy ? 'Saving…' : 'Save edit'}
                          </button>
                          <button type="button" data-testid="po-edit-cancel" onClick={cancelEdit} className="text-[14px] text-zinc-400 underline">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-start justify-between gap-4">
                          <h2 className="font-vault text-[1.5rem] leading-8 text-zinc-100">{poem.title}</h2>
                          <div className="flex shrink-0 items-center gap-3">
                            <button type="button" data-testid="po-edit" onClick={() => startEdit(poem)} className="text-[13px] text-zinc-400 underline">
                              Edit
                            </button>
                            {deleteArmedId === poem.id ? (
                              <>
                                <button
                                  type="button"
                                  data-testid="po-delete-confirm"
                                  onClick={() => { void confirmDelete(poem.id); }}
                                  disabled={deleteBusy}
                                  className="text-[13px] text-red-400 underline disabled:opacity-60"
                                >
                                  {deleteBusy ? 'Deleting…' : 'Confirm delete?'}
                                </button>
                                <button type="button" onClick={cancelDelete} className="text-[13px] text-zinc-400 underline">
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button type="button" data-testid="po-delete" onClick={() => requestDelete(poem.id)} className="text-[13px] text-zinc-400 underline">
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                        <p data-testid="po-counts" className="mt-1 text-[12px] text-zinc-500">
                          {stats.lines} line{stats.lines === 1 ? '' : 's'} · {stats.words} word{stats.words === 1 ? '' : 's'}
                        </p>
                        {deleteError && deleteArmedId === poem.id ? (
                          <p role="alert" className="mt-1 text-[13px] text-zinc-300">{deleteError}</p>
                        ) : null}
                        <div className="mt-3 flex">
                          <LineNumbers count={lines.length} />
                          <div className="px-4 py-4 font-mono text-[14px] text-zinc-300">
                            {lines.map((line, index) => (
                              <p key={`${poem.id}-${index}`} data-testid="po-line" className="h-7 leading-7">{line}</p>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {phase === 'ready' && composing && (
            <div className="space-y-4 px-6 py-5">
              <label className="block text-[14px] text-zinc-400">
                Title
                <input
                  data-testid="po-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 font-vault text-[1.25rem] text-zinc-100 outline-none"
                  autoFocus
                />
              </label>
              <label className="block text-[14px] text-zinc-400">
                Lines
                <textarea
                  data-testid="po-body"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  rows={6}
                  className="mt-1 w-full resize-none border-b border-white/15 bg-transparent pb-2 font-mono text-[14px] text-zinc-100 outline-none"
                />
              </label>
              <button type="button" data-testid="po-cancel" onClick={cancelCompose} className="text-[13px] text-zinc-400 underline">
                Cancel
              </button>
            </div>
          )}
        </section>

        {actionError ? (
          <p role="alert" className="mt-4 text-[14px] text-zinc-300">{actionError}</p>
        ) : null}

        <button
          type="button"
          onClick={primaryAction}
          disabled={phase !== 'ready' || busy}
          className="fixed bottom-8 right-8 z-30 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          {composing ? (busy ? 'Saving…' : 'Save poem') : '+ New poem'}
        </button>
      </div>
    </LensShell>
  );
}
