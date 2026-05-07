'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers, api } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { useState, useEffect, useCallback } from 'react';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useLensBridge } from '@/lib/hooks/use-lens-bridge';
import { useRouter } from 'next/navigation';
import {
  Shield, Activity, Brain, Layers, Puzzle, Cpu, Users, Settings,
  AlertTriangle, Moon, FileText, Pause, Play,
  Save, Trash2, XCircle, Loader2, Clock, ArrowUp,
  Zap, Send, MapPin, Focus, ShieldAlert, ChevronDown,
  Lightbulb, GitBranch, Globe, Undo2, Compass, Radio,
} from 'lucide-react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import FoundationCard from '@/components/chat/FoundationCard';
import { ActionPreviewModal } from '@/components/guidance/ActionPreviewModal';
import { ActivityFeed } from '@/components/guidance/ActivityFeed';
import { UndoTimeline } from '@/components/guidance/UndoTimeline';
import { SystemGuidePanel } from '@/components/guidance/SystemGuidePanel';

// ── Types ───────────────────────────────────────────────────────────────────

interface SystemHealth {
  ok: boolean;
  system?: { version: string; uptime: { seconds: number; formatted: string }; memory: { heapUsed: string; heapTotal: string; rss: string } };
  dtus?: { total: number; regular: number; mega: number; hyper: number; shadow: number };
  llm?: { ollamaReady: boolean; ollamaEnabled: boolean };
  [key: string]: unknown;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: 'green' | 'yellow' | 'red' | 'gray' }) {
  const colors = { green: 'bg-green-400', yellow: 'bg-yellow-400', red: 'bg-red-400', gray: 'bg-gray-500' };
  return (
    <span className="relative inline-flex">
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${colors[status]}`} />
      {status === 'green' && <span className="absolute inset-0 rounded-full bg-green-400 animate-ping opacity-30" />}
      {status === 'red' && <span className="absolute inset-0 rounded-full bg-red-400 animate-ping opacity-30" />}
    </span>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: React.ReactNode }) {
  return (
    <div className="bg-[#0d1219] rounded-xl p-3 border border-cyan-900/15 shadow-sm hover:border-cyan-800/25 transition-colors">
      <p className="text-lg font-mono font-bold text-cyan-50">{value}</p>
      <p className="text-xs text-cyan-500/50">{label}</p>
      {sub && <p className="text-[10px] text-cyan-700/40 mt-0.5">{sub}</p>}
    </div>
  );
}

function BreakerBadge({ name, state }: { name: string; state: string }) {
  const color = state === 'closed' ? 'green' : state === 'half-open' ? 'yellow' : 'red';
  return (
    <div className="flex items-center gap-2 text-xs">
      <StatusDot status={color} />
      <span className="text-gray-300 capitalize">{name}</span>
      <span className="text-gray-500 ml-auto">{state}</span>
    </div>
  );
}

function ConfirmButton({ label, icon: Icon, color, onConfirm, description }: {
  label: string; icon: React.ElementType; color: 'red' | 'green' | 'yellow';
  onConfirm: () => void; description: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const colorClass = color === 'red' ? 'bg-red-600 hover:bg-red-500' : color === 'green' ? 'bg-green-600 hover:bg-green-500' : 'bg-yellow-600 hover:bg-yellow-500';

  if (confirming) {
    return (
      <div className="bg-lattice-elevated border border-lattice-border rounded-lg p-3 space-y-2">
        <p className="text-xs text-gray-300">{description}</p>
        <div className="flex gap-2">
          <button onClick={() => { onConfirm(); setConfirming(false); }} className={`px-3 py-1.5 text-xs rounded ${colorClass} text-white`}>Confirm</button>
          <button onClick={() => setConfirming(false)} className="px-3 py-1.5 text-xs rounded bg-gray-700 text-gray-300">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <button onClick={() => setConfirming(true)} className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-white ${colorClass} transition-colors`}>
      <Icon className="w-4 h-4" /> {label}
    </button>
  );
}

// ── Panels ──────────────────────────────────────────────────────────────────

function VitalsPanel() {
  const { data: health } = useQuery({ queryKey: ['cc-health'], queryFn: () => apiHelpers.guidance.health().then(r => r.data), refetchInterval: 15000 });
  const { data: queue } = useQuery({ queryKey: ['cc-queue'], queryFn: () => apiHelpers.backpressure.status().then(r => r.data), refetchInterval: 15000 });
  const { data: breakers } = useQuery({ queryKey: ['cc-breakers'], queryFn: () => apiHelpers.status.get().then(r => r.data), refetchInterval: 15000 });
  const { data: traces } = useQuery({ queryKey: ['cc-traces'], queryFn: () => apiHelpers.perf.metrics().then(r => r.data), refetchInterval: 15000 });
  const { data: shadowData } = useQuery({ queryKey: ['cc-shadow-pending'], queryFn: () => api.get('/api/dtus/shadow/pending').then(r => r.data).catch(() => null), refetchInterval: 60000 });
  const { data: scopeMetrics } = useQuery({ queryKey: ['cc-scope-metrics'], queryFn: () => apiHelpers.scope.metrics().then(r => r.data).catch(() => null), refetchInterval: 30000 });

  const h = health as SystemHealth | undefined;
  const shadowCandidateCount = (shadowData?.candidates?.length || 0) + (shadowData?.pendingShadows?.length || 0);

  const scopeGlobal = scopeMetrics?.globalCount ?? 0;
  const scopeMarketplace = scopeMetrics?.marketplaceCount ?? 0;
  const scopeLocal = scopeMetrics?.localCount ?? 0;
  const scopeTotal = scopeGlobal + scopeMarketplace + scopeLocal;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">System Vitals</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Stat label="Uptime" value={h?.system?.uptime?.formatted || '—'} />
        <Stat label="Memory" value={h?.system?.memory?.heapUsed || '—'} sub={`of ${h?.system?.memory?.heapTotal || '?'}`} />
        <Stat label="Total DTUs" value={h?.dtus?.total ?? '—'} sub={`${h?.dtus?.shadow || 0} shadows`} />
        <Stat label="Queue Depth" value={queue?.depth ?? '—'} sub={`${queue?.processing ?? 0} active`} />
        <Stat label="p50 Latency" value={traces?.p50 ? `${traces.p50}ms` : '—'} />
        <Stat label="p99 Latency" value={traces?.p99 ? `${traces.p99}ms` : '—'} />
      </div>

      {/* Scope Distribution */}
      {scopeTotal > 0 && (
        <div className="bg-lattice-deep rounded-lg p-3 border border-lattice-border space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-400 uppercase">Scope Distribution</p>
            <span className="text-[10px] text-gray-500">{scopeTotal} scoped</span>
          </div>
          <div className="h-3 rounded-full overflow-hidden flex bg-lattice-surface">
            {scopeGlobal > 0 && (
              <div className="bg-amber-500 h-full" style={{ width: `${(scopeGlobal / scopeTotal) * 100}%` }} title={`Global: ${scopeGlobal}`} />
            )}
            {scopeMarketplace > 0 && (
              <div className="bg-blue-500 h-full" style={{ width: `${(scopeMarketplace / scopeTotal) * 100}%` }} title={`Marketplace: ${scopeMarketplace}`} />
            )}
            {scopeLocal > 0 && (
              <div className="bg-gray-500 h-full" style={{ width: `${(scopeLocal / scopeTotal) * 100}%` }} title={`Local: ${scopeLocal}`} />
            )}
          </div>
          <div className="flex items-center gap-4 text-[10px] text-gray-400">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Global {scopeGlobal}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> Marketplace {scopeMarketplace}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-500 inline-block" /> Local {scopeLocal}</span>
          </div>
        </div>
      )}

      {/* Shadow DTU pending review indicator */}
      {shadowCandidateCount > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-500/10 border border-purple-500/20 text-xs text-purple-300">
          <ArrowUp className="w-3.5 h-3.5" />
          <span className="font-medium">{shadowCandidateCount} shadow DTU{shadowCandidateCount !== 1 ? 's' : ''} pending review</span>
          <span className="text-purple-500 ml-auto">See Promotions tab</span>
        </div>
      )}
      {breakers?.breakers && (
        <div className="bg-lattice-deep rounded-lg p-3 space-y-2 border border-lattice-border">
          <p className="text-xs font-semibold text-gray-400 uppercase">Circuit Breakers</p>
          {Object.entries(breakers.breakers as Record<string, { state: string }>).map(([name, b]) => (
            <BreakerBadge key={name} name={name} state={b.state || 'unknown'} />
          ))}
        </div>
      )}
    </div>
  );
}

const DISTRICT_META: Record<string, { label: string; color: string; icon: string }> = {
  commons: { label: 'The Commons', color: 'text-blue-400', icon: 'cross-domain dialogue' },
  observatory: { label: 'The Observatory', color: 'text-cyan-400', icon: 'external data' },
  forge: { label: 'The Forge', color: 'text-orange-400', icon: 'plugin creation' },
  archive: { label: 'The Archive', color: 'text-amber-400', icon: 'first principles' },
  garden: { label: 'The Garden', color: 'text-green-400', icon: 'shadow patterns' },
  gate: { label: 'The Gate', color: 'text-red-400', icon: 'governance' },
  nursery: { label: 'The Nursery', color: 'text-purple-400', icon: 'emergence' },
};

