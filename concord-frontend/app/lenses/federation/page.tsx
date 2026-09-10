'use client';

/**
 * Federation — one peer-manager / cross-instance search app.
 * Thin shell + single `active` union. Screens live in components/federation/*.
 */

import { useState, useCallback, useEffect } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
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
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<FedView>('network');
  const [status, setStatus] = useState<FederationStatus | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [loading, setLoading] = useState(false);
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

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, pInst, pTrust] = await Promise.all([
        fetch('/api/federation/status', { credentials: 'include' }).then((r) => r.json()).catch(() => null),
        fetch('/api/federation/instances', { credentials: 'include' }).then((r) => r.json()).catch(() => null),
        fetch('/api/federation/peers', { credentials: 'include' }).then((r) => r.json()).catch(() => null),
      ]);
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
      <DepthBadge lensId="federation" size="sm" className="ml-2" />
      <div data-lens-theme="federation" className={ds.pageContainer}>
        <header className={cn(ds.sectionHeader, 'flex items-start justify-between gap-3 flex-wrap')}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg border border-[var(--lens-accent)]/40 bg-[var(--lens-gradient)]">
              <Network className="w-6 h-6" style={{ color: 'var(--lens-accent)' }} />
            </div>
            <div className="min-w-0">
              <h1 className={ds.heading1}>Federation</h1>
              <p className={ds.textMuted}>
                Concord nodes peer with each other to share knowledge, trust, and DTU lineage.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="text-white/40 hover:text-white text-xs inline-flex items-center gap-1 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Refresh
          </button>
        </header>

        {loading && !loaded && (
          <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-gray-400 mb-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading federation status…
          </div>
        )}

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

        {!error && (
          <>
            <StatusStrip status={status} peerCount={peers.length} />

            <nav
              className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto mt-5"
              aria-label="Federation views"
            >
              {VIEWS.map((v) => {
                const Icon = v.icon;
                const on = active === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setActive(v.id)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
                      on
                        ? 'border-[var(--lens-accent)] text-white'
                        : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600',
                    )}
                    aria-current={on ? 'page' : undefined}
                  >
                    <Icon className="w-4 h-4" />
                    {v.label}
                    <kbd className="hidden sm:inline-block text-[10px] text-white/30 bg-white/5 border border-white/10 rounded px-1 py-0.5 font-mono">
                      {v.keys}
                    </kbd>
                  </button>
                );
              })}
            </nav>

            <AnimatePresence mode="wait">
              <motion.div
                key={active}
                initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
                transition={{ duration: reduceMotion ? 0 : 0.16 }}
                className="pt-4"
              >
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
              </motion.div>
            </AnimatePresence>
          </>
        )}

        <CrossLensRecentsPanel lensId="federation" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
