'use client';

/**
 * DTUEmbed — inline rich preview of a DTU. The cross-lens canonical way
 * to reference a DTU within another lens (chat, council, paper, atlas,
 * any creative editor).
 *
 * Modes:
 *   - "card"    (default): collapsed summary card, click to expand
 *   - "compact": single-line chip with title + creator
 *   - "full":   always-expanded preview with media + nested children
 *
 * Composes CreatorBadge + TierBadge + FederationBadge primitives so
 * provenance / royalty / federation context follows the DTU everywhere
 * it appears.
 */

import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Image as ImageIcon, FileText, Music, Video } from 'lucide-react';

import { cn } from '@/lib/utils';
import { CreatorBadge, type CreatorBadgeProps } from './CreatorBadge';
import { TierBadge, type DTUTier } from './TierBadge';
import { FederationBadge, type FederationStatus } from '@/components/federation/FederationBadge';
// Phase 7 — cross-lens narrative: small chip showing "used in N lenses".
import { DownstreamBadge } from './DownstreamBadge';
import { ReactionBar } from '@/components/social/ReactionBar';
import { CommentThread } from '@/components/social/CommentThread';
import { ShareButton } from '@/components/social/ShareButton';
import { BookmarkButton } from '@/components/social/BookmarkButton';
import { useDtuSurface } from '@/hooks/useDtuSurface';
// Phase P — surface the previously-orphan provenance/freshness badges.
import { FreshnessBadge } from '@/components/common/FreshnessBadge';

export interface DTUEmbedRecord {
  id: string;
  title?: string;
  summary?: string;
  domain?: string;
  tier?: DTUTier | string;
  tags?: string[];
  createdAt?: string;
  /** Optional rich-media artifact metadata. */
  artifact?: {
    kind: 'image' | 'audio' | 'video' | 'document' | 'other';
    url?: string;
    mimeType?: string;
    durationMs?: number;
    pageCount?: number;
  };
  /** Children DTUs (e.g. MEGA → originals) for inline drill-down. */
  children?: DTUEmbedRecord[];
  creator?: CreatorBadgeProps['creator'];
  provenance?: CreatorBadgeProps['provenance'];
  royaltyRate?: number;
  royaltyEarnedCc?: number;
  /** Last-touched timestamp drives the optional FreshnessBadge. */
  updatedAt?: string;
  freshnessScore?: number | null;
  freshnessLabel?: string | null;
  federation?: {
    status: FederationStatus;
    instanceName?: string;
    lastSync?: string;
  };
}

export interface DTUEmbedProps {
  dtu: DTUEmbedRecord;
  mode?: 'card' | 'compact' | 'full';
  /** Click on the DTU body — typically open the full DTU detail modal. */
  onOpen?: (id: string) => void;
  /** Lens this embed appears in. When set, an dtu_surface.record fires on mount. */
  recordSurfaceFromLens?: string;
  className?: string;
}

const KIND_ICON = {
  image: ImageIcon,
  audio: Music,
  video: Video,
  document: FileText,
  other: FileText,
} as const;

function formatRelative(iso?: string): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const days = Math.floor(h / 24);
    if (days < 30) return `${days}d ago`;
    return d.toLocaleDateString();
  } catch {
    return null;
  }
}

function MediaPreview({ artifact }: { artifact: DTUEmbedRecord['artifact'] }) {
  if (!artifact) return null;
  const Icon = KIND_ICON[artifact.kind] ?? FileText;

  if (artifact.kind === 'image' && artifact.url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={artifact.url}
        alt=""
        className="rounded-md max-h-48 w-auto object-cover border border-lattice-border/60"
        loading="lazy"
      />
    );
  }
  if (artifact.kind === 'audio' && artifact.url) {
    return <audio controls src={artifact.url} className="w-full" preload="none" />;
  }
  if (artifact.kind === 'video' && artifact.url) {
    return <video controls src={artifact.url} className="w-full max-h-64 rounded-md" preload="metadata" />;
  }
  return (
    <div className="inline-flex items-center gap-2 rounded-md border border-lattice-border/60 bg-lattice-surface/40 px-2 py-1 text-xs text-gray-400">
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
      {artifact.mimeType ?? artifact.kind}
      {artifact.pageCount ? ` · ${artifact.pageCount} pages` : ''}
      {artifact.durationMs ? ` · ${Math.round(artifact.durationMs / 1000)}s` : ''}
    </div>
  );
}

