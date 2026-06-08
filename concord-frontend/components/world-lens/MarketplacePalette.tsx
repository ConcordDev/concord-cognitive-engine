'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Search, Quote, ShieldCheck } from 'lucide-react';
import type { MarketplaceEntry, ComponentCategory } from '@/lib/world-lens/types';

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

const SORT_OPTIONS = [
  { value: 'citations', label: 'Most Cited' },
  { value: 'newest', label: 'Newest' },
  { value: 'name', label: 'Name' },
] as const;

interface MarketplacePaletteProps {
  onDragComponent?: (entry: MarketplaceEntry) => void;
  onSelectComponent?: (entry: MarketplaceEntry) => void;
  filterCategory?: ComponentCategory;
}

export default function MarketplacePalette({
  onDragComponent,
  onSelectComponent,
  filterCategory,
}: MarketplacePaletteProps) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<string>('citations');
  const [categoryFilter, setCategoryFilter] = useState<string>(filterCategory || 'all');
  const [liveEntries, setLiveEntries] = useState<MarketplaceEntry[]>([]);

  // Fetch real marketplace listings. Stays empty (honest empty-state) on
  // error or no data — never renders fabricated entries.
  useEffect(() => {
    fetch('/api/creative-marketplace?limit=50')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.listings?.length) return;
        const mapped: MarketplaceEntry[] = data.listings.map((l: Record<string, unknown>) => ({
          dtuId:            String(l.id ?? l.dtu_id ?? ''),
          name:             String(l.title ?? l.name ?? 'Untitled'),
          category:         (l.artifact_type ?? 'component') as ComponentCategory,
          creator:          `@${l.creator_handle ?? l.creator ?? 'unknown'}`,
          creatorHandle:    String(l.creator_handle ?? ''),
          validationStatus: 'validated' as const,
          citationCount:    Number(l.download_count ?? l.citations ?? 0),
          performanceSpecs: {},
          materialRefs:     [],
          thumbnail:        String(l.thumbnail_url ?? ''),
          royaltyRate:      0.02,
          publishedAt:      l.created_at ? new Date(Number(l.created_at) * 1000).toISOString().slice(0, 10) : '',
          tags:             Array.isArray(l.tags) ? l.tags : [],
        }));
        setLiveEntries(mapped);
      })
      .catch(() => {});
  }, []);

  const baseEntries = liveEntries;

  const filtered = useMemo(() => {
    let items = [...baseEntries];

    if (categoryFilter !== 'all') {
      items = items.filter(i => i.category === categoryFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(i =>
        i.name.toLowerCase().includes(q) ||
        i.tags.some(t => t.includes(q)) ||
        i.creator.includes(q)
      );
    }

    if (sort === 'citations') items.sort((a, b) => b.citationCount - a.citationCount);
    else if (sort === 'newest') items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    else items.sort((a, b) => a.name.localeCompare(b.name));

    return items;
  }, [baseEntries, search, sort, categoryFilter]);

  const categories = useMemo(() => {
    const cats = new Set(baseEntries.map(i => i.category));
    return ['all', ...Array.from(cats)];
  }, [baseEntries]);

  return (
    <div className={`${panel} p-3 space-y-3`}>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
        Component Marketplace
      </h3>

      {/* Search */}
      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search components..."
          className="w-full bg-black/50 border border-white/10 rounded pl-7 pr-2 py-1.5 text-[10px] text-white"
        />
      </div>

      {/* Filters */}
      <div className="flex gap-1">
        <select
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          className="flex-1 bg-black/50 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white"
        >
          {categories.map(c => (
            <option key={c} value={c}>{c === 'all' ? 'All' : c}</option>
          ))}
        </select>
        <select
          value={sort}
          onChange={e => setSort(e.target.value)}
          className="flex-1 bg-black/50 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white"
        >
          {SORT_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Component list */}
      <div className="space-y-1.5 max-h-96 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="text-[10px] text-gray-400 text-center py-4">No components found</p>
        )}
        {filtered.map(entry => (
          <button
            key={entry.dtuId}
            onClick={() => onSelectComponent?.(entry)}
            draggable
            onDragStart={() => onDragComponent?.(entry)}
            className="w-full text-left p-2 rounded border border-white/5 hover:border-white/15 hover:bg-white/5 transition-all group"
          >
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[11px] text-white font-medium group-hover:text-cyan-300 transition-colors">
                {entry.name}
              </span>
              <ShieldCheck className="w-3 h-3 text-green-400 flex-shrink-0" />
            </div>
            <div className="flex items-center gap-2 text-[9px] text-gray-400">
              <span className="text-cyan-500">{entry.creator}</span>
              <span className="flex items-center gap-0.5">
                <Quote className="w-2.5 h-2.5" /> {entry.citationCount}
              </span>
            </div>
            {Object.keys(entry.performanceSpecs).length > 0 && (
              <div className="flex gap-2 mt-0.5 text-[9px] text-gray-400">
                {Object.entries(entry.performanceSpecs).slice(0, 2).map(([k, v]) => (
                  <span key={k}>{k}: {v}</span>
                ))}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
