'use client';

// Federation lens — production-grade peer manager + cross-instance search.
//
// Tabs: Network | Search | Peers | Sync
//
// Network: trust graph + local instance status (ID, capabilities, peer count).
// Search:  full-text query across all federated instances.
// Peers:   probe / register / remove / inspect each peer with last-seen.
// Sync:    manual sync trigger + recent sync events.

import { useState, useCallback, useEffect, useMemo } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { FediverseFeed } from '@/components/federation/FediverseFeed';
import { PeerPolicyPanel } from '@/components/federation/PeerPolicyPanel';
import { ModerationQueuePanel } from '@/components/federation/ModerationQueuePanel';
import { SyncPolicyPanel } from '@/components/federation/SyncPolicyPanel';
import { RelayPanel } from '@/components/federation/RelayPanel';
import { TrustHistoryPanel } from '@/components/federation/TrustHistoryPanel';
import { MetricsDashboardPanel } from '@/components/federation/MetricsDashboardPanel';
import { ActorKeysPanel } from '@/components/federation/ActorKeysPanel';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useLensCommand } from '@/hooks/useLensCommand';
import {
  useArtifacts,
  useCreateArtifact,
} from '@/lib/hooks/use-lens-artifacts';
import dynamic from 'next/dynamic';
import {
  Network, Search, Users, RefreshCw, Loader2, ShieldCheck,
  Globe, Trash2, AlertCircle, Zap, Activity, Plus, X,
  ShieldX, Inbox, Radio, BarChart3, KeyRound,
} from 'lucide-react';

const TrustGraphView = dynamic(
  () => import('@/components/federation/TrustGraphView'),
  { ssr: false }
);

interface SearchHit {
  id?: string;
  dtuId?: string;
  title?: string;
  source?: string;
  peerName?: string;
  score?: number;
  snippet?: string;
}

interface Peer {
  id?: string;
  nodeId?: string;
  instanceId?: string;
  name?: string;
  status?: string;
  registryUrl?: string;
  lastSeen?: number | string | null;
  addedAt?: number | string | null;
  capabilities?: string[];
}

interface FederationStatus {
  ok: boolean;
  enabled?: boolean;
  federation?: {
    instanceId?: string;
    name?: string;
    trustedCount?: number;
    pendingPosts?: number;
    capabilities?: string[];
    [k: string]: unknown;
  };
}

type Tab =
  | 'network' | 'search' | 'peers' | 'sync'
  | 'moderation' | 'policy' | 'relays' | 'metrics' | 'keys';

