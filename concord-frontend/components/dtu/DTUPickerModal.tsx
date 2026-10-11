'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api/client';
import { dtuOwnerId } from '@/lib/dtu/origin';
import { emitEvent } from '@/lib/realtime/event-bus';
import { TierBadge } from './TierBadge';
import { Search, X, Loader2, Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DTU } from '@/lib/api/generated-types';

type FilterMode = 'user' | 'purchased' | 'all';
type PickerScope = 'context' | 'mine';

const EMPTY_DTUS: DTU[] = [];

interface DTUPickerModalProps {
  onClose: () => void;
  onSelect: (dtu: DTU) => void;
  lens?: string;
  title?: string;
  filter?: FilterMode;
  /**
   * `mine` lists GET /api/dtus/paginated?scope=mine (the viewer's own DTUs).
   * `context` (default) keeps the shared lens library for cite/mail/mesh.
   */
  scope?: PickerScope;
}

export function DTUPickerModal({
  onClose,
  onSelect,
  lens,
  title = 'Insert DTU',
  filter = 'all',
  scope = 'context',
}: DTUPickerModalProps) {
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterMode>(filter);
  const { user } = useAuth();
  const userId = user?.id;
  const mineQuery = useQuery({
    queryKey: ['dtu-picker', 'mine', lens || 'studio'],
    enabled: scope === 'mine',
    queryFn: async () => {
      const res = await api.get<{ dtus?: DTU[]; items?: DTU[] }>('/api/dtus/paginated', {
        params: { scope: 'mine', limit: 100, offset: 0 },
      });
      return res.data?.dtus || res.data?.items || [];
    },
  });
  const { contextDTUs, isLoading: contextLoading } = useLensDTUs({
    lens: lens || 'studio',
    enabled: scope !== 'mine',
  });
  const mineRows = mineQuery.data;
  const source = useMemo(
    () => (scope === 'mine' ? (mineRows ?? EMPTY_DTUS) : (contextDTUs ?? EMPTY_DTUS)),
    [scope, mineRows, contextDTUs],
  );
  const isLoading = scope === 'mine' ? mineQuery.isLoading : contextLoading;

  const filtered = useMemo(() => {
    const owned = scope === 'mine' && userId
      ? source.filter((d) => dtuOwnerId(d) === userId)
      : source;
    const base = owned.filter((d) => {
      if (activeFilter === 'user') {
        return d.ownerId === userId || d.meta?.createdBy === userId;
      }
      if (activeFilter === 'purchased') {
        return !!(d.meta as Record<string, unknown> | undefined)?.purchasedFrom;
      }
      return true;
    });
    if (!search.trim()) return base;
    const q = search.toLowerCase();
    return base.filter(
      (d) =>
        d.title?.toLowerCase().includes(q) ||
        d.domain?.toLowerCase().includes(q) ||
        d.tags?.some((t) => t.toLowerCase().includes(q))
    );
  }, [source, scope, activeFilter, userId, search]);

  function handleSelect(dtu: DTU) {
    emitEvent('dtu:selected', { dtu, lens });
    onSelect(dtu);
    onClose();
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-lattice-surface border border-white/10 rounded-xl w-full max-w-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <h3 className="font-semibold flex items-center gap-2">
            <Package className="w-4 h-4 text-neon-cyan" />
            {title}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filters + Search */}
        <div className="px-4 py-3 space-y-2 border-b border-white/10">
          <div className="flex gap-1">
            {(['all', 'user', 'purchased'] as FilterMode[]).map((f) => (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                className={cn(
                  'px-2.5 py-1 rounded-full text-xs transition-colors',
                  activeFilter === f
                    ? 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30'
                    : 'text-gray-400 hover:text-white border border-white/10'
                )}
              >
                {f === 'user' ? 'My Creations' : f === 'purchased' ? 'Purchased' : 'All'}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search DTUs..."
              className="w-full pl-8 pr-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-neon-cyan/40"
            />
          </div>
        </div>

        {/* List */}
        <div className="max-h-72 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-neon-cyan animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-400">
              {scope === 'mine' ? 'No notes of yours yet.' : 'No DTUs found.'}
            </div>
          ) : (
            filtered.map((dtu) => (
              <button
                key={dtu.id}
                onClick={() => handleSelect(dtu)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left border-b border-white/5 last:border-0"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{dtu.title}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5 truncate">
                    {dtu.domain}
                    {dtu.timestamp ? ` · ${new Date(dtu.timestamp).toLocaleDateString()}` : ''}
                  </p>
                </div>
                <TierBadge tier={dtu.tier} size="sm" />
              </button>
            ))
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
