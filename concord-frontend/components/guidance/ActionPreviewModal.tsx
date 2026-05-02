'use client';

/**
 * ActionPreviewModal — Shows a dry-run preview before destructive operations.
 *
 * Displays what will be created, modified, or deleted, plus any warnings.
 * User must confirm to proceed.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { AlertTriangle, Plus, Pencil, Trash2, X, Shield, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PreviewItem {
  type: string;
  id?: string;
  title?: string;
  field?: string;
  from?: string;
  to?: string;
  [key: string]: unknown;
}

interface PreviewData {
  action: string;
  entityType: string;
  entityId: string;
  willCreate: PreviewItem[];
  willModify: PreviewItem[];
  willDelete: PreviewItem[];
  warnings: string[];
}

interface ActionPreviewModalProps {
  action: string;
  entityType: string;
  entityId: string;
  params?: Record<string, unknown>;
  onConfirm: () => void;
  onCancel: () => void;
}

function ActionPreviewModal({
  action,
  entityType,
  entityId,
  params,
  onConfirm,
  onCancel,
}: ActionPreviewModalProps) {
  const [confirming, setConfirming] = useState(false);

  const { data, isLoading, isError } = useQuery<{ preview: PreviewData }>({
    queryKey: ['action-preview', action, entityType, entityId],
    queryFn: async () =>
      (await api.post('/api/preview-action', { action, entityType, entityId, params })).data,
  });

  const preview = data?.preview;
  const hasWarnings = (preview?.warnings?.length || 0) > 0;
  const hasChanges =
    (preview?.willCreate?.length || 0) +
      (preview?.willModify?.length || 0) +
      (preview?.willDelete?.length || 0) >
    0;

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      onConfirm();
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-lattice-surface border border-lattice-border rounded-lg shadow-2xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-lattice-border">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-neon-blue" />
            <span className="text-sm font-medium text-white">Action Preview</span>
          </div>
          <button onClick={onCancel} className="text-gray-500 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {isLoading ? (
            <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
              <Loader2 className="w-4 h-4 animate-spin" />
              Previewing action...
            </div>
          ) : isError ? (
            <div className="text-red-400 text-sm">Failed to load preview</div>
          ) : preview ? (
            <div className="space-y-3">
              {/* Action summary */}
              <div className="text-xs text-gray-500">
                <span className="font-mono bg-gray-800 px-1 py-0.5 rounded">{action}</span>
                {' on '}
                <span className="text-gray-400">
                  {entityType}:{entityId.slice(0, 12)}
                </span>
              </div>

              {/* Will create */}
              {preview.willCreate.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-neon-green flex items-center gap-1 mb-1">
                    <Plus className="w-3 h-3" />
                    Will Create ({preview.willCreate.length})
                  </div>
                  {preview.willCreate.map((item, i) => (
                    <div key={i} className="text-xs text-gray-400 pl-4">
                      {item.type}
                      {item.id ? `: ${item.id}` : ''}
                      {item.title ? ` — ${item.title}` : ''}
                    </div>
                  ))}
                </div>
              )}

              {/* Will modify */}
              {preview.willModify.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-neon-blue flex items-center gap-1 mb-1">
                    <Pencil className="w-3 h-3" />
                    Will Modify ({preview.willModify.length})
                  </div>
                  {preview.willModify.map((item, i) => (
                    <div key={i} className="text-xs text-gray-400 pl-4">
                      {item.type}:{item.id?.slice(0, 10)} — {item.field}: {String(item.from)} →{' '}
                      {String(item.to)}
                    </div>
                  ))}
                </div>
              )}

              {/* Will delete */}
              {preview.willDelete.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-red-400 flex items-center gap-1 mb-1">
                    <Trash2 className="w-3 h-3" />
                    Will Delete ({preview.willDelete.length})
                  </div>
                  {preview.willDelete.map((item, i) => (
                    <div key={i} className="text-xs text-gray-400 pl-4">
                      {item.type}: {item.title || item.id}
                    </div>
                  ))}
                </div>
              )}

              {/* Warnings */}
              {hasWarnings && (
                <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded">
                  {preview.warnings.map((w, i) => (
                    <div key={i} className="text-xs text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                      {w}
                    </div>
                  ))}
                </div>
              )}

              {!hasChanges && !hasWarnings && (
                <p className="text-xs text-gray-500">No changes detected for this action.</p>
              )}
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-lattice-border">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs text-gray-400 hover:text-white rounded border border-lattice-border hover:bg-lattice-border/50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={confirming || isLoading}
            className={cn(
              'px-3 py-1.5 text-xs rounded font-medium transition-colors',
              hasWarnings
                ? 'bg-amber-600 hover:bg-amber-500 text-white'
                : 'bg-neon-blue hover:bg-neon-blue/80 text-white'
            )}
          >
            {confirming ? 'Processing...' : hasWarnings ? 'Confirm Anyway' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedActionPreviewModal = withErrorBoundary(ActionPreviewModal);
export { _WrappedActionPreviewModal as ActionPreviewModal };