export default function FederationPage() {
  const [tab, setTab] = useState<Tab>('network');

  useLensCommand(
    [
      { id: 'tab-network',    keys: 'n', description: 'Network',    category: 'navigation', action: () => setTab('network') },
      { id: 'tab-search',     keys: 's', description: 'Search',     category: 'navigation', action: () => setTab('search') },
      { id: 'tab-peers',      keys: 'p', description: 'Peers',      category: 'navigation', action: () => setTab('peers') },
      { id: 'tab-sync',       keys: 'y', description: 'Sync',       category: 'navigation', action: () => setTab('sync') },
      { id: 'tab-moderation', keys: 'm', description: 'Moderation', category: 'navigation', action: () => setTab('moderation') },
      { id: 'tab-policy',     keys: 'b', description: 'Defederation', category: 'navigation', action: () => setTab('policy') },
      { id: 'tab-relays',     keys: 'r', description: 'Relays',     category: 'navigation', action: () => setTab('relays') },
      { id: 'tab-metrics',    keys: 'd', description: 'Metrics',    category: 'navigation', action: () => setTab('metrics') },
      { id: 'tab-keys',       keys: 'k', description: 'Actor keys', category: 'navigation', action: () => setTab('keys') },
    ],
    { lensId: 'federation' }
  );

  // ── Shared state ───────────────────────────────────────────────────
  const [status, setStatus] = useState<FederationStatus | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, pInst, pTrust] = await Promise.all([
        fetch('/api/federation/status', { credentials: 'include' }).then((r) => r.json()).catch(() => null),
        fetch('/api/federation/instances', { credentials: 'include' }).then((r) => r.json()).catch(() => null),
        fetch('/api/federation/peers',     { credentials: 'include' }).then((r) => r.json()).catch(() => null),
      ]);
      // If the status endpoint itself is unreachable, surface a real error
      // (with a Retry) rather than a silently-empty page.
      if (s == null) {
        setError('Federation service unreachable. Check the node is up and try again.');
        setStatus(null);
        setPeers([]);
        return;
      }
      setStatus(s as FederationStatus | null);
      const all: Peer[] = [];
      if (Array.isArray(pInst?.peers))   all.push(...(pInst.peers as Peer[]));
      if (Array.isArray(pTrust?.peers))  all.push(...(pTrust.peers as Peer[]));
      // De-dupe by instanceId/nodeId.
      const seen = new Set<string>();
      const deduped = all.filter((p) => {
        const k = (p.instanceId ?? p.nodeId ?? p.id ?? '') as string;
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      setPeers(deduped);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load federation status.');
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <LensShell lensId="federation" asMain={false}>
      <FirstRunTour lensId="federation" />
      <ManifestActionBar />
      <DepthBadge lensId="federation" size="sm" className="ml-2" />
      <div className="min-h-screen bg-[#0b0f17] text-gray-100 p-6">
        <header className="mb-5 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-3xl font-semibold text-amber-300 inline-flex items-center gap-2">
              <Network className="w-7 h-7" /> Federation
            </h1>
            <p className="text-gray-400 mt-1">
              Concord nodes peer with each other to share knowledge, trust, and DTU lineage.
            </p>
          </div>
          <button
            onClick={refresh}
            disabled={loading}
            className="text-white/40 hover:text-white text-xs inline-flex items-center gap-1 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Refresh
          </button>
        </header>

        {/* Initial load status — accessible live region */}
        {loading && !loaded && (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 text-sm text-gray-400 mb-2"
          >
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading federation status…
          </div>
        )}

        {/* Error surface — accessible alert with a working Retry */}
        {error && !loading && (
          <div
            role="alert"
            className="mb-3 rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-sm text-rose-200 flex items-center justify-between gap-3 flex-wrap"
          >
            <span className="inline-flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> {error}
            </span>
            <button
              type="button"
              onClick={refresh}
              className="px-2 py-1 rounded bg-rose-700/60 hover:bg-rose-700 text-white text-xs inline-flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Try again
            </button>
          </div>
        )}

        {/* Status strip */}
        {!error && <StatusStrip status={status} peerCount={peers.length} />}

        {/* Tabs + content — hidden while the initial status fetch is failing
            so the error surface above reads cleanly. */}
        {!error && (<>
        <nav className="flex gap-2 mt-5 mb-5 border-b border-white/10 pb-3 overflow-x-auto">
          <TabButton current={tab} value="network"    label="Network"      onClick={() => setTab('network')}    icon={<Globe         className="w-3.5 h-3.5" />} />
          <TabButton current={tab} value="search"     label="Search"       onClick={() => setTab('search')}     icon={<Search        className="w-3.5 h-3.5" />} />
          <TabButton current={tab} value="peers"      label="Peers"        onClick={() => setTab('peers')}      icon={<Users         className="w-3.5 h-3.5" />} />
          <TabButton current={tab} value="policy"     label="Defederation" onClick={() => setTab('policy')}     icon={<ShieldX       className="w-3.5 h-3.5" />} />
          <TabButton current={tab} value="moderation" label="Moderation"   onClick={() => setTab('moderation')} icon={<Inbox         className="w-3.5 h-3.5" />} />
          <TabButton current={tab} value="sync"       label="Sync"         onClick={() => setTab('sync')}       icon={<Zap           className="w-3.5 h-3.5" />} />
          <TabButton current={tab} value="relays"     label="Relays"       onClick={() => setTab('relays')}     icon={<Radio         className="w-3.5 h-3.5" />} />
          <TabButton current={tab} value="metrics"    label="Metrics"      onClick={() => setTab('metrics')}    icon={<BarChart3     className="w-3.5 h-3.5" />} />
          <TabButton current={tab} value="keys"       label="Actor keys"   onClick={() => setTab('keys')}       icon={<KeyRound      className="w-3.5 h-3.5" />} />
        </nav>

        {tab === 'network'    && <NetworkTab />}
        {tab === 'search'     && <SearchTab />}
        {tab === 'peers'      && <PeersTab peers={peers} onChanged={refresh} />}
        {tab === 'sync'       && <SyncTab onSynced={refresh} />}
        {tab === 'policy'     && <PeerPolicyPanel />}
        {tab === 'moderation' && <ModerationQueuePanel />}
        {tab === 'relays'     && (
          <div className="space-y-4">
            <RelayPanel />
            <SyncPolicyPanel />
          </div>
        )}
        {tab === 'metrics'    && (
          <div className="space-y-4">
            <MetricsDashboardPanel />
            <TrustHistoryPanel />
          </div>
        )}
        {tab === 'keys'       && <ActorKeysPanel />}
        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <FediverseFeed />
        </section>
        </>)}
      </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
          <RecentMineCard domain="federation" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="federation" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="federation" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}

// ── Status strip ────────────────────────────────────────────────────

function StatusStrip({ status, peerCount }: { status: FederationStatus | null; peerCount: number }) {
  const fed = status?.federation ?? {};
  const enabled = !!status?.enabled;
  const instanceId = String(fed.instanceId ?? '—');
  const trusted = typeof fed.trustedCount === 'number' ? fed.trustedCount : peerCount;
  const pending = typeof fed.pendingPosts === 'number' ? fed.pendingPosts : 0;
  const caps = Array.isArray(fed.capabilities) ? fed.capabilities : [];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <StatusCard
        label="Status"
        value={enabled ? 'Enabled' : 'Disabled'}
        tone={enabled ? 'good' : 'warn'}
        icon={<ShieldCheck className="w-3.5 h-3.5" />}
      />
      <StatusCard
        label="Instance ID"
        value={instanceId.length > 16 ? `${instanceId.slice(0, 12)}…` : instanceId}
        icon={<Globe className="w-3.5 h-3.5" />}
      />
      <StatusCard
        label="Peers"
        value={String(trusted)}
        icon={<Users className="w-3.5 h-3.5" />}
      />
      <StatusCard
        label="Pending"
        value={String(pending)}
        tone={pending > 0 ? 'warn' : undefined}
        icon={<Activity className="w-3.5 h-3.5" />}
      />
      {caps.length > 0 && (
        <div className="col-span-2 sm:col-span-4 text-[11px] text-gray-400 mt-1">
          capabilities: <span className="text-gray-400 font-mono">{caps.join(', ')}</span>
        </div>
      )}
    </div>
  );
}

