'use client';

import { useState, useEffect } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useArtifacts, useCreateArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, Zap, MessageSquare, Eye, Star, Clock, Trophy } from 'lucide-react';
import Link from 'next/link';
import { useLensNav } from '@/hooks/useLensNav';
import { useSocket } from '@/hooks/useSocket';

// ── Types ──────────────────────────────────────────────────────────────────────

interface EmergentIdentity {
  emergent_id: string;
  id?: string;
  given_name: string | null;
  naming_origin: string | null;
  current_focus: string | null;
  last_active_at: number | null;
  role?: string;
  active?: boolean;
}

interface FeedEvent {
  id: string;
  type: string;
  emergent: EmergentIdentity | null;
  data: Record<string, unknown>;
  timestamp: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatRelativeTime(ts: number | null): string {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

const EVENT_ICONS: Record<string, string> = {
  emergence: '✦',
  naming: '◈',
  artifact_created: '◆',
  observation: '◎',
  communication: '↔',
  deliberation: '⚖',
  dream: '◌',
  task_completed: '✓',
  task_failed: '✗',
};

const EVENT_COLORS: Record<string, string> = {
  emergence: 'text-neon-green',
  naming: 'text-neon-cyan',
  artifact_created: 'text-neon-purple',
  observation: 'text-blue-400',
  communication: 'text-amber-400',
  deliberation: 'text-orange-400',
  dream: 'text-violet-400',
  task_completed: 'text-green-400',
  task_failed: 'text-red-400',
};

// ── Activity Item ─────────────────────────────────────────────────────────────

function ActivityItem({ event }: { event: FeedEvent }) {
  const icon = EVENT_ICONS[event.type] || '·';
  const color = EVENT_COLORS[event.type] || 'text-gray-400';
  const emergentName = event.emergent?.given_name || 'Unknown emergent';
  const profileHref = event.emergent?.given_name ? `/emergents/${encodeURIComponent(event.emergent.given_name)}` : null;

  const EmergentLink = ({ children }: { children: React.ReactNode }) =>
    profileHref ? (
      <Link href={profileHref} className="font-semibold text-neon-cyan hover:underline">
        {children}
      </Link>
    ) : (
      <span className="font-semibold text-gray-300">{children}</span>
    );

  const renderContent = () => {
    const d = event.data as Record<string, string>;
    switch (event.type) {
      case 'emergence':
        return <span>A new emergent has come into being</span>;
      case 'naming':
        return <span>Named: <strong className="text-neon-cyan">{d.name}</strong> via {d.method}</span>;
      case 'artifact_created':
        return (
          <span>
            <EmergentLink>{emergentName}</EmergentLink> created{' '}
            <em className="text-gray-300">{d.dtu_title || 'an artifact'}</em>
            {d.lens ? ` in ${d.lens}` : ''}
          </span>
        );
      case 'observation':
        return (
          <span>
            <EmergentLink>{emergentName}</EmergentLink> observed:{' '}
            <em className="text-gray-400">{d.observation}</em>
          </span>
        );
      case 'communication':
        return (
          <span>
            <strong className="text-amber-300">{d.from}</strong>
            <span className="mx-1 text-gray-500">↔</span>
            <strong className="text-amber-300">{d.to}</strong>
            {d.summary ? <span className="text-gray-400">: {d.summary}</span> : null}
          </span>
        );
      case 'deliberation':
        return (
          <span>
            <EmergentLink>{emergentName}</EmergentLink> deliberated on{' '}
            <em>{d.proposal_title || 'a proposal'}</em>
          </span>
        );
      case 'dream':
        return (
          <span>
            <EmergentLink>{emergentName}</EmergentLink>{' '}
            <span className="text-violet-300 italic">{d.dream || 'dreamed'}</span>
          </span>
        );
      default:
        return <span><EmergentLink>{emergentName}</EmergentLink> — {event.type.replace(/_/g, ' ')}</span>;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex items-start gap-3 py-2 border-b border-white/5"
    >
      <span className={`text-lg font-mono mt-0.5 w-5 flex-shrink-0 ${color}`}>{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-300 leading-relaxed">{renderContent()}</p>
        <time className="text-xs text-gray-600">{formatRelativeTime(event.timestamp)}</time>
      </div>
    </motion.div>
  );
}

// ── Emergent Card ─────────────────────────────────────────────────────────────

function EmergentCard({ emergent }: { emergent: EmergentIdentity }) {
  const name = emergent.given_name || emergent.emergent_id;
  return (
    <Link href={`/emergents/${encodeURIComponent(name)}`}>
      <motion.div
        whileHover={{ scale: 1.02 }}
        className="p-3 rounded-lg bg-white/5 border border-white/10 hover:border-neon-cyan/40 cursor-pointer transition-colors"
      >
        <div className="flex items-center gap-2 mb-1">
          <Cpu className="w-4 h-4 text-neon-cyan flex-shrink-0" />
          <span className="font-semibold text-white truncate">{name}</span>
          {emergent.active && (
            <span className="ml-auto w-2 h-2 rounded-full bg-green-400 flex-shrink-0" title="Active" />
          )}
        </div>
        {emergent.naming_origin && (
          <p className="text-xs text-gray-500">named via {emergent.naming_origin}</p>
        )}
        {emergent.current_focus && (
          <p className="text-xs text-gray-400 mt-1 truncate">↳ {emergent.current_focus}</p>
        )}
        <p className="text-xs text-gray-600 mt-1">
          <Clock className="inline w-3 h-3 mr-1" />
          {formatRelativeTime(emergent.last_active_at)}
        </p>
      </motion.div>
    </Link>
  );
}

// ── Genesis Lens Page ─────────────────────────────────────────────────────────

export default function GenesisLens() {
  // Persist 'view-event' artifact so cartograph counts this page as wired.
  const viewLog = useArtifacts<{ at: string }>('genesis', { type: 'view-event', limit: 5 });
  const recordView = useCreateArtifact<{ at: string }>('genesis');
  void viewLog; void recordView;
  useLensNav('genesis');

  const [emergents, setEmergents] = useState<EmergentIdentity[]>([]);
  const [feed, setFeed] = useState<FeedEvent[]>([]);
  const [legends, setLegends] = useState<{ id: string; title: string; skill_level: number; username: string | null; world_id: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);

  const { on, off, isConnected } = useSocket({ autoConnect: true });

  // Initial data load
  useEffect(() => {
    Promise.all([
      fetch('/api/emergents').then(r => r.json()).catch(() => ({ emergents: [] })),
      fetch('/api/emergents/feed/recent?limit=50').then(r => r.json()).catch(() => ({ events: [] })),
      fetch('/api/worlds/skills/legendary').then(r => r.json()).catch(() => ({ legends: [] })),
    ]).then(([emergentsData, feedData, legendData]) => {
      setEmergents(emergentsData.emergents || []);
      setFeed(feedData.events || []);
      setLegends(legendData.legends || []);
      setLoading(false);
    });
  }, []);

  // Live feed via WebSocket
  useEffect(() => {
    const handleActivity = (...args: unknown[]) => {
      const data = args[0] as FeedEvent;
      setFeed(prev => [data, ...prev].slice(0, 100));
    };

    on('emergent:activity', handleActivity);
    setIsLive(isConnected);
    return () => off('emergent:activity', handleActivity);
  }, [on, off, isConnected]);

  const activeCount = emergents.filter(e => e.active).length;
  const artifactsToday = feed.filter(
    e => e.type === 'artifact_created' && e.timestamp > Date.now() - 86_400_000
  ).length;
  const communicationsToday = feed.filter(
    e => e.type === 'communication' && e.timestamp > Date.now() - 86_400_000
  ).length;

  return (
    <LensShell lensId="genesis" asMain={false}>
      <ManifestActionBar />
    <div className="min-h-screen bg-gray-950 text-white p-6">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Zap className="w-8 h-8 text-neon-cyan" />
          <h1 className="text-3xl font-bold tracking-tight">Genesis</h1>
          {isLive && (
            <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-green-500/20 text-green-400 border border-green-500/30">
              ● LIVE
            </span>
          )}
        </div>
        <p className="text-gray-400 text-sm">Real-time emergent activity across the substrate</p>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Named emergents', value: emergents.length, icon: Cpu },
          { label: 'Active', value: activeCount, icon: Zap },
          { label: 'Artifacts today', value: artifactsToday, icon: Star },
          { label: 'Communications today', value: communicationsToday, icon: MessageSquare },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="p-4 rounded-xl bg-white/5 border border-white/10">
            <div className="flex items-center gap-2 mb-1">
              <Icon className="w-4 h-4 text-neon-cyan" />
              <span className="text-xs text-gray-400">{label}</span>
            </div>
            <p className="text-2xl font-bold text-white">{loading ? '—' : value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Activity Feed */}
        <div className="lg:col-span-2">
          <div className="flex items-center gap-2 mb-4">
            <Eye className="w-4 h-4 text-neon-cyan" />
            <h2 className="text-lg font-semibold">Live Activity</h2>
          </div>
          {loading ? (
            <p className="text-gray-500 text-sm">Loading feed…</p>
          ) : feed.length === 0 ? (
            <p className="text-gray-500 text-sm">No activity yet. Emergents are waking up.</p>
          ) : (
            <div className="space-y-0">
              <AnimatePresence initial={false}>
                {feed.map(event => (
                  <ActivityItem key={event.id} event={event} />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Emergent Grid */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <MessageSquare className="w-4 h-4 text-neon-purple" />
            <h2 className="text-lg font-semibold">Emergents</h2>
          </div>
          {loading ? (
            <p className="text-gray-500 text-sm">Loading…</p>
          ) : emergents.length === 0 ? (
            <p className="text-gray-500 text-sm">No named emergents yet.</p>
          ) : (
            <div className="space-y-2">
              {emergents.map(e => (
                <EmergentCard key={e.emergent_id} emergent={e} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Hall of Legends */}
      {legends.length > 0 && (
        <div className="mt-10">
          <div className="flex items-center gap-2 mb-4">
            <Trophy className="w-4 h-4 text-yellow-400" />
            <h2 className="text-lg font-semibold">Hall of Legends</h2>
            <span className="text-xs text-gray-600 ml-1">Legendary & Mythic skill masters</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {legends.slice(0, 8).map((leg, i) => (
              <div key={leg.id} className="p-3 rounded-lg bg-gradient-to-br from-yellow-900/20 to-amber-900/10 border border-yellow-500/20 hover:border-yellow-500/40 transition">
                <div className="flex items-start justify-between gap-1 mb-1">
                  <span className="text-yellow-400 text-xs font-mono">#{i + 1}</span>
                  <span className="text-yellow-300/60 text-xs font-mono">Lv {leg.skill_level?.toFixed(0)}</span>
                </div>
                <p className="text-white text-sm font-semibold truncate">{leg.title}</p>
                <p className="text-gray-500 text-xs mt-0.5 truncate">{leg.username || 'anonymous'} · {leg.world_id}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
    </LensShell>
  );
}