export function DTUEmbed({ dtu, mode = 'card', onOpen, recordSurfaceFromLens, className }: DTUEmbedProps) {
  const [expanded, setExpanded] = useState(mode === 'full');
  const [childrenOpen, setChildrenOpen] = useState(false);
  const { record } = useDtuSurface();

  // Phase 7 — fire-and-forget surface log on mount when the caller declares
  // the embedding lens. The substrate populates as users use the app, so
  // DownstreamBadge starts showing real counts without manual instrumentation.
  useEffect(() => {
    if (!recordSurfaceFromLens || !dtu.id) return;
    void record({
      dtuId: dtu.id,
      lensId: recordSurfaceFromLens,
      surfaceKind: mode === 'compact' ? 'citation_chip' : 'quote_block',
    });
    // We deliberately do NOT re-fire on every prop change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dtu.id, recordSurfaceFromLens]);

  const title = dtu.title ?? dtu.id.slice(0, 16);
  const relTime = formatRelative(dtu.createdAt);
  const hasChildren = !!dtu.children?.length;

  if (mode === 'compact') {
    return (
      <button
        type="button"
        onClick={() => onOpen?.(dtu.id)}
        className={cn(
          'inline-flex items-center gap-2 rounded-md border border-lattice-border/60 bg-lattice-surface/40',
          'px-2 py-1 text-xs text-gray-200 hover:border-neon-cyan/50 hover:text-white transition',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-cyan/40',
          className
        )}
        aria-label={`Open DTU: ${title}`}
      >
        {dtu.tier && <TierBadge tier={dtu.tier as DTUTier} size="sm" />}
        <span className="font-medium truncate max-w-[200px]">{title}</span>
        {dtu.creator && (
          <span className="text-gray-400">
            · {dtu.creator.displayName ?? (dtu.creator.id ? dtu.creator.id.slice(0, 6) : 'Anon')}
          </span>
        )}
        <ExternalLink className="w-3 h-3 opacity-60" aria-hidden="true" />
      </button>
    );
  }

  return (
    <article
      className={cn(
        'rounded-lg border border-lattice-border/60 bg-lattice-surface/30 transition',
        'hover:border-neon-cyan/40 focus-within:border-neon-cyan/40',
        className
      )}
      aria-labelledby={`dtu-${dtu.id}-title`}
    >
      <header className="flex items-start gap-2 p-3">
        {mode === 'card' && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-0.5 text-gray-400 hover:text-white"
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse DTU' : 'Expand DTU'}
          >
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        )}
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-baseline gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => onOpen?.(dtu.id)}
              id={`dtu-${dtu.id}-title`}
              className="text-sm font-semibold text-white hover:text-neon-cyan transition text-left truncate max-w-[420px]"
            >
              {title}
            </button>
            {dtu.tier && <TierBadge tier={dtu.tier as DTUTier} size="sm" />}
            {dtu.federation && (
              <FederationBadge
                status={dtu.federation.status}
                instanceName={dtu.federation.instanceName}
                lastSync={dtu.federation.lastSync}
                size="sm"
              />
            )}
            {(dtu.updatedAt || dtu.freshnessScore != null) && (
              <FreshnessBadge
                updatedAt={dtu.updatedAt}
                freshnessScore={dtu.freshnessScore}
                freshnessLabel={dtu.freshnessLabel}
                size="sm"
              />
            )}
            <DownstreamBadge dtuId={dtu.id} compact />
          </div>
          {/* Phase 10 — pan-social interactions on every DTU embed.
              Reactions inline; Share + Bookmark stay visible always so
              users have a single-click save/repost path even when no
              one's reacted yet. */}
          <div className="flex items-center gap-1.5 flex-wrap mt-1">
            <ReactionBar postId={dtu.id} compact hideWhenEmpty={!expanded} />
            <ShareButton postId={dtu.id} compact hideWhenEmpty={!expanded} />
            <BookmarkButton postId={dtu.id} compact />
          </div>
          {dtu.summary && (
            <p
              className={cn(
                'text-xs text-gray-300',
                expanded ? '' : 'line-clamp-2'
              )}
            >
              {dtu.summary}
            </p>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <CreatorBadge
              creator={dtu.creator}
              provenance={dtu.provenance}
              royaltyRate={dtu.royaltyRate}
              royaltyEarnedCc={dtu.royaltyEarnedCc}
              size="sm"
            />
            {dtu.domain && (
              <span className="text-[10px] text-gray-400 capitalize">{dtu.domain}</span>
            )}
            {relTime && <span className="text-[10px] text-gray-400">{relTime}</span>}
          </div>
        </div>
      </header>

      {expanded && (
        <div className="border-t border-lattice-border/40 px-3 py-2 space-y-2">
          {dtu.artifact && <MediaPreview artifact={dtu.artifact} />}
          {dtu.tags && dtu.tags.length > 0 && (
            <ul className="flex flex-wrap gap-1" aria-label="Tags">
              {dtu.tags.slice(0, 12).map((tag) => (
                <li
                  key={tag}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-lattice-surface/60 text-gray-400 border border-lattice-border/40"
                >
                  {tag}
                </li>
              ))}
            </ul>
          )}
          {hasChildren && (
            <div>
              <button
                type="button"
                onClick={() => setChildrenOpen((v) => !v)}
                className="inline-flex items-center gap-1 text-xs text-amber-300/80 hover:text-amber-300"
                aria-expanded={childrenOpen}
              >
                {childrenOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                {dtu.children!.length} source DTU{dtu.children!.length === 1 ? '' : 's'}
              </button>
              {childrenOpen && (
                <ul className="mt-2 space-y-2 border-l border-amber-500/20 pl-3">
                  {dtu.children!.map((child) => (
                    <li key={child.id}>
                      <DTUEmbed dtu={child} mode="compact" onOpen={onOpen} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {/* Phase 10c — collapsed comment thread; expands on user click. */}
          <CommentThread postId={dtu.id} collapsed maxDepth={2} />
        </div>
      )}
    </article>
  );
}

export default DTUEmbed;
