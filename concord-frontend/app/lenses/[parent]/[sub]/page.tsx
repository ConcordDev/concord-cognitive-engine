'use client';

/**
 * Dynamic Sub-Lens Page
 *
 * Renders ANY sub-lens in the hierarchical sub-lens registry. Backed by the
 * /api/sub-lens/* endpoints (see server/routes/sub-lens.js), it:
 *  - Fetches the sub-lens' ancestors + children
 *  - Inherits features from the parent lens
 *  - Shows sub-lens-specific DTUs (filtered by tag)
 *  - Links back to the parent lens + siblings
 *  - Exposes an "Ask the Oracle" button pre-filled with the sub-lens domain
 */

import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  ChevronRight, ArrowLeft, Sparkles, Layers, Tag, Loader2,
  Network, BookOpen, Compass,
} from 'lucide-react';
import { useLensNav } from '@/hooks/useLensNav';
import { getLensById } from '@/lib/lens-registry';
import { LensShell } from '@/components/lens/LensShell';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { ErrorState } from '@/components/common/EmptyState';

/* ─── Types ─────────────────────────────────────────────── */
interface SubLensData {
  children: string[];
  ancestors: string[];
  hasSubLenses: boolean;
}

interface DTU {
  id: string;
  title?: string;
  content?: string;
  type?: string;
  tags?: string[];
  createdAt?: string;
}

