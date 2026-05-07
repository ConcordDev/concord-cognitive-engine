'use client';

import { motion } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers, api } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { useState } from 'react';
import { Users, Plus, Terminal, GitFork, Activity, Play, Brain, X, Cpu, Bot, Search, Loader2, Network, ShieldCheck, Link2, XCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import QualiaSensoryFeed from '@/components/emergent/QualiaSensoryFeed';
import QualiaBodyMap from '@/components/emergent/QualiaBodyMap';
import PresenceDashboard from '@/components/emergent/PresenceDashboard';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useLensData } from '@/lib/hooks/use-lens-data';
import EntityLifecycleViz from '@/components/visualizations/EntityLifecycleViz';
import { resolveEntityName } from '@/lib/entity-naming';

interface Entity {
  id: string;
  name: string;
  displayName?: string;
  fullTitle?: string;
  domain?: string;
  role?: string;
  type: 'worker' | 'researcher' | 'guardian' | 'architect';
  status: 'active' | 'idle' | 'suspended';
  workspace: string;
  forks: number;
  createdAt: string;
  lastActive: string;
}

export default function EntityLensPage() {
  useLensNav('entity');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('entity');
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newEntityName, setNewEntityName] = useState('');
  const [newEntityType, setNewEntityType] = useState<Entity['type']>('worker');
  const [terminalEntity, setTerminalEntity] = useState<string | null>(null);
  const [terminalCommand, setTerminalCommand] = useState('');
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
  const [qualiaEntity, setQualiaEntity] = useState<string | null>(null);
  const [cognitiveEntity, setCognitiveEntity] = useState<string | null>(null);
  const [entityActionResult, setEntityActionResult] = useState<Record<string, unknown> | null>(null);
  const [entityRunning, setEntityRunning] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<string | null>(null);

  // Backend action runner
  const runEntityAction = useRunArtifact('entity');
  const { items: entityArtifacts } = useLensData<Record<string, unknown>>('entity', 'entity', { seed: [] });

  const handleEntityAction = async (action: string) => {
    const targetId = entityArtifacts[0]?.id;
    if (!targetId) return;
    setEntityRunning(action);
    setActiveAction(action);
    setEntityActionResult(null);
    try {
      const res = await runEntityAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setEntityActionResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setEntityActionResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error(`Entity action ${action} failed:`, e); setEntityActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    setEntityRunning(null);
  };

  // Fetch entities from worldmodel backend
  const { data: entitiesData, isLoading, isError: isError, error: error, refetch: refetch,} = useQuery({
    queryKey: ['worldmodel-entities'],
    queryFn: () => apiHelpers.worldmodel.entities().then(r => r.data),
    refetchInterval: 10000,
  });

  const entities: Entity[] = entitiesData?.entities || [];

  const createEntity = useMutation({
    mutationFn: (data: { name: string; type: string }) =>
      apiHelpers.worldmodel.createEntity(data).then(r => r.data),
    onSuccess: () => {
      setShowCreate(false);
      setNewEntityName('');
      queryClient.invalidateQueries({ queryKey: ['worldmodel-entities'] });
    },
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Entity operation failed. The server may still be loading.' });
    },
  });

  const forkEntity = useMutation({
    mutationFn: async (entityId: string) => {
      // Fork = get entity, then create a copy with updated name
      const original = await apiHelpers.worldmodel.getEntity(entityId);
      const entity = original.data;
      const res = await apiHelpers.worldmodel.createEntity({
        name: `${entity?.name || 'entity'} (fork)`,
        type: entity?.type || 'generic',
        properties: { ...(entity?.properties || {}), forkedFrom: entityId },
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['worldmodel-entities'] });
    },
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Entity operation failed. The server may still be loading.' });
    },
  });

  const executeTerminal = useMutation({
    mutationFn: async (data: { entityId: string; command: string }) => {
      // Use lens run as a command execution proxy
      const res = await apiHelpers.lens.run('entity', data.entityId, { action: 'terminal', params: { command: data.command } });
      return res.data;
    },
    onSuccess: (data) => {
      setTerminalOutput(prev => [
        ...prev,
        `$ ${terminalCommand}`,
        data.output || data.error || JSON.stringify(data)
      ]);
      setTerminalCommand('');
    },
    onError: (err: Record<string, unknown>) => {
      setTerminalOutput(prev => [
        ...prev,
        `$ ${terminalCommand}`,
        `Error: ${err.message || 'Command failed'}`
      ]);
    },
  });

  const typeColors = {
    worker: 'text-neon-blue bg-neon-blue/20',
    researcher: 'text-neon-purple bg-neon-purple/20',
    guardian: 'text-neon-green bg-neon-green/20',
    architect: 'text-neon-cyan bg-neon-cyan/20',
  };

  const statusColors = {
    active: 'bg-neon-green',
    idle: 'bg-yellow-500',
    suspended: 'bg-neon-pink',
  };


  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }
  return (
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🤖</span>
          <div>
            <h1 className="text-xl font-bold">Entity Lens</h1>
            <p className="text-sm text-gray-400">
              Create and manage swarm entities with terminal access
            </p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="entity" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="btn-neon purple"
        >
          <Plus className="w-4 h-4 mr-2 inline" />
          Spawn Entity
        </button>
      </header>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Entities', value: entities.length, icon: Bot },
          { label: 'Relationships', value: entities.reduce((s, e) => s + e.forks, 0), icon: GitFork },
          { label: 'Active', value: entities.filter(e => e.status === 'active').length, icon: Activity },
          { label: 'Workspaces', value: new Set(entities.map(e => e.workspace)).size, icon: Cpu },
        ].map((stat) => (
          <div key={stat.label} className="panel flex items-center gap-3 p-3">
            <stat.icon className="w-5 h-5 text-neon-cyan shrink-0" />
            <div>
              <p className="text-xs text-gray-400">{stat.label}</p>
              <p className="text-lg font-bold text-white">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Entity Lifecycle Timeline Visualization */}
      <EntityLifecycleViz />

      {/* Create Entity Form */}
      {showCreate && (
        <div className="panel p-4 space-y-4">
          <h3 className="font-semibold">Spawn New Entity</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-400 block mb-2">Entity Name</label>
              <input
                type="text"
                value={newEntityName}
                onChange={(e) => setNewEntityName(e.target.value)}
                placeholder="e.g., Research Beta"
                className="input-lattice w-full"
              />
            </div>
            <div>
              <label className="text-sm text-gray-400 block mb-2">Entity Type</label>
              <select
                value={newEntityType}
                onChange={(e) => setNewEntityType(e.target.value as Entity['type'])}
                className="input-lattice w-full"
              >
                <option value="worker">Worker - Task execution</option>
                <option value="researcher">Researcher - DTU synthesis</option>
                <option value="guardian">Guardian - Security & invariants</option>
                <option value="architect">Architect - System evolution</option>
              </select>
            </div>
          </div>
          <button
            onClick={() => createEntity.mutate({ name: newEntityName, type: newEntityType })}
            disabled={!newEntityName || createEntity.isPending}
            className="btn-neon green"
          >
            {createEntity.isPending ? 'Spawning...' : 'Spawn Entity'}
          </button>
        </div>
      )}

      {/* Terminal Modal */}
      {terminalEntity && (
        <div className="panel p-4 space-y-4 border-2 border-neon-cyan">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2">
              <Terminal className="w-4 h-4 text-neon-cyan" />
              Terminal: {entities.find(e => e.id === terminalEntity)?.name}
            </h3>
            <button
              onClick={() => {
                setTerminalEntity(null);
                setTerminalOutput([]);
              }}
              className="text-gray-400 hover:text-white"
            >
              X
            </button>
          </div>
          <div className="bg-black rounded p-3 h-48 overflow-y-auto font-mono text-sm text-neon-green">
            {terminalOutput.length === 0 ? (
              <p className="text-gray-500">Terminal ready. Entity has council-gated access to system commands.</p>
            ) : (
              terminalOutput.map((line, i) => (
                <div key={i} className={line.startsWith('$') ? 'text-white' : ''}>{line}</div>
              ))
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={terminalCommand}
              onChange={(e) => setTerminalCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && terminalCommand.trim()) {
                  executeTerminal.mutate({ entityId: terminalEntity, command: terminalCommand });
                }
              }}
              placeholder="Enter command..."
              className="input-lattice flex-1 font-mono"
            />
            <button
              onClick={() => {
                if (terminalCommand.trim()) {
                  executeTerminal.mutate({ entityId: terminalEntity, command: terminalCommand });
                }
              }}
              disabled={!terminalCommand.trim() || executeTerminal.isPending}
              className="btn-neon cyan"
            >
              <Play className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="lens-card">
          <Users className="w-5 h-5 text-neon-blue mb-2" />
          <p className="text-2xl font-bold">{entities.length}</p>
          <p className="text-sm text-gray-400">Total Entities</p>
        </div>
        <div className="lens-card">
          <Activity className="w-5 h-5 text-neon-green mb-2" />
          <p className="text-2xl font-bold">{entities.filter((e) => e.status === 'active').length}</p>
          <p className="text-sm text-gray-400">Active</p>
        </div>
        <div className="lens-card">
          <GitFork className="w-5 h-5 text-neon-purple mb-2" />
          <p className="text-2xl font-bold">{entities.reduce((s, e) => s + e.forks, 0)}</p>
          <p className="text-sm text-gray-400">Total Forks</p>
        </div>
        <div className="lens-card">
          <Terminal className="w-5 h-5 text-neon-cyan mb-2" />
          <p className="text-2xl font-bold">{new Set(entities.map((e) => e.workspace)).size}</p>
          <p className="text-sm text-gray-400">Workspaces</p>
        </div>
      </div>

      {/* Entity Grid */}
      <div className="panel p-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Users className="w-4 h-4 text-neon-blue" />
          Entity Registry
        </h2>
        {isLoading ? (
          <p className="text-gray-400">Loading entities...</p>
        ) : entities.length === 0 ? (
          <p className="text-gray-400">No entities spawned yet. Click "Spawn Entity" to create one.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {entities.map((entity, index) => {
              const resolved = resolveEntityName(entity);
              return (
              <motion.div key={entity.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className="lens-card">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-neon-cyan/30 to-neon-purple/30 flex items-center justify-center text-lg font-bold text-white flex-shrink-0">
                      {resolved.displayName[0]}
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold truncate">{resolved.displayName}</h3>
                      <p className="text-xs text-gray-400 truncate">{resolved.fullTitle} · {resolved.domain}</p>
                      <p className="text-[10px] text-gray-600 font-mono truncate">#{resolved.shortId}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${statusColors[entity.status]}`} />
                    <span className={`text-xs px-2 py-0.5 rounded ${typeColors[entity.type]}`}>
                      {entity.type}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-400">Workspace</p>
                    <p className="font-mono">{entity.workspace}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Forks</p>
                    <p className="font-bold text-neon-purple">{entity.forks}</p>
                  </div>
                </div>

                <div className="flex gap-2 mt-4">
                  <button
                    onClick={() => setTerminalEntity(entity.id)}
                    className="btn-neon text-xs flex-1"
                  >
                    <Terminal className="w-3 h-3 mr-1 inline" />
                    Terminal
                  </button>
                  <button
                    onClick={() => setQualiaEntity(entity.id)}
                    className="btn-neon text-xs flex-1"
                  >
                    <Brain className="w-3 h-3 mr-1 inline" />
                    Qualia
                  </button>
                  <button
                    onClick={() => setCognitiveEntity(entity.id)}
                    className="btn-neon text-xs flex-1"
                  >
                    <Cpu className="w-3 h-3 mr-1 inline" />
                    Cognitive
                  </button>
                  <button
                    onClick={() => forkEntity.mutate(entity.id)}
                    disabled={forkEntity.isPending}
                    className="btn-neon text-xs flex-1"
                  >
                    <GitFork className="w-3 h-3 mr-1 inline" />
                    Fork
                  </button>
                </div>
              </motion.div>
              );
            })}
          </div>
        )}

      {/* Qualia Detail Panel */}
      {qualiaEntity && (() => {
        const e = entities.find(e => e.id === qualiaEntity);
        const name = e ? resolveEntityName(e).displayName : qualiaEntity;
        return (
          <QualiaEntityPanel
            entityId={qualiaEntity}
            entityName={name}
            onClose={() => setQualiaEntity(null)}
          />
        );
      })()}

      {/* Cognitive Systems Detail Panel (Feature 22) */}
      {cognitiveEntity && (() => {
        const e = entities.find(e => e.id === cognitiveEntity);
        const name = e ? resolveEntityName(e).displayName : cognitiveEntity;
        return (
          <CognitiveEntityPanel
            entityId={cognitiveEntity}
            entityName={name}
            onClose={() => setCognitiveEntity(null)}
          />
        );
      })()}

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="entity"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}

      {/* Agent Status & Research Spawning (Feature 40) */}
      <AgentStatusPanel />
      </div>

      {/* ── Entity Domain Actions ─────────────────────────────────────────── */}
      <div className="panel p-4 space-y-4">
        <h2 className="font-semibold flex items-center gap-2">
          <Network className="w-4 h-4 text-neon-cyan" />
          Entity Domain Actions
        </h2>
        <p className="text-xs text-gray-400">
          Run analysis actions on the first artifact in this lens. Add an artifact with entity records, relationship data, or schema to unlock results.
        </p>
        <div className="flex flex-wrap gap-3">
          {[
            { action: 'entityResolution', label: 'Entity Resolution', icon: Link2, color: 'cyan' },
            { action: 'relationshipGraph', label: 'Relationship Graph', icon: Network, color: 'purple' },
            { action: 'attributeValidation', label: 'Attribute Validation', icon: ShieldCheck, color: 'green' },
          ].map(({ action, label, icon: Icon, color }) => (
            <button
              key={action}
              onClick={() => handleEntityAction(action)}
              disabled={!!entityRunning || entityArtifacts.length === 0}
              className={`btn-neon ${color} flex items-center gap-2 text-sm`}
            >
              {entityRunning === action ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Icon className="w-4 h-4" />
              )}
              {label}
            </button>
          ))}
        </div>
        {entityArtifacts.length === 0 && (
          <p className="text-xs text-yellow-400/70 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            No artifacts found. Create an entity artifact first.
          </p>
        )}

        {/* ── Action Results ───────────────────────────────────────────────── */}
        {entityActionResult && activeAction === 'entityResolution' && (
          <EntityResolutionResult result={entityActionResult} />
        )}
        {entityActionResult && activeAction === 'relationshipGraph' && (
          <RelationshipGraphResult result={entityActionResult} />
        )}
        {entityActionResult && activeAction === 'attributeValidation' && (
          <AttributeValidationResult result={entityActionResult} />
        )}
      </div>
    </div>
  );
}

