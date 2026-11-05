'use client';

/**
 * Maker — the bench.
 *
 * Review F5 (unscoped-shared-store-rendering): this page used to call
 * app-maker.projectList/projectCreate — a user-wide app-builder project
 * list with no lens scoping, so every App Maker project rendered here
 * too, unlabelled, next to real makes. It now reads/writes its own
 * domain (maker.list/create/update/delete, server/domains/maker.js,
 * migration 497) — there is nothing foreign left to show.
 *
 * Review F2/F3 (name-only shell, no edit/rename/delete): a make now
 * carries one body field (`spec`, free text — the review's floor is
 * "spec plus one body field", not full Crafting field parity) and has
 * a real edit/rename and delete lifecycle, mirroring the pattern
 * already shipped for the Crafting bench (app/lenses/crafting/page.tsx).
 *
 * Review F4 (silent draft loss on navigation): the name + spec being
 * composed is a lens draft (useLensDraft) — leaving the lens no longer
 * destroys it, and a successful save clears it.
 */

import { useCallback, useEffect, useId, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensDraft } from '@/hooks/useLensDraft';
import { lensRun } from '@/lib/api/client';

interface Make {
  id: string;
  name: string;
  spec: string;
}

type Phase = 'loading' | 'ready' | 'error';

interface MakeRow {
  id?: string;
  name?: string;
  spec?: string;
}

interface Draft {
  name: string;
  spec: string;
}

const EMPTY_DRAFT: Draft = { name: '', spec: '' };

function makesFrom(rows: unknown): Make[] {
  if (!Array.isArray(rows)) return [];
  const out: Make[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = (row as MakeRow).id;
    const name = (row as MakeRow).name;
    if (typeof id !== 'string' || !id) continue;
    if (typeof name !== 'string' || !name.trim()) continue;
    out.push({ id, name: name.trim(), spec: typeof (row as MakeRow).spec === 'string' ? (row as MakeRow).spec as string : '' });
  }
  return out;
}

function errorFrom(res: { data?: { error?: unknown; reason?: unknown } } | null, fallback: string): string {
  const data = res?.data;
  if (data && typeof data.error === 'string' && data.error) return data.error;
  if (data && typeof data.reason === 'string' && data.reason) return data.reason;
  return fallback;
}

async function readBench(): Promise<Make[]> {
  const list = await lensRun<{ makes?: unknown }>('maker', 'list', {});
  if (!list.data?.ok) throw new Error(errorFrom(list, 'Could not read the bench.'));
  return makesFrom(list.data.result?.makes);
}

function isDuplicateName(name: string, makes: Make[], excludeId?: string): boolean {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return false;
  return makes.some((m) => m.id !== excludeId && m.name.trim().toLowerCase() === wanted);
}

