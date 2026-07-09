'use client';

/**
 * CitationChainPanel — the "what have I pulled, and who cites it" view for
 * the Intelligence Desk. Everything is real DTU substrate:
 *
 *   • lists the user's pulled news DTUs (GET /api/dtus/paginated, tag=news)
 *   • each is a real DTUEmbed (shared component) with its provenance
 *   • expanding a row fetches the citation chain (GET /api/social/cited-by/:id)
 *
 * Honest empty state when nothing has been pulled yet — no placeholder rows.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Quote, ChevronRight, Loader2, Link2 } from 'lucide-react';
import { api } from '@/lib/api/client';
import { DTUEmbed, type DTUEmbedRecord } from '@/components/dtu/DTUEmbed';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';

interface PulledDtu {
  id: string;
  title?: string;
  tier?: string;
  tags?: string[];
  createdAt?: string;
  source?: string;
  human?: { summary?: string };
  meta?: { apiProvider?: string; apiUrl?: string; fetchedAt?: string };
}

interface CitedBy {
  ok: boolean;
  dtuId: string;
  citedBy: Array<{ dtuId: string; title: string }>;
  total: number;
}

export function CitationChainPanel({ refreshKey }: { refreshKey?: number }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['news-pulled-dtus', refreshKey],
    queryFn: async () => {
      const r = await api.get('/api/dtus/paginated', {
        params: { tag: 'news', pageSize: 30, scope: 'local' },
      });
      return (r.data?.items || []) as PulledDtu[];
    },
    staleTime: 15_000,
  });

  const items = data || [];

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} variant="line" lines={2} />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        compact
        icon={<Quote className="h-6 w-6 text-zinc-600" />}
        title="No pulled intelligence yet"
        description="Pull a live headline into your substrate (the bookmark button on any feed row). Pulled DTUs carry the source, URL and timestamp — and become citable here."
      />
    );
  }

  return (
    <div className="space-y-2">
      {items.map((d) => {
        const record: DTUEmbedRecord = {
          id: d.id,
          title: d.title,
          summary: d.human?.summary,
          domain: 'news',
          tier: d.tier,
          tags: d.tags,
          createdAt: d.createdAt || d.meta?.fetchedAt,
        };
        const isOpen = expanded === d.id;
        return (
          <div key={d.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
            <DTUEmbed dtu={record} mode="compact" recordSurfaceFromLens="news" />
            <button
              type="button"
              onClick={() => setExpanded(isOpen ? null : d.id)}
              className="mt-1 flex w-full items-center gap-1 rounded px-1.5 py-1 text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800/60 hover:text-cyan-300"
            >
              <ChevronRight className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
              <Link2 className="h-3 w-3" />
              Citation chain
            </button>
            <AnimatePresence>
              {isOpen && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.15 }}
                  className="overflow-hidden"
                >
                  <CitationChain dtuId={d.id} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

function CitationChain({ dtuId }: { dtuId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['cited-by', dtuId],
    queryFn: async () => {
      const r = await api.get(`/api/social/cited-by/${dtuId}`);
      return r.data as CitedBy;
    },
    staleTime: 15_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-2 py-2 text-[11px] text-zinc-500">
        <Loader2 className="h-3 w-3 animate-spin" /> Resolving chain…
      </div>
    );
  }

  const citers = data?.citedBy || [];
  if (citers.length === 0) {
    return (
      <p className="px-2 py-2 text-[11px] text-zinc-500">
        Not yet cited. When you derive a DTU from this one (cite it as a parent), the chain grows here and
        royalties cascade to the source.
      </p>
    );
  }

  return (
    <div className="space-y-1 py-1 pl-4">
      <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
        Cited by {data?.total ?? citers.length}
      </p>
      {citers.map((c) => (
        <div key={c.dtuId} className="flex items-center gap-1.5 border-l border-cyan-500/20 pl-2 text-[11px] text-zinc-300">
          <Quote className="h-3 w-3 shrink-0 text-cyan-500/60" />
          <span className="truncate">{c.title}</span>
        </div>
      ))}
    </div>
  );
}