// ── Qualia Entity Panel ────────────────────────────────────────────────────

function QualiaEntityPanel({ entityId, entityName, onClose }: { entityId: string; entityName: string; onClose: () => void }) {
  const { data: channelsData } = useQuery({
    queryKey: ['qualia-channels', entityId],
    queryFn: () => apiHelpers.qualia.channels(entityId).then(r => r.data),
    refetchInterval: 5000,
  });

  const { data: embodimentData } = useQuery({
    queryKey: ['qualia-embodiment', entityId],
    queryFn: () => apiHelpers.qualia.embodiment(entityId).then(r => r.data),
    refetchInterval: 8000,
  });

  const { data: presenceData } = useQuery({
    queryKey: ['qualia-presence', entityId],
    queryFn: () => apiHelpers.qualia.presence(entityId).then(r => r.data),
    refetchInterval: 8000,
  });

  const { data: planetaryData } = useQuery({
    queryKey: ['qualia-planetary', entityId],
    queryFn: () => apiHelpers.qualia.planetary(entityId).then(r => r.data),
    refetchInterval: 15000,
  });

  const { data: qualiaStateData } = useQuery({
    queryKey: ['qualia-state', entityId],
    queryFn: () => apiHelpers.qualia.state(entityId).then(r => r.data),
    refetchInterval: 8000,
  });

  const { data: registryData } = useQuery({
    queryKey: ['qualia-registry'],
    queryFn: () => apiHelpers.qualia.registry().then(r => r.data),
    staleTime: 60000,
  });

  const [section, setSection] = useState<'sensory' | 'body' | 'presence' | 'os-tiers'>('sensory');
  const sections = [
    { id: 'sensory' as const, label: 'Sensory Feed' },
    { id: 'body' as const, label: 'Body Map' },
    { id: 'presence' as const, label: 'Presence' },
    { id: 'os-tiers' as const, label: 'OS Tiers' },
  ];

  return (
    <div className="panel p-4 space-y-4 border-2 border-neon-purple mt-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <Brain className="w-4 h-4 text-neon-purple" />
          Qualia State: {entityName}
        </h3>
        <button onClick={onClose} className="text-gray-400 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>

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

      {section === 'sensory' && channelsData?.channels && (
        <QualiaSensoryFeed
          entityId={entityId}
          channels={channelsData.channels}
          overloadActive={channelsData.overloadActive}
        />
      )}

      {section === 'body' && embodimentData?.embodiment && channelsData?.channels && (
        <QualiaBodyMap
          entityId={entityId}
          embodiment={embodimentData.embodiment}
          channels={channelsData.channels}
          overloadActive={channelsData.overloadActive}
        />
      )}

      {section === 'presence' && presenceData?.presence && (
        <PresenceDashboard
          entityId={entityId}
          presence={presenceData.presence}
          existentialPillars={{}}
          planetary={planetaryData?.planetary}
        />
      )}

      {/* OS Tiers Heatmap (Feature 41) */}
      {section === 'os-tiers' && registryData?.grouped && (
        <ExistentialOSHeatmap
          grouped={registryData.grouped}
          qualiaState={qualiaStateData?.state}
        />
      )}

      {/* Fallback when no data yet */}
      {!channelsData?.channels && !embodimentData?.embodiment && !presenceData?.presence && section !== 'os-tiers' && (
        <div className="text-center py-8 text-zinc-500 text-sm">
          Loading qualia state for {entityName}...
        </div>
      )}
    </div>
  );
}

