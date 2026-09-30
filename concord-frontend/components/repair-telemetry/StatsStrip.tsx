'use client';

import { cn } from '@/lib/utils';
import type { MemStats } from './types';

type StatTone = 'slate' | 'emerald' | 'amber' | 'cyan' | 'red';

function Stat({ label, value, tone }: { label: string; value: string | number; tone: StatTone }) {
  const toneClass: Record<StatTone, string> = {
    slate: 'border-zinc-800 bg-zinc-950/40 text-slate-100',
    emerald: 'border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-200',
    amber: 'border-amber-500/20 bg-amber-500/[0.06] text-amber-200',
    cyan: 'border-cyan-500/20 bg-cyan-500/[0.06] text-cyan-200',
    red: 'border-red-500/20 bg-red-500/[0.06] text-red-200',
  };
  return (
    <div className={cn('rounded-lg border px-2.5 py-1.5', toneClass[tone])}>
      <div className="text-[10px] uppercase tracking-wider opacity-70">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function StatsStrip({
  counts, mem,
}: {
  counts: { all: number; healed: number; escalated: number; noted: number };
  mem: MemStats;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
      <Stat label="findings" value={counts.all} tone="slate" />
      <Stat label="healed" value={counts.healed} tone="emerald" />
      <Stat label="escalated" value={counts.escalated} tone="amber" />
      <Stat label="noted" value={counts.noted} tone="slate" />
      <Stat label="patterns learned" value={mem.totalPatterns} tone="cyan" />
      <Stat label="repairs applied" value={mem.totalRepairs} tone="cyan" />
      <Stat label="avg success" value={`${Math.round((mem.avgSuccessRate || 0) * 100)}%`} tone="cyan" />
      <Stat label="deprecated fixes" value={mem.deprecatedFixes} tone="red" />
    </div>
  );
}