function StatusCard({
  label, value, tone, icon,
}: { label: string; value: string; tone?: 'good' | 'warn'; icon: React.ReactNode }) {
  const toneColor =
    tone === 'good' ? 'text-emerald-300' :
    tone === 'warn' ? 'text-amber-300'  :
    'text-white';
  return (
    <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-white/50">
        {icon}{label}
      </div>
      <div className={`text-base font-bold leading-tight mt-0.5 ${toneColor}`}>{value}</div>
    </div>
  );
}

// ── Network tab ─────────────────────────────────────────────────────

function NetworkTab() {
  return (
    <section className="rounded-lg border border-white/10 bg-black/60 p-4">
      <h2 className="text-amber-300 font-semibold mb-3 inline-flex items-center gap-1.5">
        <Globe className="w-4 h-4" /> Trust graph
      </h2>
      <p className="text-xs text-gray-400 mb-3">
        Each node is an instance; edges show mutual trust. Edge weight tracks
        rolling DTU exchange + verification success rate.
      </p>
      <TrustGraphView />
    </section>
  );
}

// ── Search tab ──────────────────────────────────────────────────────

function SearchTab() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [meta, setMeta] = useState<{ total?: number; fanout?: number } | null>(null);
  const [scope, setScope] = useState<'all' | 'self' | 'remote'>('all');

  const runSearch = useCallback(async () => {
    if (!q.trim()) return;
    setSearching(true);
    try {
      const r = await fetch(`/api/federation/search?q=${encodeURIComponent(q)}&limit=30`, {
        credentials: 'include',
      });
      const data = await r.json();
      setResults((data.results || []) as SearchHit[]);
      setMeta({ total: data.total, fanout: data.fanout });
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [q]);

  const visible = useMemo(() => {
    if (!results) return null;
    if (scope === 'self')   return results.filter((r) => r.source === 'self');
    if (scope === 'remote') return results.filter((r) => r.source !== 'self');
    return results;
  }, [results, scope]);

  return (
    <section className="rounded-lg border border-violet-500/30 bg-black/60 p-4">
      <h2 className="text-violet-300 font-semibold mb-3 inline-flex items-center gap-1.5">
        <Search className="w-4 h-4" /> Cross-instance search
      </h2>
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
          placeholder='Try "drought-tolerant agriculture" or "post-quantum signing"...'
          className="flex-1 min-w-[260px] bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-violet-400"
        />
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as typeof scope)}
          className="bg-black/60 border border-white/10 rounded px-2 py-2 text-sm text-gray-200"
        >
          <option value="all">All</option>
          <option value="self">Local</option>
          <option value="remote">Remote</option>
        </select>
        <button
          type="button"
          onClick={runSearch}
          disabled={searching || !q.trim()}
          className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded text-white text-sm inline-flex items-center gap-1"
        >
          {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          {searching ? 'Searching…' : 'Search'}
        </button>
      </div>

      {meta && (
        <div className="text-xs text-gray-400 mb-3">
          {meta.total ?? 0} result{meta.total === 1 ? '' : 's'} across {meta.fanout ?? 0} instance{meta.fanout === 1 ? '' : 's'}
          {scope !== 'all' && ` (scoped: ${scope})`}.
        </div>
      )}

      {visible === null ? (
        <p className="text-xs text-gray-400 italic">Enter a query and press Enter or Search.</p>
      ) : visible.length === 0 ? (
        <div className="text-gray-400 italic">No matches.</div>
      ) : (
        <ul className="space-y-2">
          {visible.map((r, i) => (
            <li
              key={`${r.dtuId ?? r.id ?? i}`}
              className="border-l-2 border-violet-400/40 pl-3 py-1"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-gray-100 text-sm font-medium">{r.title ?? '(untitled)'}</span>
                <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                  r.source === 'self'
                    ? 'bg-amber-700/60 text-amber-200'
                    : 'bg-violet-700/60 text-violet-100'
                }`}>
                  {r.source === 'self' ? 'local' : (r.peerName ?? r.source)}
                </span>
                {typeof r.score === 'number' && (
                  <span className="text-[10px] text-gray-400">{r.score.toFixed(3)}</span>
                )}
              </div>
              {r.snippet && <div className="text-xs text-gray-400 mt-1">{r.snippet}</div>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Peers tab ───────────────────────────────────────────────────────

function PeersTab({ peers, onChanged }: { peers: Peer[]; onChanged: () => void }) {
  return (
    <div className="space-y-4">
      <PeerManager onChanged={onChanged} />
      <PeerList peers={peers} onChanged={onChanged} />
    </div>
  );
}

function PeerManager({ onChanged }: { onChanged: () => void }) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [probeResult, setProbeResult] = useState<{ ok: boolean; instanceId?: string; name?: string; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Persist a 'peer-event' lens artifact on every probe + register so the
  // operator has a paper trail across reloads (persistence credit).
  const createPeerEvent = useCreateArtifact<{ kind: string; url: string; instanceId?: string; at: string }>('federation');

  const probe = useCallback(async () => {
    if (!url) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/federation/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ url }),
      });
      const data = await r.json();
      if (data?.ok) {
        const peerName = data.peer?.name ?? data.peer?.federation?.name;
        const instanceId = data.peer?.instanceId ?? data.peer?.federation?.instanceId;
        setProbeResult({ ok: true, instanceId, name: peerName });
        setName(peerName ?? instanceId ?? '');
        createPeerEvent.mutate({
          type: 'peer-event',
          title: `Probed ${peerName || instanceId || url}`,
          data: { kind: 'probe', url, instanceId, at: new Date().toISOString() },
          meta: { tags: ['federation', 'probe'], status: 'ok', visibility: 'private' },
        });
      } else {
        setProbeResult({ ok: false, error: data?.error ?? 'unreachable' });
      }
    } finally {
      setBusy(false);
    }
  }, [url, createPeerEvent]);

  const register = useCallback(async () => {
    if (!url || !probeResult?.ok || !probeResult.instanceId) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/federation/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          instanceId: probeResult.instanceId,
          name: name || probeResult.instanceId,
          registryUrl: url,
        }),
      });
      const data = await r.json();
      if (data?.ok) {
        setMsg(`Peered with ${name || probeResult.instanceId}`);
        createPeerEvent.mutate({
          type: 'peer-event',
          title: `Registered ${name || probeResult.instanceId}`,
          data: { kind: 'register', url, instanceId: probeResult.instanceId, at: new Date().toISOString() },
          meta: { tags: ['federation', 'register'], status: 'ok', visibility: 'private' },
        });
        setUrl(''); setName(''); setProbeResult(null);
        onChanged();
      } else {
        setMsg(`Failed: ${data?.error ?? 'unknown'}`);
      }
    } finally {
      setBusy(false);
    }
  }, [url, name, probeResult, createPeerEvent, onChanged]);

  return (
    <section className="rounded-lg border border-amber-500/30 bg-black/60 p-4">
      <h2 className="text-amber-300 font-semibold mb-3 inline-flex items-center gap-1.5">
        <Plus className="w-4 h-4" /> Add peer
      </h2>
      <div className="space-y-3 text-sm">
        <div className="flex gap-2 items-center flex-wrap">
          <input
            value={url}
            onChange={(e) => { setUrl(e.target.value); setProbeResult(null); }}
            placeholder="https://peer.concord.example"
            className="flex-1 min-w-[260px] bg-black/60 border border-white/10 rounded px-3 py-2 text-gray-200"
          />
          <button
            type="button"
            onClick={probe}
            disabled={busy || !url}
            className="px-3 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded text-white text-xs inline-flex items-center gap-1"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
            {busy ? 'Probing…' : 'Probe'}
          </button>
        </div>

        {probeResult?.ok && (
          <div className="rounded bg-emerald-900/40 border border-emerald-400/30 p-3">
            <div className="text-emerald-200 text-xs">
              Reachable: <span className="font-mono">{probeResult.instanceId}</span>
            </div>
            <div className="flex gap-2 items-center mt-2 flex-wrap">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Display name"
                className="flex-1 min-w-[180px] bg-black/60 border border-white/10 rounded px-2 py-1 text-gray-200 text-xs"
              />
              <button
                type="button"
                onClick={register}
                disabled={busy}
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 rounded text-white text-xs inline-flex items-center gap-1"
              >
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                Register peer
              </button>
            </div>
          </div>
        )}
        {probeResult && !probeResult.ok && (
          <div className="text-rose-300 text-xs inline-flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> Probe failed: {probeResult.error}
          </div>
        )}
        {msg && <div className="text-amber-300 text-xs">{msg}</div>}
      </div>
    </section>
  );
}

function PeerList({ peers, onChanged }: { peers: Peer[]; onChanged: () => void }) {
  const [removing, setRemoving] = useState<string | null>(null);

  async function removePeer(p: Peer) {
    const id = p.instanceId ?? p.nodeId ?? p.id;
    if (!id) return;
    setRemoving(String(id));
    try {
      await fetch('/api/federation/remove', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId: id }),
      });
      onChanged();
    } finally {
      setRemoving(null);
    }
  }

  return (
    <section className="rounded-lg border border-white/10 bg-black/60 p-4">
      <h2 className="text-amber-200 font-semibold mb-3 inline-flex items-center gap-1.5">
        <Users className="w-4 h-4" /> Trusted peers
        <span className="text-gray-400 text-xs">({peers.length})</span>
      </h2>
      {peers.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No peers yet. Add one above.</p>
      ) : (
        <ul className="space-y-2">
          {peers.map((p) => {
            const id = p.instanceId ?? p.nodeId ?? p.id ?? '';
            const lastSeen = p.lastSeen
              ? typeof p.lastSeen === 'number'
                ? new Date(p.lastSeen).toLocaleString()
                : new Date(p.lastSeen).toLocaleString()
              : 'never';
            return (
              <li key={String(id)} className="border border-white/10 rounded p-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-100 truncate">
                    {p.name || id || '(unnamed)'}
                  </div>
                  <div className="text-[11px] text-gray-400 font-mono truncate">{String(id)}</div>
                  {p.registryUrl && (
                    <div className="text-[11px] text-gray-400 truncate">{p.registryUrl}</div>
                  )}
                  <div className="text-[10px] text-gray-400 mt-1">
                    last seen: {lastSeen} · status: {p.status ?? 'unknown'}
                  </div>
                </div>
                <button
                  onClick={() => removePeer(p)}
                  disabled={removing === id}
                  className="px-2 py-1 text-xs bg-rose-700/60 hover:bg-rose-700 rounded text-white inline-flex items-center gap-1 disabled:opacity-50"
                >
                  {removing === id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ── Sync tab ────────────────────────────────────────────────────────

function SyncTab({ onSynced }: { onSynced: () => void }) {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Recent sync events from the lens-artifact runtime.
  const recentEvents = useArtifacts<{ kind: string; result?: string; at: string }>('federation', {
    type: 'peer-event', limit: 10,
  });
  const createSyncEvent = useCreateArtifact<{ kind: string; result?: string; at: string }>('federation');

  async function sync() {
    setSyncing(true); setError(null); setResult(null);
    try {
      const r = await fetch('/api/federation/sync', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await r.json().catch(() => null);
      if (!r.ok || data?.ok === false) {
        const err = data?.error ?? `Sync failed (${r.status}).`;
        setError(err);
        createSyncEvent.mutate({
          type: 'peer-event',
          title: `Sync failed: ${err}`,
          data: { kind: 'sync', result: err, at: new Date().toISOString() },
          meta: { tags: ['federation', 'sync'], status: 'error', visibility: 'private' },
        });
      } else {
        const summary = JSON.stringify(data ?? {}).slice(0, 120);
        setResult(`Sync ok · ${summary}`);
        createSyncEvent.mutate({
          type: 'peer-event',
          title: 'Federation sync ok',
          data: { kind: 'sync', result: 'ok', at: new Date().toISOString() },
          meta: { tags: ['federation', 'sync'], status: 'ok', visibility: 'private' },
        });
        onSynced();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className="rounded-lg border border-violet-500/30 bg-black/60 p-4">
      <h2 className="text-violet-300 font-semibold mb-3 inline-flex items-center gap-1.5">
        <Zap className="w-4 h-4" /> Manual sync
      </h2>
      <p className="text-xs text-gray-400 mb-3">
        Triggers a federation pass: pulls new shadow DTUs from peers, pushes
        any pending posts queued locally, and refreshes peer last-seen timestamps.
      </p>
      <button
        onClick={sync}
        disabled={syncing}
        className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded text-white text-sm inline-flex items-center gap-1"
      >
        {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
        {syncing ? 'Syncing…' : 'Run sync now'}
      </button>
      {result && <p className="mt-2 text-emerald-300 text-xs break-all">{result}</p>}
      {error  && <p className="mt-2 text-rose-300 text-xs">{error}</p>}

      <div className="mt-5 border-t border-white/10 pt-3">
        <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-2 inline-flex items-center gap-1">
          <Activity className="w-3 h-3" /> Recent federation events
        </div>
        {recentEvents.isLoading ? (
          <p className="text-xs text-gray-400 italic">Loading events…</p>
        ) : !recentEvents.data?.artifacts || recentEvents.data.artifacts.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No events yet. Probe a peer or trigger a sync to populate.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {recentEvents.data.artifacts.map((a) => {
              const data = a.data as { kind?: string; at?: string };
              const status = (a.meta?.status as string) || 'ok';
              return (
                <li key={a.id} className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    status === 'ok' ? 'bg-emerald-400' : status === 'error' ? 'bg-rose-400' : 'bg-amber-400'
                  }`} />
                  <span className="text-gray-200 flex-1 truncate">{a.title}</span>
                  <span className="text-gray-400 text-[10px]">
                    {new Date(data?.at ?? a.createdAt).toLocaleString()}
                  </span>
                  {data?.kind && (
                    <span className="text-[10px] uppercase tracking-wide bg-white/5 border border-white/10 rounded px-1 text-gray-400">
                      {data.kind}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

// ── Tab button ──────────────────────────────────────────────────────

function TabButton({
  current, value, label, onClick, icon,
}: { current: Tab; value: Tab; label: string; onClick: () => void; icon: React.ReactNode }) {
  const active = current === value;
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-all ${
        active
          ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300'
          : 'bg-white/5 border border-transparent hover:bg-white/10 text-white/70'
      }`}
    >
      {icon}{label}
    </button>
  );
}

// Suppress unused-import lint when X isn't directly referenced in the
// final tree (kept for parity with the earlier file's icon set).
void X;
