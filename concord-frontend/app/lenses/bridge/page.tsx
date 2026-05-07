'use client';

import { useState, useEffect, useCallback } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { api } from '@/lib/api/client';
import { motion } from 'framer-motion';
import {
  Network, ArrowLeftRight, Shield, MessageSquare, Skull,
  Baby, Eye, CheckCircle2, XCircle,
  RefreshCw, ChevronDown, ChevronRight, Loader2, Search,
  Users, Zap, Activity, Layers, Radio, GitMerge,
} from 'lucide-react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { DTUDetailView } from '@/components/dtu/DTUDetailView';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Organism {
  id: string; name: string; size: number; isOrganism: boolean;
  persona: { name?: string; personality?: string; objective?: string } | null;
  awakenedAt: string | null; topTags: string[]; lastUpdated: string;
}

interface BridgeLogEntry {
  id: string; action: string; at: string;
  dtuId?: string; swarmName?: string;
  [key: string]: unknown;
}

interface Debate {
  id: string; dtuId: string; challengerRole: string; challenge: string;
  transcript: { speaker: string; content: string }[];
  verdict: string; resolution: string; at: string;
}

interface BirthCert {
  id: string; swarmId: string; swarmName: string; approved: boolean;
  approvalRatio: string; at: string;
  governanceReviews: { role: string; approve: boolean; note: string }[];
  persona: { name?: string } | null;
}

interface EmergentRole {
  role: string;
  capabilities: { canQuery: boolean; canValidate: boolean; canDebate: boolean; canVote: boolean };
}

/* ------------------------------------------------------------------ */
/*  Data Fetching                                                      */
/* ------------------------------------------------------------------ */

async function fetchOrganisms(): Promise<Organism[]> {
  const res = await api.get('/api/bridge/organisms');
  return res?.data?.organisms || [];
}

async function fetchBridgeLog(limit = 50): Promise<BridgeLogEntry[]> {
  const res = await api.get(`/api/bridge/log?limit=${limit}`);
  return res?.data?.log || [];
}

async function fetchDebates(limit = 20): Promise<Debate[]> {
  const res = await api.get(`/api/bridge/debates?limit=${limit}`);
  return res?.data?.debates || [];
}

async function fetchBirths(): Promise<BirthCert[]> {
  const res = await api.get('/api/bridge/births');
  return res?.data?.births || [];
}

