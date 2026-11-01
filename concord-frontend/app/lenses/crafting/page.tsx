'use client';

/**
 * Crafting — the piece on the bench.
 *
 * One list: GET /api/crafting/recipes (SQLite dtus where type is recipe).
 * One action: a name, then POST /api/crafting/design, then the same GET
 * must contain the new id before the title is shown.
 *
 * D1: a saved piece is also a canonical lens artifact (POST
 * /api/lens/crafting, data.recipeId joins the two). The artifact is the
 * piece's platform identity — the shared Export reads lens artifacts —
 * so a piece the bench can show is a piece the platform can hold. Each
 * joined piece carries the bench's own Publish act (POST
 * /api/lens/crafting/:artifactId/publish). Pieces saved before D1 gain
 * their artifact when the bench loads (owner-scoped: /recipes only ever
 * returns the caller's own rows). If registration fails, the piece still
 * shows and the bench says so; the next load retries.
 *
 * D2: a piece can be renamed and removed. Rename and delete act on both
 * stores — PATCH/DELETE /api/crafting/recipes/:id for the bench row,
 * PUT/DELETE /api/lens/crafting/:artifactId for the platform record —
 * and a title that diverged (a rename whose platform half failed) is
 * converged by the next load.
 *
 * F7: a rename converges every name copy the artifact carries — title,
 * data.name, and data.spec.name — not the title alone, or the exported
 * artifact goes on calling the piece by its old name. The load-time
 * convergence checks all three copies, so an artifact that diverged
 * before this fix heals on the next load. An empty name on "Save the
 * name" is refused out loud in the form; it used to return silently.
 * The name being typed is a lens draft
 * (useLensDraft): leaving the lens no longer destroys it, and a
 * successful save clears it. Typing a name already on the bench says so
 * under the field — a notice, not a wall.
 *
 * Locker DTUs, forge, marketplace, skills, and the in-memory workbench
 * are other stores. They are not on this screen.
 */

import { useCallback, useEffect, useId, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensDraft } from '@/hooks/useLensDraft';
import { api } from '@/lib/api/client';
import {
  artifactNameLag,
  artifactsFromList,
  isDuplicateName,
  joinPieces,
  pieceArtifactBody,
  pieceDesignBody,
  pieceRenameBody,
  recipesFromList,
  saveErrorFrom,
  specsFromRecipesList,
  type BenchPiece,
} from '@/components/crafting/bench';

