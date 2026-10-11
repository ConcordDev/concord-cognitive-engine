'use client';

import { useState } from 'react';
import { axiosStatus, deleteWhiteboard, ownerMutationNote, renameWhiteboard } from './boardOwner';

export function BoardOwnerMenu({
  boardId,
  title,
  onRenamed,
  onDeleted,
}: {
  boardId: string;
  title: string;
  onRenamed: (title: string) => void;
  onDeleted: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(title);
  const [busy, setBusy] = useState<'rename' | 'delete' | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function rename(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const next = draft.trim();
    if (!next) {
      setNote('A board name is required.');
      return;
    }
    setBusy('rename');
    setNote(null);
    try {
      const res = await renameWhiteboard(boardId, next);
      if (res.data?.ok === false) {
        setNote(ownerMutationNote(res.data?.status, String(res.data?.error || 'Rename was refused.')));
        return;
      }
      onRenamed(next);
      setRenaming(false);
      setNote(`Renamed to ${next}.`);
    } catch (err) {
      setNote(ownerMutationNote(axiosStatus(err), err instanceof Error ? err.message : 'Rename failed.'));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy('delete');
    setNote(null);
    try {
      const res = await deleteWhiteboard(boardId);
      if (res.data?.ok === false) {
        setNote(ownerMutationNote(res.data?.status, String(res.data?.error || 'Delete was refused.')));
        return;
      }
      onDeleted();
    } catch (err) {
      setNote(ownerMutationNote(axiosStatus(err), err instanceof Error ? err.message : 'Delete failed.'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="px-1 py-1">
      {renaming ? (
        <form onSubmit={(e) => { void rename(e); }} className="flex flex-col gap-1 px-1.5 py-1">
          <label className="text-[11px] text-zinc-500" htmlFor={`wb-rename-${boardId}`}>Board name</label>
          <input
            id={`wb-rename-${boardId}`}
            aria-label="Board name"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[13px] text-zinc-100"
          />
          <button type="submit" disabled={busy !== null} className="rounded-md px-2 py-1 text-left text-[13px] text-zinc-100 hover:bg-white/[0.06] disabled:opacity-40">
            {busy === 'rename' ? 'Saving name…' : 'Save name'}
          </button>
        </form>
      ) : (
        <button
          type="button"
          role="menuitem"
          onClick={() => { setDraft(title); setRenaming(true); }}
          className="flex w-full rounded-md px-2.5 py-1.5 text-left text-[13px] text-zinc-300 hover:bg-white/[0.06]"
        >
          Rename
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        onClick={() => { void remove(); }}
        disabled={busy !== null}
        className="flex w-full rounded-md px-2.5 py-1.5 text-left text-[13px] text-rose-300 hover:bg-white/[0.06] disabled:opacity-40"
      >
        {busy === 'delete' ? 'Deleting…' : 'Delete board'}
      </button>
      {note && <p className="px-2.5 py-1 text-[11px] text-zinc-400" role="status">{note}</p>}
    </div>
  );
}