async function fetchEmergents(): Promise<EmergentRole[]> {
  const res = await api.get('/api/bridge/emergents');
  return res?.data?.emergents || [];
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

const TABS = ['activity', 'organisms', 'debates', 'lifecycle', 'emergents'] as const;
type Tab = typeof TABS[number];

export default function BridgeLens() {
  useLensNav('bridge');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('bridge');

  const [showFeatures, setShowFeatures] = useState(true);
  const [tab, setTab] = useState<Tab>('activity');
  const [organisms, setOrganisms] = useState<Organism[]>([]);
  const [log, setLog] = useState<BridgeLogEntry[]>([]);
  const [debates, setDebates] = useState<Debate[]>([]);
  const [births, setBirths] = useState<BirthCert[]>([]);
  const [emergents, setEmergents] = useState<EmergentRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedDebate, setExpandedDebate] = useState<string | null>(null);
  const [selectedDtuId, setSelectedDtuId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [org, lg, deb, bir, em] = await Promise.all([
        fetchOrganisms(), fetchBridgeLog(), fetchDebates(), fetchBirths(), fetchEmergents(),
      ]);
      setOrganisms(org); setLog(lg); setDebates(deb); setBirths(bir); setEmergents(em);
    } catch (e) { console.error('Bridge data load failed:', e); }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const tabIcons: Record<Tab, React.ReactNode> = {
    activity: <Activity className="w-4 h-4" />,
    organisms: <Network className="w-4 h-4" />,
    debates: <MessageSquare className="w-4 h-4" />,
    lifecycle: <Baby className="w-4 h-4" />,
    emergents: <Shield className="w-4 h-4" />,
  };

  return (
    <div data-lens-theme="bridge" className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
            <ArrowLeftRight className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Organism Bridge</h1>
            <p className="text-sm text-zinc-500">Emergent ↔ Knowledge Organism Communication</p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="bridge" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>
        <button onClick={refresh} className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors" title="Refresh">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Stat Cards — connected system health overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Organisms', value: organisms.length, icon: <Network className="w-5 h-5 text-purple-400" />, color: 'text-purple-400' },
          { label: 'Bridge Events', value: log.length, icon: <Activity className="w-5 h-5 text-cyan-400" />, color: 'text-cyan-400' },
          { label: 'Debates', value: debates.length, icon: <MessageSquare className="w-5 h-5 text-amber-400" />, color: 'text-amber-400' },
          { label: 'Emergent Roles', value: emergents.length, icon: <Radio className="w-5 h-5 text-green-400" />, color: 'text-green-400' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, duration: 0.35 }}
            className="p-4 bg-zinc-900 rounded-lg border border-zinc-800"
          >
            <div className="flex items-center gap-2 mb-2">{stat.icon}</div>
            <p className={`text-2xl font-bold font-mono ${stat.color}`}>{stat.value}</p>
            <p className="text-xs text-zinc-500">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Data Flow Arrows — unique visual: animated bridge connection indicator */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="mb-6 p-3 bg-zinc-900/60 rounded-lg border border-purple-500/20 flex items-center justify-center gap-4"
      >
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <GitMerge className="w-4 h-4 text-purple-400" />
          <span>Knowledge Organisms</span>
        </div>
        <div className="flex items-center gap-1">
          {[0, 1, 2].map(i => (
            <motion.div
              key={i}
              className="w-2 h-2 rounded-full bg-purple-400"
              animate={{ opacity: [0.2, 1, 0.2], x: [0, 8, 16] }}
              transition={{ duration: 1.5, delay: i * 0.3, repeat: Infinity }}
            />
          ))}
        </div>
        <ArrowLeftRight className="w-4 h-4 text-purple-400" />
        <div className="flex items-center gap-1">
          {[0, 1, 2].map(i => (
            <motion.div
              key={i}
              className="w-2 h-2 rounded-full bg-cyan-400"
              animate={{ opacity: [0.2, 1, 0.2], x: [16, 8, 0] }}
              transition={{ duration: 1.5, delay: i * 0.3, repeat: Infinity }}
            />
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span>Emergent Agents</span>
          <Shield className="w-4 h-4 text-cyan-400" />
        </div>
      </motion.div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-zinc-900 rounded-lg p-1">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-colors ${
              tab === t ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}>
            {tabIcons[t]}
            <span className="capitalize">{t}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-zinc-600" />
        </div>
      ) : (
        <>
          {tab === 'activity' && <ActivityTab log={log} onDtuClick={setSelectedDtuId} />}
          {tab === 'organisms' && <OrganismsTab organisms={organisms} onRefresh={refresh} />}
          {tab === 'debates' && <DebatesTab debates={debates} expanded={expandedDebate} setExpanded={setExpandedDebate} onDtuClick={setSelectedDtuId} />}
          {tab === 'lifecycle' && <LifecycleTab births={births} />}
          {tab === 'emergents' && <EmergentsTab emergents={emergents} />}
        </>
      )}

      <RealtimeDataPanel data={realtimeInsights} />

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Lens Features & Capabilities
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="bridge" />
          </div>
        )}
      </div>

      {/* DTU Detail View modal */}
      {selectedDtuId && (
        <DTUDetailView
          dtuId={selectedDtuId}
          onClose={() => setSelectedDtuId(null)}
          onNavigate={(id) => setSelectedDtuId(id)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function ActivityTab({ log, onDtuClick }: { log: BridgeLogEntry[]; onDtuClick?: (id: string) => void }) {
  if (log.length === 0) return <EmptyCard icon={<Activity />} message="No bridge activity yet" hint="Submit a DTU for validation or query an organism to see activity here." />;

  return (
    <div className="space-y-2">
      {log.slice().reverse().map(entry => (
        <div key={entry.id} className="flex items-start gap-3 p-3 bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="mt-0.5">{actionIcon(entry.action)}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-zinc-200">{formatAction(entry.action)}</span>
              <span className="text-xs text-zinc-600">{new Date(entry.at).toLocaleString()}</span>
            </div>
            {entry.dtuId && <button onClick={() => onDtuClick?.(String(entry.dtuId))} className="text-xs text-neon-cyan hover:underline cursor-pointer">DTU: {String(entry.dtuId).slice(0, 12)}...</button>}
            {entry.swarmName && <span className="text-xs text-purple-400 ml-2">{String(entry.swarmName)}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function OrganismsTab({ organisms, onRefresh: _onRefresh }: { organisms: Organism[]; onRefresh: () => void }) {
  if (organisms.length === 0) return <EmptyCard icon={<Network />} message="No organisms detected" hint="DTU swarms with 10+ members can be awakened as Knowledge Organisms." />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={onRefresh} className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/20 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>
    <div className="grid gap-4 md:grid-cols-2">
      {organisms.map(org => (
        <div key={org.id} className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="flex items-center gap-2 mb-2">
            {org.isOrganism ? <Zap className="w-4 h-4 text-yellow-400" /> : <Network className="w-4 h-4 text-zinc-500" />}
            <h3 className="font-semibold text-sm">{org.persona?.name || org.name}</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full ${org.isOrganism ? 'bg-green-500/20 text-green-400' : 'bg-zinc-700 text-zinc-400'}`}>
              {org.isOrganism ? 'Awakened' : 'Dormant'}
            </span>
          </div>
          <div className="text-xs text-zinc-500 space-y-1">
            <div>{org.size} DTUs in swarm</div>
            {org.topTags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {org.topTags.map(tag => (
                  <span key={tag} className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400">{tag}</span>
                ))}
              </div>
            )}
            {org.persona?.objective && <div className="text-zinc-400 mt-1 italic">{org.persona.objective}</div>}
          </div>
        </div>
      ))}
    </div>
    </div>
  );
}

function DebatesTab({ debates, expanded, setExpanded, onDtuClick }: { debates: Debate[]; expanded: string | null; setExpanded: (id: string | null) => void; onDtuClick?: (id: string) => void }) {
  if (debates.length === 0) return <EmptyCard icon={<MessageSquare />} message="No debates yet" hint="Debates occur when emergent agents challenge organism DTU outputs." />;

  return (
    <div className="space-y-3">
      {debates.slice().reverse().map(debate => (
        <div key={debate.id} className="bg-zinc-900 rounded-lg border border-zinc-800 overflow-hidden">
          <button onClick={() => setExpanded(expanded === debate.id ? null : debate.id)}
            className="w-full flex items-center gap-3 p-4 text-left hover:bg-zinc-800/50 transition-colors">
            {expanded === debate.id ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronRight className="w-4 h-4 text-zinc-500" />}
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium capitalize">{debate.challengerRole}</span>
                <span className="text-zinc-600">challenged</span>
                <button onClick={(e) => { e.stopPropagation(); onDtuClick?.(debate.dtuId); }} className="text-xs text-neon-cyan hover:underline cursor-pointer">{debate.dtuId.slice(0, 12)}...</button>
              </div>
              <div className="text-xs text-zinc-500 mt-0.5">{debate.challenge.slice(0, 100)}</div>
            </div>
            <VerdictBadge verdict={debate.verdict} />
          </button>
          {expanded === debate.id && (
            <div className="px-4 pb-4 space-y-2 border-t border-zinc-800 pt-3">
              {debate.transcript.map((turn, i) => (
                <div key={i} className="flex gap-2 text-sm">
                  <span className="font-medium text-zinc-400 capitalize min-w-[80px]">{turn.speaker}:</span>
                  <span className="text-zinc-300">{turn.content}</span>
                </div>
              ))}
              {debate.resolution && (
                <div className="mt-2 p-2 bg-zinc-800 rounded text-xs text-zinc-400">
                  Resolution: {debate.resolution}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function LifecycleTab({ births }: { births: BirthCert[] }) {
  if (births.length === 0) return <EmptyCard icon={<Baby />} message="No organism lifecycle events" hint="When a DTU swarm crosses the awakening threshold, a birth ceremony convenes all nine emergent agents." />;

  return (
    <div className="space-y-3">
      {births.slice().reverse().map(cert => (
        <div key={cert.id} className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="flex items-center gap-2 mb-3">
            {cert.approved ? <CheckCircle2 className="w-5 h-5 text-green-400" /> : <XCircle className="w-5 h-5 text-red-400" />}
            <h3 className="font-semibold text-sm">{cert.swarmName}</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full ${cert.approved ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
              {cert.approved ? 'Approved' : 'Denied'} — {cert.approvalRatio}
            </span>
            <span className="text-xs text-zinc-600 ml-auto">{new Date(cert.at).toLocaleDateString()}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {cert.governanceReviews.map((review, i) => (
              <div key={i} className="p-2 bg-zinc-800 rounded text-xs">
                <div className="flex items-center gap-1">
                  {review.approve ? <CheckCircle2 className="w-3 h-3 text-green-400" /> : <XCircle className="w-3 h-3 text-red-400" />}
                  <span className="font-medium capitalize">{review.role}</span>
                </div>
                <div className="text-zinc-500 mt-1 line-clamp-2">{review.note}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmergentsTab({ emergents }: { emergents: EmergentRole[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {emergents.map(em => (
        <div key={em.role} className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-blue-400" />
            <h3 className="font-semibold text-sm capitalize">{em.role}</h3>
          </div>
          <div className="flex flex-wrap gap-1">
            {em.capabilities.canQuery && <span className="text-xs px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded">Query</span>}
            {em.capabilities.canValidate && <span className="text-xs px-1.5 py-0.5 bg-green-500/20 text-green-400 rounded">Validate</span>}
            {em.capabilities.canDebate && <span className="text-xs px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded">Debate</span>}
            {em.capabilities.canVote && <span className="text-xs px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded">Vote</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function EmptyCard({ icon, message, hint }: { icon: React.ReactNode; message: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-center">
      <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mb-4 text-zinc-500">{icon}</div>
      <p className="text-zinc-400 font-medium">{message}</p>
      <p className="text-sm text-zinc-600 mt-1 max-w-md">{hint}</p>
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const colors: Record<string, string> = {
    accept: 'bg-green-500/20 text-green-400',
    modify: 'bg-amber-500/20 text-amber-400',
    quarantine: 'bg-red-500/20 text-red-400',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${colors[verdict] || 'bg-zinc-700 text-zinc-400'}`}>
      {verdict}
    </span>
  );
}

function actionIcon(action: string) {
  if (action.includes('debate')) return <MessageSquare className="w-4 h-4 text-amber-400" />;
  if (action.includes('birth') || action.includes('awaken')) return <Baby className="w-4 h-4 text-green-400" />;
  if (action.includes('death') || action.includes('dormant')) return <Skull className="w-4 h-4 text-red-400" />;
  if (action.includes('validation') || action.includes('submit')) return <Shield className="w-4 h-4 text-blue-400" />;
  if (action.includes('query') || action.includes('response')) return <Search className="w-4 h-4 text-purple-400" />;
  return <Eye className="w-4 h-4 text-zinc-500" />;
}

function formatAction(action: string): string {
  return action.replace(/\./g, ' → ').replace(/_/g, ' ');
}
