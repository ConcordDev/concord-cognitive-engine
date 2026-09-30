'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState } from 'react';
import { lensRun } from '@/lib/api/client';

const KINDS = ['physics_simulator', 'research_zone', 'concord_substrate'];

export function SpawnPanel({ onSpawned }: { onSpawned?: () => void }) {
  const [status, setStatus] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    kind: 'physics_simulator',
    privacy: 'public',
    description: '',
    forgeAppDtuId: '',
    capacity: 16,
  });

  const flash = (m: string) => {
    setStatus(m);
    window.setTimeout(() => setStatus(null), 4000);
  };

  const spawn = async () => {
    if (form.name.trim().length < 3) {
      flash('Name must be at least 3 characters.');
      return;
    }
    const r = await lensRun('sub_worlds', 'spawn', form);
    if (r.data?.ok) {
      flash(`Spawned sub-world "${form.name}".`);
      setForm({ ...form, name: '', description: '', forgeAppDtuId: '' });
      onSpawned?.();
    } else {
      flash(`Failed: ${r.data?.error || 'unknown'}`);
    }
  };

  return (
    <section className="rounded-xl border border-cyan-800/50 bg-zinc-900/80 p-4 space-y-3">
      <h2 className="text-sm font-bold text-cyan-300">Spawn Sub-World</h2>
      {status && (
        <div className="rounded-lg border border-cyan-700/50 bg-cyan-950/50 px-3 py-2 text-sm text-cyan-200">
          {status}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input
          type="text"
          placeholder="World name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
        />
        <input
          type="text"
          placeholder="Forge app DTU id (optional)"
          value={form.forgeAppDtuId}
          onChange={(e) => setForm({ ...form, forgeAppDtuId: e.target.value })}
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
        />
      </div>
      <textarea
        placeholder="Description"
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
        rows={2}
        className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
      />
      <div className="grid grid-cols-3 gap-3">
        <select
          value={form.kind}
          onChange={(e) => setForm({ ...form, kind: e.target.value })}
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm text-zinc-100"
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <select
          value={form.privacy}
          onChange={(e) => setForm({ ...form, privacy: e.target.value })}
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm text-zinc-100"
        >
          <option value="public">public</option>
          <option value="unlisted">unlisted</option>
          <option value="private">private</option>
        </select>
        <input
          type="number"
          min={1}
          max={200}
          value={form.capacity}
          onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })}
          aria-label="Capacity"
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm text-zinc-100"
        />
      </div>
      <button
        type="button"
        onClick={spawn}
        disabled={form.name.trim().length < 3}
        className="w-full rounded-lg bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
      >
        Spawn Sub-World
      </button>
    </section>
  );
}
