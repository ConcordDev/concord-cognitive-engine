'use client';

import { Search, SlidersHorizontal } from 'lucide-react';

export interface FilterState {
  query: string;
  category: string;
  difficulty: string;
  status: string;
  tag: string;
  sortBy: string;
}

const CATEGORIES = ['security', 'feature', 'bug', 'design', 'docs', 'research', 'infra', 'other'];
const DIFFICULTIES = ['beginner', 'intermediate', 'advanced', 'expert'];
const STATUSES = ['open', 'claimed', 'in_review', 'paid', 'disputed'];

export function BountyFilters({
  value, onChange, total,
}: {
  value: FilterState;
  onChange: (v: FilterState) => void;
  total: number;
}) {
  const set = (patch: Partial<FilterState>) => onChange({ ...value, ...patch });

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <Search className="w-4 h-4 text-zinc-500 shrink-0" />
        <input
          value={value.query}
          onChange={(e) => set({ query: e.target.value })}
          placeholder="Search bounties by title, description, tag…"
          className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-2.5 py-1.5 text-sm text-zinc-100 focus:ring-2 focus:ring-amber-500 focus:outline-none"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SlidersHorizontal className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
        <select
          value={value.category}
          onChange={(e) => set({ category: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:ring-2 focus:ring-amber-500 focus:outline-none"
        >
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={value.difficulty}
          onChange={(e) => set({ difficulty: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:ring-2 focus:ring-amber-500 focus:outline-none"
        >
          <option value="">All difficulties</option>
          {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select
          value={value.status}
          onChange={(e) => set({ status: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:ring-2 focus:ring-amber-500 focus:outline-none"
        >
          <option value="">Any status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          value={value.tag}
          onChange={(e) => set({ tag: e.target.value })}
          placeholder="tag"
          className="w-20 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:ring-2 focus:ring-amber-500 focus:outline-none"
        />
        <select
          value={value.sortBy}
          onChange={(e) => set({ sortBy: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:ring-2 focus:ring-amber-500 focus:outline-none"
        >
          <option value="recent">Newest</option>
          <option value="reward">Highest reward</option>
          <option value="submissions">Most submissions</option>
        </select>
        <span className="ml-auto text-[11px] text-zinc-500">{total} result{total === 1 ? '' : 's'}</span>
      </div>
    </div>
  );
}
