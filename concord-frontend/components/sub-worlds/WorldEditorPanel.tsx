'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useState } from 'react';
import { X, Plus, Trash2, Mountain, MapPin, Box, Code, Square, Lightbulb } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import type { SubWorld } from './WorldCard';

interface Block {
  id: string;
  type: string;
  label: string;
  x: number;
  y: number;
  z: number;
  props: Record<string, unknown>;
  created_by: string;
  created_at: number;
}

interface EditorLogEntry {
  action: string;
  blockId: string;
  type?: string;
  by: string;
  at: number;
}

const BLOCK_TYPES = ['terrain', 'spawn_point', 'prop', 'script', 'zone', 'light'];
const BLOCK_ICON: Record<string, any> = {
  terrain: Mountain,
  spawn_point: MapPin,
  prop: Box,
  script: Code,
  zone: Square,
  light: Lightbulb,
};

export function WorldEditorPanel({
  world,
  onClose,
}: {
  world: SubWorld;
  onClose: () => void;
}) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [log, setLog] = useState<EditorLogEntry[]>([]);
  const [form, setForm] = useState({ type: 'prop', label: '', x: 0, y: 0, z: 0 });
  const [msg, setMsg] = useState<string | null>(null);

  const flash = (m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg(null), 3000);
  };

  const load = useCallback(async () => {
    const r = await lensRun('sub_worlds', 'editor_state', { worldId: world.world_id });
    if (r.data?.ok) {
      const res = r.data.result as any;
      setBlocks(res.blocks || []);
      setLog(res.editor_log || []);
    }
  }, [world.world_id]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addBlock = async () => {
    const r = await lensRun('sub_worlds', 'editor_add_block', {
      worldId: world.world_id,
      type: form.type,
      label: form.label,
      x: form.x,
      y: form.y,
      z: form.z,
    });
    if (r.data?.ok) {
      const res = r.data.result as any;
      setBlocks(res.blocks || []);
      setForm({ type: form.type, label: '', x: 0, y: 0, z: 0 });
      flash('Block added.');
      void load();
    } else {
      flash(`Failed: ${r.data?.error || 'unknown'}`);
    }
  };

  const removeBlock = async (blockId: string) => {
    const r = await lensRun('sub_worlds', 'editor_remove_block', {
      worldId: world.world_id,
      blockId,
    });
    if (r.data?.ok) {
      setBlocks((r.data.result as any).blocks || []);
      flash('Block removed.');
      void load();
    } else {
      flash(`Failed: ${r.data?.error || 'unknown'}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-fuchsia-800/60 bg-zinc-950 p-5 space-y-4">
        <header className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-fuchsia-300">In-Place World Editor</h2>
            <p className="text-[11px] text-zinc-500">{world.name} — author blocks without leaving the lens</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-zinc-500 hover:text-zinc-200">
            <X className="h-5 w-5" />
          </button>
        </header>

        {msg && (
          <div className="rounded-lg bg-fuchsia-950/60 border border-fuchsia-700/50 px-3 py-2 text-xs text-fuchsia-200">
            {msg}
          </div>
        )}

        <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 space-y-2">
          <h3 className="text-[11px] uppercase tracking-wider text-zinc-500">Add Block</h3>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm text-zinc-100"
            >
              {BLOCK_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="Label (optional)"
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(['x', 'y', 'z'] as const).map((axis) => (
              <input
                key={axis}
                type="number"
                value={form[axis]}
                onChange={(e) => setForm({ ...form, [axis]: Number(e.target.value) })}
                placeholder={axis.toUpperCase()}
                aria-label={`${axis} coordinate`}
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm text-zinc-100"
              />
            ))}
          </div>
          <button
            type="button"
            onClick={addBlock}
            className="flex w-full items-center justify-center gap-1 rounded-lg bg-fuchsia-800 hover:bg-fuchsia-700 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            <Plus className="h-4 w-4" /> Add Block
          </button>
        </section>

        <section className="space-y-2">
          <h3 className="text-[11px] uppercase tracking-wider text-zinc-500">
            Blocks ({blocks.length}/500)
          </h3>
          {blocks.length === 0 ? (
            <p className="text-xs text-zinc-600 italic">No blocks yet — author your world above.</p>
          ) : (
            <ul className="space-y-1">
              {blocks.map((b) => {
                const Icon = BLOCK_ICON[b.type] || Box;
                return (
                  <li
                    key={b.id}
                    className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-fuchsia-400" />
                      <div>
                        <p className="text-sm text-zinc-100">{b.label}</p>
                        <p className="text-[10px] text-zinc-500 font-mono">
                          {b.type} · ({b.x}, {b.y}, {b.z})
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeBlock(b.id)}
                      aria-label="Remove block"
                      className="text-rose-400 hover:text-rose-300"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {log.length > 0 && (
          <section className="space-y-1">
            <h3 className="text-[11px] uppercase tracking-wider text-zinc-500">Recent Edits</h3>
            <ul className="space-y-0.5 max-h-32 overflow-y-auto">
              {log.slice().reverse().map((e, i) => (
                <li key={`${e.blockId}-${e.at}-${i}`} className="text-[10px] text-zinc-500 font-mono">
                  {e.action} {e.type || ''} · {e.by.slice(0, 8)} · {new Date(e.at).toLocaleTimeString()}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
