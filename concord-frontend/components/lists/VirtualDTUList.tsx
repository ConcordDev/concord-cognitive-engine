'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain,
  Star,
  MoreHorizontal,
  Clock,
  GitBranch,
  Trash2,
  Edit,
  Copy,
  ExternalLink,
  SortAsc,
  SortDesc,
  Search
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils';
import { TierBadge } from '@/components/dtu/TierBadge';

interface DTU {
  id: string;
  title: string;
  excerpt?: string;
  tier: 'regular' | 'mega' | 'hyper' | 'shadow';
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  resonance?: number;
  connectionCount?: number;
  isFavorite?: boolean;
}

interface VirtualDTUListProps {
  dtus: DTU[];
  selectedId?: string;
  onSelect?: (dtu: DTU) => void;
  onEdit?: (dtu: DTU) => void;
  onDelete?: (dtu: DTU) => void;
  onFavorite?: (dtu: DTU) => void;
  onDuplicate?: (dtu: DTU) => void;
  className?: string;
  showFilters?: boolean;
  emptyMessage?: string;
}

const tierConfig = {
  regular: { color: 'bg-gray-500', label: 'Regular', textColor: 'text-gray-400' },
  mega: { color: 'bg-neon-cyan', label: 'MEGA', textColor: 'text-neon-cyan' },
  hyper: { color: 'bg-neon-purple', label: 'HYPER', textColor: 'text-neon-purple' },
  shadow: { color: 'bg-gray-700', label: 'Shadow', textColor: 'text-gray-500' }
};

type SortField = 'createdAt' | 'updatedAt' | 'title' | 'resonance';
type SortOrder = 'asc' | 'desc';

