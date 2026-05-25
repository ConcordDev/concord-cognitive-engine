'use client';

/**
 * Foundry — ComponentPalette.
 *
 * The left rail: every composable system from the registry, grouped by
 * category. Each system is a card you can drag onto the canvas (native
 * HTML5 DnD) or add with a click/Enter — keyboard-accessible by design.
 * Systems already on the canvas are dimmed + disabled. Stub systems
 * (the Phase 7 net-new set) carry a "soon" badge but are still
 * selectable, since they persist in the worldspec and activate later.
 */

import { useMemo, useState } from 'react';
import type { SystemEntry, CategoryGroup, SystemCategory } from '@/lib/foundry/api';
import { ChevronDown, ChevronRight, Plus, Search } from 'lucide-react';

interface ComponentPaletteProps {
  categories: Record<SystemCategory, CategoryGroup>;
  selectedIds: Set<string>;
  onAdd: (systemId: string) => void;
}

const CATEGORY_ORDER: SystemCategory[] = ['world', 'character', 'combat', 'npc', 'economy', 'social'];

export function ComponentPalette({ categories, selectedIds, onAdd }: ComponentPaletteProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  const toggle = (cat: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    const out: Array<{ cat: SystemCategory; group: CategoryGroup; systems: SystemEntry[] }> = [];
    for (const cat of CATEGORY_ORDER) {
      const group = categories[cat];
      if (!group) continue;
      const systems = q
        ? group.systems.filter(
            (s) => s.displayName.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
          )
        : group.systems;
      if (systems.length) out.push({ cat, group, systems });
    }
    return out;
  }, [categories, q]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-800 px-3 py-2.5">
        <h2 className="text-sm font-semibold text-slate-200">Components</h2>
        <div className="relative mt-2">
          <Search className="pointer-events-none absolute left-2 top-1.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search systems…"
            className="w-full rounded-md border border-slate-700 bg-slate-900 py-1 pl-7 pr-2 text-xs text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {filtered.length === 0 && (
          <p className="px-1 py-4 text-center text-xs text-slate-400">No systems match “{query}”.</p>
        )}
        {filtered.map(({ cat, group, systems }) => {
          const isCollapsed = collapsed.has(cat);
          return (
            <div key={cat} className="mb-1">
              <button
                type="button"
                onClick={() => toggle(cat)}
                className="flex w-full items-center gap-1 rounded px-1 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500"
              >
                {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {group.label}
                <span className="ml-auto font-mono text-slate-600">{systems.length}</span>
              </button>
              {!isCollapsed && (
                <div className="space-y-1 py-1">
                  {systems.map((sys) => {
                    const added = selectedIds.has(sys.id);
                    return (
                      <div
                        key={sys.id}
                        draggable={!added}
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/x-foundry-system', sys.id);
                          e.dataTransfer.effectAllowed = 'copy';
                        }}
                        className={`group rounded-md border px-2 py-1.5 transition-colors ${
                          added
                            ? 'cursor-default border-slate-800 bg-slate-900/40 opacity-50'
                            : 'cursor-grab border-slate-700 bg-slate-900 hover:border-sky-600/60 hover:bg-slate-800/80'
                        }`}
                      >
                        <div className="flex items-start gap-1.5">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-xs font-medium text-slate-200">
                                {sys.displayName}
                              </span>
                              {sys.status === 'stub' && (
                                <span className="shrink-0 rounded-full border border-amber-600/40 bg-amber-500/10 px-1 py-px text-[9px] font-medium text-amber-300">
                                  soon
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-slate-400">
                              {sys.description}
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={added}
                            onClick={() => !added && onAdd(sys.id)}
                            aria-label={`Add ${sys.displayName}`}
                            className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-sky-600/20 hover:text-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-30"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ComponentPalette;
