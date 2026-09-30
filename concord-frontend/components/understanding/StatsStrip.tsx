'use client';

import { FileText, Network, BookOpen, Clock, Lightbulb, TrendingUp, Layers } from 'lucide-react';
import type { EvolutionStats, NotesOverview } from './understanding-shared';

export function StatsStrip({
  stats, subjectKindsCount, notesOverview,
}: { stats: EvolutionStats | null; subjectKindsCount: number; notesOverview: NotesOverview | null }) {
  const linkTotal = notesOverview
    ? (notesOverview.manualLinkCount ?? 0) + (notesOverview.wikiLinkCount ?? 0)
    : null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
      <StatCard label="Notes" value={String(notesOverview?.noteCount ?? '—')} icon={<FileText className="w-3.5 h-3.5 text-violet-300" />} />
      <StatCard label="Links" value={linkTotal != null ? String(linkTotal) : '—'} icon={<Network className="w-3.5 h-3.5 text-cyan-300" />} />
      <StatCard label="Tags" value={String(notesOverview?.tagCount ?? '—')} icon={<BookOpen className="w-3.5 h-3.5 text-rose-300" />} />
      <StatCard label="In review" value={String(notesOverview?.reviewEnabledCount ?? '—')} icon={<Clock className="w-3.5 h-3.5 text-amber-300" />} />
      <StatCard label="Due now" value={String(notesOverview?.dueForReviewCount ?? '—')} icon={<Clock className="w-3.5 h-3.5 text-rose-300" />} />
      <StatCard label="Composed" value={String(stats?.totalUnderstandings ?? '—')} icon={<Lightbulb className="w-3.5 h-3.5 text-amber-300" />} />
      <StatCard label="Promoted" value={String(stats?.promotedCount ?? '—')} icon={<TrendingUp className="w-3.5 h-3.5 text-emerald-300" />} />
      <StatCard label="Subject kinds" value={String(subjectKindsCount)} icon={<Layers className="w-3.5 h-3.5 text-blue-300" />} />
    </div>
  );
}

function StatCard({
  label, value, icon,
}: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-white/50">
        {icon}{label}
      </div>
      <div className="text-base font-bold leading-tight mt-0.5">{value}</div>
    </div>
  );
}
