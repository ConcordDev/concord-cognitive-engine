'use client';

/**
 * FashionMoodboardPanel — pin inspiration to a canvas (Whering/Stylebook
 * parity gap, docs/lens-specs/fashion-capability-map.md: "No moodboards").
 * Distinct from SaveAsDtuButton's "save one item" — a moodboard is a named
 * board holding MANY pinned external image references, each with an
 * optional note and a simple x/y position on a bounded virtual canvas.
 * Backed by real, persistent fashion.moodboard-* macros
 * (STATE.fashionLens.moodboards, the same per-user Map shape as
 * items/outfits/wishlist/capsules) — not client-side useState. Every list
 * render, create, pin, unpin, rename, and delete reflects a real macro
 * response; a failed macro call surfaces its actual error, never a silent
 * no-op or fabricated success.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Pin, Trash2, ArrowLeft, ImagePlus, X, Pencil, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface MoodboardPin {
  id: string;
  imageUrl: string;
  note: string | null;
  x: number;
  y: number;
  createdAt: string;
}

interface Moodboard {
  id: string;
  name: string;
  items: MoodboardPin[];
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

const CANVAS_MAX = 1000;

export function FashionMoodboardPanel({ onChange }: { onChange?: () => void }) {
  const [boards, setBoards] = useState<Moodboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [pinForm, setPinForm] = useState({ imageUrl: '', note: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('fashion', 'moodboard-list', {});
    if (r.data?.ok === false) {
      setError(r.data?.error || 'Failed to load moodboards.');
      setLoading(false);
      return;
    }
    setBoards((r.data?.result?.moodboards as Moodboard[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const openBoard = boards.find((b) => b.id === openId) || null;

  const createBoard = async () => {
    if (!newName.trim()) { setError('Board name is required.'); return; }
    const r = await lensRun('fashion', 'moodboard-create', { name: newName.trim() });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed to create board.'); return; }
    setNewName(''); setShowCreate(false); setError(null);
    await refresh(); onChange?.();
  };

  const deleteBoard = async (id: string) => {
    setBusy(id);
    const r = await lensRun('fashion', 'moodboard-delete', { id });
    setBusy(null);
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed to delete board.'); return; }
    if (openId === id) setOpenId(null);
    setError(null);
    await refresh(); onChange?.();
  };

  const startRename = (b: Moodboard) => { setRenaming({ id: b.id, name: b.name }); setError(null); };
  const submitRename = async () => {
    if (!renaming) return;
    if (!renaming.name.trim()) { setError('Board name cannot be empty.'); return; }
    setBusy(renaming.id);
    const r = await lensRun('fashion', 'moodboard-update', { id: renaming.id, name: renaming.name.trim() });
    setBusy(null);
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed to rename board.'); return; }
    setRenaming(null); setError(null);
    await refresh(); onChange?.();
  };

  const addPin = async () => {
    if (!openId) return;
    if (!pinForm.imageUrl.trim()) { setError('An image URL is required to pin an item.'); return; }
    const r = await lensRun('fashion', 'moodboard-add-item', {
      boardId: openId,
      imageUrl: pinForm.imageUrl.trim(),
      note: pinForm.note.trim() || undefined,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed to pin item.'); return; }
    setPinForm({ imageUrl: '', note: '' }); setError(null);
    await refresh(); onChange?.();
  };

  const removePin = async (itemId: string) => {
    if (!openId) return;
    setBusy(itemId);
    const r = await lensRun('fashion', 'moodboard-remove-item', { boardId: openId, itemId });
    setBusy(null);
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed to remove pin.'); return; }
    setError(null);
    await refresh(); onChange?.();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  if (openBoard) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => setOpenId(null)}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200">
            <ArrowLeft className="w-3.5 h-3.5" /> All moodboards
          </button>
          {renaming?.id === openBoard.id ? (
            <div className="flex items-center gap-1.5">
              <input autoFocus value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') void submitRename(); if (e.key === 'Escape') setRenaming(null); }}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-100" />
              <button aria-label="Save name" type="button" onClick={submitRename} disabled={busy === openBoard.id}
                className="text-emerald-400 hover:text-emerald-300 disabled:opacity-50">
                {busy === openBoard.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              </button>
              <button aria-label="Cancel rename" type="button" onClick={() => setRenaming(null)} className="text-zinc-400 hover:text-zinc-300">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
              <Pin className="w-3.5 h-3.5 text-fuchsia-400" /> {openBoard.name}
              <button aria-label="Rename board" type="button" onClick={() => startRename(openBoard)} className="text-zinc-500 hover:text-zinc-300">
                <Pencil className="w-3 h-3" />
              </button>
            </h3>
          )}
        </div>

        {error && <div role="alert" className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

        <div className="grid grid-cols-2 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <input placeholder="Image URL (https://... or data:image/...)" value={pinForm.imageUrl}
            onChange={(e) => setPinForm({ ...pinForm, imageUrl: e.target.value })}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Note (optional)" value={pinForm.note}
            onChange={(e) => setPinForm({ ...pinForm, note: e.target.value })}
            className="col-span-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addPin}
            className="col-span-1 flex items-center justify-center gap-1 bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">
            <ImagePlus className="w-3.5 h-3.5" /> Pin it
          </button>
        </div>

        {openBoard.items.length === 0 ? (
          <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
            No pins yet. Add an image URL above to start this board.
          </div>
        ) : (
          <div
            data-testid="moodboard-canvas"
            className="relative w-full h-[420px] bg-zinc-900/50 border border-zinc-800 rounded-xl overflow-auto"
          >
            <div className="relative" style={{ width: CANVAS_MAX, height: CANVAS_MAX }}>
              {openBoard.items.map((pin) => (
                <div
                  key={pin.id}
                  data-testid={`pin-${pin.id}`}
                  className="absolute w-32 bg-zinc-950 border border-zinc-700 rounded-lg shadow-lg p-1.5 group"
                  style={{ left: pin.x, top: pin.y }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={pin.imageUrl} alt={pin.note || 'Pinned inspiration'} className="w-full h-24 object-cover rounded" />
                  {pin.note && <p className="text-[10px] text-zinc-400 mt-1 line-clamp-2">{pin.note}</p>}
                  <button aria-label="Remove pin" type="button" onClick={() => removePin(pin.id)} disabled={busy === pin.id}
                    className="absolute -top-1.5 -right-1.5 bg-zinc-950 border border-zinc-700 rounded-full p-0.5 text-zinc-500 hover:text-rose-400 disabled:opacity-50">
                    {busy === pin.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
          <Pin className="w-3.5 h-3.5 text-fuchsia-400" /> Moodboards
        </h3>
        <button type="button" onClick={() => setShowCreate((v) => !v)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-fuchsia-600 hover:bg-fuchsia-500 text-white rounded-lg shrink-0">
          <Plus className="w-3.5 h-3.5" /> New board
        </button>
      </div>

      {error && <div role="alert" className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {showCreate && (
        <div className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <input placeholder="Board name" value={newName} onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void createBoard(); }}
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={createBoard}
            className="bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-medium rounded-lg px-3 py-1.5">Create</button>
        </div>
      )}

      {boards.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No moodboards yet. Create one and pin inspiration images to it.
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {boards.map((b) => (
            <li key={b.id} data-testid={`board-${b.id}`} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <div className="flex items-start justify-between gap-2">
                <button type="button" onClick={() => setOpenId(b.id)} className="min-w-0 text-left">
                  <p className="text-sm font-semibold text-zinc-100 truncate">{b.name}</p>
                  <p className="text-[10px] text-zinc-400">{b.itemCount} pin{b.itemCount === 1 ? '' : 's'}</p>
                </button>
                <button aria-label={`Delete ${b.name}`} type="button" onClick={() => deleteBoard(b.id)} disabled={busy === b.id}
                  className="text-zinc-600 hover:text-rose-400 shrink-0 disabled:opacity-50">
                  {busy === b.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
