'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';
import {
  Globe,
  Download,
  Shield,
  Clock,
  BarChart3,
  Plus,
  X,
  Link,
  FileText,
  CheckCircle,
  Loader2,
  AlertTriangle,
  Trash2,
  RefreshCw,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface QueueItem {
  id: string;
  url: string;
  domain?: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  tier?: string;
  dtusGenerated?: number;
  error?: string;
  createdAt?: string;
  completedAt?: string;
}

interface IngestStats {
  totalIngested: number;
  totalDtus: number;
  totalFailed: number;
  rateLimits: Record<string, { used: number; limit: number }>;
  domainBreakdown: Record<string, number>;
  queueDepth: number;
  processingCount: number;
}

interface AllowlistEntry {
  domain: string;
  addedAt?: string;
  addedBy?: string;
}

interface BlocklistEntry {
  domain: string;
  reason?: string;
  blockedAt?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const STATUS_CONFIG: Record<
  QueueItem['status'],
  { color: string; bgClass: string; label: string }
> = {
  queued: { color: 'gray-400', bgClass: 'bg-gray-400/20 text-gray-400', label: 'Queued' },
  processing: { color: 'neon-blue', bgClass: 'bg-blue-500/20 text-blue-400', label: 'Processing' },
  completed: { color: 'green-400', bgClass: 'bg-green-500/20 text-green-400', label: 'Completed' },
  failed: { color: 'red-400', bgClass: 'bg-red-500/20 text-red-400', label: 'Failed' },
};

const TIER_LIMITS: Record<string, number | null> = {
  free: 10,
  paid: 100,
  researcher: 500,
  sovereign: null, // unlimited
};

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function IngestMonitorPage() {
  const queryClient = useQueryClient();

  /* ---- local form state ---- */
  const [urlInput, setUrlInput] = useState('');
  const [tierInput, setTierInput] = useState('free');
  const [newDomain, setNewDomain] = useState('');
  const [blockDomain, setBlockDomain] = useState('');
  const [activeTab, setActiveTab] = useState<'queue' | 'allowlist' | 'blocklist'>('queue');

  /* ---------------------------------------------------------------- */
  /*  Queries                                                          */
  /* ---------------------------------------------------------------- */

  // Ingest queue
  const { data: queueData, isLoading: queueLoading } = useQuery({
    queryKey: ['ingest-queue'],
    queryFn: () => api.get('/api/ingest/queue').then((r) => r.data),
    refetchInterval: 5000,
  });

  // Ingest stats
  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['ingest-stats'],
    queryFn: () => api.get('/api/ingest/stats').then((r) => r.data),
    refetchInterval: 10000,
  });

  // Allowlist
  const { data: allowlistData, isLoading: allowlistLoading } = useQuery({
    queryKey: ['ingest-allowlist'],
    queryFn: () => api.get('/api/ingest/allowlist').then((r) => r.data),
  });

  /* ---------------------------------------------------------------- */
  /*  Derived data with safe defaults                                  */
  /* ---------------------------------------------------------------- */

  const queue: QueueItem[] = Array.isArray(queueData?.items ?? queueData?.queue ?? queueData)
    ? (queueData?.items ?? queueData?.queue ?? queueData)
    : [];

  const stats: IngestStats = {
    totalIngested: statsData?.totalIngested ?? statsData?.total ?? 0,
    totalDtus: statsData?.totalDtus ?? statsData?.dtus ?? 0,
    totalFailed: statsData?.totalFailed ?? statsData?.failed ?? 0,
    rateLimits: statsData?.rateLimits ?? {},
    domainBreakdown: statsData?.domainBreakdown ?? statsData?.domains ?? {},
    queueDepth: statsData?.queueDepth ?? queue.filter((i) => i.status === 'queued').length,
    processingCount:
      statsData?.processingCount ?? queue.filter((i) => i.status === 'processing').length,
  };

  const allowlist: AllowlistEntry[] = Array.isArray(allowlistData?.domains ?? allowlistData)
    ? (allowlistData?.domains ?? allowlistData).map((d: string | AllowlistEntry) =>
        typeof d === 'string' ? { domain: d } : d
      )
    : [];

  const blocklist: BlocklistEntry[] = Array.isArray(
    statsData?.blocklist ?? statsData?.blockedDomains
  )
    ? (statsData?.blocklist ?? statsData?.blockedDomains).map((d: string | BlocklistEntry) =>
        typeof d === 'string' ? { domain: d } : d
      )
    : [];

  // Domain breakdown sorted descending
  const sortedDomains = Object.entries(stats.domainBreakdown)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20);

  /* ---------------------------------------------------------------- */
  /*  Mutations                                                        */
  /* ---------------------------------------------------------------- */

  const submitUrl = useMutation({
    mutationFn: (url: string) =>
      api.post('/api/ingest/submit', { url, tier: tierInput }).then((r) => r.data),
    onSuccess: () => {
      setUrlInput('');
      queryClient.invalidateQueries({ queryKey: ['ingest-queue'] });
      queryClient.invalidateQueries({ queryKey: ['ingest-stats'] });
    },
  });

  const addToAllowlist = useMutation({
    mutationFn: (domain: string) =>
      api.post('/api/ingest/allowlist', { action: 'add', domain }).then((r) => r.data),
    onSuccess: () => {
      setNewDomain('');
      queryClient.invalidateQueries({ queryKey: ['ingest-allowlist'] });
    },
  });

  const removeFromAllowlist = useMutation({
    mutationFn: (domain: string) =>
      api.post('/api/ingest/allowlist', { action: 'remove', domain }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingest-allowlist'] });
    },
  });

  const blockDomainMutation = useMutation({
    mutationFn: (domain: string) => api.post('/api/ingest/block', { domain }).then((r) => r.data),
    onSuccess: () => {
      setBlockDomain('');
      queryClient.invalidateQueries({ queryKey: ['ingest-stats'] });
      queryClient.invalidateQueries({ queryKey: ['ingest-allowlist'] });
    },
  });

  const flushQueue = useMutation({
    mutationFn: () => api.post('/api/ingest/flush').then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ingest-queue'] });
      queryClient.invalidateQueries({ queryKey: ['ingest-stats'] });
    },
  });

  /* ---------------------------------------------------------------- */
  /*  Handlers                                                         */
  /* ---------------------------------------------------------------- */

  const handleSubmitUrl = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    submitUrl.mutate(trimmed);
  };

  const handleAddDomain = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newDomain.trim();
    if (!trimmed) return;
    addToAllowlist.mutate(trimmed);
  };

  const handleBlockDomain = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = blockDomain.trim();
    if (!trimmed) return;
    blockDomainMutation.mutate(trimmed);
  };

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className={ds.pageContainer}>
      {/* ---- Header ---- */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Download className="w-8 h-8 text-neon-blue" />
          <div>
            <h1 className={ds.heading1}>Ingest Monitor</h1>
            <p className={ds.textMuted}>
              System 13f -- URL ingestion pipeline, rate limits, and domain governance
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            queryClient.invalidateQueries({ queryKey: ['ingest-queue'] });
            queryClient.invalidateQueries({ queryKey: ['ingest-stats'] });
            queryClient.invalidateQueries({ queryKey: ['ingest-allowlist'] });
          }}
          className={ds.btnGhost}
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </header>

      {/* ---- Submit URL Form ---- */}
      <div className={ds.panel}>
        <h2 className={cn(ds.heading3, 'flex items-center gap-2 mb-4')}>
          <Link className="w-5 h-5 text-neon-blue" />
          Submit URL for Ingestion
        </h2>
        <form onSubmit={handleSubmitUrl} className="flex flex-col sm:flex-row gap-3">
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://example.com/article"
            className={cn(ds.input, 'flex-1')}
            required
          />
          <select
            value={tierInput}
            onChange={(e) => setTierInput(e.target.value)}
            className={cn(ds.select, 'w-full sm:w-40')}
          >
            <option value="free">Free</option>
            <option value="paid">Paid</option>
            <option value="researcher">Researcher</option>
            <option value="sovereign">Sovereign</option>
          </select>
          <button
            type="submit"
            disabled={submitUrl.isPending || !urlInput.trim()}
            className={ds.btnPrimary}
          >
            {submitUrl.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {submitUrl.isPending ? 'Submitting...' : 'Ingest'}
          </button>
        </form>
        {submitUrl.isError && (
          <p className="mt-2 text-sm text-red-400">
            Failed to submit: {(submitUrl.error as Error)?.message ?? 'Unknown error'}
          </p>
        )}
        {submitUrl.isSuccess && (
          <p className="mt-2 text-sm text-green-400 flex items-center gap-1">
            <CheckCircle className="w-4 h-4" /> URL submitted successfully.
          </p>
        )}
      </div>

      {/* ---- Stats Cards ---- */}
      <div className={ds.grid4}>
        {/* Total Ingested */}
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-5 h-5 text-neon-blue" />
            <span className={ds.textMuted}>Total Ingested</span>
          </div>
          <p className="text-3xl font-bold text-white">
            {statsLoading ? '--' : stats.totalIngested.toLocaleString()}
          </p>
        </div>

        {/* DTUs Generated */}
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="w-5 h-5 text-neon-purple" />
            <span className={ds.textMuted}>DTUs Generated</span>
          </div>
          <p className="text-3xl font-bold text-white">
            {statsLoading ? '--' : stats.totalDtus.toLocaleString()}
          </p>
        </div>

        {/* Queue Depth */}
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-5 h-5 text-yellow-400" />
            <span className={ds.textMuted}>Queue Depth</span>
          </div>
          <p className="text-3xl font-bold text-white">{queueLoading ? '--' : stats.queueDepth}</p>
          <p className={ds.textMuted}>
            {stats.processingCount > 0 && `${stats.processingCount} processing`}
          </p>
        </div>

        {/* Failed */}
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            <span className={ds.textMuted}>Failed</span>
          </div>
          <p className="text-3xl font-bold text-white">{statsLoading ? '--' : stats.totalFailed}</p>
        </div>
      </div>

      {/* ---- Rate Limits Per Tier ---- */}
      <div className={ds.panel}>
        <h2 className={cn(ds.heading3, 'flex items-center gap-2 mb-4')}>
          <Shield className="w-5 h-5 text-neon-cyan" />
          Rate Limit Status
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.entries(TIER_LIMITS).map(([tier, limit]) => {
            const used = stats.rateLimits[tier]?.used ?? 0;
            const serverLimit = stats.rateLimits[tier]?.limit ?? limit;
            const isUnlimited =
              serverLimit === null || serverLimit === undefined || tier === 'sovereign';
            const pct = isUnlimited ? 0 : serverLimit ? (used / serverLimit) * 100 : 0;
            const barColor = pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-neon-green';

            return (
              <div key={tier} className="p-3 bg-lattice-elevated rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-white capitalize">{tier}</span>
                  <span className={ds.textMuted}>
                    {isUnlimited ? `${used} / unlimited` : `${used} / ${serverLimit}`}
                  </span>
                </div>
                {!isUnlimited && (
                  <div className="h-2 bg-lattice-surface rounded-full overflow-hidden">
                    <div
                      className={cn('h-full rounded-full transition-all duration-500', barColor)}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                )}
                {isUnlimited && <div className="h-2 bg-neon-cyan/30 rounded-full" />}
              </div>
            );
          })}
        </div>
      </div>

      {/* ---- Tabs: Queue / Allowlist / Blocklist ---- */}
      <div className="flex gap-1 border-b border-lattice-border">
        {[
          { key: 'queue' as const, label: 'Ingest Queue', icon: <Clock className="w-4 h-4" /> },
          { key: 'allowlist' as const, label: 'Allowlist', icon: <Shield className="w-4 h-4" /> },
          {
            key: 'blocklist' as const,
            label: 'Blocklist',
            icon: <AlertTriangle className="w-4 h-4" />,
          },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={activeTab === tab.key ? ds.tabActive() : ds.tabInactive}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ---- Tab: Queue ---- */}
      {activeTab === 'queue' && (
        <div className={ds.panel}>
          <div className="flex items-center justify-between mb-4">
            <h2 className={cn(ds.heading3, 'flex items-center gap-2')}>
              <Clock className="w-5 h-5 text-neon-blue" />
              Ingest Queue
              <span className="ml-2 text-sm font-normal text-gray-400">({queue.length} items)</span>
            </h2>
            <button
              onClick={() => flushQueue.mutate()}
              disabled={flushQueue.isPending || queue.length === 0}
              className={ds.btnDanger}
            >
              {flushQueue.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              Flush Queue
            </button>
          </div>

          {queueLoading ? (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
              Loading queue...
            </div>
          ) : queue.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <Download className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>Queue is empty. Submit a URL above to start ingesting.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[480px] overflow-y-auto">
              {queue.map((item) => {
                const cfg = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.queued;
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-3 bg-lattice-elevated rounded-lg"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {/* Status dot */}
                      <span
                        className={cn(
                          'w-2.5 h-2.5 rounded-full flex-shrink-0',
                          item.status === 'queued' && 'bg-gray-400',
                          item.status === 'processing' && 'bg-blue-400 animate-pulse',
                          item.status === 'completed' && 'bg-green-400',
                          item.status === 'failed' && 'bg-red-400'
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-white truncate">{item.url}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {item.domain && (
                            <span className={ds.textMuted}>
                              <Globe className="w-3 h-3 inline mr-1" />
                              {item.domain}
                            </span>
                          )}
                          {item.createdAt && (
                            <span className={ds.textMuted}>
                              {new Date(item.createdAt).toLocaleTimeString()}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                      {item.dtusGenerated !== undefined && item.dtusGenerated > 0 && (
                        <span className="text-xs text-neon-purple">
                          {item.dtusGenerated} DTU{item.dtusGenerated !== 1 ? 's' : ''}
                        </span>
                      )}
                      <span
                        className={cn('px-2 py-0.5 rounded-full text-xs font-medium', cfg.bgClass)}
                      >
                        {cfg.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ---- Tab: Allowlist ---- */}
      {activeTab === 'allowlist' && (
        <div className={ds.panel}>
          <h2 className={cn(ds.heading3, 'flex items-center gap-2 mb-4')}>
            <Shield className="w-5 h-5 text-neon-green" />
            Domain Allowlist
            <span className="ml-2 text-sm font-normal text-gray-400">
              ({allowlist.length} domains)
            </span>
          </h2>

          {/* Add to allowlist */}
          <form onSubmit={handleAddDomain} className="flex gap-3 mb-4">
            <input
              type="text"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              placeholder="example.com"
              className={cn(ds.input, 'flex-1')}
            />
            <button
              type="submit"
              disabled={addToAllowlist.isPending || !newDomain.trim()}
              className={ds.btnPrimary}
            >
              {addToAllowlist.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              Add
            </button>
          </form>

          {allowlistLoading ? (
            <div className="flex items-center justify-center py-8 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Loading allowlist...
            </div>
          ) : allowlist.length === 0 ? (
            <p className="text-center py-8 text-gray-500">
              No domains on the allowlist. Add a domain above.
            </p>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {allowlist.map((entry) => (
                <div
                  key={entry.domain}
                  className="flex items-center justify-between p-3 bg-lattice-elevated rounded-lg"
                >
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-neon-green" />
                    <span className="text-white text-sm">{entry.domain}</span>
                    {entry.addedAt && (
                      <span className={ds.textMuted}>
                        added {new Date(entry.addedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => removeFromAllowlist.mutate(entry.domain)}
                    disabled={removeFromAllowlist.isPending}
                    className={ds.btnGhost}
                    title="Remove from allowlist"
                  >
                    <X className="w-4 h-4 text-red-400" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---- Tab: Blocklist ---- */}
      {activeTab === 'blocklist' && (
        <div className={ds.panel}>
          <h2 className={cn(ds.heading3, 'flex items-center gap-2 mb-4')}>
            <AlertTriangle className="w-5 h-5 text-red-400" />
            Blocked Domains
            <span className="ml-2 text-sm font-normal text-gray-400">
              ({blocklist.length} domains)
            </span>
          </h2>

          {/* Block a domain */}
          <form onSubmit={handleBlockDomain} className="flex gap-3 mb-4">
            <input
              type="text"
              value={blockDomain}
              onChange={(e) => setBlockDomain(e.target.value)}
              placeholder="spam-domain.com"
              className={cn(ds.input, 'flex-1')}
            />
            <button
              type="submit"
              disabled={blockDomainMutation.isPending || !blockDomain.trim()}
              className={ds.btnDanger}
            >
              {blockDomainMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Shield className="w-4 h-4" />
              )}
              Block
            </button>
          </form>

          {blocklist.length === 0 ? (
            <p className="text-center py-8 text-gray-500">
              No blocked domains. Use the form above to block a domain.
            </p>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {blocklist.map((entry) => (
                <div
                  key={entry.domain}
                  className="flex items-center justify-between p-3 bg-lattice-elevated rounded-lg"
                >
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-red-400" />
                    <span className="text-white text-sm">{entry.domain}</span>
                    {entry.reason && <span className={ds.textMuted}>-- {entry.reason}</span>}
                  </div>
                  {entry.blockedAt && (
                    <span className={ds.textMuted}>
                      {new Date(entry.blockedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---- Domain Breakdown ---- */}
      <div className={ds.grid2}>
        <div className={ds.panel}>
          <h2 className={cn(ds.heading3, 'flex items-center gap-2 mb-4')}>
            <Globe className="w-5 h-5 text-neon-cyan" />
            Domain Breakdown
          </h2>
          {sortedDomains.length === 0 ? (
            <p className="text-center py-6 text-gray-500">No domain data yet.</p>
          ) : (
            <div className="space-y-2 max-h-[360px] overflow-y-auto">
              {sortedDomains.map(([domain, count]) => {
                const maxCount = sortedDomains[0]?.[1] ?? 1;
                const pct = (count / maxCount) * 100;
                return (
                  <div key={domain} className="group">
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-300 truncate flex-1 mr-2">{domain}</span>
                      <span className="text-white font-medium flex-shrink-0">{count}</span>
                    </div>
                    <div className="h-1.5 bg-lattice-surface rounded-full overflow-hidden">
                      <div
                        className="h-full bg-neon-cyan/60 rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* DTU Generation Summary */}
        <div className={ds.panel}>
          <h2 className={cn(ds.heading3, 'flex items-center gap-2 mb-4')}>
            <BarChart3 className="w-5 h-5 text-neon-purple" />
            DTU Generation
          </h2>

          <div className="space-y-4">
            <div className="p-4 bg-lattice-elevated rounded-lg">
              <p className={ds.textMuted}>Total DTUs from Ingest</p>
              <p className="text-4xl font-bold text-neon-purple mt-1">
                {statsLoading ? '--' : stats.totalDtus.toLocaleString()}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-lattice-elevated rounded-lg">
                <p className={ds.textMuted}>Success Rate</p>
                <p className="text-xl font-bold text-neon-green">
                  {stats.totalIngested > 0
                    ? `${Math.round(((stats.totalIngested - stats.totalFailed) / stats.totalIngested) * 100)}%`
                    : '--'}
                </p>
              </div>
              <div className="p-3 bg-lattice-elevated rounded-lg">
                <p className={ds.textMuted}>DTUs / Ingest</p>
                <p className="text-xl font-bold text-white">
                  {stats.totalIngested > 0
                    ? (stats.totalDtus / stats.totalIngested).toFixed(1)
                    : '--'}
                </p>
              </div>
            </div>

            {/* Recent completed items with DTU counts */}
            <div>
              <p className={cn(ds.textMuted, 'mb-2')}>Recent Completions</p>
              <div className="space-y-1.5">
                {queue
                  .filter((i) => i.status === 'completed' && i.dtusGenerated)
                  .slice(0, 5)
                  .map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between text-sm p-2 bg-lattice-surface rounded"
                    >
                      <span className="text-gray-300 truncate flex-1 mr-2">
                        {extractDomain(item.url)}
                      </span>
                      <span className="text-neon-purple font-medium flex-shrink-0">
                        +{item.dtusGenerated} DTU{item.dtusGenerated !== 1 ? 's' : ''}
                      </span>
                    </div>
                  ))}
                {queue.filter((i) => i.status === 'completed' && i.dtusGenerated).length === 0 && (
                  <p className="text-center py-4 text-gray-500 text-sm">
                    No completed items with DTUs yet.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
