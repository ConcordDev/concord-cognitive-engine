'use client';

/**
 * AvatarComputeToggle — Phase E control surface.
 *
 * Lives in the UX Suite lens (Settings group). Exposes the
 * `concordia:avatarCompute` localStorage toggle that controls whether
 * gait/FABRIK/secondary-physics math runs in a Web Worker or on the
 * main thread.
 *
 * The toggle dispatches a `concordia:avatar-compute-mode` window event so
 * mounted avatars (AvatarSystem3D) pick up the change without a reload.
 */

import { useAvatarAnimator, type AvatarComputeMode } from '@/hooks/useAvatarAnimator';
import { Cpu, Layers, Zap } from 'lucide-react';

const OPTIONS: { id: AvatarComputeMode; label: string; description: string; icon: React.ComponentType<{ className?: string }> }[] = [
  {
    id: 'auto',
    label: 'Auto',
    description: 'Use the avatar Web Worker when available; fall back to main thread on error. Recommended.',
    icon: Cpu,
  },
  {
    id: 'main-thread',
    label: 'Main thread',
    description: 'Run gait + FABRIK + secondary physics on the React render loop. Lower latency but freezes UI under load.',
    icon: Layers,
  },
  {
    id: 'worker-only',
    label: 'Worker only',
    description: 'Force worker mode; do not fall back. For debugging worker output.',
    icon: Zap,
  },
];

export function AvatarComputeToggle() {
  const { mode, setMode, isWorkerActive, getStats } = useAvatarAnimator();
  const stats = getStats();

  return (
    <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4 text-cyan-100">
      <div className="mb-2 flex items-center gap-2">
        <Cpu className="h-4 w-4" />
        <h3 className="text-[12px] font-semibold uppercase tracking-wider">Avatar compute mode (Phase E)</h3>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium ${isWorkerActive ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
          {isWorkerActive ? 'worker active' : (mode === 'main-thread' ? 'main-thread' : 'starting / fallback')}
        </span>
      </div>
      <p className="mb-3 text-[11px] text-cyan-200/80">
        Moves gait synthesis, FABRIK foot IK and verlet secondary physics off the main thread.
        Default <strong>Auto</strong> spawns the worker and falls back to inline on error.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const active = opt.id === mode;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setMode(opt.id)}
              className={`rounded-lg border p-3 text-left transition ${active ? 'border-cyan-400 bg-cyan-500/20 ring-1 ring-cyan-400/40' : 'border-cyan-500/30 bg-cyan-500/5 hover:bg-cyan-500/10'}`}
              aria-pressed={active}
            >
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-cyan-300" />
                <span className="text-[12px] font-semibold text-cyan-100">{opt.label}</span>
              </div>
              <p className="mt-1 text-[10px] text-cyan-200/80">{opt.description}</p>
            </button>
          );
        })}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="last compute" value={stats.lastMs ? `${stats.lastMs.toFixed(2)} ms` : '—'} />
        <Stat label="p50" value={stats.p50 ? `${stats.p50.toFixed(2)} ms` : '—'} />
        <Stat label="p99" value={stats.p99 ? `${stats.p99.toFixed(2)} ms` : '—'} />
        <Stat label="samples" value={String(stats.samples)} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-cyan-500/10 p-2">
      <div className="text-[10px] uppercase tracking-wider text-cyan-300/80">{label}</div>
      <div className="font-mono text-[12px] text-cyan-100">{value}</div>
    </div>
  );
}
