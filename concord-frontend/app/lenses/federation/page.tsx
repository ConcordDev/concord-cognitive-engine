'use client';

/**
 * Federation — one peer-manager / cross-instance search app.
 * Thin shell + single `active` union. Screens live in components/federation/*.
 */

import { useState, useCallback, useEffect } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import {
  Network, Search, Users, RefreshCw, Loader2, AlertCircle, Zap,
  Globe, ShieldX, Inbox, Radio, BarChart3, KeyRound, Share2,
} from 'lucide-react';

import { StatusStrip, type FederationStatus } from '@/components/federation/StatusStrip';
import { NetworkPanel } from '@/components/federation/NetworkPanel';
import { SearchPanel } from '@/components/federation/SearchPanel';
import { PeersPanel, type Peer } from '@/components/federation/PeersPanel';
import { SyncPanel } from '@/components/federation/SyncPanel';
import { PeerPolicyPanel } from '@/components/federation/PeerPolicyPanel';
import { ModerationQueuePanel } from '@/components/federation/ModerationQueuePanel';
import { RelaysHubPanel } from '@/components/federation/RelaysHubPanel';
import { MetricsHubPanel } from '@/components/federation/MetricsHubPanel';
import { ActorKeysPanel } from '@/components/federation/ActorKeysPanel';
import { FediverseHubPanel } from '@/components/federation/FediverseHubPanel';

type FedView =
  | 'network' | 'search' | 'peers' | 'sync'
  | 'moderation' | 'policy' | 'relays' | 'metrics' | 'keys' | 'fediverse';

const VIEWS: { id: FedView; label: string; keys: string; icon: typeof Network }[] = [
  { id: 'network', label: 'Network', keys: 'n', icon: Globe },
  { id: 'search', label: 'Search', keys: 's', icon: Search },
  { id: 'peers', label: 'Peers', keys: 'p', icon: Users },
  { id: 'policy', label: 'Defederation', keys: 'b', icon: ShieldX },
  { id: 'moderation', label: 'Moderation', keys: 'm', icon: Inbox },
  { id: 'sync', label: 'Sync', keys: 'y', icon: Zap },
  { id: 'relays', label: 'Relays', keys: 'r', icon: Radio },
  { id: 'metrics', label: 'Metrics', keys: 'd', icon: BarChart3 },
  { id: 'keys', label: 'Actor keys', keys: 'k', icon: KeyRound },
  { id: 'fediverse', label: 'Fediverse', keys: 'f', icon: Share2 },
];

export default function FederationPage() {
  useLensNav('federation');
  const [active, setActive] = useState<FedView>('network');
  const [status, setStatus] = useState<FederationStatus | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useLensCommand(
    VIEWS.map((v) => ({
      id: `tab-${v.id}`,
      keys: v.keys,
      description: v.label,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'federation' },
  );

  const [reloadKey, setReloadKey] = useState(0);
  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/api/federation/status', { credentials: 'include' }).then((r) => r.json()).catch(() => null),
      fetch('/api/federation/instances', { credentials: 'include' }).then((r) => r.json()).catch(() => null),
      fetch('/api/federation/peers', { credentials: 'include' }).then((r) => r.json()).catch(() => null),
    ])
      .then(([s, pInst, pTrust]) => {
        if (cancelled) return;
        if (s == null) {
          setError('Federation service unreachable. Check the node is up and try again.');
          setStatus(null);
          setPeers([]);
          return;
        }
        setStatus(s as FederationStatus | null);
        const all: Peer[] = [];
        if (Array.isArray(pInst?.peers)) all.push(...(pInst.peers as Peer[]));
        if (Array.isArray(pTrust?.peers)) all.push(...(pTrust.peers as Peer[]));
        const seen = new Set<string>();
        setPeers(all.filter((p) => {
          const k = (p.instanceId ?? p.nodeId ?? p.id ?? '') as string;
          if (!k || seen.has(k)) return false;
          seen.add(k);
          return true;
        }));
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load federation status.');
      })
      .finally(() => {
        if (!cancelled) { setLoading(false); setLoaded(true); }
      });
    return () => { cancelled = true; };
  }, [reloadKey]);


  return (
    <LensShell lensId="federation" asMain={false}>

      <DepthBadge lensId="federation" size="sm" className="ml-2" />
      <div data-lens-theme="federation">
        <NorthStarFrame
          lensId="federation"
          crumb="Network"
          subtitle="Concord nodes peer with each other to share knowledge, trust, and DTU lineage."
          tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon, keys: v.keys }))}
          activeTab={active}
          onTab={(id) => setActive(id as FedView)}
          tabsLabel="Federation views"
          cta={{
            label: loading ? 'Refreshing…' : 'Refresh network',
            icon: loading ? Loader2 : RefreshCw,
            onClick: () => void refresh(),
            disabled: loading,
            title: 'Re-check status and peers',
          }}
        >
          {loading && !loaded && (
            <div role="status" aria-live="polite" className="mb-3 flex items-center gap-2 text-sm text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading federation status…
            </div>
          )}

          {error && !loading && (
            <div
              role="alert"
              className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-500/40 bg-rose-950/40 px-4 py-3 text-sm text-rose-200"
            >
              <span className="inline-flex items-center gap-2">
                <AlertCircle className="h-4 w-4" /> {error}
              </span>
              <button
                type="button"
                onClick={refresh}
                className="inline-flex items-center gap-1 rounded bg-rose-700/60 px-2 py-1 text-xs text-white hover:bg-rose-700"
              >
                <RefreshCw className="h-3 w-3" /> Try again
              </button>
            </div>
          )}

          {!error && (
            <div className="space-y-5">
              <StatusStrip status={status} peerCount={peers.length} />
              {active === 'network' && <NetworkPanel />}
              {active === 'search' && <SearchPanel />}
              {active === 'peers' && <PeersPanel peers={peers} onChanged={refresh} />}
              {active === 'sync' && <SyncPanel onSynced={refresh} />}
              {active === 'policy' && <PeerPolicyPanel />}
              {active === 'moderation' && <ModerationQueuePanel />}
              {active === 'relays' && <RelaysHubPanel />}
              {active === 'metrics' && <MetricsHubPanel />}
              {active === 'keys' && <ActorKeysPanel />}
              {active === 'fediverse' && <FediverseHubPanel />}
            </div>
          )}
        </NorthStarFrame>
      </div>
    </LensShell>
  );
}
