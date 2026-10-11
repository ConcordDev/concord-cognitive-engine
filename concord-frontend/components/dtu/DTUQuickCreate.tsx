'use client';

/**
 * DTUQuickCreate — Minimal modal form for creating a new DTU.
 *
 * Wired to POST /api/dtus via apiHelpers.dtus.create.
 * Can be opened from the DTU Browser, lenses, or dashboard.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { X, Zap, Plus } from 'lucide-react';
import type { DTUTier } from '@/lib/api/generated-types';
// Phase P — wire the 5-tier VisibilityScopePicker.
import { VisibilityScopePicker, type VisibilityScope } from '@/components/scope/VisibilityScopePicker';
import {
  ContentClassLicenseFields,
  buildContentLicensePayload,
  type ContentClass,
} from '@/components/dtu/ContentClassLicenseFields';

interface DTUQuickCreateProps {
  onClose: () => void;
  onSuccess?: () => void;
  /** Pre-fill source (e.g. 'chat-lens', 'research-lens') */
  source?: string;
  /** Pre-fill tags */
  defaultTags?: string[];
}

function DTUQuickCreate({ onClose, onSuccess, source, defaultTags }: DTUQuickCreateProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tagsInput, setTagsInput] = useState(defaultTags?.join(', ') || '');
  const [tier, setTier] = useState<DTUTier>('regular');
  const [isGlobal, setIsGlobal] = useState(false);
  const [visibilityScope, setVisibilityScope] = useState<VisibilityScope>('private');
  const [contentClass, setContentClass] = useState<ContentClass>('generic');
  const [licenseScopes, setLicenseScopes] = useState<string[]>(['private']);

  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const createMutation = useMutation({
    mutationFn: async () => {
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const licensePayload = buildContentLicensePayload(contentClass, licenseScopes, {
        tier,
        visibilityScope,
      });
      return apiHelpers.dtus.create({
        title: title || undefined,
        content,
        tags: tags.length > 0 ? tags : undefined,
        source: source || 'manual',
        isGlobal: isGlobal || visibilityScope === 'global',
        contentClass: licensePayload.contentClass,
        licenseScopes: licensePayload.licenseScopes,
        scopes: licensePayload.scopes,
        license: licensePayload.license,
        meta: licensePayload.meta,
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

  // Portaled to document.body. The DTUs lens mounts this inside a framer-motion
  // div (a transform), and AppShell's <main> is the page scrollport. A transformed
  // ancestor makes position:fixed stick to that box instead of the viewport, so
  // the dialog was centered in a region taller than the screen and Create sat
  // below the fold where page scroll could not reach it. Cap the dialog to the
  // viewport, scroll the fields, and keep Cancel/Create outside that scroller.
  // z-[80] is above CookieConsent (ACTION_REQUIRED = 60) so the notice cannot
  // cover the footer.
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }} />

      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="dtu-quick-create-title"
        onSubmit={handleSubmit}
        className="relative flex min-h-0 w-full max-w-lg max-h-[calc(100dvh-2rem)] flex-col overflow-hidden bg-lattice-surface border border-lattice-border rounded-xl shadow-2xl"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between px-6 py-4 border-b border-lattice-border">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-neon-blue" />
            <h2 id="dtu-quick-create-title" className="font-semibold">Create New DTU</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-lattice-elevated transition-colors"
          aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form body — the only scrolling region. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6 space-y-4">
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

          {/* Phase P — 5-tier federation visibility (private / local /
              regional / national / global). Caller's checkbox above
              remains as a quick "global" shortcut. */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">
              Who can see this?
            </label>
            <VisibilityScopePicker value={visibilityScope} onChange={setVisibilityScope} />
          </div>

          <ContentClassLicenseFields
            contentClass={contentClass}
            onContentClassChange={setContentClass}
            licenseScopes={licenseScopes}
            onLicenseScopesChange={setLicenseScopes}
            variant="lattice"
            idPrefix="quick-create"
          />
        </div>

        {/* Footer stays put while the fields scroll. */}
        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-lattice-border px-6 py-4">
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
    </div>,
    document.body,
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedDTUQuickCreate = withErrorBoundary(DTUQuickCreate);
export { _WrappedDTUQuickCreate as DTUQuickCreate };
