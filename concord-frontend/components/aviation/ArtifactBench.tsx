'use client';

import { ReactNode, useRef } from 'react';
import { motion } from 'framer-motion';
import { Plus, Search, X } from 'lucide-react';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import { EmptyState } from '@/components/ui/EmptyState';
import { LensItem } from '@/lib/hooks/use-lens-data';
import { ActionResultPanel } from './ActionResultPanel';

export function ArtifactBench({
  label,
  typeLabel,
  statuses,
  items,
  isLoading,
  isError,
  error,
  refetch,
  searchQuery,
  setSearchQuery,
  statusFilter,
  setStatusFilter,
  onNew,
  actionButtons,
  actionResult,
  onClearResult,
  pending,
  showEditor,
  editingId,
  onCloseEditor,
  onSave,
  onDelete,
  editor,
  editorActions,
  renderCard,
}: {
  label: string;
  typeLabel: string;
  statuses: string[];
  items: LensItem[];
  isLoading: boolean;
  isError: boolean;
  error?: Error | null;
  refetch: () => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  onNew: () => void;
  actionButtons: ReactNode;
  actionResult: Record<string, unknown> | null;
  onClearResult: () => void;
  pending?: boolean;
  showEditor: boolean;
  editingId: string | null;
  onCloseEditor: () => void;
  onSave: () => void;
  onDelete: () => void;
  editor: ReactNode;
  editorActions?: ReactNode;
  renderCard: (item: LensItem) => ReactNode;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const reduceMotion = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (isLoading) {
    return (
      <div role="status" aria-live="polite" className="flex items-center justify-center py-16">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-sky-400 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Preparing {label.toLowerCase()}…</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div role="alert" className="py-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-300/80">{label}</h2>
        <div className="flex items-center gap-2">
          {pending && <span className="text-xs text-sky-400 animate-pulse">Processing…</span>}
          <button type="button" onClick={onNew} className={ds.btnPrimary}>
            <Plus className="w-4 h-4" /> New {typeLabel}
          </button>
        </div>
      </div>

      <div className="flex gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}…`}
            className={cn(ds.input, 'pl-10')}
          />
        </div>
        {statuses.length > 0 && (
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={cn(ds.select, 'w-52')}>
            <option value="">All Statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        )}
      </div>

      <div className="flex flex-wrap gap-2">{actionButtons}</div>

      {items.length === 0 ? (
        <EmptyState
          title={`No ${label.toLowerCase()} yet`}
          description={`Create your first ${typeLabel.toLowerCase()} to persist it on the aviation substrate.`}
          action={{ label: `New ${typeLabel}`, onClick: onNew }}
        />
      ) : (
        <div className={ds.grid3}>
          {items.map((item, index) => (
            <motion.div
              key={item.id}
              initial={reduceMotion ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reduceMotion ? { duration: 0 } : { delay: Math.min(index, 8) * 0.04 }}
            >
              {renderCard(item)}
            </motion.div>
          ))}
        </div>
      )}

      {actionResult && <ActionResultPanel result={actionResult} onClose={onClearResult} />}

      {showEditor && (
        <div className={ds.modalBackdrop} onClick={onCloseEditor} role="presentation">
          <div className={ds.modalContainer}>
            <div
              className={cn(ds.modalPanel, 'max-w-3xl max-h-[90vh] overflow-hidden flex flex-col')}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="av-editor-title"
            >
              <div className="p-6 border-b border-lattice-border flex items-center justify-between shrink-0">
                <h2 id="av-editor-title" className={ds.heading2}>{editingId ? 'Edit' : 'New'} {typeLabel}</h2>
                <button type="button" onClick={onCloseEditor} className={ds.btnGhost} aria-label="Close"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6 overflow-y-auto flex-1">{editor}</div>
              <div className="p-4 border-t border-lattice-border flex justify-between shrink-0">
                <div className="flex gap-2">
                  {editingId && (
                    <button type="button" onClick={onDelete} className={ds.btnDanger}>
                      <X className="w-4 h-4" /> Delete
                    </button>
                  )}
                  {editorActions}
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={onCloseEditor} className={ds.btnSecondary}>Cancel</button>
                  <button type="button" onClick={onSave} className={ds.btnPrimary}>
                    {editingId ? 'Update' : 'Create'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
