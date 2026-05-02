'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { Network, X, ChevronRight, Loader2, RefreshCw, AlertCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CrossDomainConnectionsProps {
  /** Machine-readable domain key (e.g. "music", "research"). */
  domain: string;
  /** Human-readable label shown in the header (e.g. "Music Production"). */
  domainLabel: string;
}

/** A single cross-domain connection result after normalisation. */
interface ConnectionItem {
  id: string;
  title: string;
  sourceDomain: string;
  similarity: number;
  /** Optional snippet / excerpt for context. */
  excerpt?: string;
}

/** The shape returned by graph.force after normalisation. */
interface GraphNode {
  id?: string;
  _id?: string;
  title?: string;
  label?: string;
  name?: string;
  domain?: string;
  group?: string;
  scope?: string;
  score?: number;
  weight?: number;
  similarity?: number;
}

interface GraphForceResponse {
  nodes?: GraphNode[];
  links?: unknown[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalise raw graph nodes into a list of ConnectionItems, filtering out
 * nodes that belong to the current domain so we only show cross-domain hits.
 */
function normaliseGraphNodes(nodes: GraphNode[], currentDomain: string): ConnectionItem[] {
  return nodes
    .filter((n) => {
      const nd = n.domain || n.group || n.scope || '';
      return nd !== '' && nd !== currentDomain;
    })
    .map((n) => ({
      id: n.id || n._id || String(Math.random()),
      title: n.title || n.label || n.name || 'Untitled',
      sourceDomain: n.domain || n.group || n.scope || 'unknown',
      similarity: n.score ?? n.weight ?? n.similarity ?? 0,
    }))
    .sort((a, b) => b.similarity - a.similarity);
}

/**
 * Assign a deterministic colour class to a domain string so badges are
 * visually distinguishable. Uses a small palette that loops.
 */
const DOMAIN_COLORS = [
  'bg-neon-cyan/20 text-neon-cyan',
  'bg-neon-purple/20 text-neon-purple',
  'bg-amber-500/20 text-amber-400',
  'bg-emerald-500/20 text-emerald-400',
  'bg-rose-500/20 text-rose-400',
  'bg-sky-500/20 text-sky-400',
  'bg-orange-500/20 text-orange-400',
] as const;

function domainColor(domain: string): string {
  let hash = 0;
  for (let i = 0; i < domain.length; i++) {
    hash = (hash << 5) - hash + domain.charCodeAt(i);
    hash |= 0;
  }
  return DOMAIN_COLORS[Math.abs(hash) % DOMAIN_COLORS.length];
}

function formatScore(score: number): string {
  if (score <= 0) return '--';
  if (score <= 1) return `${Math.round(score * 100)}%`;
  return String(Math.round(score));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function CrossDomainConnections({ domain, domainLabel }: CrossDomainConnectionsProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  // ---- Keyboard shortcut: Cmd/Ctrl + J to toggle ----
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ---- Fetch cross-domain connections via semantic search (primary) or graph.force (fallback) ----
  const {
    data: connectionData,
    isLoading: graphLoading,
    error: graphError,
    refetch: refetchGraph,
  } = useQuery({
    queryKey: ['cross-domain-connections', domain],
    queryFn: async () => {
      // Try semantic search first
      try {
        const res = await apiHelpers.semanticSearch.search(domain, { lens: domain, limit: 30 });
        if (res.data?.ok && res.data.results?.length > 0) {
          // Convert semantic results to ConnectionItem format
          const items: ConnectionItem[] = res.data.results
            .filter((r: { tags?: string[] }) => {
              const primaryTag = r.tags?.[0]?.toLowerCase() || '';
              return primaryTag !== '' && primaryTag !== domain.toLowerCase();
            })
            .map(
              (r: {
                id: string;
                title?: string;
                tags?: string[];
                score?: number;
                summary?: string;
              }) => ({
                id: r.id,
                title: r.title || 'Untitled',
                sourceDomain: r.tags?.[0] || 'unknown',
                similarity: r.score ?? 0,
                excerpt: r.summary,
              })
            );
          return { items, source: 'semantic' as const };
        }
      } catch {
        // Fall through to graph.force
      }

      // Fallback: graph.force
      const res = await apiHelpers.graph.force({
        centerNode: domain,
        depth: 2,
        maxNodes: 60,
      });
      const graphRes = res.data as GraphForceResponse;
      return {
        items: normaliseGraphNodes(graphRes?.nodes || [], domain),
        source: 'graph' as const,
      };
    },
    staleTime: 60_000,
    enabled: open,
    retry: 1,
  });

  // ---- Normalise results ----
  const connections: ConnectionItem[] = useMemo(() => {
    return connectionData?.items || [];
  }, [connectionData]);

  // ---- Group by source domain ----
  const grouped: Record<string, ConnectionItem[]> = useMemo(() => {
    const map: Record<string, ConnectionItem[]> = {};
    for (const item of connections) {
      if (!map[item.sourceDomain]) map[item.sourceDomain] = [];
      map[item.sourceDomain].push(item);
    }
    return map;
  }, [connections]);

  const domainKeys = useMemo(
    () => Object.keys(grouped).sort((a, b) => grouped[b].length - grouped[a].length),
    [grouped]
  );

  // ---- Navigate to a result ----
  const handleNavigate = useCallback(
    (item: ConnectionItem) => {
      router.push(`/lenses/${item.sourceDomain}?highlight=${item.id}`);
      setOpen(false);
    },
    [router]
  );

  // ---- Platform modifier key label ----
  const modKey =
    typeof navigator !== 'undefined' && navigator.platform.includes('Mac') ? '\u2318' : 'Ctrl';

  const isLoading = graphLoading;
  const hasError = !!graphError;
  const isEmpty = !isLoading && !hasError && connections.length === 0;

  return (
    <>
      {/* Toggle button (visible when panel is closed) - positioned above DomainAssistant */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-40 right-6 z-40 flex items-center gap-2 px-3 py-2.5 bg-lattice-surface border border-lattice-border text-gray-300 font-medium rounded-full shadow-lg hover:bg-lattice-elevated hover:text-white transition-colors"
          aria-label="Open cross-domain connections"
        >
          <Network className="w-5 h-5" />
          <span className="hidden sm:inline text-sm">Connections</span>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 ml-1 px-1.5 py-0.5 text-[10px] font-mono bg-black/20 rounded">
            {modKey} J
          </kbd>
        </button>
      )}

      {/* Slide-out panel */}
      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-50 bg-black/40"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />

            {/* Panel */}
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 300 }}
              className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-md flex flex-col bg-lattice-bg border-l border-lattice-border shadow-2xl"
              role="dialog"
              aria-label="Cross-domain connections"
            >
              {/* Header */}
              <header className="flex items-center justify-between px-4 py-3 border-b border-lattice-border bg-lattice-surface">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-neon-purple/20 flex items-center justify-center flex-shrink-0">
                    <Network className="w-5 h-5 text-neon-purple" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-white truncate">
                      Cross-Domain Connections
                    </h2>
                    <p className="text-xs text-gray-400 truncate">Related to {domainLabel}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => refetchGraph()}
                    disabled={isLoading}
                    className="p-2 rounded-lg hover:bg-lattice-bg text-gray-400 hover:text-white transition-colors disabled:opacity-40"
                    aria-label="Refresh connections"
                  >
                    <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
                  </button>
                  <button
                    onClick={() => setOpen(false)}
                    className="p-2 rounded-lg hover:bg-lattice-bg text-gray-400 hover:text-white transition-colors"
                    aria-label="Close panel"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </header>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-4 py-4">
                {/* Loading state */}
                {isLoading && (
                  <div className="flex flex-col items-center justify-center h-full gap-3">
                    <Loader2 className="w-8 h-8 text-neon-purple animate-spin" />
                    <p className="text-sm text-gray-400">Discovering connections...</p>
                  </div>
                )}

