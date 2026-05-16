'use client';

/**
 * SaveAsDtuButton — the canonical "save this real-data result as a DTU"
 * affordance for every lens page that fetches from a real public API.
 *
 * Provenance lands in three places on the created DTU:
 *   • top-level `source: "<api-id>"` (e.g. "openfda", "noaa-tides")
 *   • `tags`: ["real-data", <api-id>, ...extra]
 *   • `meta`: { apiUrl, fetchedAt, apiProvider, rawSnapshot? }
 *
 * Two surfaces:
 *   1. Inline (compact={true}) — small icon-only button for embedding on
 *      result cards (the common case — one button per result row)
 *   2. Modal — full-form confirm (title, tags, scope) for the "save the
 *      whole table" use case at the top of a panel
 *
 * The created DTU is purposefully unowned-public-data ORIGINAL (no lineage),
 * because the real-data source is itself unowned (FDA, NOAA, etc.). If the
 * user later derives from this DTU, that's where the citation cascade kicks
 * in (handled automatically by the dtu.create macro when lineage is set).
 */

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { Bookmark, BookmarkCheck, X, Loader2, Globe2, Lock, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface SaveAsDtuButtonProps {
  /**
   * Stable API identifier in kebab-case. Lands as the DTU's top-level
   * `source` field and is part of every fetched-data DTU's tag set.
   * Examples: "openfda", "noaa-tides", "yahoo-finance", "courtlistener".
   */
  apiSource: string;
  /**
   * The actual URL hit (with params). Stored in meta for full provenance —
   * a future reader can re-fetch the same query against the same API.
   */
  apiUrl?: string;
  /**
   * Pre-filled DTU title. Caller knows the data shape best — pass a
   * scannable title like "Aspirin — FDA Drug Label" or
   * "Apple Inc. (AAPL) — quote 2026-05-16".
   */
  title: string;
  /**
   * The human-readable body of the DTU. Caller pre-renders the result
   * into a readable form (markdown is fine; the DTU substrate stores
   * the raw text and the consolidator picks it apart later).
   */
  content: string;
  /**
   * Extra tags beyond the auto-added ["real-data", apiSource].
   * Domain tags work best: ["pharmacy", "drug-label", "fda"].
   */
  extraTags?: string[];
  /**
   * The raw fetched object — embedded under meta.rawSnapshot for full
   * reproducibility. Truncated to 8KB if larger to stay sane.
   */
  rawData?: unknown;
  /**
   * compact={true} → icon-only button suitable for inline use on
   * result cards. compact={false} (default) → labeled "Save as DTU"
   * pill button suitable for top-of-panel.
   */
  compact?: boolean;
  /**
   * If true (default), opens a quick-confirm modal where the user can
   * tweak title/tags/scope before save. If false, saves immediately
   * with the props as-is (useful for inline one-tap saves on result
   * cards where the user has already chosen what they want).
   */
  confirm?: boolean;
  /**
   * className passthrough.
   */
  className?: string;
  /**
   * Optional callback fired when the DTU is created. Useful for
   * highlighting the saved row, refreshing a "my DTUs" sidebar, etc.
   */
  onSaved?: (dtuId: string) => void;
}

const RAW_SNAPSHOT_BUDGET = 8000;

function truncateForSnapshot(data: unknown): string | undefined {
  if (data === undefined || data === null) return undefined;
  try {
    const s = JSON.stringify(data);
    return s.length > RAW_SNAPSHOT_BUDGET ? s.slice(0, RAW_SNAPSHOT_BUDGET) + '…[truncated]' : s;
  } catch {
    return undefined;
  }
}

export function SaveAsDtuButton({
  apiSource,
  apiUrl,
  title,
  content,
  extraTags = [],
  rawData,
  compact = false,
  confirm = true,
  className = '',
  onSaved,
}: SaveAsDtuButtonProps) {
  const [open, setOpen] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState(title);
  const [editTags, setEditTags] = useState([apiSource, ...extraTags].join(', '));
  const [isGlobal, setIsGlobal] = useState(false);
  const queryClient = useQueryClient();
  const addToast = useUIStore((s) => s.addToast);

  useEffect(() => { setEditTitle(title); }, [title]);
  useEffect(() => { setEditTags([apiSource, ...extraTags].join(', ')); }, [apiSource, extraTags]);

  const createMutation = useMutation({
    mutationFn: async (opts: { title: string; tags: string[]; isGlobal: boolean }) => {
      const allTags = ['real-data', apiSource, ...opts.tags.filter((t) => t !== 'real-data' && t !== apiSource)];
      const meta: Record<string, unknown> = {
        apiProvider: apiSource,
        fetchedAt: new Date().toISOString(),
      };
      if (apiUrl) meta.apiUrl = apiUrl;
      const snapshot = truncateForSnapshot(rawData);
      if (snapshot) meta.rawSnapshot = snapshot;

      return apiHelpers.dtus.create({
        title: opts.title || title,
        content,
        tags: allTags,
        source: apiSource,
        isGlobal: opts.isGlobal,
        meta,
      });
    },
    onSuccess: (resp) => {
      const data = (resp as { data?: { id?: string; dtu?: { id?: string } } })?.data;
      const id = data?.id || data?.dtu?.id || 'saved';
      setSavedId(id);
      addToast({ type: 'success', message: `Saved as DTU (source: ${apiSource})` });
      queryClient.invalidateQueries({ queryKey: ['dtus-recent'] });
      queryClient.invalidateQueries({ queryKey: ['dtus-mine'] });
      queryClient.invalidateQueries({ queryKey: ['lensDTUs'] });
      onSaved?.(id);
      setOpen(false);
    },
    onError: () => {
      addToast({ type: 'error', message: 'Failed to save DTU' });
    },
  });

  const handleQuickSave = () => {
    if (savedId) return;
    if (confirm) {
      setOpen(true);
      return;
    }
    createMutation.mutate({
      title,
      tags: [apiSource, ...extraTags],
      isGlobal: false,
    });
  };

  const handleConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    const tags = editTags.split(',').map((t) => t.trim()).filter(Boolean);
    createMutation.mutate({ title: editTitle, tags, isGlobal });
  };

  return (
    <>
      <button
        type="button"
        onClick={handleQuickSave}
        disabled={createMutation.isPending || !!savedId}
        title={savedId ? 'Saved as DTU' : `Save as DTU (source: ${apiSource})`}
        className={
          compact
            ? `inline-flex items-center justify-center rounded-md p-1.5 transition-colors disabled:opacity-50 ${
                savedId
                  ? 'text-cyan-400 bg-cyan-500/10'
                  : 'text-zinc-400 hover:text-cyan-300 hover:bg-cyan-500/10'
              } ${className}`
            : `inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                savedId
                  ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
                  : 'border-cyan-500/20 bg-cyan-500/5 text-cyan-300/90 hover:bg-cyan-500/15 hover:border-cyan-500/40'
              } ${className}`
        }
        aria-label={savedId ? 'Saved as DTU' : 'Save as DTU'}
      >
        {createMutation.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : savedId ? (
          <BookmarkCheck className="h-3.5 w-3.5" />
        ) : (
          <Bookmark className="h-3.5 w-3.5" />
        )}
        {!compact && <span>{savedId ? 'Saved' : 'Save as DTU'}</span>}
      </button>

      {open && <SaveModal
        apiSource={apiSource}
        apiUrl={apiUrl}
        editTitle={editTitle}
        setEditTitle={setEditTitle}
        editTags={editTags}
        setEditTags={setEditTags}
        isGlobal={isGlobal}
        setIsGlobal={setIsGlobal}
        content={content}
        onCancel={() => setOpen(false)}
        onSubmit={handleConfirm}
        pending={createMutation.isPending}
      />}
    </>
  );
}