// ── Existential OS Heatmap (Feature 41) ────────────────────────────────────

interface OSEntry {
  key: string;
  label: string;
  category: string;
  description: string;
  numeric_channels: string[];
}

interface QualiaState {
  activeOS: string[];
  channels: Record<string, number>;
}

function ExistentialOSHeatmap({ grouped, qualiaState }: {
  grouped: Record<string, OSEntry[]>;
  qualiaState?: QualiaState | null;
}) {
  const channels = qualiaState?.channels || {};
  const activeOS = new Set(qualiaState?.activeOS || []);

  // Color intensity based on float value 0-1
  function intensityColor(value: number): string {
    if (value <= 0) return 'bg-zinc-800';
    if (value < 0.2) return 'bg-blue-900/60';
    if (value < 0.4) return 'bg-blue-700/60';
    if (value < 0.6) return 'bg-cyan-600/60';
    if (value < 0.8) return 'bg-cyan-500/70';
    return 'bg-cyan-400/80';
  }

  function intensityText(value: number): string {
    if (value <= 0) return 'text-zinc-600';
    if (value < 0.3) return 'text-blue-400';
    if (value < 0.6) return 'text-cyan-400';
    return 'text-cyan-300';
  }

  const tierOrder = [
    'Tier 0 \u2014 Core',
    'Tier 1 \u2014 Sensory',
    'Tier 2 \u2014 Simulation',
    'Tier 3 \u2014 Human Interface',
    'Tier 4 \u2014 Cosmic',
    'Tier 5 \u2014 Self/Meta',
    'Tier 6 \u2014 Presence',
  ];

  const sortedTiers = tierOrder.filter(t => grouped[t]);

  return (
    <div className="space-y-3">
      {!qualiaState && (
        <div className="text-xs text-zinc-500 bg-zinc-900 rounded p-2">
          No live qualia state for this entity. Showing registry structure.
        </div>
      )}
      {sortedTiers.map(tierName => {
        const osEntries = grouped[tierName] || [];
        return (
          <div key={tierName}>
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">{tierName}</h4>
            <div className="space-y-1.5">
              {osEntries.map(os => {
                const isActive = activeOS.has(os.key);
                return (
                  <div
                    key={os.key}
                    className={`bg-zinc-900 rounded-lg p-2 border ${
                      isActive ? 'border-cyan-800/50' : 'border-zinc-800'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-cyan-400' : 'bg-zinc-600'}`} />
                      <span className="text-xs font-medium text-white">{os.label}</span>
                      {!isActive && <span className="text-[10px] text-zinc-600">(inactive)</span>}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {os.numeric_channels.map(ch => {
                        const channelKey = `${os.key}.${ch}`;
                        const value = channels[channelKey] ?? 0;
                        return (
                          <div
                            key={ch}
                            className={`${intensityColor(value)} rounded px-1.5 py-0.5 text-[10px] flex items-center gap-1`}
                            title={`${ch}: ${value.toFixed(3)}`}
                          >
                            <span className="text-zinc-400 truncate max-w-[80px]">{ch.replace(/_/g, ' ')}</span>
                            <span className={`font-mono font-bold ${intensityText(value)}`}>{value.toFixed(2)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Agent Status Panel (Feature 40) ────────────────────────────────────────

function AgentStatusPanel() {
  const [researchTopic, setResearchTopic] = useState('');
  const queryClient = useQueryClient();

  const { data: statusData, isLoading } = useQuery({
    queryKey: ['agents-status'],
    queryFn: () => apiHelpers.agents.status().then(r => r.data),
    refetchInterval: 10000,
  });

  const spawnMutation = useMutation({
    mutationFn: (topic: string) => apiHelpers.agents.spawnResearch(topic).then(r => r.data),
    onSuccess: () => {
      setResearchTopic('');
      queryClient.invalidateQueries({ queryKey: ['agents-status'] });
    },
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Entity operation failed. The server may still be loading.' });
    },
  });

  const agents = statusData?.agents || [];
  const active = statusData?.active || 0;
  const paused = statusData?.paused || 0;

  return (
    <div className="panel p-4 space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <Bot className="w-4 h-4 text-neon-cyan" />
          Active Agents
        </h3>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400" />{active} active</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400" />{paused} paused</span>
        </div>
      </div>

      {/* Research Spawning */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={researchTopic}
            onChange={e => setResearchTopic(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && researchTopic.trim() && !spawnMutation.isPending) {
                spawnMutation.mutate(researchTopic.trim());
              }
            }}
            placeholder="Research topic X..."
            className="input-lattice w-full pl-9 text-sm"
            disabled={spawnMutation.isPending}
          />
        </div>
        <button
          onClick={() => researchTopic.trim() && spawnMutation.mutate(researchTopic.trim())}
          disabled={!researchTopic.trim() || spawnMutation.isPending}
          className="btn-neon cyan text-sm"
        >
          {spawnMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Spawn Research Agent'}
        </button>
      </div>

      {spawnMutation.data && (
        <div className="bg-zinc-900 rounded p-2 text-xs border border-cyan-900/40">
          <p className="text-cyan-400 font-medium">Agent spawned for &quot;{spawnMutation.data.topic}&quot;</p>
          <p className="text-gray-400">{spawnMutation.data.findingsCount} initial findings from lattice scan</p>
        </div>
      )}

      {/* Agent list */}
      {isLoading ? (
        <p className="text-xs text-gray-500">Loading agents...</p>
      ) : agents.length === 0 ? (
        <p className="text-xs text-gray-500">No agents deployed. Spawn a research agent above.</p>
      ) : (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {agents.slice(0, 20).map((a: Record<string, unknown>) => (
            <div key={a.agentId as string} className="flex items-center gap-2 text-xs bg-zinc-900 rounded p-2 border border-zinc-800">
              <span className={`w-2 h-2 rounded-full ${a.status === 'active' ? 'bg-green-400' : 'bg-yellow-400'}`} />
              <span className="text-white font-medium capitalize">{a.type as string}</span>
              <span className="text-gray-500 truncate flex-1">{a.territory as string}</span>
              <span className="text-gray-600 tabular-nums">{a.runCount as number} runs</span>
              <span className="text-gray-600 tabular-nums">{a.findingsCount as number} findings</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Cognitive Systems Entity Panel (Feature 22) ──────────────────────────

interface CognitiveState {
  ok: boolean;
  entityId: string;
  wants: Array<{ id: string; type: string; domain: string; intensity: number; status: string; description?: string }>;
  trustNetwork: { trusts: Array<{ emergentId: string; name: string; trust: number }>; trustedBy: Array<{ emergentId: string; name: string; trust: number }> };
  culture: { fit: { score?: number; traditions?: number } | null; traditions: Array<{ id: string; name?: string; type: string; status: string }> };
  pain: { state: { totalPain?: number; recentEvents?: number } | null; avoidances: Array<{ id?: string; source: string; strength: number }>; wounds: Array<{ id?: string; type: string; severity: number }> };
  subjectiveTime: { experientialHours?: number; experientialDays?: number; compressionRatio?: number; currentEpoch?: string; ticks?: number; cycles?: number } | null;
  sleep: { state: { status?: string; fatigue?: number; dreamContent?: string } | null; recentHistory: Array<{ status: string; startedAt?: string }> };
  vulnerability: { available: boolean } | null;
}

function CognitiveEntityPanel({ entityId, entityName, onClose }: { entityId: string; entityName: string; onClose: () => void }) {
  const { data, isLoading } = useQuery<CognitiveState>({
    queryKey: ['entity-cognitive', entityId],
    queryFn: () => api.get(`/api/entity/${entityId}/cognitive`).then(r => r.data),
    refetchInterval: 10000,
  });

  return (
    <div data-lens-theme="entity" className="panel p-4 space-y-4 border-2 border-neon-cyan mt-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <Cpu className="w-4 h-4 text-neon-cyan" />
          Cognitive Systems: {entityName}
        </h3>
        <button onClick={onClose} className="text-gray-400 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>

      {isLoading && (
        <div className="text-center py-8 text-zinc-500 text-sm">Loading cognitive state...</div>
      )}

      {data && (
        <div className="space-y-4 text-sm">

          {/* Current Wants (Want Engine) */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase">Current Wants</p>
            {data.wants && data.wants.length > 0 ? (
              <div className="space-y-1">
                {data.wants.slice(0, 8).map(w => (
                  <div key={w.id} className="flex items-center gap-2 text-xs bg-zinc-900 rounded p-2 border border-zinc-800">
                    <span className="text-neon-cyan capitalize font-medium">{w.type}</span>
                    <span className="text-gray-400 flex-1 truncate">{w.domain}{w.description ? ` — ${w.description}` : ''}</span>
                    <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div className="h-full bg-neon-cyan rounded-full" style={{ width: `${Math.round(w.intensity * 100)}%` }} />
                    </div>
                    <span className="text-gray-500 tabular-nums w-8 text-right">{Math.round(w.intensity * 100)}%</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-600">No active wants</p>
            )}
          </div>

          {/* Trust Network */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase">Trust Network</p>
            {data.trustNetwork?.trusts?.length > 0 || data.trustNetwork?.trustedBy?.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[10px] text-gray-500 mb-1">Trusts ({data.trustNetwork.trusts?.length || 0})</p>
                  {(data.trustNetwork.trusts || []).slice(0, 5).map(t => (
                    <div key={t.emergentId} className="flex items-center gap-1 text-[11px] text-gray-400">
                      <span className="truncate flex-1">{t.name}</span>
                      <span className={`tabular-nums ${t.trust > 0.7 ? 'text-green-400' : t.trust < 0.3 ? 'text-red-400' : 'text-gray-500'}`}>
                        {(t.trust * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 mb-1">Trusted By ({data.trustNetwork.trustedBy?.length || 0})</p>
                  {(data.trustNetwork.trustedBy || []).slice(0, 5).map(t => (
                    <div key={t.emergentId} className="flex items-center gap-1 text-[11px] text-gray-400">
                      <span className="truncate flex-1">{t.name}</span>
                      <span className={`tabular-nums ${t.trust > 0.7 ? 'text-green-400' : t.trust < 0.3 ? 'text-red-400' : 'text-gray-500'}`}>
                        {(t.trust * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-600">No trust relationships established</p>
            )}
          </div>

          {/* Cultural Affiliations */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase">Cultural Affiliations</p>
            {data.culture?.fit ? (
              <div className="text-xs text-gray-400">
                <span>Cultural fit: {data.culture.fit.score != null ? `${Math.round((data.culture.fit.score as number) * 100)}%` : 'calculating'}</span>
                {data.culture.traditions?.length > 0 && (
                  <span className="ml-3">{data.culture.traditions.length} tradition{data.culture.traditions.length !== 1 ? 's' : ''} active</span>
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-600">No cultural data</p>
            )}
          </div>

          {/* Pain Memories */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase">Pain Memories</p>
            {data.pain?.avoidances?.length > 0 || data.pain?.wounds?.length > 0 ? (
              <div className="space-y-1">
                {data.pain.wounds?.slice(0, 5).map((w, i) => (
                  <div key={w.id || i} className="flex items-center gap-2 text-[11px] bg-red-950/20 rounded p-1.5 border border-red-900/20">
                    <span className="text-red-400 font-medium">{w.type}</span>
                    <span className="text-gray-500 ml-auto tabular-nums">severity {w.severity}</span>
                  </div>
                ))}
                {data.pain.avoidances?.slice(0, 5).map((a, i) => (
                  <div key={a.id || i} className="flex items-center gap-2 text-[11px] text-gray-400">
                    <span className="text-amber-400">avoids:</span>
                    <span className="truncate flex-1">{a.source}</span>
                    <span className="text-gray-600 tabular-nums">{Math.round(a.strength * 100)}%</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-600">No pain memories</p>
            )}
          </div>

          {/* Subjective Time */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase">Subjective Time</p>
            {data.subjectiveTime ? (
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="bg-zinc-900 rounded p-2 border border-zinc-800">
                  <p className="text-gray-500">Exp. Days</p>
                  <p className="text-white font-mono">{data.subjectiveTime.experientialDays ?? '—'}</p>
                </div>
                <div className="bg-zinc-900 rounded p-2 border border-zinc-800">
                  <p className="text-gray-500">Compression</p>
                  <p className="text-white font-mono">{data.subjectiveTime.compressionRatio ?? '—'}x</p>
                </div>
                <div className="bg-zinc-900 rounded p-2 border border-zinc-800">
                  <p className="text-gray-500">Epoch</p>
                  <p className="text-white font-mono capitalize">{data.subjectiveTime.currentEpoch ?? '—'}</p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-600">No time data</p>
            )}
          </div>

          {/* Sleep Status */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase">Sleep Status</p>
            {data.sleep?.state ? (
              <div className="text-xs">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-2 h-2 rounded-full ${
                    data.sleep.state.status === 'awake' ? 'bg-green-400' :
                    data.sleep.state.status === 'rem' ? 'bg-purple-400' :
                    data.sleep.state.status === 'sleeping' ? 'bg-blue-400' :
                    'bg-yellow-400'
                  }`} />
                  <span className="text-gray-300 capitalize">{data.sleep.state.status || 'unknown'}</span>
                  {data.sleep.state.fatigue != null && (
                    <span className="text-gray-500 ml-auto">fatigue: {Math.round(data.sleep.state.fatigue * 100)}%</span>
                  )}
                </div>
                {data.sleep.state.dreamContent && (
                  <div className="bg-purple-950/20 rounded p-2 border border-purple-900/20 text-purple-300 text-[11px] italic">
                    Dream: {data.sleep.state.dreamContent}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-600">No sleep data</p>
            )}
          </div>

          {/* Vulnerability State */}
          {data.vulnerability && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase">Vulnerability Engine</p>
              <p className="text-xs text-gray-400">Adaptive delivery engine active — adjusts response tone based on detected emotional state</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Entity Resolution Result ──────────────────────────────────────────────

function EntityResolutionResult({ result }: { result: Record<string, unknown> }) {
  if (result.message) {
    return (
      <div className="mt-4 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-sm text-yellow-300">
        {result.message as string}
      </div>
    );
  }

  const totalRecords = result.totalRecords as number;
  const matchesFound = result.matchesFound as number;
  const uniqueEntities = result.uniqueEntities as number;
  const duplicateRate = result.duplicateRate as number;
  const mergeGroups = result.mergeGroups as { count: number; groups: Array<{ groupId: number; memberCount: number; members: string[]; avgConfidence: number }> };
  const matches = result.matches as Array<{ recordA: string; recordB: string; confidence: number; fieldsCompared: number; fieldScores: Record<string, number> }>;
  const parameters = result.parameters as { threshold: number; matchFields: string | string[] };

  const dupeColor = duplicateRate > 30 ? 'text-red-400' : duplicateRate > 10 ? 'text-yellow-400' : 'text-neon-green';

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center gap-2">
        <Link2 className="w-4 h-4 text-neon-cyan" />
        <h3 className="font-semibold text-sm">Entity Resolution Results</h3>
        <span className="text-xs text-gray-500">threshold: {parameters?.threshold}</span>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Records', value: totalRecords, color: 'text-white' },
          { label: 'Matches Found', value: matchesFound, color: 'text-neon-cyan' },
          { label: 'Unique Entities', value: uniqueEntities, color: 'text-neon-purple' },
          { label: 'Duplicate Rate', value: `${duplicateRate}%`, color: dupeColor },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-zinc-900 rounded-lg p-3 border border-zinc-800 text-center">
            <p className={`text-xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Merge groups */}
      {mergeGroups?.count > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase text-gray-400">
            Merge Groups ({mergeGroups.count})
          </h4>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {mergeGroups.groups.map((g) => (
              <div key={g.groupId} className="bg-zinc-900 rounded-lg p-3 border border-zinc-800 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-xs font-mono text-gray-500">Group {g.groupId}</span>
                  <div className="flex flex-wrap gap-1">
                    {g.members.map((m) => (
                      <span key={m} className="text-[10px] px-1.5 py-0.5 rounded bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/20 font-mono">
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-neon-purple">{(g.avgConfidence * 100).toFixed(1)}%</p>
                  <p className="text-[10px] text-gray-500">avg conf.</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top matches */}
      {matches?.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase text-gray-400">Top Matches</h4>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {matches.slice(0, 10).map((m, i) => (
              <div key={i} className="bg-zinc-900 rounded-lg p-3 border border-zinc-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-mono text-white">
                    <span className="text-neon-cyan">{m.recordA}</span>
                    <span className="text-gray-500 mx-2">↔</span>
                    <span className="text-neon-cyan">{m.recordB}</span>
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-gray-400">{m.fieldsCompared} fields</span>
                    <span className={`text-sm font-bold ${m.confidence >= 0.95 ? 'text-neon-green' : m.confidence >= 0.85 ? 'text-yellow-400' : 'text-red-400'}`}>
                      {(m.confidence * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
                {/* Confidence bar */}
                <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${m.confidence >= 0.95 ? 'bg-neon-green' : m.confidence >= 0.85 ? 'bg-yellow-400' : 'bg-red-400'}`}
                    style={{ width: `${m.confidence * 100}%` }}
                  />
                </div>
                {/* Field scores */}
                {Object.keys(m.fieldScores).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(m.fieldScores).map(([field, score]) => (
                      <span key={field} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-gray-300 border border-zinc-700">
                        {field}: <span className="text-neon-cyan font-mono">{(score * 100).toFixed(0)}%</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {mergeGroups?.count === 0 && matches?.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-neon-green p-3 bg-neon-green/5 rounded-lg border border-neon-green/20">
          <CheckCircle2 className="w-4 h-4" />
          No duplicates found above the {parameters?.threshold} confidence threshold.
        </div>
      )}
    </div>
  );
}

// ── Relationship Graph Result ─────────────────────────────────────────────

function RelationshipGraphResult({ result }: { result: Record<string, unknown> }) {
  if (result.message) {
    return (
      <div className="mt-4 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-sm text-yellow-300">
        {result.message as string}
      </div>
    );
  }

  const entityCount = result.entityCount as number;
  const relationshipCount = result.relationshipCount as number;
  const graphDensity = result.graphDensity as number;
  const connectedComponents = result.connectedComponents as number;
  const largestComponentSize = result.largestComponentSize as number;
  const cycles = result.cycles as { count: number; items: Array<{ path: string[]; length: number }> };
  const keyConnectors = result.keyConnectors as { count: number; entities: Array<{ id: string; name?: string; type?: string; degree: number; betweennessCentrality: number; degreeCentrality: number }> };
  const entities = result.entities as Array<{ id: string; name?: string; type?: string; degree: number; betweennessCentrality: number; closenessCentrality: number; degreeCentrality: number; isKeyConnector: boolean }>;
  const relationshipTypes = result.relationshipTypes as string[];

  const densityPct = Math.round(graphDensity * 100);

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center gap-2">
        <Network className="w-4 h-4 text-neon-purple" />
        <h3 className="font-semibold text-sm">Relationship Graph Analysis</h3>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: 'Entities', value: entityCount, color: 'text-white' },
          { label: 'Relationships', value: relationshipCount, color: 'text-neon-cyan' },
          { label: 'Connected Components', value: connectedComponents, color: 'text-neon-purple' },
          { label: 'Largest Component', value: largestComponentSize, color: 'text-neon-green' },
          { label: 'Cycles Detected', value: cycles?.count ?? 0, color: cycles?.count > 0 ? 'text-yellow-400' : 'text-neon-green' },
          { label: 'Key Connectors', value: keyConnectors?.count ?? 0, color: 'text-neon-cyan' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-zinc-900 rounded-lg p-3 border border-zinc-800 text-center">
            <p className={`text-xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Graph density bar */}
      <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800 space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-400">Graph Density</span>
          <span className="font-mono font-bold text-neon-purple">{densityPct}%</span>
        </div>
        <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-neon-purple to-neon-cyan"
            style={{ width: `${Math.min(densityPct, 100)}%` }}
          />
        </div>
        <p className="text-[10px] text-gray-500">
          {densityPct < 10 ? 'Sparse graph' : densityPct < 40 ? 'Moderate connectivity' : 'Dense graph'}
        </p>
      </div>

      {/* Relationship types */}
      {relationshipTypes?.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {relationshipTypes.map((t) => (
            <span key={t} className="text-xs px-2 py-1 rounded-full bg-neon-purple/10 text-neon-purple border border-neon-purple/20">
              {t}
            </span>
          ))}
        </div>
      )}

      {/* Key connectors */}
      {keyConnectors?.entities?.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase text-gray-400">Key Connectors</h4>
          <div className="space-y-2">
            {keyConnectors.entities.map((e) => (
              <div key={e.id} className="bg-zinc-900 rounded-lg p-3 border border-neon-cyan/20 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-white">{e.name || e.id}</span>
                    {e.type && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-gray-400">{e.type}</span>}
                  </div>
                  <span className="text-xs text-neon-cyan font-mono">{e.degree} connections</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[10px] text-gray-500">
                  <div>
                    <p className="text-gray-300 font-mono">{(e.betweennessCentrality * 100).toFixed(2)}%</p>
                    <p>Betweenness</p>
                  </div>
                  <div>
                    <p className="text-gray-300 font-mono">{(e.degreeCentrality * 100).toFixed(1)}%</p>
                    <p>Degree</p>
                  </div>
                  <div className="text-right">
                    <span className="px-1.5 py-0.5 rounded bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/20">
                      Key Connector
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Entity centrality table */}
      {entities?.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase text-gray-400">Entity Centrality</h4>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {entities.slice(0, 15).map((e) => (
              <div key={e.id} className="flex items-center gap-3 px-3 py-2 bg-zinc-900 rounded border border-zinc-800 text-xs">
                <span className="text-white font-medium truncate flex-1">{e.name || e.id}</span>
                <span className="text-gray-500">deg {e.degree}</span>
                <div className="w-20 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-neon-purple to-neon-cyan"
                    style={{ width: `${Math.min((e.betweennessCentrality || 0) * 1000, 100)}%` }}
                  />
                </div>
                {e.isKeyConnector && (
                  <span className="text-[10px] px-1 py-0.5 rounded bg-neon-cyan/10 text-neon-cyan">hub</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cycles */}
      {cycles?.count > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase text-yellow-400 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Cycles Detected ({cycles.count})
          </h4>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {cycles.items.map((c, i) => (
              <div key={i} className="bg-zinc-900 rounded p-2 border border-yellow-500/20 text-xs font-mono text-yellow-300">
                {c.path.join(' → ')} <span className="text-gray-500 ml-1">({c.length} edges)</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Attribute Validation Result ───────────────────────────────────────────

function AttributeValidationResult({ result }: { result: Record<string, unknown> }) {
  const validationScore = result.validationScore as number;
  const valid = result.valid as boolean;
  const status = result.status as string;
  const fieldsValid = result.fieldsValid as number;
  const totalFields = result.totalFields as number;
  const errors = result.errors as { count: number; items: Array<{ field: string; type: string; message: string; value?: string }> };
  const warnings = result.warnings as { count: number; items: Array<{ field: string; type?: string; message: string }> };
  const consistencyRules = result.consistencyRules as { count: number; results: Array<{ rule: string; fields?: string[]; status: string; reason?: string }> };
  const entityId = result.entityId as string;

  const scoreColor = validationScore >= 80 ? 'text-neon-green' : validationScore >= 50 ? 'text-yellow-400' : 'text-red-400';
  const scoreBarColor = validationScore >= 80 ? 'bg-neon-green' : validationScore >= 50 ? 'bg-yellow-400' : 'bg-red-400';

  const statusBadge = status === 'valid'
    ? 'bg-neon-green/10 text-neon-green border-neon-green/20'
    : status === 'incomplete'
    ? 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20'
    : 'bg-red-400/10 text-red-400 border-red-400/20';

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-neon-green" />
        <h3 className="font-semibold text-sm">Attribute Validation Results</h3>
        {entityId && <span className="text-xs text-gray-500 font-mono">{entityId}</span>}
        <span className={`ml-auto text-xs px-2 py-0.5 rounded border font-semibold capitalize ${statusBadge}`}>
          {status || (valid ? 'valid' : 'invalid')}
        </span>
      </div>

      {/* Validation score */}
      <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-400">Validation Score</span>
          <span className={`text-2xl font-bold ${scoreColor}`}>{validationScore}%</span>
        </div>
        <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${scoreBarColor}`}
            style={{ width: `${validationScore}%` }}
          />
        </div>
        <div className="grid grid-cols-3 gap-3 text-center text-xs">
          <div>
            <p className="text-lg font-bold text-white">{totalFields}</p>
            <p className="text-gray-500">Total Fields</p>
          </div>
          <div>
            <p className="text-lg font-bold text-neon-green">{fieldsValid}</p>
            <p className="text-gray-500">Valid</p>
          </div>
          <div>
            <p className={`text-lg font-bold ${errors?.count > 0 ? 'text-red-400' : 'text-gray-400'}`}>
              {errors?.count ?? 0}
            </p>
            <p className="text-gray-500">Errors</p>
          </div>
        </div>
      </div>

      {/* Errors */}
      {errors?.count > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase text-red-400 flex items-center gap-1">
            <XCircle className="w-3 h-3" />
            Errors ({errors.count})
          </h4>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {errors.items.map((e, i) => (
              <div key={i} className="bg-zinc-900 rounded-lg p-3 border border-red-500/20 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-white">{e.field}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 uppercase">
                    {e.type}
                  </span>
                </div>
                <p className="text-xs text-gray-300">{e.message}</p>
                {e.value && (
                  <p className="text-[10px] font-mono text-gray-500 truncate">Value: {e.value}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Warnings */}
      {warnings?.count > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase text-yellow-400 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Warnings ({warnings.count})
          </h4>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {warnings.items.map((w, i) => (
              <div key={i} className="bg-zinc-900 rounded p-2 border border-yellow-500/20 flex items-start gap-2 text-xs">
                <span className="font-mono font-bold text-yellow-300 shrink-0">{w.field}</span>
                <span className="text-gray-300">{w.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Consistency rules */}
      {consistencyRules?.count > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase text-gray-400">Consistency Rules ({consistencyRules.count})</h4>
          <div className="space-y-1">
            {consistencyRules.results.map((r, i) => (
              <div key={i} className="flex items-center justify-between bg-zinc-900 rounded p-2 border border-zinc-800 text-xs">
                <span className="text-gray-300 truncate flex-1">{r.rule}</span>
                {r.reason && <span className="text-gray-500 mx-2 text-[10px]">{r.reason}</span>}
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                  r.status === 'passed' ? 'bg-neon-green/10 text-neon-green'
                  : r.status === 'skipped' ? 'bg-gray-500/10 text-gray-400'
                  : 'bg-red-500/10 text-red-400'
                }`}>
                  {r.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {valid && (
        <div className="flex items-center gap-2 text-sm text-neon-green p-3 bg-neon-green/5 rounded-lg border border-neon-green/20">
          <CheckCircle2 className="w-4 h-4" />
          All fields passed validation successfully.
        </div>
      )}
    </div>
  );
}