                {/* Error state */}
                {hasError && !isLoading && (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
                    <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
                      <AlertCircle className="w-6 h-6 text-red-400" />
                    </div>
                    <p className="text-sm text-gray-300">Unable to load connections</p>
                    <p className="text-xs text-gray-500 max-w-xs">
                      The graph service may be unavailable. Try refreshing.
                    </p>
                    <button
                      onClick={() => refetchGraph()}
                      className="mt-2 px-3 py-1.5 text-xs font-medium text-neon-purple bg-neon-purple/10 border border-neon-purple/30 rounded-lg hover:bg-neon-purple/20 transition-colors"
                    >
                      Retry
                    </button>
                  </div>
                )}

                {/* Empty state */}
                {isEmpty && (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
                    <div className="w-16 h-16 rounded-full bg-neon-purple/10 flex items-center justify-center">
                      <Network className="w-8 h-8 text-neon-purple" />
                    </div>
                    <p className="text-sm text-gray-300 font-medium">
                      No cross-domain connections yet
                    </p>
                    <p className="text-xs text-gray-500 max-w-xs">
                      As you add content to {domainLabel.toLowerCase()} and other domains,
                      cross-domain connections will appear here automatically.
                    </p>
                  </div>
                )}

                {/* Results grouped by domain */}
                {!isLoading && !hasError && connections.length > 0 && (
                  <div className="space-y-5">
                    {/* Summary */}
                    <p className="text-xs text-gray-500">
                      {connections.length} connection
                      {connections.length !== 1 ? 's' : ''} across {domainKeys.length} domain
                      {domainKeys.length !== 1 ? 's' : ''}
                    </p>

                    {domainKeys.map((domKey) => (
                      <div key={domKey}>
                        {/* Domain group header */}
                        <div className="flex items-center gap-2 mb-2">
                          <span
                            className={cn(
                              'inline-flex items-center px-2 py-0.5 text-[11px] font-semibold rounded-full',
                              domainColor(domKey)
                            )}
                          >
                            {domKey.charAt(0).toUpperCase() + domKey.slice(1)}
                          </span>
                          <span className="text-[11px] text-gray-500">
                            {grouped[domKey].length} item
                            {grouped[domKey].length !== 1 ? 's' : ''}
                          </span>
                        </div>

                        {/* Items */}
                        <div className="space-y-1.5">
                          {grouped[domKey].map((item) => (
                            <button
                              key={item.id}
                              onClick={() => handleNavigate(item)}
                              className="w-full group flex items-center gap-3 px-3 py-2.5 rounded-xl bg-lattice-surface/50 border border-transparent hover:border-lattice-border hover:bg-lattice-surface transition-all text-left"
                            >
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-gray-200 truncate group-hover:text-white transition-colors">
                                  {item.title}
                                </p>
                                {item.excerpt && (
                                  <p className="text-xs text-gray-500 truncate mt-0.5">
                                    {item.excerpt}
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className="text-[10px] font-mono text-gray-500 tabular-nums">
                                  {formatScore(item.similarity)}
                                </span>
                                <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors" />
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-4 py-2.5 border-t border-lattice-border bg-lattice-surface">
                <p className="text-[10px] text-gray-500 text-center">
                  {modKey}+J to toggle &middot; Click a result to navigate
                </p>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedCrossDomainConnections = withErrorBoundary(CrossDomainConnections);
export { _WrappedCrossDomainConnections as CrossDomainConnections };
export default _WrappedCrossDomainConnections;