interface ModalProps {
  apiSource: string;
  apiUrl?: string;
  editTitle: string;
  setEditTitle: (v: string) => void;
  editTags: string;
  setEditTags: (v: string) => void;
  isGlobal: boolean;
  setIsGlobal: (v: boolean) => void;
  content: string;
  onCancel: () => void;
  onSubmit: (e: React.FormEvent) => void;
  pending: boolean;
}

function SaveModal(props: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  // SSR-safe portal target — only render on client.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        ref={overlayRef}
        className="fixed inset-0 z-[100] flex items-center justify-center p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
      >
        <div
          className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          onClick={props.onCancel}
        />
        <motion.form
          onSubmit={props.onSubmit}
          initial={{ scale: 0.96, y: 8 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.96, y: 8 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="relative w-full max-w-md overflow-hidden rounded-xl border border-cyan-500/20 bg-zinc-950 shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-cyan-500/15 px-4 py-3">
            <div className="flex items-center gap-2">
              <Bookmark className="h-4 w-4 text-cyan-400" />
              <span className="text-sm font-semibold text-white">Save as DTU</span>
              <span className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-mono uppercase text-cyan-300">
                {props.apiSource}
              </span>
            </div>
            <button
              type="button"
              onClick={props.onCancel}
              className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-3 p-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
                Title
              </label>
              <input
                type="text"
                value={props.editTitle}
                onChange={(e) => props.setEditTitle(e.target.value)}
                className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:border-cyan-500/40 focus:outline-none"
                placeholder="Descriptive title"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500">
                Tags <span className="font-normal normal-case text-zinc-600">(comma-separated)</span>
              </label>
              <input
                type="text"
                value={props.editTags}
                onChange={(e) => props.setEditTags(e.target.value)}
                className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-white placeholder-zinc-600 focus:border-cyan-500/40 focus:outline-none"
              />
              <p className="mt-1 text-[11px] text-zinc-600">
                Auto-tagged: <code className="text-cyan-400">real-data</code>, <code className="text-cyan-400">{props.apiSource}</code>
              </p>
            </div>

            <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-2.5">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
                Preview
              </div>
              <div className="line-clamp-4 whitespace-pre-wrap text-xs text-zinc-300">
                {props.content || <span className="italic text-zinc-600">(empty)</span>}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => props.setIsGlobal(!props.isGlobal)}
                className={`flex flex-1 items-center gap-2 rounded-md border px-3 py-2 text-xs transition-colors ${
                  props.isGlobal
                    ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700'
                }`}
              >
                {props.isGlobal ? <Globe2 className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                {props.isGlobal ? 'Global (shareable)' : 'Private (just you)'}
              </button>
            </div>

            {props.apiUrl && (
              <a
                href={props.apiUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 truncate text-[11px] text-zinc-500 hover:text-cyan-400"
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                <span className="truncate">{props.apiUrl}</span>
              </a>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-cyan-500/15 px-4 py-3">
            <button
              type="button"
              onClick={props.onCancel}
              className="rounded-md px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={props.pending || !props.editTitle.trim()}
              className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/15 px-3 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/25 disabled:opacity-50"
            >
              {props.pending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Bookmark className="h-3.5 w-3.5" />
              )}
              Save DTU
            </button>
          </div>
        </motion.form>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