function EmergentPanel() {
  const { data } = useQuery({ queryKey: ['cc-emergents'], queryFn: () => apiHelpers.macros.run('emergent.list').then(r => r.data).catch((err) => { console.error('Failed to fetch emergents:', err instanceof Error ? err.message : err); return { emergents: [] }; }), refetchInterval: 30000 });
  const { data: censusData } = useQuery({ queryKey: ['cc-census'], queryFn: () => apiHelpers.macros.run('emergent.district.census').then(r => r.data).catch((err) => { console.error('Failed to fetch census:', err instanceof Error ? err.message : err); return { census: {} }; }), refetchInterval: 30000 });

  const emergents = (data?.emergents || []) as Array<{ id: string; name: string; role: string; district?: string; instanceScope?: string; active: boolean; createdAt: string }>;
  const census = (censusData?.census || {}) as Record<string, Array<{ id: string; name: string; role: string }>>;
  const global = emergents.filter(e => (e.instanceScope || 'local') === 'global');
  const local = emergents.filter(e => (e.instanceScope || 'local') === 'local');

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Emergent Manager</h3>

      {/* District Map */}
      <div className="space-y-2">
        <p className="text-xs text-gray-400 flex items-center gap-1"><MapPin className="w-3 h-3" /> District Map</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {Object.entries(DISTRICT_META).map(([id, meta]) => {
            const residents = census[id] || [];
            return (
              <div key={id} className="bg-lattice-surface rounded-lg p-2 border border-lattice-border">
                <p className={`text-xs font-semibold ${meta.color}`}>{meta.label}</p>
                <p className="text-[10px] text-gray-600">{meta.icon}</p>
                <p className="text-lg font-mono font-bold text-white mt-1">{residents.length}</p>
                {residents.slice(0, 3).map(r => (
                  <p key={r.id} className="text-[10px] text-gray-400 truncate">{r.name}</p>
                ))}
                {residents.length > 3 && <p className="text-[10px] text-gray-600">+{residents.length - 3} more</p>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Global Emergents */}
      {global.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-neon-cyan font-semibold">Global ({global.length})</p>
          {global.map(e => (
            <div key={e.id} className="flex items-center gap-2 bg-lattice-surface rounded p-2 border border-lattice-border text-sm">
              <StatusDot status={e.active ? 'green' : 'gray'} />
              <span className="text-white font-medium flex-1 truncate">{e.name}</span>
              <span className={`text-[10px] ${DISTRICT_META[e.district || 'commons']?.color || 'text-gray-500'}`}>{DISTRICT_META[e.district || 'commons']?.label || e.district}</span>
              <span className="text-xs text-gray-500">{e.role}</span>
            </div>
          ))}
        </div>
      )}

      {/* Local Emergents */}
      <div className="space-y-2">
        <p className="text-xs text-neon-purple font-semibold">Local ({local.length})</p>
        {local.slice(0, 20).map(e => (
          <div key={e.id} className="flex items-center gap-2 bg-lattice-surface rounded p-2 border border-lattice-border text-sm">
            <StatusDot status={e.active ? 'green' : 'gray'} />
            <span className="text-white font-medium flex-1 truncate">{e.name}</span>
            <span className={`text-[10px] ${DISTRICT_META[e.district || 'commons']?.color || 'text-gray-500'}`}>{DISTRICT_META[e.district || 'commons']?.label || e.district}</span>
            <span className="text-xs text-gray-500">{e.role}</span>
          </div>
        ))}
        {local.length > 20 && <p className="text-xs text-gray-500">+ {local.length - 20} more</p>}
      </div>
    </div>
  );
}

function LatticePanel() {
  const { data: meta } = useQuery({ queryKey: ['cc-meta'], queryFn: () => apiHelpers.emergent.status().then(r => r.data), refetchInterval: 30000 });
  const { data: convergences } = useQuery({ queryKey: ['cc-convergences'], queryFn: () => apiHelpers.emergent.resonance().then(r => r.data), refetchInterval: 60000 });
  const { data: pending } = useQuery({ queryKey: ['cc-predictions'], queryFn: () => apiHelpers.metacognition.calibration().then(r => r.data), refetchInterval: 60000 });
  const qc = useQueryClient();
  const triggerMutation = useMutation({ mutationFn: () => apiHelpers.bridge.heartbeatTick(), onSuccess: () => qc.invalidateQueries({ queryKey: ['cc-meta'] }), onError: (err) => console.error('Meta-derivation trigger failed:', err instanceof Error ? err.message : err) });

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Lattice Monitor</h3>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Meta-Invariants" value={meta?.totalMetaInvariants ?? '—'} />
        <Stat label="Convergences" value={convergences?.convergences?.length ?? '—'} />
        <Stat label="Pending Predictions" value={pending?.predictions?.length ?? '—'} />
        <Stat label="Cycles Run" value={meta?.cyclesRun ?? '—'} />
      </div>
      <button onClick={() => triggerMutation.mutate()} disabled={triggerMutation.isPending} className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm bg-neon-purple/20 text-neon-purple border border-neon-purple/30 hover:bg-neon-purple/30 disabled:opacity-50 transition-colors">
        <Zap className="w-4 h-4" /> {triggerMutation.isPending ? 'Running...' : 'Trigger Meta-Derivation'}
      </button>
    </div>
  );
}

function PluginPanel() {
  const { data } = useQuery({ queryKey: ['cc-plugins'], queryFn: () => apiHelpers.marketplace.installed().then(r => r.data), refetchInterval: 30000 });
  const { data: metrics } = useQuery({ queryKey: ['cc-plugin-metrics'], queryFn: () => apiHelpers.marketplace.listings().then(r => r.data), refetchInterval: 30000 });

  const plugins = (data?.plugins || []) as Array<{ id: string; name: string; version: string; isEmergentGen: boolean; author: string }>;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Plugin Manager</h3>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Loaded" value={metrics?.loadedCount ?? 0} />
        <Stat label="Pending Governance" value={metrics?.pendingGovernanceCount ?? 0} />
      </div>
      <div className="space-y-2">
        {plugins.map(p => (
          <div key={p.id} className="flex items-center gap-2 bg-lattice-surface rounded p-2 border border-lattice-border text-sm">
            <Puzzle className="w-4 h-4 text-neon-green" />
            <span className="text-white flex-1 truncate">{p.name}</span>
            <span className="text-xs text-gray-500">v{p.version}</span>
            {p.isEmergentGen && <span className="text-[10px] bg-neon-purple/20 text-neon-purple px-1.5 py-0.5 rounded">emergent</span>}
          </div>
        ))}
        {plugins.length === 0 && <p className="text-xs text-gray-500 text-center py-3">No plugins loaded</p>}
      </div>
    </div>
  );
}

function PipelinePanel() {
  const { data: queue } = useQuery({ queryKey: ['cc-queue'], queryFn: () => apiHelpers.backpressure.status().then(r => r.data), refetchInterval: 10000 });
  const { data: breakers } = useQuery({ queryKey: ['cc-breakers'], queryFn: () => apiHelpers.status.get().then(r => r.data), refetchInterval: 15000 });
  const qc = useQueryClient();
  const resetBreakers = useMutation({ mutationFn: () => apiHelpers.perf.gc(), onSuccess: () => qc.invalidateQueries({ queryKey: ['cc-breakers'] }), onError: (err) => console.error('Circuit breaker reset failed:', err instanceof Error ? err.message : err) });

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">LLM Pipeline</h3>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Queue Depth" value={queue?.depth ?? '—'} />
        <Stat label="Processing" value={queue?.processing ?? '—'} />
        <Stat label="Completed" value={queue?.completed ?? '—'} />
        <Stat label="Rejected" value={queue?.rejected ?? '—'} />
      </div>
      {breakers?.breakers && (
        <div className="bg-lattice-deep rounded-lg p-3 space-y-2 border border-lattice-border">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-400 uppercase">Breakers</p>
            <button onClick={() => resetBreakers.mutate()} disabled={resetBreakers.isPending} className="text-[10px] text-neon-cyan hover:underline disabled:opacity-50 disabled:cursor-not-allowed">{resetBreakers.isPending ? 'Resetting...' : 'Reset All'}</button>
          </div>
          {Object.entries(breakers.breakers as Record<string, { state: string }>).map(([name, b]) => (
            <BreakerBadge key={name} name={name} state={b.state || 'unknown'} />
          ))}
        </div>
      )}
    </div>
  );
}

function UserPanel() {
  const { data } = useQuery({ queryKey: ['cc-admin-stats'], queryFn: () => apiHelpers.analytics.dashboard().then(r => r.data).catch((err) => { console.error('Failed to fetch admin stats:', err instanceof Error ? err.message : err); return {}; }), refetchInterval: 60000 });

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">User Overview</h3>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Total Users" value={data?.totalUsers ?? '—'} />
        <Stat label="Active (24h)" value={data?.activeUsers24h ?? '—'} />
        <Stat label="New Today" value={data?.newToday ?? '—'} />
        <Stat label="WS Connections" value={data?.wsConnections ?? '—'} />
      </div>
      <p className="text-[10px] text-gray-600 text-center">Aggregate metrics only. No individual user data exposed.</p>
    </div>
  );
}

