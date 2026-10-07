'use client';

/**
 * Crafting — the piece on the bench.
 *
 * One list: GET /api/crafting/recipes (SQLite dtus where type is recipe).
 * One action: a name, then POST /api/crafting/design, then the same GET
 * must contain the new id before the title is shown.
 *
 * Locker DTUs, forge, marketplace, skills, and the in-memory workbench
 * are other stores. They are not on this screen.
 */

import { useCallback, useEffect, useId, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { api } from '@/lib/api/client';
import {
  pieceDesignBody,
  recipesFromList,
  saveErrorFrom,
  type BenchRecipe,
} from '@/components/crafting/bench';

export default function CraftingPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const nameId = useId();
  const [recipes, setRecipes] = useState<BenchRecipe[]>([]);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const pull = useCallback(async () => {
    const res = await api.get('/api/crafting/recipes');
    const body = res.data as { ok?: boolean; error?: unknown };
    if (body && body.ok === false) {
      const error = typeof body.error === 'string' && body.error ? body.error : 'The bench did not answer.';
      return { ok: false as const, error };
    }
    return { ok: true as const, recipes: recipesFromList(body) };
  }, []);

  const applyPull = useCallback((result: Awaited<ReturnType<typeof pull>>) => {
    if (!result.ok) {
      setPhase('error');
      setLoadError(result.error);
      return;
    }
    setRecipes(result.recipes);
    setPhase('ready');
  }, []);

  const failPull = useCallback((err: unknown) => {
    setPhase('error');
    setLoadError(saveErrorFrom(err, 'The bench did not answer.'));
  }, []);

  useEffect(() => {
    let cancelled = false;
    pull()
      .then((result) => { if (!cancelled) applyPull(result); })
      .catch((err) => { if (!cancelled) failPull(err); });
    return () => { cancelled = true; };
  }, [pull, applyPull, failPull]);

  const load = useCallback(() => {
    setPhase('loading');
    setLoadError('');
    pull().then(applyPull).catch(failPull);
  }, [pull, applyPull, failPull]);

  const start = useCallback(() => {
    setOpen(true);
    setSaveError('');
  }, []);

  const putOnBench = useCallback(async () => {
    const title = name.trim();
    if (!title || saving) {
      setOpen(true);
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const res = await api.post('/api/crafting/design', pieceDesignBody(title));
      const body = res.data as { ok?: boolean; error?: unknown; recipe?: { id?: unknown } };
      const id = typeof body?.recipe?.id === 'string' ? body.recipe.id : '';
      if (!body?.ok || !id) {
        setSaveError(typeof body?.error === 'string' && body.error ? body.error : 'The bench did not keep that piece.');
        return;
      }
      const listed = await api.get('/api/crafting/recipes');
      const rows = recipesFromList(listed.data);
      setRecipes(rows);
      setPhase('ready');
      if (!rows.some((row) => row.id === id)) {
        setSaveError('Saved, but the bench did not read it back.');
        return;
      }
      setName('');
      setOpen(false);
    } catch (err) {
      setSaveError(saveErrorFrom(err, 'The bench did not keep that piece.'));
    } finally {
      setSaving(false);
    }
  }, [name, saving]);

  const onPrimary = useCallback(() => {
    if (!open) {
      start();
      return;
    }
    void putOnBench();
  }, [open, start, putOnBench]);

  useLensCommand(
    [{ id: 'start-piece', keys: 'n', description: 'Start a piece', category: 'actions' as const, action: start }],
    { lensId: 'crafting' },
  );

  const greeting = who ? `The piece on the bench, ${who}` : 'The piece on the bench';

  return (
    <LensShell lensId="crafting" asMain={false}>
      <div data-lens-theme="crafting" className="relative min-h-full bg-black px-8 pb-28 pt-6">
        <p className="text-[14px] text-zinc-500">Crafting</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          {greeting}
        </h1>

        <section
          aria-label="Bench"
          className="flex min-h-[22rem] flex-col items-center justify-center rounded-2xl border border-white/10 bg-zinc-950 px-6 py-16"
        >
          {phase === 'loading' && (
            <p role="status" className="text-[14px] text-zinc-500">Opening the bench.</p>
          )}
          {phase === 'error' && (
            <div role="alert" className="text-center">
              <p className="text-[14px] text-zinc-300">{loadError}</p>
              <button type="button" onClick={load} className="mt-4 text-[14px] text-zinc-100 underline">
                Retry
              </button>
            </div>
          )}
          {phase === 'ready' && recipes.length === 0 && !open && (
            <p className="text-[14px] text-zinc-500">The bench is clear.</p>
          )}
          {phase === 'ready' && recipes.length > 0 && (
            <ul className="w-full max-w-xl self-stretch">
              {recipes.map((row) => (
                <li key={row.id} className="border-b border-white/10 py-3 text-[16px] text-zinc-100">
                  {row.title}
                </li>
              ))}
            </ul>
          )}
          {phase === 'ready' && open && (
            <form
              className="mt-6 w-full max-w-md"
              onSubmit={(event) => { event.preventDefault(); void putOnBench(); }}
            >
              <label htmlFor={nameId} className="block text-[13px] text-zinc-400">Piece name</label>
              <input
                id={nameId}
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setOpen(false);
                    setSaveError('');
                  }
                }}
                autoFocus
                className="mt-2 w-full border-b border-white/20 bg-transparent py-2 text-[18px] text-zinc-100 outline-none"
              />
              {saveError ? <p role="alert" className="mt-3 text-[14px] text-zinc-300">{saveError}</p> : null}
              {saving ? <p role="status" className="mt-3 text-[14px] text-zinc-500">Saving the piece.</p> : null}
            </form>
          )}
        </section>

        <button
          type="button"
          onClick={onPrimary}
          disabled={saving || phase !== 'ready'}
          title="Start a piece (N)"
          className="fixed bottom-8 right-8 z-30 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black disabled:opacity-60"
        >
          + Start a piece
        </button>
      </div>
    </LensShell>
  );
}
