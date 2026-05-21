'use client';

import { useState } from 'react';
import { Plus, Loader2 } from 'lucide-react';

export interface EnqueueInput {
  queue: string;
  name: string;
  priority: 'high' | 'normal' | 'low';
  delayMs: number;
  maxAttempts: number;
  payload: Record<string, unknown>;
}

export function EnqueueForm({
  queues,
  busy,
  onEnqueue,
}: {
  queues: string[];
  busy: boolean;
  onEnqueue: (input: EnqueueInput) => void;
}) {
  const [name, setName] = useState('');
  const [queue, setQueue] = useState(queues[0] || 'ingest');
  const [priority, setPriority] = useState<'high' | 'normal' | 'low'>('normal');
  const [delaySec, setDelaySec] = useState(0);
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [shouldFail, setShouldFail] = useState(false);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onEnqueue({
      queue,
      name: trimmed,
      priority,
      delayMs: Math.max(0, delaySec) * 1000,
      maxAttempts: Math.max(1, maxAttempts),
      payload: shouldFail ? { shouldFail: true, failReason: 'simulated failure' } : {},
    });
    setName('');
    setShouldFail(false);
  };

  return (
    <div className="space-y-3 rounded-lg border border-white/10 bg-black/30 p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
        <Plus className="h-4 w-4 text-cyan-400" /> Enqueue a job
      </h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Job name"
          className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-white placeholder:text-zinc-600"
        />
        <select
          value={queue}
          onChange={(e) => setQueue(e.target.value)}
          className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-white"
        >
          {queues.map((q) => (
            <option key={q} value={q}>
              {q}
            </option>
          ))}
        </select>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as 'high' | 'normal' | 'low')}
          className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-white"
        >
          <option value="high">High priority</option>
          <option value="normal">Normal priority</option>
          <option value="low">Low priority</option>
        </select>
        <div className="flex items-center gap-2">
          <label className="text-xs text-zinc-400">Delay (s)</label>
          <input
            type="number"
            min={0}
            value={delaySec}
            onChange={(e) => setDelaySec(Number(e.target.value))}
            className="w-20 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-white"
          />
          <label className="text-xs text-zinc-400">Max tries</label>
          <input
            type="number"
            min={1}
            max={10}
            value={maxAttempts}
            onChange={(e) => setMaxAttempts(Number(e.target.value))}
            className="w-16 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-white"
          />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={shouldFail}
            onChange={(e) => setShouldFail(e.target.checked)}
            className="accent-rose-500"
          />
          Simulate failure on process
        </label>
        <button
          onClick={submit}
          disabled={busy || !name.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-cyan-500/20 px-3 py-1.5 text-sm text-cyan-300 hover:bg-cyan-500/30 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Enqueue
        </button>
      </div>
    </div>
  );
}
