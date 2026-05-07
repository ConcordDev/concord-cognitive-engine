'use client';

/**
 * DTUQuickCreate — Minimal modal form for creating a new DTU.
 *
 * Wired to POST /api/dtus via apiHelpers.dtus.create.
 * Can be opened from the DTU Browser, lenses, or dashboard.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { X, Zap, Plus } from 'lucide-react';
import type { DTUTier } from '@/lib/api/generated-types';

interface DTUQuickCreateProps {
  onClose: () => void;
  onSuccess?: () => void;
  /** Pre-fill source (e.g. 'chat-lens', 'research-lens') */
  source?: string;
  /** Pre-fill tags */
  defaultTags?: string[];
}

export function DTUQuickCreate({ onClose, onSuccess, source, defaultTags }: DTUQuickCreateProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tagsInput, setTagsInput] = useState(defaultTags?.join(', ') || '');
  const [tier, setTier] = useState<DTUTier>('regular');
  const [isGlobal, setIsGlobal] = useState(false);

  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);

  const createMutation = useMutation({
    mutationFn: async () => {
      const tags = tagsInput
        .split(',')
        .map(t => t.trim())
        .filter(Boolean);

      return apiHelpers.dtus.create({
        title: title || undefined,
        content,
        tags: tags.length > 0 ? tags : undefined,
        source: source || 'manual',
        isGlobal,
        meta: { tier },
      });
    },
    onSuccess: () => {
      addToast({ type: 'success', message: 'DTU created successfully' });
      queryClient.invalidateQueries({ queryKey: ['dtus-browser'] });
      queryClient.invalidateQueries({ queryKey: ['dtus-recent'] });
      queryClient.invalidateQueries({ queryKey: ['lensDTUs'] });
      onSuccess?.();
    },
    onError: () => {
      addToast({ type: 'error', message: 'Failed to create DTU' });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    createMutation.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <form
        onSubmit={handleSubmit}
        className="relative w-full max-w-lg bg-lattice-surface border border-lattice-border rounded-xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-lattice-border">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-neon-blue" />
            <h2 className="font-semibold">Create New DTU</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-lattice-elevated transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form body */}
        <div className="p-6 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">
              Title <span className="text-gray-600">(optional)</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="A descriptive title for this thought..."
              className="w-full px-3 py-2 bg-lattice-deep border border-lattice-border rounded-lg text-white placeholder-gray-500 text-sm focus:outline-none focus:border-neon-cyan/50"
            />
          </div>

          {/* Content */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">
              Content <span className="text-red-400">*</span>
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="The thought content..."
              rows={5}
              className="w-full px-3 py-2 bg-lattice-deep border border-lattice-border rounded-lg text-white placeholder-gray-500 text-sm focus:outline-none focus:border-neon-cyan/50 resize-y"
              required
            />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">
              Tags <span className="text-gray-600">(comma-separated)</span>
            </label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="research, science, hypothesis"
              className="w-full px-3 py-2 bg-lattice-deep border border-lattice-border rounded-lg text-white placeholder-gray-500 text-sm focus:outline-none focus:border-neon-cyan/50"
            />
          </div>

          {/* Tier + Global toggle */}
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-400 mb-1">Tier</label>
              <select
                value={tier}
                onChange={(e) => setTier(e.target.value as DTUTier)}
                className="w-full rounded-lg border border-lattice-border bg-lattice-deep px-3 py-2 text-sm"
              >
                <option value="regular">Regular</option>
                <option value="shadow">Shadow</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-400 mb-1">Scope</label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isGlobal}
                  onChange={(e) => setIsGlobal(e.target.checked)}
                  className="rounded border-lattice-border bg-lattice-deep"
                />
                <span className="text-sm text-gray-300">Make global</span>
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-lattice-border flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!content.trim() || createMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-neon-blue/20 text-neon-blue border border-neon-blue/30 rounded-lg hover:bg-neon-blue/30 transition-colors disabled:opacity-50"
          >
            {createMutation.isPending ? (
              <div className="w-4 h-4 border-2 border-neon-blue border-t-transparent rounded-full animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            Create DTU
          </button>
        </div>
      </form>
    </div>
  );
}