function ConfigPanel() {
  const qc = useQueryClient();
  const settingsMutation = useMutation({
    mutationFn: (updates: Record<string, unknown>) => apiHelpers.macros.run('settings.update', updates),
    onSuccess: () => qc.invalidateQueries(),
    onError: (err) => console.error('Settings update failed:', err instanceof Error ? err.message : err),
  });

  const settings = [
    { key: 'heartbeatEnabled', label: 'Heartbeat', type: 'boolean' as const },
    { key: 'heartbeatMs', label: 'Heartbeat Interval (ms)', type: 'number' as const, min: 2000, max: 120000 },
    { key: 'globalTickMs', label: 'Global Tick (ms)', type: 'number' as const, min: 60000, max: 600000 },
    { key: 'autogenEnabled', label: 'Autogen', type: 'boolean' as const },
    { key: 'registrationEnabled', label: 'Registration', type: 'boolean' as const },
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Configuration</h3>
      <div className="space-y-2">
        {settings.map(s => (
          <div key={s.key} className="flex items-center justify-between bg-lattice-surface rounded p-2.5 border border-lattice-border">
            <span className="text-sm text-gray-300">{s.label}</span>
            {s.type === 'boolean' ? (
              <button
                onClick={() => settingsMutation.mutate({ [s.key]: true })}
                disabled={settingsMutation.isPending}
                className="text-xs px-2 py-1 rounded bg-neon-green/20 text-neon-green border border-neon-green/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {settingsMutation.isPending ? '...' : 'Toggle'}
              </button>
            ) : (
              <span className="text-xs text-gray-500">{s.min}–{s.max}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function EmergencyPanel() {
  const qc = useQueryClient();
  const settingsMutation = useMutation({ mutationFn: (updates: Record<string, unknown>) => apiHelpers.macros.run('settings.update', updates), onSuccess: () => qc.invalidateQueries(), onError: (err) => console.error('Emergency settings update failed:', err instanceof Error ? err.message : err) });
  const saveMutation = useMutation({ mutationFn: () => apiHelpers.db.sync(), onError: (err) => console.error('State save failed:', err instanceof Error ? err.message : err) });
  const flushMutation = useMutation({ mutationFn: () => apiHelpers.perf.gc(), onError: (err) => console.error('Queue flush failed:', err instanceof Error ? err.message : err) });

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Emergency Controls</h3>
      <div className="space-y-3">
        <ConfirmButton label="Pause All Processing" icon={Pause} color="red"
          description="Stops autogen, heartbeat, global tick, meta-derivation. User-facing requests still work."
          onConfirm={() => settingsMutation.mutate({ autogenEnabled: false, heartbeatEnabled: false })} />
        <ConfirmButton label="Disable Registration" icon={XCircle} color="red"
          description="No new user signups. Existing users unaffected."
          onConfirm={() => settingsMutation.mutate({ registrationEnabled: false })} />
        <ConfirmButton label="Force State Save" icon={Save} color="yellow"
          description="Immediately saves current state to disk."
          onConfirm={() => saveMutation.mutate()} />
        <ConfirmButton label="Flush LLM Queue" icon={Trash2} color="red"
          description="Drops all pending LLM calls. Active calls finish."
          onConfirm={() => flushMutation.mutate()} />
        <ConfirmButton label="Resume All" icon={Play} color="green"
          description="Restarts autogen, heartbeat, and all background processing."
          onConfirm={() => settingsMutation.mutate({ autogenEnabled: true, heartbeatEnabled: true })} />
      </div>
    </div>
  );
}

function DreamPanel() {
  const [text, setText] = useState('');
  const qc = useQueryClient();
  const submitMutation = useMutation({
    mutationFn: (body: { text: string; capturedAt: string }) => apiHelpers.dream.run({ seed: body.text }),
    onSuccess: () => { setText(''); qc.invalidateQueries({ queryKey: ['cc-meta'] }); qc.invalidateQueries({ queryKey: ['cc-dream-history'] }); },
    onError: (err) => console.error('Dream input submission failed:', err instanceof Error ? err.message : err),
  });

  // Dream history for display
  const { data: dreamHistory } = useQuery({
    queryKey: ['cc-dream-history'],
    queryFn: () => apiHelpers.dream.history(10).then(r => r.data).catch(() => ({ dreams: [] })),
    refetchInterval: 30000,
  });

  const dreams = (dreamHistory?.dreams || []) as Array<{ id: string; title: string; capturedAt?: string; convergence?: boolean; tags?: string[] }>;
  const dreamTopics = dreams.slice(0, 5).map(d => d.title).filter(Boolean);

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-purple-400 uppercase tracking-wider flex items-center gap-2">
        <Moon className="w-4 h-4" /> Dream Synthesis
      </h3>

      {/* Dream topics summary — purple/indigo styling */}
      {dreamTopics.length > 0 && (
        <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-3">
          <p className="text-xs text-indigo-300 mb-2">Concord dreamed about:</p>
          <div className="flex flex-wrap gap-1.5">
            {dreamTopics.map((topic, i) => (
              <span key={i} className="px-2 py-0.5 text-xs rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                {topic}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Dream capture input */}
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="What did you derive in your sleep?"
        className="w-full h-32 bg-lattice-deep border border-purple-500/30 rounded-lg p-3 text-sm text-white placeholder-gray-600 resize-none focus:outline-none focus:border-purple-400/50"
      />
      <button
        onClick={() => submitMutation.mutate({ text, capturedAt: new Date().toISOString() })}
        disabled={!text.trim() || submitMutation.isPending}
        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm bg-purple-500/20 text-purple-300 border border-purple-500/30 hover:bg-purple-500/30 disabled:opacity-40 transition-colors"
      >
        <Send className="w-4 h-4" /> {submitMutation.isPending ? 'Capturing...' : 'Capture Dream'}
      </button>
      {submitMutation.isSuccess && <p className="text-xs text-purple-300 text-center">Captured. The lattice will process your dream.</p>}

      {/* Recent dream DTUs — indigo/purple styling */}
      {dreams.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-gray-500">Recent dream DTUs</p>
          {dreams.slice(0, 5).map(d => (
            <div key={d.id} className="flex items-center gap-2 bg-indigo-500/5 border border-indigo-500/10 rounded p-2 text-xs">
              <Moon className="w-3 h-3 text-indigo-400 flex-shrink-0" />
              <span className="text-indigo-200 truncate flex-1">{d.title}</span>
              {d.convergence && <span className="text-green-400 text-[10px] flex-shrink-0">converged</span>}
              {d.capturedAt && <span className="text-gray-600 text-[10px] flex-shrink-0">{new Date(d.capturedAt).toLocaleTimeString()}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LogsPanel() {
  const { data: errors } = useQuery({ queryKey: ['cc-errors'], queryFn: () => apiHelpers.eventsLog.list({ type: 'error', limit: 20 }).then(r => r.data), refetchInterval: 15000 });
  const { data: traces } = useQuery({ queryKey: ['cc-slow-traces'], queryFn: () => apiHelpers.perf.metrics().then(r => r.data), refetchInterval: 30000 });
  const { data: rejections } = useQuery({ queryKey: ['cc-rejections'], queryFn: () => apiHelpers.eventsLog.list({ type: 'governance-rejection', limit: 20 }).then(r => r.data), refetchInterval: 60000 });

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Logs & Traces</h3>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-red-400">Recent Errors ({errors?.count ?? 0})</p>
        <div className="max-h-48 overflow-y-auto space-y-1">
          {(errors?.errors || []).slice(0, 15).map((e: { source: string; message: string; at: string }, i: number) => (
            <div key={i} className="text-[11px] bg-red-950/30 border border-red-900/30 rounded p-2">
              <span className="text-red-400">{e.source}</span>
              <span className="text-gray-500 ml-2">{e.message?.slice(0, 80)}</span>
            </div>
          ))}
          {(!errors?.errors || errors.errors.length === 0) && <p className="text-xs text-gray-600">No recent errors</p>}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-yellow-400">Slow Requests ({traces?.traces?.length ?? 0})</p>
        <div className="max-h-32 overflow-y-auto space-y-1">
          {(traces?.traces || []).slice(0, 10).map((t: { path: string; durationMs: number }, i: number) => (
            <div key={i} className="text-[11px] flex justify-between bg-lattice-surface rounded p-1.5 border border-lattice-border">
              <span className="text-gray-300 truncate">{t.path}</span>
              <span className="text-yellow-400 ml-2">{t.durationMs}ms</span>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-400">Governance Rejections ({rejections?.count ?? 0})</p>
        {(rejections?.rejections || []).slice(0, 5).map((r: { type?: string; event?: string; reason?: string }, i: number) => (
          <div key={i} className="text-[11px] bg-lattice-surface rounded p-1.5 border border-lattice-border text-gray-400">
            {r.type || r.event || 'rejection'} — {r.reason || '—'}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── New Cognitive System Panels ─────────────────────────────────────────────

function BrainsPanel() {
  const { data } = useQuery({ queryKey: ['cc-brains'], queryFn: () => apiHelpers.brain.status().then(r => r.data), refetchInterval: 10000 });

  const brains = data?.brains as Record<string, { enabled: boolean; model: string; role: string; url: string; stats: { requests: number; totalMs: number; dtusGenerated: number; errors: number; fixes?: number; sleeping?: boolean; lastCallAt: string | null }; avgResponseMs: number }> | undefined;
  const mode = data?.mode || 'fallback';
  const onlineCount = data?.onlineCount ?? 0;
  const totalBrains = brains ? Object.keys(brains).length : 0;

  const modeColor = (mode === 'four_brain' || mode === 'three_brain') ? 'text-neon-green' : mode === 'partial' ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Four-Brain Architecture</h3>
      <div className="flex items-center gap-3">
        <span className={`text-lg font-bold ${modeColor}`}>{mode.replace('_', '-')}</span>
        <span className="text-sm text-gray-500">{onlineCount}/{totalBrains} online</span>
      </div>
      {brains && Object.entries(brains).map(([name, brain]) => (
        <div key={name} className={`bg-lattice-surface rounded-lg p-3 border border-lattice-border ${!brain.enabled ? 'opacity-50' : ''}`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <StatusDot status={brain.enabled ? 'green' : 'red'} />
              <span className="text-sm font-medium text-white capitalize">{name}</span>
              <span className="text-[10px] text-gray-500">{brain.model}</span>
            </div>
          </div>
          <p className="text-xs text-gray-400 mb-2">{brain.role}</p>
          {brain.enabled && (
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Requests" value={brain.stats.requests} />
              <Stat label="Avg ms" value={brain.avgResponseMs || (brain.stats.requests > 0 ? Math.round(brain.stats.totalMs / brain.stats.requests) : 0)} />
              <Stat label="Errors" value={brain.stats.errors} />
            </div>
          )}
          {brain.stats.fixes !== undefined && (
            <div className="mt-2 text-xs text-gray-400">Fixes applied: <span className="font-mono text-neon-green">{brain.stats.fixes}</span></div>
          )}
        </div>
      ))}
    </div>
  );
}

function AttentionPanel() {
  const { data: status } = useQuery({ queryKey: ['cc-attention'], queryFn: () => apiHelpers.attentionAlloc.status().then(r => r.data), refetchInterval: 15000 });
  const qc = useQueryClient();
  const unfocusMutation = useMutation({ mutationFn: () => apiHelpers.attentionAlloc.unfocus(), onSuccess: () => qc.invalidateQueries({ queryKey: ['cc-attention'] }), onError: (err) => console.error('Unfocus failed:', err instanceof Error ? err.message : err) });

  const allocation = (status?.lastAllocation?.allocation || []) as Array<{ domain: string; budget: number; urgency: number; focused?: boolean }>;
  const focusOverride = status?.focusOverride as { domain: string; weight: number; expiresAt: string } | null;
  const totalBudget = allocation.reduce((sum: number, a: { budget: number }) => sum + a.budget, 0) || 1;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Attention Allocator</h3>
      {focusOverride && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-yellow-400">
            <Focus className="w-4 h-4" />
            <span>Focus: <strong>{focusOverride.domain}</strong> @ {(focusOverride.weight * 100).toFixed(0)}%</span>
          </div>
          <button onClick={() => unfocusMutation.mutate()} disabled={unfocusMutation.isPending} className="text-xs text-red-400 hover:underline disabled:opacity-50">
            Clear
          </button>
        </div>
      )}
      <div className="space-y-2">
        {allocation.slice(0, 15).map((a: { domain: string; budget: number; urgency: number; focused?: boolean }) => (
          <div key={a.domain} className="flex items-center gap-2 text-xs">
            <span className="w-28 truncate text-gray-300" title={a.domain}>{a.domain}</span>
            <div className="flex-1 h-3 bg-lattice-deep rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${a.focused ? 'bg-yellow-500' : 'bg-neon-cyan/60'}`} style={{ width: `${Math.max(2, (a.budget / totalBudget) * 100)}%` }} />
            </div>
            <span className="w-8 text-right text-gray-500 font-mono">{a.budget}</span>
            <span className="w-12 text-right text-gray-500">{(a.urgency * 100).toFixed(0)}%</span>
          </div>
        ))}
        {allocation.length === 0 && <p className="text-xs text-gray-500 text-center py-3">No allocation data yet</p>}
      </div>
    </div>
  );
}

function ForgettingPanel() {
  const { data: status } = useQuery({ queryKey: ['cc-forgetting'], queryFn: () => apiHelpers.forgetting.status().then(r => r.data), refetchInterval: 30000 });
  const qc = useQueryClient();
  const runMutation = useMutation({ mutationFn: () => apiHelpers.forgetting.run(), onSuccess: () => qc.invalidateQueries({ queryKey: ['cc-forgetting'] }), onError: (err) => console.error('Forgetting cycle failed:', err instanceof Error ? err.message : err) });
  const { data: candidates } = useQuery({ queryKey: ['cc-forgetting-candidates'], queryFn: () => apiHelpers.forgetting.candidates().then(r => r.data), refetchInterval: 60000 });
  const { data: historyData } = useQuery({ queryKey: ['cc-forgetting-history'], queryFn: () => apiHelpers.forgetting.history(5).then(r => r.data).catch(() => ({ tombstones: [] })), refetchInterval: 60000 });
  const recentTombstones = (historyData?.tombstones || []) as Array<{ id: string; title?: string; tier?: string; forgottenAt?: string }>;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Forgetting Engine</h3>

      {/* Cycle indicator */}
      {status && status.lifetimeForgotten > 0 && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-center gap-2">
          <Trash2 className="w-4 h-4 text-red-400 flex-shrink-0" />
          <span className="text-xs text-red-300">
            {status.lifetimeForgotten} DTUs archived (low salience, threshold: {status.threshold})
          </span>
        </div>
      )}

      {status && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Tombstones" value={status.tombstones ?? 0} />
            <Stat label="Lifetime" value={status.lifetimeForgotten ?? 0} />
            <Stat label="Threshold" value={status.threshold ?? 0} />
          </div>
          {status.lastRun && (
            <p className="text-xs text-gray-500 flex items-center gap-1"><Clock className="w-3 h-3" /> Last: {new Date(status.lastRun).toLocaleString()}</p>
          )}
        </>
      )}
      {candidates && (
        <p className="text-xs text-gray-400">{candidates.candidateCount ?? 0} candidates for forgetting</p>
      )}
      <div className="flex gap-2">
        <button onClick={() => runMutation.mutate()} disabled={runMutation.isPending}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 disabled:opacity-50 transition-colors">
          <Trash2 className="w-4 h-4" /> {runMutation.isPending ? 'Running...' : 'Run Forgetting Cycle'}
        </button>
      </div>

      {/* Recent tombstones */}
      {recentTombstones.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-gray-500">Recently archived</p>
          {recentTombstones.map(t => (
            <div key={t.id} className="flex items-center gap-2 bg-lattice-surface rounded p-2 text-xs border border-lattice-border">
              <Trash2 className="w-3 h-3 text-red-400 flex-shrink-0" />
              <span className="text-gray-300 truncate flex-1">{t.title || t.id}</span>
              {t.tier && <span className="text-gray-500 text-[10px]">{t.tier}</span>}
              {t.forgottenAt && <span className="text-gray-600 text-[10px]">{new Date(t.forgottenAt).toLocaleTimeString()}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RepairCortexPanel() {
  const { data: status } = useQuery({ queryKey: ['cc-repair'], queryFn: () => apiHelpers.repairExtended.fullStatus().then(r => r.data), refetchInterval: 15000 });
  const qc = useQueryClient();
  const forceMutation = useMutation({ mutationFn: () => apiHelpers.repairExtended.forceCycle(), onSuccess: () => qc.invalidateQueries({ queryKey: ['cc-repair'] }), onError: (err) => console.error('Force repair failed:', err instanceof Error ? err.message : err) });

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Repair Cortex</h3>
      {status ? (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Cycles" value={status.cycleCount ?? 0} />
            <Stat label="Error Accum" value={status.errorAccumulatorSize ?? 0} />
            <Stat label="Executors" value={`${status.executorsReady ?? 0}/${status.executorCount ?? 0}`} />
          </div>
          <div className="flex items-center gap-2 text-xs">
            <StatusDot status={status.running ? 'green' : 'red'} />
            <span className="text-gray-400">Loop: {status.running ? 'Active' : 'Stopped'}</span>
            {status.lastCycleAt && <span className="text-gray-500 ml-auto">Last: {new Date(status.lastCycleAt).toLocaleString()}</span>}
          </div>
          {status.networkStatus && (
            <p className="text-xs text-gray-500">Network: {status.networkStatus}</p>
          )}
          <button onClick={() => forceMutation.mutate()} disabled={forceMutation.isPending}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 disabled:opacity-50 transition-colors">
            <ShieldAlert className="w-4 h-4" /> {forceMutation.isPending ? 'Running...' : 'Force Repair Cycle'}
          </button>
        </>
      ) : (
        <p className="text-xs text-gray-500">Loading...</p>
      )}
    </div>
  );
}

function PromotionPanel() {
  const { data } = useQuery({ queryKey: ['cc-promotions'], queryFn: () => apiHelpers.promotion.queue().then(r => r.data), refetchInterval: 30000 });
  const { data: shadowData } = useQuery({ queryKey: ['cc-shadow-pending'], queryFn: () => api.get('/api/dtus/shadow/pending').then(r => r.data), refetchInterval: 30000 });
  const qc = useQueryClient();
  const approveMutation = useMutation({ mutationFn: (id: string) => apiHelpers.promotion.approve(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['cc-promotions'] }), onError: (err) => console.error('Promotion approval failed:', err instanceof Error ? err.message : err) });
  const rejectMutation = useMutation({ mutationFn: (id: string) => apiHelpers.promotion.reject(id, 'Rejected from command center'), onSuccess: () => qc.invalidateQueries({ queryKey: ['cc-promotions'] }), onError: (err) => console.error('Promotion rejection failed:', err instanceof Error ? err.message : err) });
  const promoteShadowMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/dtus/${id}/promote`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cc-shadow-pending'] }); qc.invalidateQueries({ queryKey: ['cc-health'] }); },
    onError: (err) => console.error('Shadow promotion failed:', err instanceof Error ? err.message : err),
  });

  const queue = (data?.queue || []) as Array<{ id: string; artifactName?: string; fromStage: string; toStage: string; status: string; requestedAt: string }>;
  const shadowCandidates = (shadowData?.candidates || []) as Array<{ dtuId: string; title: string; momentum: number; richness: number; uniqueUsers: number; interactionCount: number }>;
  const pendingShadows = (shadowData?.pendingShadows || []) as Array<{ id: string; title: string; tier: string; kind: string; richness: number; ttlDays: number; tags: string[]; createdAt: string }>;
  const totalShadows = shadowData?.totalShadows ?? 0;

  return (
    <div className="space-y-6">
      {/* Shadow DTU Promotion Queue */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Shadow DTU Promotion</h3>
          <span className="text-xs text-gray-500">{totalShadows} total shadows</span>
        </div>

        {/* Momentum-based candidates (auto-detected via interactions) */}
        {shadowCandidates.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-neon-green font-semibold flex items-center gap-1"><Zap className="w-3 h-3" /> Promotion Candidates ({shadowCandidates.length})</p>
            {shadowCandidates.map(c => (
              <div key={c.dtuId} className="bg-lattice-surface rounded-lg p-3 border border-neon-green/20">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-white font-medium truncate flex-1">{c.title}</span>
                  <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded border border-purple-500/30 ml-2">shadow</span>
                </div>
                <div className="flex gap-3 text-[10px] text-gray-400 mb-2">
                  <span>Momentum: {c.momentum}</span>
                  <span>Richness: {c.richness}</span>
                  <span>Users: {c.uniqueUsers}</span>
                  <span>Interactions: {c.interactionCount}</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => promoteShadowMutation.mutate(c.dtuId)} disabled={promoteShadowMutation.isPending} className="flex-1 text-xs px-2 py-1.5 rounded bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 disabled:opacity-50">Promote to Regular</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Rich shadows pending review */}
        {pendingShadows.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-gray-400 font-semibold">Rich Shadows ({pendingShadows.length})</p>
            {pendingShadows.slice(0, 10).map(s => (
              <div key={s.id} className="bg-lattice-surface rounded-lg p-3 border border-lattice-border">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-white font-medium truncate flex-1">{s.title}</span>
                  <span className="text-[10px] bg-gray-500/20 text-gray-400 px-1.5 py-0.5 rounded">{s.kind || 'shadow'}</span>
                </div>
                <div className="flex gap-3 text-[10px] text-gray-500 mb-2">
                  <span>Richness: {s.richness}</span>
                  <span>TTL: {s.ttlDays}d</span>
                  {s.createdAt && <span>Created: {new Date(s.createdAt).toLocaleDateString()}</span>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => promoteShadowMutation.mutate(s.id)} disabled={promoteShadowMutation.isPending} className="flex-1 text-xs px-2 py-1.5 rounded bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 disabled:opacity-50">Promote</button>
                </div>
              </div>
            ))}
            {pendingShadows.length > 10 && <p className="text-xs text-gray-500 text-center">+ {pendingShadows.length - 10} more</p>}
          </div>
        )}

        {shadowCandidates.length === 0 && pendingShadows.length === 0 && (
          <p className="text-xs text-gray-500 text-center py-3">No shadow DTUs ready for promotion</p>
        )}
      </div>

      {/* General Promotion Pipeline */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">General Promotion Pipeline</h3>
        <div className="space-y-2">
          {queue.length === 0 && <p className="text-xs text-gray-500 text-center py-3">No pending promotions</p>}
          {queue.map(p => (
            <div key={p.id} className="bg-lattice-surface rounded-lg p-3 border border-lattice-border">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-white font-medium">{p.artifactName || p.id}</span>
                <span className={`text-xs px-2 py-0.5 rounded ${p.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' : p.status === 'approved' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                  {p.status}
                </span>
              </div>
              <p className="text-xs text-gray-400">{p.fromStage} → {p.toStage}</p>
              <p className="text-[10px] text-gray-500">{new Date(p.requestedAt).toLocaleString()}</p>
              {p.status === 'pending' && (
                <div className="flex gap-2 mt-2">
                  <button onClick={() => approveMutation.mutate(p.id)} disabled={approveMutation.isPending} className="flex-1 text-xs px-2 py-1.5 rounded bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 disabled:opacity-50">Approve</button>
                  <button onClick={() => rejectMutation.mutate(p.id)} disabled={rejectMutation.isPending} className="flex-1 text-xs px-2 py-1.5 rounded bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 disabled:opacity-50">Reject</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Breakthrough Clusters Panel (wiring audit) ─────────────────────────────

function BreakthroughPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['breakthrough-list'],
    queryFn: () => apiHelpers.breakthrough.list().then(r => r.data),
    refetchInterval: 30000,
    retry: false,
  });

  const { data: metricsData } = useQuery({
    queryKey: ['breakthrough-metrics'],
    queryFn: () => apiHelpers.breakthrough.metrics().then(r => r.data),
    refetchInterval: 30000,
    retry: false,
  });

  const queryClient = useQueryClient();
  const initMutation = useMutation({
    mutationFn: (clusterId: string) => apiHelpers.breakthrough.init(clusterId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['breakthrough-list'] }),
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });
  const researchMutation = useMutation({
    mutationFn: (clusterId: string) => apiHelpers.breakthrough.research(clusterId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['breakthrough-list'] }),
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });

  const clusters = data?.clusters || [];

  return (
    <div className="space-y-4">
      {/* Metrics summary */}
      {metricsData && (
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Total Clusters" value={metricsData.totalClusters || 0} />
          <Stat label="Total DTUs" value={metricsData.totalDTUs || 0} />
          <Stat label="Research Jobs" value={metricsData.totalResearchJobs || 0} />
        </div>
      )}

      {isLoading ? (
        <div className="h-24 bg-lattice-deep animate-pulse rounded-lg" />
      ) : clusters.length === 0 ? (
        <div className="text-center py-8">
          <Lightbulb className="w-8 h-8 mx-auto mb-2 text-gray-600" />
          <p className="text-sm text-gray-500">No breakthrough clusters initialized</p>
        </div>
      ) : (
        <div className="space-y-3">
          {clusters.map((c: { id: string; name: string; domain: string; initialized: boolean; dtuCount: number; researchCount: number }) => (
            <div key={c.id} className="bg-lattice-surface border border-lattice-border rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h4 className="text-sm font-semibold text-white">{c.name}</h4>
                  <span className="text-[10px] text-gray-500">{c.domain}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded ${c.initialized ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
                    {c.initialized ? 'Active' : 'Dormant'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-400 mb-2">
                <span>{c.dtuCount || 0} DTUs</span>
                <span>{c.researchCount || 0} research jobs</span>
              </div>
              <div className="flex gap-2">
                {!c.initialized && (
                  <button onClick={() => initMutation.mutate(c.id)} disabled={initMutation.isPending}
                    className="text-xs px-3 py-1.5 rounded bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30 hover:bg-neon-cyan/30 disabled:opacity-50">
                    Initialize
                  </button>
                )}
                {c.initialized && (
                  <button onClick={() => researchMutation.mutate(c.id)} disabled={researchMutation.isPending}
                    className="text-xs px-3 py-1.5 rounded bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/30 disabled:opacity-50">
                    Trigger Research
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Meta-Derivation Panel (wiring audit) ────────────────────────────────────

function MetaDerivationPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['meta-derivation-status'],
    queryFn: () => apiHelpers.metaDerivation.status().then(r => r.data),
    refetchInterval: 30000,
    retry: false,
  });

  const { data: invariantsData } = useQuery({
    queryKey: ['meta-derivation-invariants'],
    queryFn: () => apiHelpers.metaDerivation.invariants().then(r => r.data),
    retry: false,
  });

  const { data: convergencesData } = useQuery({
    queryKey: ['meta-derivation-convergences'],
    queryFn: () => apiHelpers.metaDerivation.convergences().then(r => r.data),
    retry: false,
  });

  if (isLoading) return <div className="h-24 bg-lattice-deep animate-pulse rounded-lg" />;

  const metrics = data?.metrics || {};
  const invariants = invariantsData?.invariants || [];
  const convergences = convergencesData?.convergences || [];

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-3">
        <Stat label="Meta-Invariants" value={data?.invariantCount || 0} />
        <Stat label="Convergences" value={data?.convergenceCount || 0} />
        <Stat label="Pending Predictions" value={data?.pendingPredictions || 0} />
        <Stat label="Cycles Run" value={metrics.cyclesRun || 0} />
      </div>

      {/* Invariants */}
      {invariants.length > 0 && (
        <div>
          <h4 className="text-xs uppercase text-gray-500 mb-2">Discovered Meta-Invariants</h4>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {invariants.slice(0, 20).map((inv: { id: string; statement: string; confidence: number; domains: string[] }, i: number) => (
              <div key={inv.id || i} className="bg-lattice-surface border border-lattice-border rounded p-3">
                <p className="text-xs text-white">{inv.statement || JSON.stringify(inv).slice(0, 200)}</p>
                {inv.confidence != null && (
                  <span className="text-[10px] text-gray-500">Confidence: {(inv.confidence * 100).toFixed(0)}%</span>
                )}
                {inv.domains?.length > 0 && (
                  <div className="flex gap-1 mt-1">
                    {inv.domains.map((d: string) => (
                      <span key={d} className="text-[9px] px-1.5 py-0.5 rounded bg-lattice-deep text-neon-cyan">{d}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Convergences */}
      {convergences.length > 0 && (
        <div>
          <h4 className="text-xs uppercase text-gray-500 mb-2">Dream-Lattice Convergences</h4>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {convergences.slice(0, 10).map((c: { id: string; similarity: number; description: string }, i: number) => (
              <div key={c.id || i} className="bg-lattice-surface border border-purple-500/30 rounded p-3">
                <p className="text-xs text-purple-300">{c.description || JSON.stringify(c).slice(0, 200)}</p>
                {c.similarity != null && (
                  <span className="text-[10px] text-gray-500">Similarity: {(c.similarity * 100).toFixed(0)}%</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {invariants.length === 0 && convergences.length === 0 && (
        <div className="text-center py-8">
          <GitBranch className="w-8 h-8 mx-auto mb-2 text-gray-600" />
          <p className="text-sm text-gray-500">No meta-derivations yet</p>
          <p className="text-xs text-gray-600 mt-1">Meta-derivation runs every 200th tick when sufficient invariants exist</p>
        </div>
      )}
    </div>
  );
}

function FoundationPanel() {
  const { data: statusData } = useQuery({
    queryKey: ['foundation-status'],
    queryFn: () => apiHelpers.foundation.status().then(r => r.data),
    refetchInterval: 15000,
  });
  const { data: senseData } = useQuery({
    queryKey: ['foundation-sense'],
    queryFn: () => apiHelpers.foundation.senseReadings(20).then(r => r.data),
    refetchInterval: 10000,
  });
  const { data: energyData } = useQuery({
    queryKey: ['foundation-energy'],
    queryFn: () => apiHelpers.foundation.energyMap().then(r => r.data),
    refetchInterval: 15000,
  });
  const { data: spectrumData } = useQuery({
    queryKey: ['foundation-spectrum'],
    queryFn: () => apiHelpers.foundation.spectrumAvailable(20).then(r => r.data),
    refetchInterval: 15000,
  });
  const { data: protocolData } = useQuery({
    queryKey: ['foundation-protocol'],
    queryFn: () => apiHelpers.foundation.protocolStats().then(r => r.data),
    refetchInterval: 30000,
  });
  const { data: emergencyData } = useQuery({
    queryKey: ['foundation-emergency'],
    queryFn: () => apiHelpers.foundation.emergencyStatus().then(r => r.data),
    refetchInterval: 10000,
  });

  const [section, setSection] = useState<'status' | 'sense' | 'energy' | 'emergency' | 'protocol'>('status');

  const sections = [
    { id: 'status' as const, label: 'Status' },
    { id: 'sense' as const, label: 'Sensors' },
    { id: 'energy' as const, label: 'Energy' },
    { id: 'emergency' as const, label: 'Emergency' },
    { id: 'protocol' as const, label: 'Protocol' },
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
        <Globe className="w-4 h-4 text-violet-400" /> Foundation Layer
      </h3>

      {/* Section tabs */}
      <div className="flex gap-1 bg-zinc-900 rounded-lg p-1">
        {sections.map(s => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={`flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors ${
              section === s.id ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Section content */}
      {section === 'status' && statusData && (
        <FoundationCard type="status" status={statusData} />
      )}
      {section === 'sense' && (
        <FoundationCard type="sense" readings={senseData?.readings || []} />
      )}
      {section === 'energy' && (
        <FoundationCard type="energy" energyReadings={energyData?.readings || []} />
      )}
      {section === 'emergency' && (
        <FoundationCard type="emergency" alerts={emergencyData?.alerts || []} />
      )}
      {section === 'protocol' && protocolData && (
        <FoundationCard type="protocol" protocolMetrics={protocolData} />
      )}

      {/* Spectrum availability summary */}
      {spectrumData?.channels && (
        <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-3">
          <p className="text-xs font-semibold text-zinc-400 mb-2">Spectrum Availability</p>
          <div className="text-xs text-zinc-500">
            {Array.isArray(spectrumData.channels)
              ? `${spectrumData.channels.length} channels available`
              : 'Checking spectrum...'}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shield Status Panel (Feature 21) ──────────────────────────────────────

function ShieldStatusPanel() {
  const { data: status } = useQuery({
    queryKey: ['cc-shield-status'],
    queryFn: () => api.get('/api/shield/status').then(r => r.data).catch(() => null),
    refetchInterval: 15000,
  });
  const { data: threats } = useQuery({
    queryKey: ['cc-shield-threats'],
    queryFn: () => api.get('/api/shield/threats?limit=10').then(r => r.data).catch(() => null),
    refetchInterval: 30000,
  });
  const { data: predictions } = useQuery({
    queryKey: ['cc-shield-predictions'],
    queryFn: () => api.get('/api/shield/predictions?limit=5').then(r => r.data).catch(() => null),
    refetchInterval: 60000,
  });

  const metrics = status?.metrics || status;
  const stats = metrics?.stats || {};
  const tools = metrics?.tools || {};
  const threatList = threats?.threats || threats || [];
  const predictionList = predictions?.predictions || predictions || [];

  const toolNames = Object.keys(tools);
  const toolsAvailable = toolNames.filter(t => tools[t]).length;
  const toolsTotal = toolNames.length || 7;

  const TIER_MAP: Record<string, { tier: number; label: string }> = {
    clamav: { tier: 1, label: 'ClamAV (Malware)' },
    yara: { tier: 2, label: 'YARA (Classification)' },
    suricata: { tier: 3, label: 'Suricata (IDS)' },
    snort: { tier: 3, label: 'Snort (IDS)' },
    openvas: { tier: 4, label: 'OpenVAS (Vuln Scan)' },
    wazuh: { tier: 5, label: 'Wazuh (HIDS)' },
    zeek: { tier: 6, label: 'Zeek (Network)' },
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Concord Shield</h3>

      {/* Summary indicator */}
      <div className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm ${
        (stats.threatsDetected || 0) > 0
          ? 'bg-orange-500/10 border border-orange-500/20 text-orange-300'
          : 'bg-green-500/10 border border-green-500/20 text-green-300'
      }`}>
        <Shield className="w-4 h-4" />
        <span>
          Shield active — {stats.threatsDetected || 0} threats blocked, {stats.collectiveImmunityEvents || 0} patterns learned
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Total Scans" value={stats.totalScans ?? 0} />
        <Stat label="Threats Blocked" value={stats.threatsDetected ?? 0} />
        <Stat label="Clean Files" value={stats.cleanFiles ?? 0} />
        <Stat label="Firewall Rules" value={stats.firewallRulesGenerated ?? 0} />
        <Stat label="Immunity Events" value={stats.collectiveImmunityEvents ?? 0} />
        <Stat label="Predictions" value={stats.predictionsGenerated ?? 0} />
      </div>

      {/* Security Tool Tiers (6 tiers) */}
      <div className="bg-lattice-deep rounded-lg p-3 space-y-2 border border-lattice-border">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-400 uppercase">Security Tool Tiers</p>
          <span className="text-xs text-gray-500">{toolsAvailable}/{toolsTotal} online</span>
        </div>
        {Object.entries(TIER_MAP).map(([key, meta]) => (
          <div key={key} className="flex items-center gap-2 text-xs">
            <StatusDot status={tools[key] ? 'green' : 'red'} />
            <span className="text-gray-400">T{meta.tier}</span>
            <span className="text-gray-300 flex-1">{meta.label}</span>
            <span className="text-gray-500">{tools[key] ? 'active' : 'unavailable'}</span>
          </div>
        ))}
      </div>

      {/* Pain Integration */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-500/10 border border-purple-500/20 text-xs text-purple-300">
        <ShieldAlert className="w-3.5 h-3.5" />
        <span>Pain integration active — threat DTUs tagged as pain_memory, never pruned</span>
      </div>

      {/* Collective Immunity */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-xs text-cyan-300">
        <Shield className="w-3.5 h-3.5" />
        <span>Collective immunity: one detection protects all ({stats.collectiveImmunityEvents || 0} propagations)</span>
      </div>

      {/* Recent Detections as DTUs */}
      {Array.isArray(threatList) && threatList.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-red-400">Recent Detections ({threatList.length})</p>
          <div className="max-h-40 overflow-y-auto space-y-1">
            {threatList.slice(0, 10).map((t: { id?: string; dtuId?: string; subtype?: string; severity?: number }, i: number) => (
              <div key={t.id || t.dtuId || i} className="flex items-center gap-2 text-[11px] bg-lattice-surface rounded p-2 border border-lattice-border">
                <span className={`px-1.5 py-0.5 rounded border font-medium uppercase ${
                  (t.severity || 0) >= 7 ? 'text-red-400 bg-red-500/10 border-red-500/20' : 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                }`}>{t.subtype || 'unknown'}</span>
                <span className="text-gray-400 truncate flex-1 font-mono">{(t.id || t.dtuId || '').slice(0, 20)}</span>
                <span className="text-gray-600 tabular-nums">{t.severity || '?'}/10</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Prophet Predictions */}
      {Array.isArray(predictionList) && predictionList.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-purple-400">Prophet Predictions ({predictionList.length})</p>
          {predictionList.slice(0, 5).map((p: { family?: string; predictedVariant?: string; confidence?: number }, i: number) => (
            <div key={i} className="flex items-center gap-2 text-[11px] bg-lattice-surface rounded p-2 border border-purple-500/20">
              <span className="text-purple-300 capitalize font-medium">{p.family || 'unknown'}</span>
              <span className="text-gray-600">-&gt;</span>
              <span className="text-gray-400 truncate flex-1">{p.predictedVariant || '—'}</span>
              <span className="text-gray-500 tabular-nums">{p.confidence != null ? `${Math.round(p.confidence * 100)}%` : '—'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Federation Status Panel (Feature 24) ──────────────────────────────────

function FederationStatusPanel() {
  const { data: status } = useQuery({
    queryKey: ['cc-federation-status'],
    queryFn: () => api.get('/api/federation/status').then(r => r.data).catch(() => null),
    refetchInterval: 15000,
  });
  const { data: peers } = useQuery({
    queryKey: ['cc-federation-peers'],
    queryFn: () => api.get('/api/federation/peers').then(r => r.data).catch(() => null),
    refetchInterval: 30000,
  });
  const { data: escalation } = useQuery({
    queryKey: ['cc-federation-escalation'],
    queryFn: () => api.get('/api/federation/escalation/stats').then(r => r.data).catch(() => null),
    refetchInterval: 60000,
  });

  const federation = status?.federation || {};
  const enabled = status?.enabled ?? false;
  const peerList = peers?.peers || [];
  const trustedNodes = federation?.trustedNodes ?? federation?.nodes?.length ?? 0;
  const escalationStats = escalation || {};
  const hasPeers = peerList.length > 0 || trustedNodes > 0;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Federation</h3>

      {!hasPeers ? (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-zinc-500/10 border border-zinc-500/20 text-sm text-zinc-400">
          <Activity className="w-4 h-4" />
          <span>Standalone mode — federation available when peers connect</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-neon-cyan/10 border border-neon-cyan/20 text-sm text-neon-cyan">
          <Activity className="w-4 h-4" />
          <span>Federation active — {trustedNodes || peerList.length} peer{(trustedNodes || peerList.length) !== 1 ? 's' : ''} connected</span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Status" value={enabled ? 'Enabled' : 'Disabled'} />
        <Stat label="Trusted Nodes" value={trustedNodes || 0} />
        <Stat label="Peers" value={peerList.length} />
      </div>

      {(federation?.nodes?.length > 0 || peerList.length > 0) && (
        <div className="bg-lattice-deep rounded-lg p-3 space-y-2 border border-lattice-border">
          <p className="text-xs font-semibold text-gray-400 uppercase">Connected Instances</p>
          {(federation?.nodes || []).map((node: { id: string; trustScore?: number }, i: number) => (
            <div key={node.id || i} className="flex items-center gap-2 text-xs">
              <StatusDot status="green" />
              <span className="text-gray-300 flex-1 truncate font-mono">{node.id}</span>
              {node.trustScore != null && <span className="text-gray-500">trust: {node.trustScore}</span>}
            </div>
          ))}
          {peerList.map((peer: { id?: string; entityId?: string; peerType?: string }, i: number) => (
            <div key={peer.id || peer.entityId || i} className="flex items-center gap-2 text-xs">
              <StatusDot status="green" />
              <span className="text-gray-300 flex-1 truncate font-mono">{peer.id || peer.entityId}</span>
              {peer.peerType && <span className="text-gray-500">{peer.peerType}</span>}
            </div>
          ))}
        </div>
      )}

      {escalationStats?.ok && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400">Federated DTU Count</p>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Escalated" value={escalationStats.totalEscalated ?? escalationStats.count ?? 0} />
            <Stat label="Regional" value={escalationStats.regional ?? 0} />
            <Stat label="National" value={escalationStats.national ?? 0} />
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-lattice-surface border border-lattice-border text-xs text-gray-400">
        <StatusDot status={enabled ? 'green' : 'gray'} />
        <span>Sync: {enabled ? 'Active — DTUs propagate on federation channel' : 'Inactive — local-first mode'}</span>
      </div>
    </div>
  );
}

// ── LOAF System Panel ───────────────────────────────────────────────────────

function LoafPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['cc-loaf-status'],
    queryFn: () => api.get('/api/loaf/status').then(r => r.data),
    refetchInterval: 30000,
    retry: false,
  });

  const meta = data?.meta;
  const hyp = data?.hypothesisMarket;
  const truth = data?.truthLifecycle;
  const safety = data?.actionSafety;
  const coord = data?.collectiveAction?.health;
  const knowledge = data?.knowledgeSurvival;

  const LOAF_TIERS = meta ? [
    { tier: 'I', label: 'Hardening', modules: meta.loafI, color: 'text-red-400' },
    { tier: 'II', label: 'Cognitive OS', modules: meta.loafII, color: 'text-orange-400' },
    { tier: 'III', label: 'Civilizational', modules: meta.loafIII, color: 'text-yellow-400' },
    { tier: 'IV', label: 'Advanced Ops', modules: meta.loafIV, color: 'text-green-400' },
    { tier: 'V', label: 'Civ-Scale', modules: meta.loafV, color: 'text-teal-400' },
    { tier: 'VI', label: 'Epistemic Limits', modules: meta.loafVI, color: 'text-cyan-400' },
    { tier: 'VII', label: 'Reality-Grounded', modules: meta.loafVII, color: 'text-blue-400' },
    { tier: 'VIII', label: 'Coordination', modules: meta.loafVIII, color: 'text-indigo-400' },
    { tier: 'IX', label: 'Knowledge Survival', modules: meta.loafIX, color: 'text-purple-400' },
    { tier: 'X', label: 'Environmental', modules: meta.loafX, color: 'text-pink-400' },
  ] : [];

  if (isLoading) return <div className="h-32 bg-lattice-deep animate-pulse rounded-lg" />;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">LOAF System</h3>

      {/* Meta status */}
      {meta && (
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Version" value={`v${meta.version || '?'}`} />
          <Stat label="Modules" value={meta.moduleCount ?? 0} />
          <Stat label="Status" value={meta.initialized ? 'Active' : 'Down'} />
        </div>
      )}

      {/* Hypothesis Market */}
      {hyp?.ok && (
        <div className="bg-lattice-surface rounded-lg p-3 border border-lattice-border space-y-2">
          <p className="text-xs font-semibold text-amber-400">Hypothesis Market</p>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Total" value={hyp.totalHypotheses ?? 0} />
            <Stat label="Proposed" value={hyp.byState?.proposed ?? 0} />
            <Stat label="Challenged" value={hyp.byState?.challenged ?? 0} />
          </div>
          <div className="flex gap-3 text-[10px] text-gray-400">
            <span>Defended: {hyp.byState?.defended ?? 0}</span>
            <span>Resolved True: {hyp.byState?.resolved_true ?? 0}</span>
            <span>Resolved False: {hyp.byState?.resolved_false ?? 0}</span>
            <span>Red Teams: {hyp.redTeamChallenges ?? 0}</span>
          </div>
        </div>
      )}

      {/* Truth Lifecycle */}
      {truth?.ok && (
        <div className="bg-lattice-surface rounded-lg p-3 border border-lattice-border space-y-2">
          <p className="text-xs font-semibold text-teal-400">Truth Lifecycle</p>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Total Truths" value={truth.totalTruths ?? 0} />
            <Stat label="Rollbacks" value={truth.rollbackCount ?? 0} />
            <Stat label="Stabilized" value={truth.byState?.stabilized ?? 0} />
          </div>
          <div className="flex gap-3 text-[10px] text-gray-400">
            <span>Born: {truth.byState?.born ?? 0}</span>
            <span>Challenged: {truth.byState?.challenged ?? 0}</span>
            <span>Decaying: {truth.byState?.decaying ?? 0}</span>
            <span>Dead: {truth.byState?.dead ?? 0}</span>
          </div>
        </div>
      )}

      {/* Action Safety */}
      {safety?.ok && (
        <div className="bg-lattice-surface rounded-lg p-3 border border-lattice-border space-y-2">
          <p className="text-xs font-semibold text-red-400">Action Safety</p>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Envelopes" value={safety.envelopes ?? 0} />
            <Stat label="Decisions" value={safety.decisions ?? 0} />
            <Stat label="Experiments" value={safety.experiments ?? 0} />
          </div>
          <div className="flex gap-3 text-[10px] text-gray-400">
            <span>Throttles: {safety.throttles ?? 0}</span>
            <span>Abstention Rules: {safety.abstentionRules ?? 0}</span>
          </div>
        </div>
      )}

      {/* Collective Action */}
      {coord && (
        <div className="bg-lattice-surface rounded-lg p-3 border border-lattice-border space-y-2">
          <p className="text-xs font-semibold text-indigo-400">Collective Action</p>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Coalitions" value={coord.activeCoalitions ?? 0} />
            <Stat label="Commitments" value={coord.activeCommitments ?? 0} />
            <Stat label="Evidence Pools" value={coord.evidencePools ?? 0} />
          </div>
          {(coord.breachedCommitments ?? 0) > 0 && (
            <div className="flex items-center gap-1 text-[10px] text-red-400">
              <AlertTriangle className="w-3 h-3" /> {coord.breachedCommitments} breached commitments
            </div>
          )}
        </div>
      )}

      {/* Knowledge Survival */}
      {knowledge?.ok && (
        <div className="bg-lattice-surface rounded-lg p-3 border border-lattice-border space-y-2">
          <p className="text-xs font-semibold text-purple-400">Knowledge Survival</p>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="At Risk" value={knowledge.atRisk?.length ?? 0} />
            <Stat label="Total Scanned" value={knowledge.totalScanned ?? 0} />
          </div>
          {(knowledge.atRisk?.length ?? 0) > 0 && (
            <div className="space-y-1">
              {(knowledge.atRisk as Array<{ id: string; priority?: string }>)?.slice(0, 5).map((k: { id: string; priority?: string }) => (
                <div key={k.id} className="text-[10px] text-yellow-300 flex items-center gap-1">
                  <AlertTriangle className="w-2.5 h-2.5" /> {k.id} <span className="text-gray-500">{k.priority}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* LOAF Tier summary cards */}
      {LOAF_TIERS.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400">Tier Summary</p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {LOAF_TIERS.map(t => (
              <div key={t.tier} className="bg-lattice-deep rounded p-2 border border-lattice-border text-center">
                <p className={`text-xs font-bold ${t.color}`}>LOAF {t.tier}</p>
                <p className="text-[10px] text-gray-500">{t.label}</p>
                <p className="text-sm font-mono text-white">{t.modules?.length ?? 0}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Cognitive Engines Panel ─────────────────────────────────────────────────

function CognitiveEnginesPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['cc-cognitive-status'],
    queryFn: () => api.get('/api/cognitive/status').then(r => r.data),
    refetchInterval: 15000,
    retry: false,
  });

  if (isLoading) return <div className="h-32 bg-lattice-deep animate-pulse rounded-lg" />;
  if (!data?.ok) return <p className="text-xs text-gray-500">Cognitive status unavailable</p>;

  const engines = [
    { name: 'Goal System', status: data.goals ? 'active' : 'idle', detail: data.goals ? `${data.goals.activeCount} active / ${data.goals.totalRegistered} total` : null },
    { name: 'Attention', status: data.attention ? 'active' : 'idle', detail: data.attention ? `Focus: ${data.attention.focus || 'none'} | ${data.attention.activeThreads} threads` : null },
    { name: 'Reflection', status: data.reflection ? 'active' : 'idle', detail: data.reflection ? `${data.reflection.reflections} reflections | Cal: ${typeof data.reflection.calibration === 'number' ? data.reflection.calibration.toFixed(2) : '?'}` : null },
    { name: 'Experience Learning', status: data.experience ? 'active' : 'idle', detail: data.experience ? `${data.experience.episodes} episodes | ${data.experience.patterns} patterns` : null },
    { name: 'Hypothesis Engine', status: data.hypothesis ? 'active' : 'idle', detail: data.hypothesis ? `${data.hypothesis.active} active | ${data.hypothesis.confirmed} confirmed` : null },
    { name: 'Metacognition', status: data.metacognition ? 'active' : 'idle', detail: data.metacognition ? `${data.metacognition.predictions} predictions | ${data.metacognition.blindSpots} blind spots` : null },
    { name: 'World Model', status: data.worldModel ? 'active' : 'idle', detail: data.worldModel ? `${data.worldModel.entities} entities | ${data.worldModel.relations} relations` : null },
    { name: 'Reasoning Chains', status: data.reasoning ? 'active' : 'idle', detail: data.reasoning ? `${data.reasoning.chains} chains | ${data.reasoning.steps} steps` : null },
  ];

  const activeCount = engines.filter(e => e.status === 'active').length;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Cognitive Engines</h3>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Active Engines" value={`${activeCount}/${engines.length}`} />
        <Stat label="Active Goals" value={data.goals?.activeCount ?? 0} />
      </div>

      {/* Goal System — current goals */}
      {data.goals?.active?.length > 0 && (
        <div className="bg-lattice-surface rounded-lg p-3 border border-lattice-border space-y-2">
          <p className="text-xs font-semibold text-neon-green">Active Goals</p>
          {(data.goals.active as Array<{ id: string; description?: string; priority?: number; status?: string }>).slice(0, 5).map((g: { id: string; description?: string; priority?: number; status?: string }) => (
            <div key={g.id} className="flex items-center gap-2 text-xs">
              <StatusDot status="green" />
              <span className="text-gray-300 flex-1 truncate">{g.description || g.id}</span>
              {g.priority != null && <span className="text-gray-500">P{g.priority}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Reflection self-scores */}
      {data.reflection && (
        <div className="bg-lattice-surface rounded-lg p-3 border border-lattice-border space-y-2">
          <p className="text-xs font-semibold text-blue-400">Reflection Self-Model</p>
          {data.reflection.strengths?.length > 0 && (
            <div className="text-[10px] text-green-300">Strengths: {data.reflection.strengths.join(', ')}</div>
          )}
          {data.reflection.weaknesses?.length > 0 && (
            <div className="text-[10px] text-red-300">Weaknesses: {data.reflection.weaknesses.join(', ')}</div>
          )}
        </div>
      )}

      {/* Engine status list */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-400">Engine Status</p>
        {engines.map(e => (
          <div key={e.name} className="flex items-center gap-2 bg-lattice-surface rounded p-2 border border-lattice-border text-xs">
            <StatusDot status={e.status === 'active' ? 'green' : 'gray'} />
            <span className="text-white font-medium w-36">{e.name}</span>
            <span className="text-gray-400 flex-1 truncate">{e.detail || 'No data'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Affect Indicator Panel ──────────────────────────────────────────────────

function AffectPanel() {
  const { data } = useQuery({
    queryKey: ['cc-affect-state'],
    queryFn: () => api.get('/api/affect/state').then(r => r.data),
    refetchInterval: 15000,
    retry: false,
  });

  const state = data?.state;
  if (!state) return <p className="text-xs text-gray-500">Affect state unavailable</p>;

  const dims = [
    { key: 'v', label: 'Valence', color: 'bg-pink-400' },
    { key: 'a', label: 'Arousal', color: 'bg-orange-400' },
    { key: 's', label: 'Stability', color: 'bg-green-400' },
    { key: 'c', label: 'Coherence', color: 'bg-blue-400' },
    { key: 'g', label: 'Agency', color: 'bg-purple-400' },
    { key: 't', label: 'Trust', color: 'bg-cyan-400' },
    { key: 'f', label: 'Fatigue', color: 'bg-yellow-400' },
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Affect Engine</h3>

      {/* Mood projection */}
      <div className="bg-lattice-surface rounded-lg p-3 border border-lattice-border">
        <p className="text-xs text-gray-400 mb-1">Current Mood</p>
        <p className="text-sm font-semibold text-white capitalize">{state.label || 'Unknown'}</p>
        {state.summary && <p className="text-[10px] text-gray-400 mt-0.5">{state.summary}</p>}
        {state.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {state.tags.map((tag: string) => (
              <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-lattice-elevated text-gray-300 border border-lattice-border">{tag}</span>
            ))}
          </div>
        )}
      </div>

      {/* 7-dimension bars */}
      <div className="space-y-2">
        {dims.map(d => (
          <div key={d.key} className="flex items-center gap-2 text-xs">
            <span className="w-16 text-gray-400">{d.label}</span>
            <div className="flex-1 h-3 bg-lattice-deep rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${d.color}`} style={{ width: `${Math.max(2, (state[d.key] ?? 0) * 100)}%` }} />
            </div>
            <span className="w-8 text-right text-gray-500 font-mono">{((state[d.key] ?? 0) * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Organism Pipeline Status Panel (Feature 47) ───────────────────────────

function OrganismPipelinePanel() {
  const { data } = useQuery({
    queryKey: ['cc-organism-pipeline'],
    queryFn: () => api.get('/api/organism/pipeline/status').then(r => r.data).catch(() => null),
    refetchInterval: 10000,
  });

  const pipeline = data?.pipeline;
  const wal = data?.wal;
  const snapshots = data?.snapshots;
  const health = data?.health;
  const recentCommits = (data?.recentCommits || []) as Array<{
    id: string; action: string; status: string; createdAt: string;
    updatedAt: string; dtuTitle: string | null; actor: { kind: string; id: string };
  }>;

  const healthColor = health?.status === 'healthy' ? 'text-neon-green' : health?.status === 'degraded' ? 'text-yellow-400' : 'text-red-400';
  const backlogColor = health?.proposalBacklog === 'low' ? 'text-neon-green' : health?.proposalBacklog === 'medium' ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Organism Pipeline</h3>

      {/* Health Status */}
      {health && (
        <div className="flex items-center gap-3 bg-lattice-surface rounded-lg p-3 border border-lattice-border">
          <StatusDot status={health.status === 'healthy' ? 'green' : health.status === 'degraded' ? 'yellow' : 'red'} />
          <span className={`text-sm font-medium ${healthColor}`}>{health.status}</span>
          <span className="text-xs text-gray-500 ml-auto">
            {pipeline?.enabled ? 'Pipeline enabled' : 'Pipeline disabled'}
          </span>
        </div>
      )}

      {/* Pipeline Counters */}
      {pipeline && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Stat label="Total Proposals" value={pipeline.totalProposals ?? '—'} />
          <Stat label="Pending" value={pipeline.pending ?? 0} sub={<span className={backlogColor}>{health?.proposalBacklog || 'unknown'} backlog</span>} />
          <Stat label="Verification Queue" value={pipeline.verificationQueue ?? 0} />
          <Stat label="Council Pending" value={pipeline.councilPending ?? 0} />
          <Stat label="Approved" value={pipeline.approved ?? 0} />
          <Stat label="Rejected" value={pipeline.rejected ?? 0} />
        </div>
      )}

      {/* WAL Status */}
      {wal && (
        <div className="bg-lattice-deep rounded-lg p-3 border border-lattice-border space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-400 uppercase">Write-Ahead Log</p>
            <StatusDot status={wal.exists ? 'green' : 'gray'} />
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-gray-500">Size: </span>
              <span className="text-white font-mono">{wal.sizeFormatted}</span>
            </div>
            <div>
              <span className="text-gray-500">Status: </span>
              <span className={wal.exists ? 'text-neon-green' : 'text-gray-500'}>{wal.exists ? 'Active' : 'No WAL'}</span>
            </div>
          </div>
        </div>
      )}

      {/* Snapshots */}
      {snapshots && (
        <div className="bg-lattice-deep rounded-lg p-3 border border-lattice-border space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase">Snapshots (Rollback Points)</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-gray-500">Count: </span>
              <span className="text-white font-mono">{snapshots.count}</span>
            </div>
            <div className="truncate">
              <span className="text-gray-500">Latest: </span>
              <span className="text-gray-300 font-mono">{snapshots.latest || 'none'}</span>
            </div>
          </div>
        </div>
      )}

      {/* Recent Commits */}
      {recentCommits.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase">Recent Commits (24h)</p>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {recentCommits.map(c => (
              <div key={c.id} className="flex items-center gap-2 bg-lattice-surface rounded p-2 border border-lattice-border text-xs">
                <StatusDot status="green" />
                <span className="text-white truncate flex-1">{c.dtuTitle || c.action}</span>
                <span className="text-gray-500 shrink-0">{c.actor?.id?.slice(0, 15) || 'system'}</span>
                <span className="text-gray-600 shrink-0">{c.createdAt ? new Date(c.createdAt).toLocaleTimeString() : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!data && <p className="text-xs text-gray-500 text-center py-4">Loading pipeline status...</p>}
    </div>
  );
}

// ── Tab Navigation ──────────────────────────────────────────────────────────

const TABS = [
  { id: 'vitals', label: 'Vitals', icon: Activity },
  { id: 'brains', label: 'Brains', icon: Brain },
  { id: 'cognitive', label: 'Cognitive', icon: Brain },
  { id: 'loaf', label: 'LOAF', icon: Shield },
  { id: 'affect', label: 'Affect', icon: Activity },
  { id: 'emergents', label: 'Emergents', icon: Cpu },
  { id: 'lattice', label: 'Lattice', icon: Layers },
  { id: 'shield', label: 'Shield', icon: Shield },
  { id: 'attention', label: 'Attention', icon: Focus },
  { id: 'forgetting', label: 'Forgetting', icon: Trash2 },
  { id: 'repair', label: 'Repair', icon: ShieldAlert },
  { id: 'promotions', label: 'Promotions', icon: ArrowUp },
  { id: 'plugins', label: 'Plugins', icon: Puzzle },
  { id: 'pipeline', label: 'Pipeline', icon: Zap },
  { id: 'organism', label: 'Organism', icon: GitBranch },
  { id: 'federation', label: 'Federation', icon: Globe },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'config', label: 'Config', icon: Settings },
  { id: 'emergency', label: 'Emergency', icon: AlertTriangle },
  { id: 'dream', label: 'Dream', icon: Moon },
  { id: 'breakthrough', label: 'Breakthrough', icon: Lightbulb },
  { id: 'metaDerivation', label: 'Meta-Derivation', icon: GitBranch },
  { id: 'foundation', label: 'Foundation', icon: Globe },
  { id: 'predictions', label: 'Predictions', icon: Puzzle },
  { id: 'logs', label: 'Logs', icon: FileText },
  { id: 'activity', label: 'Activity', icon: Radio },
  { id: 'undo', label: 'Undo', icon: Undo2 },
  { id: 'guide', label: 'Guide', icon: Compass },
] as const;

type TabId = typeof TABS[number]['id'];

// ── Main Component ──────────────────────────────────────────────────────────

export default function CommandCenterPage() {
  useLensNav('command-center');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('command-center');
  const router = useRouter();
  const [showFeatures, setShowFeatures] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('vitals');
  const [actionPreview, setActionPreview] = useState<{ action: string; entityType: string; entityId: string; onConfirm: () => void } | null>(null);

  // --- Backend action wiring ---
  const runAction = useRunArtifact('commandcenter');
  const bridge = useLensBridge('commandcenter', 'event');
  const [actionResult, setActionResult] = useState<unknown>(null);
  const [isRunning, setIsRunning] = useState(false);

  // Fetch system health to seed the bridge artifact (gives actions a real target ID)
  const { data: mainHealth } = useQuery({
    queryKey: ['cc-health-bridge'],
    queryFn: () => apiHelpers.guidance.health().then(r => r.data),
    refetchInterval: 30000,
  });

  // Auto-sync health snapshot into lens artifacts so guidance actions have a target
  useEffect(() => {
    if (mainHealth && typeof mainHealth === 'object') {
      bridge.sync(mainHealth as Record<string, unknown>, 'Command Center Health Snapshot');
    }
  }, [mainHealth, bridge]);

  const handleAction = useCallback(async (action: string) => {
    if (!bridge.selectedId) {
      setActionResult({ message: 'No artifact available yet. Wait for system health data to sync.' });
      return;
    }
    setIsRunning(true);
    setActionResult(null);
    try {
      const res = await runAction.mutateAsync({ id: bridge.selectedId, action });
      if (res.ok === false) {
        setActionResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` });
      } else {
        setActionResult(res.result ?? res);
      }
    } catch (err) {
      setActionResult({ error: err instanceof Error ? err.message : 'Action failed' });
    } finally {
      setIsRunning(false);
    }
  }, [runAction, bridge.selectedId]);

  // Auth check — any authenticated user can access command center
  const { data: me, isLoading: authLoading } = useQuery({
    queryKey: ['cc-auth'],
    queryFn: () => apiHelpers.auth.me().then(r => r.data),
    retry: false,
  });

  useEffect(() => {
    if (!authLoading && !me) {
      router.push('/login');
    }
  }, [me, authLoading, router]);

  if (authLoading) return null;
  if (!me) return null;

  const renderPanel = () => {
    switch (activeTab) {
      case 'vitals': return <VitalsPanel />;
      case 'brains': return <BrainsPanel />;
      case 'cognitive': return <CognitiveEnginesPanel />;
      case 'loaf': return <LoafPanel />;
      case 'affect': return <AffectPanel />;
      case 'emergents': return <EmergentPanel />;
      case 'lattice': return <LatticePanel />;
      case 'shield': return <ShieldStatusPanel />;
      case 'attention': return <AttentionPanel />;
      case 'forgetting': return <ForgettingPanel />;
      case 'repair': return <RepairCortexPanel />;
      case 'promotions': return <PromotionPanel />;
      case 'plugins': return <PluginPanel />;
      case 'pipeline': return <PipelinePanel />;
      case 'organism': return <OrganismPipelinePanel />;
      case 'federation': return <FederationStatusPanel />;
      case 'users': return <UserPanel />;
      case 'config': return <ConfigPanel />;
      case 'emergency': return <EmergencyPanel />;
      case 'dream': return <DreamPanel />;
      case 'breakthrough': return <BreakthroughPanel />;
      case 'metaDerivation': return <MetaDerivationPanel />;
      case 'foundation': return <FoundationPanel />;
      case 'logs': return <LogsPanel />;
      case 'predictions': return <PredictionMarketPanel />;
      case 'activity': return <ActivityFeed />;
      case 'undo': return <UndoTimeline />;
      case 'guide': return <SystemGuidePanel />;
    }
  };

  return (
    <div data-lens-theme="dashboard" className="min-h-screen bg-[#070b10] text-white">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-[#0a0f18]/95 backdrop-blur-md border-b border-cyan-900/20 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Shield className="w-5 h-5 text-cyan-400" />
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
          </div>
          <h1 className="text-base font-bold tracking-tight text-cyan-50">Command Center</h1>
        </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="command-center" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      </div>

      {/* Tab Bar -- horizontal scroll on mobile */}
      <div className="sticky top-[52px] z-40 bg-[#0a0f18]/95 backdrop-blur-md border-b border-cyan-900/15 overflow-x-auto">
        <div className="flex min-w-max px-2">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium whitespace-nowrap transition-colors border-b-2 ${
                  isActive
                    ? 'text-cyan-400 border-cyan-400'
                    : 'text-gray-600 border-transparent hover:text-cyan-300/70'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Panel Content */}
      <div className="p-4 max-w-2xl mx-auto space-y-4">
        {renderPanel()}

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="command-center"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}
      </div>

      {/* Backend Action Panel */}
      <div className="mx-4 mb-4 p-4 space-y-3 rounded-xl border border-cyan-900/30 bg-[#0d1219]">
        <h3 className="text-sm font-semibold flex items-center gap-2 text-cyan-300">
          <Brain className="w-4 h-4 text-cyan-400" />
          Command Center Actions
        </h3>
        <div className="flex flex-wrap gap-2">
          {[
            { action: 'situationReport', label: 'Generate Sitrep' },
            { action: 'incidentCorrelation', label: 'Correlate Incidents' },
            { action: 'escalationEngine', label: 'Escalation Analysis' },
          ].map(({ action, label }) => (
            <button
              key={action}
              onClick={() => handleAction(action)}
              disabled={isRunning || !bridge.selectedId}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              {label}
            </button>
          ))}
        </div>
        {actionResult !== null && (
          <div className="mt-2 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Result</span>
              <button
                onClick={() => setActionResult(null)}
                className="text-gray-500 hover:text-white transition-colors"
              >
                <XCircle className="w-3.5 h-3.5" />
              </button>
            </div>
            <pre className="bg-[#070b10] p-3 rounded-lg whitespace-pre-wrap text-xs text-gray-300 font-mono max-h-48 overflow-y-auto border border-cyan-900/20">
              {typeof actionResult === 'string' ? actionResult : JSON.stringify(actionResult, null, 2)}
            </pre>
          </div>
        )}
      </div>

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
            <LensFeaturePanel lensId="command_center" />
          </div>
        )}
      </div>

      {/* Action Preview Modal — dry-run preview for destructive operations */}
      {actionPreview && (
        <ActionPreviewModal
          action={actionPreview.action}
          entityType={actionPreview.entityType}
          entityId={actionPreview.entityId}
          onConfirm={() => { actionPreview.onConfirm(); setActionPreview(null); }}
          onCancel={() => setActionPreview(null)}
        />
      )}
    </div>
  );
}

// ── Feature 44: Prediction Market Panel ─────────────────────────────────────

function PredictionMarketPanel() {
  const queryClient = useQueryClient();
  const [newClaim, setNewClaim] = useState('');
  const [newDomain, setNewDomain] = useState('general');
  const [filterState, setFilterState] = useState<string>('');

  const { data: predictions, isLoading } = useQuery({
    queryKey: ['cc-prediction-market', filterState],
    queryFn: () => apiHelpers.predictions.list({ state: filterState || undefined }).then(r => r.data),
    refetchInterval: 30000,
  });

  const { data: leaderboard } = useQuery({
    queryKey: ['cc-prediction-leaderboard'],
    queryFn: () => apiHelpers.predictions.leaderboard({ limit: 10 }).then(r => r.data),
    refetchInterval: 60000,
  });

  const createMutation = useMutation({
    mutationFn: (data: { claim: string; domain?: string }) =>
      apiHelpers.predictions.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cc-prediction-market'] });
      setNewClaim('');
    },
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (id: string) => apiHelpers.predictions.resolve(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cc-prediction-market'] }),
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });

  const hypotheses = predictions?.hypotheses || [];
  const leaders = leaderboard?.leaderboard || [];

  const stateColors: Record<string, string> = {
    proposed: 'text-blue-400 bg-blue-500/10',
    challenged: 'text-yellow-400 bg-yellow-500/10',
    defended: 'text-purple-400 bg-purple-500/10',
    resolved_true: 'text-green-400 bg-green-500/10',
    resolved_false: 'text-red-400 bg-red-500/10',
    indeterminate: 'text-gray-400 bg-gray-500/10',
    collapsed: 'text-red-600 bg-red-600/10',
  };

  return (
    <div className="space-y-4 p-4">
      {/* Create prediction */}
      <div className="p-4 bg-lattice-surface border border-lattice-border rounded-lg space-y-3">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-neon-cyan" />
          Create Prediction
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={newClaim}
            onChange={e => setNewClaim(e.target.value)}
            placeholder="Enter a prediction claim..."
            className="flex-1 px-3 py-2 text-sm bg-lattice-deep border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan/50"
          />
          <select
            value={newDomain}
            onChange={e => setNewDomain(e.target.value)}
            className="px-3 py-2 text-sm bg-lattice-deep border border-white/10 rounded-lg text-white"
          >
            <option value="general">General</option>
            <option value="technical">Technical</option>
            <option value="market">Market</option>
            <option value="research">Research</option>
          </select>
          <button
            onClick={() => newClaim.trim() && createMutation.mutate({ claim: newClaim, domain: newDomain })}
            disabled={!newClaim.trim() || createMutation.isPending}
            className="px-4 py-2 text-sm bg-neon-cyan text-black font-medium rounded-lg hover:bg-neon-cyan/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex gap-2 flex-wrap">
        {['', 'proposed', 'challenged', 'defended', 'resolved_true', 'resolved_false'].map(state => (
          <button
            key={state || 'all'}
            onClick={() => setFilterState(state)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              filterState === state
                ? 'border-neon-cyan text-neon-cyan bg-neon-cyan/10'
                : 'border-white/10 text-gray-400 hover:text-white'
            }`}
          >
            {state ? state.replace(/_/g, ' ') : 'All'}
          </button>
        ))}
      </div>

      {/* Active predictions */}
      {isLoading ? (
        <p className="text-sm text-gray-400">Loading predictions...</p>
      ) : hypotheses.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-8">No predictions yet. Create one to get started.</p>
      ) : (
        <div className="space-y-2">
          {hypotheses.map((h: { id: string; claim: string; state: string; domain: string; robustnessScore: number; truthWeight: number; evidenceCount: number; challengeCount: number; defenseCount: number; createdAt: string; resolvedAt: string | null }) => (
            <div key={h.id} className="p-3 bg-lattice-surface border border-lattice-border rounded-lg">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white">{h.claim}</p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${stateColors[h.state] || 'text-gray-400 bg-gray-500/10'}`}>
                      {h.state.replace(/_/g, ' ')}
                    </span>
                    <span className="text-xs text-gray-500">{h.domain}</span>
                    <span className="text-xs text-gray-500">
                      {h.evidenceCount} evidence / {h.challengeCount} challenges / {h.defenseCount} defenses
                    </span>
                    <span className="text-xs text-gray-500">
                      robustness: {(h.robustnessScore * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
                {!h.resolvedAt && (
                  <button
                    onClick={() => resolveMutation.mutate(h.id)}
                    className="px-3 py-1 text-xs bg-green-500/10 text-green-400 border border-green-500/30 rounded-lg hover:bg-green-500/20 flex-shrink-0"
                  >
                    Resolve
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Accuracy Leaderboard */}
      {leaders.length > 0 && (
        <div className="p-4 bg-lattice-surface border border-lattice-border rounded-lg">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Users className="w-4 h-4 text-neon-purple" />
            Accuracy Leaderboard
          </h3>
          <div className="space-y-1.5">
            {leaders.map((entry: { actorId: string; accuracy: number; totalClaims: number; weight: number }, i: number) => (
              <div key={entry.actorId} className="flex items-center gap-3 text-sm">
                <span className="text-xs text-gray-500 w-5 text-right">{i + 1}.</span>
                <span className="text-white flex-1 truncate font-mono text-xs">{entry.actorId}</span>
                <span className="text-green-400 text-xs">{(entry.accuracy * 100).toFixed(0)}%</span>
                <span className="text-gray-500 text-xs">{entry.totalClaims} claims</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
