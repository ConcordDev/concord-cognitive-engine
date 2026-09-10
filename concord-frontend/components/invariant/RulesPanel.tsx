'use client';

/**
 * RulesPanel — authored invariant cards by category with search/status filter.
 * Extracted from invariant/page.tsx. useLensData('invariant','invariant').
 */

import { useMemo, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { Shield, Lock, Eye, Check, X, AlertTriangle, Loader2 } from 'lucide-react';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useLensCommand } from '@/hooks/useLensCommand';
import { ErrorState } from '@/components/common/EmptyState';
import type { Invariant, InvariantStatusFilter } from './invariant-types';

export function RulesPanel() {
  const [statusFilter, setStatusFilter] = useState<InvariantStatusFilter>('all');
  const [search, setSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { items: invariantItems, isLoading, isError, error, refetch } = useLensData<Invariant>('invariant', 'invariant', {
    seed: [],
  });

  const invariants: Invariant[] = invariantItems.map((item) => {
    const d = item.data as unknown as Invariant;
    return {
      id: item.id,
      name: d.name ?? item.title,
      description: d.description ?? '',
      status: d.status ?? 'enforced',
      category: d.category ?? 'ethos',
      frozen: d.frozen ?? true,
    };
  });

  const visibleInvariants = useMemo(() => {
    const q = search.trim().toLowerCase();
    return invariants.filter((inv) => {
      if (statusFilter !== 'all' && inv.status !== statusFilter) return false;
      if (q) {
        const hay = `${inv.name} ${inv.description}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [invariants, search, statusFilter]);

  useLensCommand(
    [
      { id: 'focus-search', keys: '/', description: 'Search invariants', category: 'navigation', action: () => searchInputRef.current?.focus() },
      { id: 'filter-all', keys: '0', description: 'All statuses', category: 'view', action: () => setStatusFilter('all') },
      { id: 'filter-enforced', keys: '1', description: 'Enforced', category: 'view', action: () => setStatusFilter('enforced') },
      { id: 'filter-warning', keys: '2', description: 'Warning', category: 'view', action: () => setStatusFilter('warning') },
      { id: 'filter-violated', keys: '3', description: 'Violated', category: 'view', action: () => setStatusFilter('violated') },
    ],
    { lensId: 'invariant' },
  );

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-neon-green" />
        <span className="ml-3 text-gray-400">Loading invariants...</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="panel p-3 flex items-center gap-2 flex-wrap">
        <input
          ref={searchInputRef}
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { setSearch(''); searchInputRef.current?.blur(); } }}
          placeholder="Search invariants…  / focuses"
          className="input-lattice flex-1 min-w-[200px] text-sm"
        />
        <div className="flex items-center gap-1 text-xs">
          {(['all', 'enforced', 'warning', 'violated'] as const).map((s, i) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`px-2 py-1 rounded border transition-colors ${
                statusFilter === s
                  ? s === 'enforced' ? 'border-neon-green/40 bg-neon-green/15 text-neon-green'
                  : s === 'warning'  ? 'border-yellow-500/40 bg-yellow-500/15 text-yellow-400'
                  : s === 'violated' ? 'border-neon-pink/40 bg-neon-pink/15 text-neon-pink'
                  : 'border-neon-blue/40 bg-neon-blue/15 text-neon-blue'
                  : 'border-white/10 bg-white/5 text-gray-400 hover:text-white'
              }`}
            >
              {s}<kbd className="text-[8px] opacity-60 ml-0.5">{i}</kbd>
            </button>
          ))}
          {(search || statusFilter !== 'all') && (
            <span className="text-[10px] text-gray-400 ml-2">
              {visibleInvariants.length} of {invariants.length}
            </span>
          )}
        </div>
      </div>

      {(['ethos', 'structural', 'capability'] as const).map((category) => {
        const categoryInvariants = visibleInvariants.filter((inv) => inv.category === category);
        if (categoryInvariants.length === 0 && (search || statusFilter !== 'all')) return null;
        return (
          <div key={category} className="panel p-4">
            <h2 className="font-semibold mb-4 flex items-center gap-2 capitalize">
              {category === 'ethos' && <Shield className="w-4 h-4 text-neon-green" />}
              {category === 'structural' && <Lock className="w-4 h-4 text-neon-blue" />}
              {category === 'capability' && <Eye className="w-4 h-4 text-neon-purple" />}
              {category} Invariants
              <span className="text-xs text-gray-400 font-normal">({categoryInvariants.length})</span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {categoryInvariants.map((inv, index) => (
                <motion.div
                  key={inv.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="lens-card flex items-start gap-3"
                >
                  <span
                    className={`mt-1 ${
                      inv.status === 'enforced'
                        ? 'text-neon-green'
                        : inv.status === 'warning'
                        ? 'text-yellow-500'
                        : 'text-neon-pink'
                    }`}
                  >
                    {inv.status === 'enforced' ? (
                      <Check className="w-5 h-5" />
                    ) : inv.status === 'warning' ? (
                      <AlertTriangle className="w-5 h-5" />
                    ) : (
                      <X className="w-5 h-5" />
                    )}
                  </span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-mono text-sm font-bold">{inv.name}</p>
                      {inv.frozen && <Lock className="w-3 h-3 text-gray-400" />}
                    </div>
                    <p className="text-sm text-gray-400 mt-1">{inv.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        );
      })}

      {invariants.length > 0 && visibleInvariants.length === 0 && (
        <div className="panel p-6 text-center text-sm text-gray-400">
          No invariants match the current filters.
        </div>
      )}
    </div>
  );
}
