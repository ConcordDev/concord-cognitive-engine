'use client';

import { useState } from 'react';
import { Lock, Plus, Trash2 } from 'lucide-react';
import type { FurnitureItem, RoomDetail } from './types';

interface RoomEditorProps {
  room: RoomDetail;
  onLockChange: (tier: number) => void;
  onPlace: (item: FurnitureItem) => void;
  onRemove: (itemId: string) => void;
  busyKey: string | null;
}

export function RoomEditor({ room, onLockChange, onPlace, onRemove, busyKey }: RoomEditorProps) {
  // The coordinate fields hold what was TYPED (strings), parsed only at
  // submit. Binding them to Number state coerced every keystroke —
  // typing '-5' ate the minus and stored 5, and a fast Place could send
  // the coerced 0,0 instead of the values on screen.
  const [newItem, setNewItem] = useState({ itemId: '', x: '0', y: '0', z: '0', rot: '0' });
  const [placeError, setPlaceError] = useState('');

  const handlePlace = () => {
    const x = Number(newItem.x);
    const z = Number(newItem.z);
    const rot = Number(newItem.rot);
    if (newItem.x.trim() === '' || newItem.z.trim() === '' || newItem.rot.trim() === '' ||
      !Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(rot)) {
      setPlaceError('Coordinates need to be numbers — check x, z and rotation.');
      return;
    }
    if (x < 0 || z < 0 || rot < 0) {
      setPlaceError('Coordinates can\'t be negative — use 0 or more.');
      return;
    }
    setPlaceError('');
    onPlace({ itemId: newItem.itemId, x, y: 0, z, rot });
    setNewItem({ itemId: '', x: '0', y: '0', z: '0', rot: '0' });
  };

  return (
    <div className="rounded border border-emerald-500/20 bg-zinc-900/50 p-2">
      <header className="mb-2 flex items-center justify-between text-[12px]">
        <span className="font-medium text-emerald-200">{room.name} <span className="text-[10px] text-slate-500">{room.room_type} · {room.width}×{room.depth}</span></span>
        <div className="flex items-center gap-1">
          <Lock className="h-3 w-3 text-amber-400" />
          {[0, 1, 2, 3, 4, 5].map(t => (
            <button key={t} onClick={() => onLockChange(t)}
              className={`rounded px-1.5 py-0.5 text-[10px] ${room.lock_tier === t ? 'bg-amber-500/30 text-amber-100' : 'text-slate-500 hover:text-slate-300'}`}>
              {t}
            </button>
          ))}
        </div>
      </header>

      <div className="space-y-1 text-[11px]">
        {room.furniture_layout && room.furniture_layout.length > 0 ? room.furniture_layout.map(f => (
          <div key={f.itemId} className="flex items-center justify-between rounded bg-zinc-900 px-2 py-1">
            <span className="text-slate-200">{f.itemId} <span className="text-[10px] text-slate-500">@({f.x.toFixed(1)}, {f.y.toFixed(1)}, {f.z.toFixed(1)}) rot {f.rot.toFixed(0)}°</span></span>
            <button onClick={() => onRemove(f.itemId)} disabled={busyKey === `rm-${f.itemId}`} aria-label="Remove" className="rounded p-1 text-rose-400 hover:bg-rose-500/20 disabled:opacity-40">
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )) : (
          <p className="text-[10px] text-slate-500">Empty.</p>
        )}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); if (newItem.itemId) handlePlace(); }}
        className="mt-2 grid grid-cols-6 gap-1 text-[10px]">
        <input placeholder="itemId" value={newItem.itemId} onChange={(e) => setNewItem({ ...newItem, itemId: e.target.value })}
          className="col-span-2 rounded border border-slate-700 bg-slate-900/60 px-1 py-0.5 text-slate-100" />
        <input type="number" step="0.5" min={0} placeholder="x" value={newItem.x} onChange={(e) => setNewItem({ ...newItem, x: e.target.value })}
          className="rounded border border-slate-700 bg-slate-900/60 px-1 py-0.5 text-slate-100" />
        <input type="number" step="0.5" min={0} placeholder="z" value={newItem.z} onChange={(e) => setNewItem({ ...newItem, z: e.target.value })}
          className="rounded border border-slate-700 bg-slate-900/60 px-1 py-0.5 text-slate-100" />
        <input type="number" min={0} placeholder="rot" value={newItem.rot} onChange={(e) => setNewItem({ ...newItem, rot: e.target.value })}
          className="rounded border border-slate-700 bg-slate-900/60 px-1 py-0.5 text-slate-100" />
        <button type="submit" className="rounded bg-emerald-500/20 px-1 py-0.5 text-emerald-100 hover:bg-emerald-500/30">
          <Plus className="inline h-3 w-3" /> place
        </button>
      </form>
      {placeError && (
        <p role="alert" className="mt-1 text-[10px] text-rose-300">{placeError}</p>
      )}
    </div>
  );
}
