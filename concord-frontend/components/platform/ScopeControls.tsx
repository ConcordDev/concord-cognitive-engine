'use client';

import React, { useState } from 'react';
import { keepPreviousData, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { SCOPE_PAGE_SIZE, scopeDtuQuery } from '@/lib/dtu/list-pages';
import {
  Globe,
  Store,
  User,
  ArrowUpCircle,
  Layers,
  Filter,
  BarChart3,
  MapPin,
  Flag,
  Pencil,
  Trash2,
} from 'lucide-react';
import { FreshnessIndicator } from '@/components/common/FreshnessIndicator';
import { useAuth } from '@/hooks/useAuth';

// Federation-tier scope filter. Matches server-side federation_tier
// values plus a "marketplace" branch and "all" for unfiltered views.
type ScopeFilter = 'all' | 'global' | 'national' | 'regional' | 'marketplace' | 'local';

const SCOPE_META: Record<
  string,
  { icon: React.ComponentType<{ className?: string; size?: number | string }>; color: string; label: string; desc: string }
> = {
  global: {
    icon: Globe,
    color: 'neon-blue',
    label: 'Global',
    desc: 'Council-approved, federation-wide',
  },
  national: { icon: Flag, color: 'neon-purple', label: 'National', desc: 'Your country only' },
  regional: { icon: MapPin, color: 'neon-cyan', label: 'Regional', desc: 'Your region only' },
  marketplace: {
    icon: Store,
    color: 'neon-orange',
    label: 'Marketplace',
    desc: 'Listed for purchase',
  },
  local: { icon: User, color: 'neon-green', label: 'Local', desc: 'Your personal knowledge base' },
};

function ScopeBadge({ scope }: { scope: string }) {
  const meta = SCOPE_META[scope] || SCOPE_META.local;
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-${meta.color}/10 text-${meta.color} border border-${meta.color}/20`}
    >
      <Icon className="w-3 h-3" />
      {meta.label}
    </span>
  );
}

function computeTimeFreshness(dateStr: string): number {
  const ageMs = Date.now() - new Date(dateStr).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const halfLife = 30;
  return Math.max(0, Math.min(1, Math.exp((-0.693 * ageDays) / halfLife)));
}

function DTUCard({
  dtu,
  currentUserId,
}: {
  dtu: {
    id: string;
    title: string;
    scope?: string;
    tier?: string;
    tags?: string[];
    creatorId?: string;
    createdAt?: string;
    updatedAt?: string;
  };
  currentUserId?: string | null;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editTags, setEditTags] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['scope-dtus'] });
    queryClient.invalidateQueries({ queryKey: ['scope-metrics'] });
  };

  const promoteMutation = useMutation({
    mutationFn: (data: { dtuId: string; targetScope: string; reason?: string }) =>
      apiHelpers.scope.promote(data),
    onSuccess: invalidate,
  });

  // Edit + delete (FIX-platform-001). Ownership is enforced by the
  // server on PATCH/DELETE; the controls are hidden only when the row
  // positively belongs to someone else, and a server refusal is shown
  // inline rather than swallowed.
  const errText = (e: unknown) =>
    (e as { response?: { data?: { error?: string } } })?.response?.data?.error
    || (e instanceof Error ? e.message : 'Action failed');
  const updateMutation = useMutation({
    mutationFn: (patch: { title: string; tags: string[] }) => apiHelpers.dtus.update(dtu.id, patch),
    onSuccess: () => { setEditing(false); setActionError(null); invalidate(); },
    onError: (e) => setActionError(errText(e)),
  });
  const deleteMutation = useMutation({
    mutationFn: () => apiHelpers.dtus.delete(dtu.id),
    onSuccess: invalidate,
    onError: (e) => { setConfirmDelete(false); setActionError(errText(e)); },
  });

  const scope = dtu.scope || 'local';
  const canPromote = scope === 'local';
  const canManage = !dtu.creatorId || (!!currentUserId && dtu.creatorId === currentUserId);

  return (
    <div className="bg-lattice-elevated border border-lattice-border rounded-lg p-4 hover:border-neon-blue/30 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-medium text-gray-200 truncate">{dtu.title}</h4>
          <div className="flex items-center gap-2 mt-1">
            <ScopeBadge scope={scope} />
            {dtu.tier && dtu.tier !== 'regular' && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-neon-yellow/10 text-neon-yellow border border-neon-yellow/20">
                {dtu.tier}
              </span>
            )}
            {(dtu.updatedAt || dtu.createdAt) && (
              <FreshnessIndicator
                score={computeTimeFreshness(dtu.updatedAt || dtu.createdAt!)}
                showLabel
                size="sm"
              />
            )}
          </div>
          {dtu.tags && dtu.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {dtu.tags.slice(0, 5).map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-lattice-deep text-gray-400"
                >
                  {tag}
                </span>
              ))}
              {dtu.tags.length > 5 && (
                <span className="text-[10px] text-gray-400">+{dtu.tags.length - 5}</span>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-start gap-1">
          {canPromote && (
            <button
              onClick={() =>
                promoteMutation.mutate({
                  dtuId: dtu.id,
                  targetScope: 'marketplace',
                  reason: 'Manual promotion from scope controls',
                })
              }
              disabled={promoteMutation.isPending}
              className="p-1.5 rounded hover:bg-neon-purple/10 text-gray-400 hover:text-neon-purple transition-colors"
              title="Promote to Marketplace"
            >
              <ArrowUpCircle className="w-4 h-4" />
            </button>
          )}
          {canManage && !editing && (
            <button
              onClick={() => { setEditTitle(dtu.title); setEditTags((dtu.tags || []).join(', ')); setActionError(null); setEditing(true); }}
              className="p-1.5 rounded hover:bg-cyan-500/10 text-gray-400 hover:text-cyan-300 transition-colors"
              title="Edit DTU"
              aria-label={`Edit ${dtu.title}`}
            >
              <Pencil className="w-4 h-4" />
            </button>
          )}
          {canManage && !confirmDelete && (
            <button
              onClick={() => { setConfirmDelete(true); setActionError(null); }}
              className="p-1.5 rounded hover:bg-rose-500/10 text-gray-400 hover:text-rose-300 transition-colors"
              title="Delete DTU"
              aria-label={`Delete ${dtu.title}`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          {canManage && confirmDelete && (
            <span className="flex items-center gap-1">
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="px-2 py-1 rounded bg-rose-500/15 text-rose-300 text-xs disabled:opacity-50"
              >
                Confirm delete
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-2 py-1 rounded bg-zinc-800 text-zinc-300 text-xs"
              >
                Cancel
              </button>
            </span>
          )}
        </div>
      </div>
      {editing && (
        <div className="mt-3 space-y-2">
          <input
            aria-label="DTU title"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-white"
          />
          <input
            aria-label="DTU tags"
            value={editTags}
            onChange={(e) => setEditTags(e.target.value)}
            placeholder="Tags, comma-separated"
            className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-white"
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (!editTitle.trim()) { setActionError('Title cannot be empty.'); return; }
                updateMutation.mutate({
                  title: editTitle.trim(),
                  tags: editTags.split(',').map((t) => t.trim()).filter(Boolean),
                });
              }}
              disabled={updateMutation.isPending}
              className="px-3 py-1 rounded bg-cyan-500/15 text-cyan-300 text-xs disabled:opacity-50"
            >
              Save changes
            </button>
            <button
              onClick={() => setEditing(false)}
              className="px-3 py-1 rounded bg-zinc-800 text-zinc-300 text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {actionError && (
        <p role="alert" className="mt-2 text-xs text-rose-300">{actionError}</p>
      )}
    </div>
  );
}

function ScopeControls() {
  const { user } = useAuth();
  const [activeScope, setActiveScope] = useState<ScopeFilter>('all');
  const [page, setPage] = useState(0);
  const selectScope = (scope: ScopeFilter) => {
    setActiveScope(scope);
    setPage(0);
  };

  const { data: metricsRes } = useQuery({
    queryKey: ['scope-metrics'],
    queryFn: () => apiHelpers.scope.metrics(),
    refetchInterval: 30000,
  });

  const { data: dtusRes, isLoading } = useQuery({
    queryKey: ['scope-dtus', activeScope, page],
    queryFn: () => {
      const q = scopeDtuQuery(activeScope, page);
      if (q.via === 'dtus') return apiHelpers.dtus.list(q.params);
      return apiHelpers.scope.dtus(q.scope, q.params);
    },
    placeholderData: keepPreviousData,
    refetchInterval: 30000,
  });

  const metrics = metricsRes?.data;
  const listBody = dtusRes?.data;
  const dtus: Array<{
    id: string;
    title: string;
    scope?: string;
    tier?: string;
    tags?: string[];
    creatorId?: string;
    createdAt?: string;
  }> = Array.isArray(listBody?.dtus) ? listBody.dtus : Array.isArray(listBody) ? listBody : [];
  const reportedTotal = Number(listBody?.total);
  const pageIsFullSet = page === 0 && Number.isFinite(reportedTotal) && dtus.length >= reportedTotal;

  const scopeCounts: Record<string, number> = {
    global: 0,
    marketplace: 0,
    local: 0,
  };

  // Metrics are the distribution. A single page is not: counting it would
  // report 50 when the filter matches more.
  const haveMetrics = metrics?.globalCount !== undefined;
  if (haveMetrics) {
    scopeCounts.global = metrics.globalCount;
    scopeCounts.marketplace = metrics.marketplaceCount ?? 0;
    scopeCounts.local = metrics.localCount ?? 0;
  } else if (pageIsFullSet) {
    for (const d of dtus) {
      const s = d.scope || 'local';
      if (scopeCounts[s] !== undefined) scopeCounts[s]++;
    }
  }

  const counted = scopeCounts.global + scopeCounts.marketplace + scopeCounts.local;
  const totalDtus = haveMetrics || pageIsFullSet
    ? counted
    : (Number.isFinite(reportedTotal) ? reportedTotal : counted);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Layers className="w-6 h-6 text-neon-blue" />
        <h2 className="text-xl font-bold text-gray-100">Scope Controls</h2>
      </div>

      {/* Scope Distribution Bar */}
      <div className="bg-lattice-surface border border-lattice-border rounded-lg p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-neon-cyan" />
            DTU Scope Distribution
          </h3>
          <span className="text-xs text-gray-400">{totalDtus} total DTUs</span>
        </div>

        {/* Distribution bar */}
        {totalDtus > 0 && (
          <div className="h-4 rounded-full overflow-hidden flex bg-lattice-deep mb-4">
            {scopeCounts.global > 0 && (
              <div
                className="bg-neon-blue h-full transition-all"
                style={{ width: `${(scopeCounts.global / totalDtus) * 100}%` }}
                title={`Global: ${scopeCounts.global}`}
              />
            )}
            {scopeCounts.marketplace > 0 && (
              <div
                className="bg-neon-purple h-full transition-all"
                style={{ width: `${(scopeCounts.marketplace / totalDtus) * 100}%` }}
                title={`Marketplace: ${scopeCounts.marketplace}`}
              />
            )}
            {scopeCounts.local > 0 && (
              <div
                className="bg-neon-green h-full transition-all"
                style={{ width: `${(scopeCounts.local / totalDtus) * 100}%` }}
                title={`Local: ${scopeCounts.local}`}
              />
            )}
          </div>
        )}

        {/* Scope cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {Object.entries(SCOPE_META).map(([scope, meta]) => {
            const Icon = meta.icon;
            const count = scopeCounts[scope] || 0;
            const isActive = activeScope === scope;
            return (
              <button
                key={scope}
                onClick={() => selectScope(isActive ? 'all' : (scope as ScopeFilter))}
                className={`text-left p-4 rounded-lg border transition-colors ${
                  isActive
                    ? `bg-${meta.color}/10 border-${meta.color}/30`
                    : 'bg-lattice-deep border-lattice-border hover:border-gray-600'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={`w-4 h-4 text-${meta.color}`} />
                  <span
                    className={`text-sm font-medium ${isActive ? `text-${meta.color}` : 'text-gray-300'}`}
                  >
                    {meta.label}
                  </span>
                </div>
                <p className={`text-2xl font-bold text-${meta.color}`}>{count}</p>
                <p className="text-[10px] text-gray-400 mt-1">{meta.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2">
        <Filter className="w-4 h-4 text-gray-400" />
        <span className="text-xs text-gray-400">Showing:</span>
        {['all', 'global', 'marketplace', 'local'].map((s) => (
          <button
            key={s}
            onClick={() => selectScope(s as ScopeFilter)}
            className={`text-xs px-3 py-1 rounded-full transition-colors ${
              activeScope === s
                ? 'bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/20'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {s === 'all' ? 'All' : SCOPE_META[s]?.label || s}
          </button>
        ))}
      </div>

      {/* DTU List */}
      <div className="space-y-2">
        {isLoading ? (
          <div className="animate-pulse space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-20 bg-lattice-elevated rounded-lg" />
            ))}
          </div>
        ) : Array.isArray(dtus) && dtus.length > 0 ? (
          dtus.map((dtu) => <DTUCard key={dtu.id} dtu={dtu} currentUserId={user?.id} />)
        ) : (
          <div className="text-center py-12 text-gray-400 text-sm">
            No DTUs in {activeScope === 'all' ? 'the lattice' : `${activeScope} scope`}
          </div>
        )}
        {Number.isFinite(reportedTotal) && reportedTotal > SCOPE_PAGE_SIZE && (
          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-gray-400">
              {page * SCOPE_PAGE_SIZE + 1}–{page * SCOPE_PAGE_SIZE + dtus.length} of {reportedTotal}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="text-xs px-3 py-1 rounded-full border border-lattice-border text-gray-300 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={(page + 1) * SCOPE_PAGE_SIZE >= reportedTotal}
                onClick={() => setPage((p) => p + 1)}
                className="text-xs px-3 py-1 rounded-full border border-lattice-border text-gray-300 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedScopeControls = withErrorBoundary(ScopeControls);
export { _WrappedScopeControls as ScopeControls };
export default _WrappedScopeControls;
export { ScopeBadge };