export function VirtualDTUList({
  dtus,
  selectedId,
  onSelect,
  onEdit,
  onDelete,
  onFavorite,
  onDuplicate,
  className,
  showFilters = true,
  emptyMessage = 'No DTUs found'
}: VirtualDTUListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('updatedAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [filterTier, setFilterTier] = useState<DTU['tier'] | 'all'>('all');
  const [contextMenu, setContextMenu] = useState<{ dtu: DTU; x: number; y: number } | null>(null);

  // Filter and sort DTUs
  const filteredDTUs = useMemo(() => {
    let result = [...dtus];

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(dtu =>
        dtu.title.toLowerCase().includes(query) ||
        dtu.excerpt?.toLowerCase().includes(query) ||
        dtu.tags.some(tag => tag.toLowerCase().includes(query))
      );
    }

    // Tier filter
    if (filterTier !== 'all') {
      result = result.filter(dtu => dtu.tier === filterTier);
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'createdAt':
          comparison = a.createdAt.getTime() - b.createdAt.getTime();
          break;
        case 'updatedAt':
          comparison = a.updatedAt.getTime() - b.updatedAt.getTime();
          break;
        case 'title':
          comparison = a.title.localeCompare(b.title);
          break;
        case 'resonance':
          comparison = (a.resonance || 0) - (b.resonance || 0);
          break;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [dtus, searchQuery, sortField, sortOrder, filterTier]);

  const handleContextMenu = useCallback((e: React.MouseEvent, dtu: DTU) => {
    e.preventDefault();
    setContextMenu({ dtu, x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  // Row renderer
  const rowRenderer = useCallback((index: number) => {
    const dtu = filteredDTUs[index];
    const isSelected = selectedId === dtu.id;
    const config = tierConfig[dtu.tier];

    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className={cn(
          'group px-4 py-3 border-b border-lattice-border hover:bg-lattice-surface/50 cursor-pointer transition-colors',
          isSelected && 'bg-neon-cyan/10 border-l-2 border-l-neon-cyan'
        )}
        onClick={() => onSelect?.(dtu)}
        onContextMenu={(e) => handleContextMenu(e, dtu)}
      >
        <div className="flex items-start gap-3">
          {/* Tier indicator */}
          <div className={cn('w-2 h-2 rounded-full mt-2 flex-shrink-0', config.color)} />

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={cn(
                'font-medium truncate',
                isSelected ? 'text-white' : 'text-gray-200'
              )}>
                {dtu.title}
              </span>
              <TierBadge tier={dtu.tier} size="sm" />
              {dtu.isFavorite && (
                <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
              )}
            </div>

            {dtu.excerpt && (
              <p className="text-sm text-gray-500 truncate mt-0.5">
                {dtu.excerpt}
              </p>
            )}

            <div className="flex items-center gap-3 mt-1.5">
              {/* Tags */}
              {dtu.tags.length > 0 && (
                <div className="flex items-center gap-1">
                  {dtu.tags.slice(0, 2).map(tag => (
                    <span key={tag} className="text-xs text-gray-500">
                      #{tag}
                    </span>
                  ))}
                  {dtu.tags.length > 2 && (
                    <span className="text-xs text-gray-600">
                      +{dtu.tags.length - 2}
                    </span>
                  )}
                </div>
              )}

              {/* Metadata */}
              <div className="flex items-center gap-2 text-xs text-gray-600">
                {dtu.connectionCount !== undefined && dtu.connectionCount > 0 && (
                  <span className="flex items-center gap-0.5">
                    <GitBranch className="w-3 h-3" />
                    {dtu.connectionCount}
                  </span>
                )}
                <span className="flex items-center gap-0.5">
                  <Clock className="w-3 h-3" />
                  {formatRelativeTime(dtu.updatedAt)}
                </span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onFavorite?.(dtu);
              }}
              className="p-1.5 text-gray-400 hover:text-yellow-400 transition-colors"
            aria-label="Favorite">
              <Star className={cn('w-4 h-4', dtu.isFavorite && 'fill-yellow-400 text-yellow-400')} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleContextMenu(e, dtu);
              }}
              className="p-1.5 text-gray-400 hover:text-white transition-colors"
            aria-label="More options">
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </div>
        </div>
      </motion.div>
    );
  }, [filteredDTUs, selectedId, onSelect, onFavorite, handleContextMenu]);

  return (
    <div className={cn('flex flex-col h-full bg-lattice-bg', className)}>
      {/* Filters */}
      {showFilters && (
        <div className="px-4 py-3 border-b border-lattice-border space-y-3">
          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg">
            <Search className="w-4 h-4 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search DTUs..."
              className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-gray-500 hover:text-white"
              >
                ×
              </button>
            )}
          </div>

          {/* Tier filter & Sort */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              {(['all', 'regular', 'mega', 'hyper'] as const).map(tier => (
                <button
                  key={tier}
                  onClick={() => setFilterTier(tier)}
                  className={cn(
                    'px-2 py-1 text-xs rounded transition-colors capitalize',
                    filterTier === tier
                      ? 'bg-neon-cyan/20 text-neon-cyan'
                      : 'text-gray-400 hover:text-white'
                  )}
                >
                  {tier}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => toggleSort('updatedAt')}
                className={cn(
                  'px-2 py-1 text-xs rounded transition-colors',
                  sortField === 'updatedAt' ? 'text-neon-cyan' : 'text-gray-400 hover:text-white'
                )}
              >
                Updated {sortField === 'updatedAt' && (sortOrder === 'asc' ? <SortAsc className="w-3 h-3 inline" /> : <SortDesc className="w-3 h-3 inline" />)}
              </button>
              <button
                onClick={() => toggleSort('createdAt')}
                className={cn(
                  'px-2 py-1 text-xs rounded transition-colors',
                  sortField === 'createdAt' ? 'text-neon-cyan' : 'text-gray-400 hover:text-white'
                )}
              >
                Created {sortField === 'createdAt' && (sortOrder === 'asc' ? <SortAsc className="w-3 h-3 inline" /> : <SortDesc className="w-3 h-3 inline" />)}
              </button>
              <button
                onClick={() => toggleSort('title')}
                className={cn(
                  'px-2 py-1 text-xs rounded transition-colors',
                  sortField === 'title' ? 'text-neon-cyan' : 'text-gray-400 hover:text-white'
                )}
              >
                Title {sortField === 'title' && (sortOrder === 'asc' ? <SortAsc className="w-3 h-3 inline" /> : <SortDesc className="w-3 h-3 inline" />)}
              </button>
              <button
                onClick={() => toggleSort('resonance')}
                className={cn(
                  'px-2 py-1 text-xs rounded transition-colors',
                  sortField === 'resonance' ? 'text-neon-cyan' : 'text-gray-400 hover:text-white'
                )}
              >
                Resonance {sortField === 'resonance' && (sortOrder === 'asc' ? <SortAsc className="w-3 h-3 inline" /> : <SortDesc className="w-3 h-3 inline" />)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      {filteredDTUs.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Brain className="w-10 h-10 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">{emptyMessage}</p>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="mt-2 text-sm text-neon-cyan hover:underline"
              >
                Clear search
              </button>
            )}
          </div>
        </div>
      ) : (
        <Virtuoso
          totalCount={filteredDTUs.length}
          itemContent={rowRenderer}
          className="flex-1"
          overscan={10}
        />
      )}

      {/* Context menu */}
      <AnimatePresence>
        {contextMenu && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={closeContextMenu}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              style={{ top: contextMenu.y, left: contextMenu.x }}
              className="fixed z-50 bg-lattice-bg border border-lattice-border rounded-lg shadow-xl overflow-hidden"
            >
              <ContextMenuItem
                icon={Edit}
                label="Edit"
                onClick={() => {
                  onEdit?.(contextMenu.dtu);
                  closeContextMenu();
                }}
              />
              <ContextMenuItem
                icon={Copy}
                label="Duplicate"
                onClick={() => {
                  onDuplicate?.(contextMenu.dtu);
                  closeContextMenu();
                }}
              />
              <ContextMenuItem
                icon={Star}
                label={contextMenu.dtu.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                onClick={() => {
                  onFavorite?.(contextMenu.dtu);
                  closeContextMenu();
                }}
              />
              <ContextMenuItem
                icon={ExternalLink}
                label="Open in new tab"
                onClick={() => {
                  window.open(`/lenses/thread?id=${contextMenu.dtu.id}`, '_blank');
                  closeContextMenu();
                }}
              />
              <div className="border-t border-lattice-border" />
              <ContextMenuItem
                icon={Trash2}
                label="Delete"
                danger
                onClick={() => {
                  onDelete?.(contextMenu.dtu);
                  closeContextMenu();
                }}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-lattice-border bg-lattice-surface/50 text-xs text-gray-500">
        {filteredDTUs.length} of {dtus.length} DTUs
      </div>
    </div>
  );
}

const ContextMenuItem = React.memo(function ContextMenuItem({
  icon: Icon,
  label,
  onClick,
  danger = false
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors',
        danger
          ? 'text-red-400 hover:bg-red-500/10'
          : 'text-gray-300 hover:bg-lattice-surface'
      )}
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
});