export default function MakerPage() {
  useLensNav('maker');
  const nameId = useId();
  const [phase, setPhase] = useState<Phase>('loading');
  const [makes, setMakes] = useState<Make[]>([]);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [open, setOpen] = useState(false);
  // F4: the name + spec being composed is a lens draft — it survives
  // leaving the lens and is cleared only by a successful save.
  const { value: draft, setValue: setDraft, clear: clearDraft } = useLensDraft<Draft>(
    'maker', 'benchDraft', { initial: EMPTY_DRAFT },
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editSpec, setEditSpec] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pull = useCallback(async () => readBench(), []);

  useEffect(() => {
    let cancelled = false;
    pull().then((rows) => {
      if (cancelled) return;
      setMakes(rows);
      setPhase('ready');
    }).catch((err) => {
      if (cancelled) return;
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the bench.');
    });
    return () => { cancelled = true; };
  }, [pull]);

  const load = useCallback(() => {
    setPhase('loading');
    setLoadError('');
    setActionError('');
    pull().then((rows) => {
      setMakes(rows);
      setPhase('ready');
    }).catch((err) => {
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the bench.');
    });
  }, [pull]);

  const start = useCallback(() => {
    setEditingId(null);
    setOpen(true);
    setActionError('');
  }, []);

  const make = useCallback(async () => {
    if (busy || phase !== 'ready') return;
    if (!open) {
      start();
      return;
    }
    const trimmed = draft.name.trim();
    if (!trimmed) {
      setActionError('A name is required.');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      const created = await lensRun<{ make?: { id?: string } }>(
        'maker', 'create', { name: trimmed, spec: draft.spec.trim() },
      );
      const id = created.data?.result?.make?.id;
      if (!created.data?.ok || !id) {
        throw new Error(errorFrom(created, 'Could not start that make.'));
      }
      const rows = await readBench();
      const row = rows.find((item) => item.id === id);
      if (!row || row.name !== trimmed) {
        throw new Error('Made, but the bench did not read it back.');
      }
      setMakes(rows);
      void clearDraft();
      setOpen(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not start that make.');
    } finally {
      setBusy(false);
    }
  }, [busy, phase, open, start, draft, clearDraft]);

  const startEdit = useCallback((item: Make) => {
    setEditingId(item.id);
    setEditName(item.name);
    setEditSpec(item.spec);
    setConfirmingId(null);
    setActionError('');
    setOpen(true);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingId || busy) return;
    const title = editName.trim();
    if (!title) {
      setActionError('A make needs a name.');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      const res = await lensRun<{ make?: { id?: string } }>(
        'maker', 'update', { id: editingId, name: title, spec: editSpec.trim() },
      );
      if (!res.data?.ok) throw new Error(errorFrom(res, 'That name could not be saved.'));
      setMakes((prev) => prev.map((m) => (m.id === editingId ? { ...m, name: title, spec: editSpec.trim() } : m)));
      setEditingId(null);
      setOpen(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'That name could not be saved. The make keeps its old name.');
    } finally {
      setBusy(false);
    }
  }, [editingId, editName, editSpec, busy]);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const deleteMake = useCallback(async (item: Make) => {
    if (deletingId) return;
    setDeletingId(item.id);
    try {
      const res = await lensRun('maker', 'delete', { id: item.id });
      if (!res.data?.ok) throw new Error(errorFrom(res, 'That make could not be deleted.'));
      setMakes((prev) => prev.filter((m) => m.id !== item.id));
      setConfirmingId(null);
      if (editingId === item.id) {
        setEditingId(null);
        setOpen(false);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'That make could not be deleted. It is still on your bench.');
    } finally {
      setDeletingId(null);
    }
  }, [deletingId, editingId]);

  const onPrimary = useCallback(() => {
    if (editingId) {
      void saveEdit();
      return;
    }
    void make();
  }, [editingId, saveEdit, make]);

  useLensCommand(
    [{ id: 'maker-new', keys: 'n', description: '+ New make', category: 'actions', action: () => { void start(); } }],
    { lensId: 'maker' },
  );

  return (
    <LensShell lensId="maker" asMain={false}>
      <div data-lens-theme="maker" className="relative min-h-full bg-black px-8 pb-28 pt-6">
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">Maker</h1>

        <section
          aria-label="Bench"
          className="flex min-h-[22rem] flex-col justify-center rounded-2xl border border-white/10 bg-zinc-950 px-6 py-16"
        >
          {phase === 'loading' && (
            <p data-testid="maker-loading" role="status" aria-busy="true" className="text-[14px] text-zinc-500">
              Opening the bench.
            </p>
          )}
          {phase === 'error' && (
            <div data-testid="maker-error" role="alert" className="text-center">
              <p className="text-[14px] text-zinc-300">{loadError || 'Could not load the bench.'}</p>
              <button type="button" onClick={load} className="mt-4 text-[14px] text-zinc-100 underline">
                Retry
              </button>
            </div>
          )}
          {phase === 'ready' && makes.length === 0 && !open && (
            <div data-testid="maker-empty" className="text-center">
              <p className="text-[14px] text-zinc-500">Nothing on the bench.</p>
            </div>
          )}
          {phase === 'ready' && makes.length > 0 && (
            <ul data-testid="maker-makes" className="w-full max-w-xl self-stretch space-y-6">
              {makes.map((item) => (
                <li key={item.id} className="border-b border-white/10 pb-4">
                  <div className="flex items-baseline justify-between gap-4">
                    <h2 className="font-vault text-[1.5rem] text-zinc-100">{item.name}</h2>
                    <span className="flex shrink-0 items-baseline gap-3">
                      <button type="button" onClick={() => startEdit(item)} className="text-[13px] text-zinc-300 underline">
                        Edit
                      </button>
                      {confirmingId === item.id ? (
                        <button
                          type="button"
                          onClick={() => void deleteMake(item)}
                          disabled={deletingId === item.id}
                          className="text-[13px] text-zinc-100 underline disabled:opacity-60"
                        >
                          Delete this make?
                        </button>
                      ) : (
                        <button type="button" onClick={() => setConfirmingId(item.id)} className="text-[13px] text-zinc-300 underline">
                          Delete
                        </button>
                      )}
                    </span>
                  </div>
                  {item.spec ? <p className="mt-1 text-[13px] text-zinc-500">{item.spec}</p> : null}
                </li>
              ))}
            </ul>
          )}
          {phase === 'ready' && open && (
            <form
              className="mt-6 w-full max-w-md"
              onSubmit={(event) => { event.preventDefault(); onPrimary(); }}
            >
              <label htmlFor={nameId} className="block text-[13px] text-zinc-400">Name</label>
              <input
                id={nameId}
                data-testid="maker-name"
                value={editingId ? editName : draft.name}
                onChange={(event) => {
                  if (editingId) setEditName(event.target.value);
                  else setDraft({ ...draft, name: event.target.value });
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); onPrimary(); }
                  if (event.key === 'Escape') {
                    setOpen(false);
                    setEditingId(null);
                    setActionError('');
                  }
                }}
                className="mt-2 w-full border-b border-white/15 bg-transparent pb-2 text-[16px] text-zinc-100 outline-none"
                autoFocus
              />
              {isDuplicateName(editingId ? editName : draft.name, makes, editingId ?? undefined) ? (
                <p className="mt-2 text-[13px] text-zinc-400">A make with this name is already on the bench.</p>
              ) : null}
              <label className="mt-4 block text-[13px] text-zinc-400">
                Spec (what it is, materials, steps)
                <textarea
                  data-testid="maker-spec"
                  value={editingId ? editSpec : draft.spec}
                  onChange={(event) => {
                    if (editingId) setEditSpec(event.target.value);
                    else setDraft({ ...draft, spec: event.target.value });
                  }}
                  rows={3}
                  className="mt-2 w-full resize-none rounded-lg border border-white/15 bg-transparent p-2 text-[14px] text-zinc-100 outline-none"
                />
              </label>
              {actionError ? <p role="alert" className="mt-3 text-[14px] text-zinc-300">{actionError}</p> : null}
              {busy ? <p role="status" className="mt-3 text-[14px] text-zinc-500">Saving the make.</p> : null}
            </form>
          )}
        </section>

        <button
          type="button"
          onClick={onPrimary}
          disabled={phase !== 'ready' || busy}
          className="fixed bottom-8 right-8 z-30 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          {open && editingId ? 'Save the name' : '+ New make'}
        </button>
      </div>
    </LensShell>
  );
}