/* ─── Utils ─────────────────────────────────────────────── */
function formatSubLensName(id: string): string {
  const parts = id.split('.');
  const leaf = parts[parts.length - 1] || id;
  return leaf
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatParentName(parent: string): string {
  return parent.charAt(0).toUpperCase() + parent.slice(1);
}

/* ─── Page ──────────────────────────────────────────────── */
export default function SubLensPage() {
  const params = useParams();
  const router = useRouter();

  const parent = (params?.parent as string) || '';
  const sub = (params?.sub as string) || '';
  const lensId = parent && sub ? `${parent}.${sub}` : parent || '';

  // Register the nested lens with the UI store (tolerant to unknown ids)
  useLensNav(lensId);

  // Realtime data for the parent domain — inherited from the parent lens
  const {
    isLive,
    lastUpdated,
  } = useRealtimeLens(parent);

  // Derived: parent lens entry from the registry (may be undefined for extension-only parents)
  const parentEntry = useMemo(() => getLensById(parent), [parent]);

  /* Fetch sub-lens metadata (children + ancestors) */
  const { data: lensData, isLoading: lensLoading, isError: lensError, refetch: refetchLens } =
    useQuery<SubLensData>({
      queryKey: ['sub-lens', lensId],
      enabled: !!lensId,
      queryFn: async () => {
        try {
          const [childrenRes, ancestorsRes] = await Promise.all([
            fetch(`/api/sub-lens/${encodeURIComponent(lensId)}/children`),
            fetch(`/api/sub-lens/${encodeURIComponent(lensId)}/ancestors`),
          ]);
          const childrenJson = childrenRes.ok ? await childrenRes.json() : null;
          const ancestorsJson = ancestorsRes.ok ? await ancestorsRes.json() : null;
          return {
            children: Array.isArray(childrenJson?.children) ? childrenJson.children : [],
            ancestors: Array.isArray(ancestorsJson?.ancestors)
              ? ancestorsJson.ancestors
              : [parent, lensId],
            hasSubLenses: Boolean(childrenJson?.hasSubLenses),
          };
        } catch {
          // Graceful fallback — use synthesized ancestors
          return {
            children: [],
            ancestors: [parent, lensId],
            hasSubLenses: false,
          };
        }
      },
    });

  /* Fetch siblings via parent's children list */
  const { data: siblingsData } = useQuery<string[]>({
    queryKey: ['sub-lens', 'siblings', parent],
    enabled: !!parent,
    queryFn: async () => {
      try {
        const r = await fetch(`/api/sub-lens/${encodeURIComponent(parent)}/children`);
        if (!r.ok) return [];
        const j = await r.json();
        return Array.isArray(j?.children) ? j.children : [];
      } catch {
        return [];
      }
    },
  });

  /* Fetch DTUs filtered by this sub-lens ID as a tag */
  const { data: dtus, isLoading: dtuLoading } = useQuery<DTU[]>({
    queryKey: ['dtus', 'sub-lens', lensId],
    enabled: !!lensId,
    queryFn: async () => {
      try {
        const qs = new URLSearchParams();
        qs.append('tag', lensId);
        qs.append('tag', `domain:${parent}`);
        const r = await fetch(`/api/dtus?${qs.toString()}`);
        if (!r.ok) return [];
        const j = await r.json();
        const arr = Array.isArray(j?.dtus)
          ? j.dtus
          : Array.isArray(j?.items)
            ? j.items
            : Array.isArray(j)
              ? j
              : [];
        return arr as DTU[];
      } catch {
        return [];
      }
    },
  });

  const [showFeatures, setShowFeatures] = useState(false);

  const siblings = useMemo(
    () => (siblingsData || []).filter((id) => id !== lensId),
    [siblingsData, lensId],
  );

  const ancestors = lensData?.ancestors || [parent, lensId];
  const childLenses = lensData?.children || [];

  const handleAskOracle = useCallback(() => {
    // Pre-fill the oracle chat with this sub-lens as domain context.
    // Route to the chat lens with query params; chat page reads ?domain=&prefill=
    const q = new URLSearchParams({
      domain: lensId,
      prefill: `Ask about ${formatSubLensName(lensId)} (${lensId})`,
    });
    router.push(`/lenses/chat?${q.toString()}`);
  }, [router, lensId]);

  /* Invalid params guard */
  if (!parent || !sub) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error="Invalid sub-lens URL" />
      </div>
    );
  }

  const subDisplay = formatSubLensName(sub);
  const parentDisplay = parentEntry?.name || formatParentName(parent);

  return (
    // eslint-disable-next-line lensManifest/lens-shell-id-matches-path -- dynamic route: lensId is the [parent] segment at runtime, not a string literal.
    <LensShell lensId={parent} asMain={false}>
    <div data-lens-theme={parent} className="px-3 py-4 sm:p-6 space-y-6">
      {/* ── Breadcrumb Header ─────────────────────────── */}
      <header className="space-y-3">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-gray-400 flex-wrap">
          <Link
            href="/hub"
            className="hover:text-neon-cyan transition-colors flex items-center gap-1"
          >
            <Compass className="w-3.5 h-3.5" />
            <span>Hub</span>
          </Link>
          <ChevronRight className="w-3.5 h-3.5 text-gray-600" />
          <Link
            href={`/lenses/${parent}`}
            className="hover:text-neon-cyan transition-colors font-medium"
          >
            {parentDisplay}
          </Link>
          <ChevronRight className="w-3.5 h-3.5 text-gray-600" />
          <span className="text-neon-purple font-medium">{subDisplay}</span>
        </nav>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-neon-purple/10 border border-neon-purple/30 text-neon-purple">
              <Layers className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-white truncate">
                {parentDisplay} &gt; {subDisplay}
              </h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
              <p className="text-sm text-gray-400 mt-1">
                Sub-lens of <span className="text-neon-cyan">{parentDisplay}</span> &mdash;
                <span className="font-mono text-xs ml-1 text-gray-500">{lensId}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={`/lenses/${parent}`}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-lattice-surface border border-lattice-border text-gray-300 hover:text-neon-cyan hover:border-neon-cyan/40 transition-colors text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to {parentDisplay}
            </Link>
            <button
              onClick={handleAskOracle}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-neon-purple/20 border border-neon-purple/40 text-neon-purple hover:bg-neon-purple/30 transition-colors text-sm font-medium"
            >
              <Sparkles className="w-4 h-4" />
              Ask the Oracle
            </button>
          </div>
        </div>
      </header>

      {/* ── Ancestor Chain ───────────────────────────── */}
      {ancestors.length > 1 && (
        <section
          aria-label="Ancestor chain"
          className="bg-lattice-surface border border-lattice-border rounded-lg p-3 flex items-center gap-2 flex-wrap text-xs"
        >
          <Network className="w-3.5 h-3.5 text-neon-cyan flex-shrink-0" />
          <span className="text-gray-500 uppercase tracking-wider">Ancestry:</span>
          {ancestors.map((a, idx) => {
            const isLast = idx === ancestors.length - 1;
            const parts = a.split('.');
            const label = formatSubLensName(a);
            const href =
              parts.length === 1 ? `/lenses/${parts[0]}` : `/lenses/${parts[0]}/${parts.slice(1).join('.')}`;
            return (
              <span key={a} className="flex items-center gap-1.5">
                {isLast ? (
                  <span className="text-neon-purple font-medium">{label}</span>
                ) : (
                  <Link href={href} className="text-gray-300 hover:text-neon-cyan transition-colors">
                    {label}
                  </Link>
                )}
                {!isLast && <ChevronRight className="w-3 h-3 text-gray-600" />}
              </span>
            );
          })}
        </section>
      )}

      {/* ── Loading / Error states for primary metadata ── */}
      {lensLoading && (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading sub-lens metadata&hellip;
        </div>
      )}
      {lensError && (
        <ErrorState
          error="Failed to load sub-lens metadata"
          onRetry={() => refetchLens()}
        />
      )}

      {/* ── DTU Grid ─────────────────────────────────── */}
      <section aria-label="Sub-lens DTUs" className="space-y-3">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-neon-cyan" />
          <h2 className="text-sm uppercase tracking-wider text-gray-400 font-semibold">
            DTUs tagged {lensId}
          </h2>
          {dtuLoading && <Loader2 className="w-3 h-3 animate-spin text-gray-500" />}
          <span className="ml-auto text-xs text-gray-500 font-mono">
            {dtus?.length ?? 0}
          </span>
        </div>
        {dtus && dtus.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {dtus.slice(0, 24).map((dtu, idx) => (
              <motion.article
                key={dtu.id || `dtu-${idx}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.02 }}
                className="bg-lattice-surface border border-lattice-border rounded-lg p-4 hover:border-neon-purple/40 transition-colors"
              >
                <h3 className="text-sm font-medium text-white mb-1 line-clamp-1">
                  {dtu.title || dtu.id || 'Untitled DTU'}
                </h3>
                {dtu.content && (
                  <p className="text-xs text-gray-400 line-clamp-3 whitespace-pre-wrap break-words">
                    {String(dtu.content).slice(0, 240)}
                  </p>
                )}
                {Array.isArray(dtu.tags) && dtu.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {dtu.tags.slice(0, 4).map((t) => (
                      <span
                        key={t}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/20 inline-flex items-center gap-1"
                      >
                        <Tag className="w-2.5 h-2.5" />
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </motion.article>
            ))}
          </div>
        ) : (
          !dtuLoading && (
            <div className="text-xs text-gray-500 italic border border-dashed border-lattice-border rounded-lg p-4 text-center">
              No DTUs tagged with <span className="font-mono">{lensId}</span> yet.
              Use &ldquo;Ask the Oracle&rdquo; above to seed content.
            </div>
          )
        )}
      </section>

      {/* ── Child Sub-Lenses (if any) ─────────────────── */}
      {childLenses.length > 0 && (
        <section aria-label="Child sub-lenses" className="space-y-3">
          <div className="flex items-center gap-2">
            <Network className="w-4 h-4 text-neon-cyan" />
            <h2 className="text-sm uppercase tracking-wider text-gray-400 font-semibold">
              Children
            </h2>
            <span className="ml-auto text-xs text-gray-500 font-mono">
              {childLenses.length}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {childLenses.map((child) => {
              const parts = child.split('.');
              const href = `/lenses/${parts[0]}/${parts.slice(1).join('.')}`;
              return (
                <Link
                  key={child}
                  href={href}
                  className="block px-3 py-2 rounded-md bg-lattice-surface border border-lattice-border hover:border-neon-purple/40 hover:text-neon-purple transition-colors text-xs"
                >
                  {formatSubLensName(child)}
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Sibling Navigation ────────────────────────── */}
      {siblings.length > 0 && (
        <section aria-label="Sibling sub-lenses" className="space-y-3">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-neon-cyan" />
            <h2 className="text-sm uppercase tracking-wider text-gray-400 font-semibold">
              Related in {parentDisplay}
            </h2>
            <span className="ml-auto text-xs text-gray-500 font-mono">
              {siblings.length}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {siblings.slice(0, 24).map((sibling) => {
              const parts = sibling.split('.');
              const href = `/lenses/${parts[0]}/${parts.slice(1).join('.')}`;
              return (
                <Link
                  key={sibling}
                  href={href}
                  className="px-3 py-1.5 rounded-full bg-lattice-surface border border-lattice-border text-xs text-gray-300 hover:text-neon-purple hover:border-neon-purple/40 transition-colors"
                >
                  {formatSubLensName(sibling)}
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Inherited Parent Features Panel ───────────── */}
      <section className="border-t border-white/10 pt-2">
        <button
          onClick={() => setShowFeatures((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-3 text-sm text-gray-400 hover:text-white transition-colors"
          aria-expanded={showFeatures}
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Inherited Features from {parentDisplay}
          </span>
          <ChevronRight
            className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-90' : ''}`}
          />
        </button>
        {showFeatures && (
          <div className="px-3 pb-4">
            <LensFeaturePanel lensId={parent} />
          </div>
        )}
      </section>
    </div>
    </LensShell>
  );
}