export default function CraftingPage() {
  const nameId = useId();
  const [recipes, setRecipes] = useState<BenchPiece[]>([]);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [open, setOpen] = useState(false);
  // F5: the name being typed for a new piece is a lens draft — it
  // survives leaving the lens and is cleared only by a successful save.
  const { value: name, setValue: setName, clear: clearDraft } = useLensDraft<string>('crafting', 'benchPieceName', { initial: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useState('');

  const pull = useCallback(async () => {
    const res = await api.get('/api/crafting/recipes');
    const body = res.data as { ok?: boolean; error?: unknown };
    if (body && body.ok === false) {
      const error = typeof body.error === 'string' && body.error ? body.error : 'The bench did not answer.';
      return { ok: false as const, error };
    }
    return { ok: true as const, recipes: recipesFromList(body), specs: specsFromRecipesList(body) };
  }, []);

  // The canonical layer is additive: its failure never errors the bench.
  // ok:false means "unknown" — callers must not backfill against it, or a
  // failed list would mint duplicate artifacts for pieces that have one.
  const pullArtifacts = useCallback(async () => {
    try {
      const res = await api.get('/api/lens/crafting', { params: { limit: 200 } });
      const body = res.data as { ok?: boolean } | null;
      if (!body || body.ok === false) return { ok: false as const, rows: [] };
      return { ok: true as const, rows: artifactsFromList(body) };
    } catch {
      return { ok: false as const, rows: [] };
    }
  }, []);

  const registerPiece = useCallback(async (piece: { id: string; title: string; spec?: unknown }) => {
    try {
      const res = await api.post('/api/lens/crafting', pieceArtifactBody(piece));
      const artifact = (res.data as { artifact?: { id?: unknown } } | null)?.artifact;
      return typeof artifact?.id === 'string' && artifact.id ? artifact.id : null;
    } catch {
      return null;
    }
  }, []);

  const applyPull = useCallback(async (result: Awaited<ReturnType<typeof pull>>) => {
    if (!result.ok) {
      setPhase('error');
      setLoadError(result.error);
      return;
    }
    setPhase('ready');
    const listed = await pullArtifacts();
    if (!listed.ok) {
      setRecipes(result.recipes);
      return;
    }
    let finalRows = listed.rows;
    let pieces = joinPieces(result.recipes, finalRows);
    // Backfill: pieces saved before D1 have no artifact yet. Registration
    // is owner-scoped by construction (the recipes list is the caller's).
    const missing = pieces.filter((p) => !p.artifactId);
    if (missing.length > 0) {
      let createdAny = false;
      for (const piece of missing) {
        const artifactId = await registerPiece({
          id: piece.id,
          title: piece.title,
          spec: result.specs.get(piece.id),
        });
        if (artifactId) createdAny = true;
      }
      if (createdAny) {
        const refreshed = await pullArtifacts();
        if (refreshed.ok) {
          finalRows = refreshed.rows;
          pieces = joinPieces(result.recipes, finalRows);
        }
      }
    }
    // Name convergence (D2 + F7): the bench row is the name of record.
    // A joined artifact lagging in ANY name copy — title, data.name, or
    // data.spec.name — is brought back in line, best-effort. The spec
    // sent is the artifact's own embedded copy when it has one, else
    // the recipe row's; only its name moves.
    for (const piece of pieces) {
      if (!piece.artifactId) continue;
      const listedRow = finalRows.find((a) => a.id === piece.artifactId);
      if (listedRow && artifactNameLag(listedRow, piece.title)) {
        // Converge the spec copy only when the artifact carries one —
        // load never mints a spec the artifact never had.
        const spec = listedRow.spec ?? (listedRow.specName !== undefined ? result.specs.get(piece.id) : undefined);
        void api.put(`/api/lens/crafting/${piece.artifactId}`, pieceRenameBody(piece.title, spec)).catch(() => {});
      }
    }
    setRecipes(pieces);
  }, [pullArtifacts, registerPiece]);

  const failPull = useCallback((err: unknown) => {
    setPhase('error');
    setLoadError(saveErrorFrom(err, 'The bench did not answer.'));
  }, []);

  useEffect(() => {
    let cancelled = false;
    pull()
      .then((result) => { if (!cancelled) void applyPull(result); })
      .catch((err) => { if (!cancelled) failPull(err); });
    return () => { cancelled = true; };
  }, [pull, applyPull, failPull]);

  const load = useCallback(() => {
    setPhase('loading');
    setLoadError('');
    pull().then(applyPull).catch(failPull);
  }, [pull, applyPull, failPull]);

  const start = useCallback(() => {
    setEditingId(null);
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
      const design = pieceDesignBody(title);
      const res = await api.post('/api/crafting/design', design);
      const body = res.data as { ok?: boolean; error?: unknown; recipe?: { id?: unknown } };
      const id = typeof body?.recipe?.id === 'string' ? body.recipe.id : '';
      if (!body?.ok || !id) {
        setSaveError(typeof body?.error === 'string' && body.error ? body.error : 'The bench did not keep that piece.');
        return;
      }
      const listed = await api.get('/api/crafting/recipes');
      const rows = recipesFromList(listed.data);
      setPhase('ready');
      if (!rows.some((row) => row.id === id)) {
        setRecipes(rows);
        setSaveError('Saved, but the bench did not read it back.');
        return;
      }
      // D1: register the piece canonically so export and publish can see
      // it. The piece is saved either way; a failed registration is said
      // out loud and retried by the next load's backfill.
      const artifactId = await registerPiece({ id, title, spec: design.spec });
      const known = recipes
        .filter((p) => p.artifactId)
        .map((p) => ({ id: p.artifactId as string, recipeId: p.id, title: p.title, published: Boolean(p.published) }));
      setRecipes(joinPieces(rows, artifactId ? [...known, { id: artifactId, recipeId: id, title, published: false }] : known));
      if (!artifactId) {
        setNotice('Saved to the bench. Its platform record could not be created yet — it will be completed when the bench reloads.');
      }
      void clearDraft();
      setOpen(false);
    } catch (err) {
      setSaveError(saveErrorFrom(err, 'The bench did not keep that piece.'));
    } finally {
      setSaving(false);
    }
  }, [name, saving, registerPiece, recipes, clearDraft]);

  const [publishingId, setPublishingId] = useState<string | null>(null);

  // D1's publish act: the piece's canonical artifact is what publish acts
  // on (POST /api/lens/crafting/:artifactId/publish flips its visibility).
  // A piece with no artifact yet has nothing to publish — no button.
  const publishPiece = useCallback(async (piece: BenchPiece) => {
    if (!piece.artifactId || publishingId) return;
    setPublishingId(piece.id);
    try {
      const res = await api.post(`/api/lens/crafting/${piece.artifactId}/publish`, {});
      const body = res.data as { ok?: boolean } | null;
      if (!body || body.ok === false) throw new Error('publish refused');
      setRecipes((prev) => prev.map((p) => (p.id === piece.id ? { ...p, published: true } : p)));
    } catch {
      setNotice('That piece could not be published. It is still on your bench.');
    } finally {
      setPublishingId(null);
    }
  }, [publishingId]);

  const startEdit = useCallback((piece: BenchPiece) => {
    setEditingId(piece.id);
    setEditName(piece.title);
    setConfirmingId(null);
    setSaveError('');
    setOpen(true);
  }, []);

  // D2 rename: the bench row first (PATCH is the title of record), then
  // the platform record. A failed platform half is converged by the next
  // load's name sync; a failed bench half keeps the old name everywhere.
  // F7: the platform half converges every name copy (pieceRenameBody),
  // with the spec re-read from the recipe row the PATCH just converged;
  // an empty name is refused out loud instead of silently returning.
  const saveEdit = useCallback(async () => {
    const piece = recipes.find((p) => p.id === editingId);
    if (!piece || saving) return;
    const title = editName.trim();
    if (!title) {
      setSaveError('A piece needs a name.');
      return;
    }
    setSaving(true);
    setSaveError('');
    try {
      const res = await api.patch(`/api/crafting/recipes/${piece.id}`, { title });
      const body = res.data as { ok?: boolean } | null;
      if (!body || body.ok === false) throw new Error('rename refused');
      if (piece.artifactId) {
        try {
          let spec: unknown;
          try {
            const listed = await api.get('/api/crafting/recipes');
            spec = specsFromRecipesList(listed.data).get(piece.id);
          } catch {
            spec = undefined;
          }
          await api.put(`/api/lens/crafting/${piece.artifactId}`, pieceRenameBody(title, spec));
        } catch {
          // Converged on the next load; the bench name already moved.
        }
      }
      setRecipes((prev) => prev.map((p) => (p.id === piece.id ? { ...p, title } : p)));
      setEditingId(null);
      setOpen(false);
    } catch {
      setSaveError('That name could not be saved. The piece keeps its old name.');
    } finally {
      setSaving(false);
    }
  }, [recipes, editingId, editName, saving]);

  // D2 delete: two-step on the row (first click arms, second confirms).
  // The bench row goes first; a platform record that cannot be removed
  // is said out loud, never left silent.
  const deletePiece = useCallback(async (piece: BenchPiece) => {
    if (deletingId) return;
    setDeletingId(piece.id);
    try {
      const res = await api.delete(`/api/crafting/recipes/${piece.id}`);
      const body = res.data as { ok?: boolean } | null;
      if (body && body.ok === false) throw new Error('delete refused');
      if (piece.artifactId) {
        try {
          await api.delete(`/api/lens/crafting/${piece.artifactId}`);
        } catch {
          setNotice('The piece was removed from your bench. Its platform record could not be removed, so it may still appear in exports.');
        }
      }
      setRecipes((prev) => prev.filter((p) => p.id !== piece.id));
      setConfirmingId(null);
      if (editingId === piece.id) {
        setEditingId(null);
        setOpen(false);
      }
    } catch {
      setNotice('That piece could not be deleted. It is still on your bench.');
    } finally {
      setDeletingId(null);
    }
  }, [deletingId, editingId]);

  const onPrimary = useCallback(() => {
    if (!open) {
      start();
      return;
    }
    if (editingId) {
      void saveEdit();
      return;
    }
    void putOnBench();
  }, [open, start, putOnBench, editingId, saveEdit]);

  useLensCommand(
    [{ id: 'start-piece', keys: 'n', description: 'Start a piece', category: 'actions' as const, action: start }],
    { lensId: 'crafting' },
  );


  return (
    <LensShell lensId="crafting" asMain={false}>
      <div data-lens-theme="crafting" className="relative min-h-full bg-black px-8 pb-28 pt-6">
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">Crafting</h1>

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
          {phase === 'ready' && notice && (
            <p role="status" className="mb-4 max-w-xl text-center text-[13px] text-zinc-400">{notice}</p>
          )}
          {phase === 'ready' && recipes.length === 0 && !open && (
            <p className="text-[14px] text-zinc-500">The bench is clear.</p>
          )}
          {phase === 'ready' && recipes.length > 0 && (
            <ul className="w-full max-w-xl self-stretch">
              {recipes.map((row) => (
                <li key={row.id} className="flex items-baseline justify-between gap-4 border-b border-white/10 py-3 text-[16px] text-zinc-100">
                  <span>{row.title}</span>
                  <span className="flex shrink-0 items-baseline gap-3">
                    {row.published ? (
                      <span className="text-[12px] text-zinc-500">Published</span>
                    ) : row.artifactId ? (
                      <button
                        type="button"
                        onClick={() => void publishPiece(row)}
                        disabled={publishingId === row.id}
                        className="text-[13px] text-zinc-300 underline disabled:opacity-60"
                      >
                        Publish
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => startEdit(row)}
                      className="text-[13px] text-zinc-300 underline"
                    >
                      Edit
                    </button>
                    {confirmingId === row.id ? (
                      <button
                        type="button"
                        onClick={() => void deletePiece(row)}
                        disabled={deletingId === row.id}
                        className="text-[13px] text-zinc-100 underline disabled:opacity-60"
                      >
                        Delete this piece?
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmingId(row.id)}
                        className="text-[13px] text-zinc-300 underline"
                      >
                        Delete
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {phase === 'ready' && open && (
            <form
              className="mt-6 w-full max-w-md"
              onSubmit={(event) => { event.preventDefault(); onPrimary(); }}
            >
              <label htmlFor={nameId} className="block text-[13px] text-zinc-400">Piece name</label>
              <input
                id={nameId}
                value={editingId ? editName : name}
                onChange={(event) => {
                  if (editingId) setEditName(event.target.value);
                  else setName(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setOpen(false);
                    setEditingId(null);
                    setSaveError('');
                  }
                }}
                autoFocus
                className="mt-2 w-full border-b border-white/20 bg-transparent py-2 text-[18px] text-zinc-100 outline-none"
              />
              {isDuplicateName(editingId ? editName : name, recipes, editingId ?? undefined) ? (
                <p className="mt-2 text-[13px] text-zinc-400">A piece with this name is already on the bench.</p>
              ) : null}
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
          {open && editingId ? 'Save the name' : '+ Start a piece'}
        </button>
      </div>
    </LensShell>
  );
}
