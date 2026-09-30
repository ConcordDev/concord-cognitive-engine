'use client';

/**
 * SwarmRegistryPanel — worldmodel swarm entities desk.
 * Owns create/fork, terminal (entity.terminal), council queue
 * (terminal_pending / terminal_approve), qualia + cognitive overlays,
 * and EntityLifecycleViz. Page shell owns the single active view union.
 */

import { motion } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { useState } from 'react';
import {
  Users, Plus, Terminal, GitFork, Activity, Play, Brain, Cpu, Bot,
  ShieldAlert, CheckCircle2, XCircle, MinusCircle, Lock, Loader2,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import EntityLifecycleViz from '@/components/visualizations/EntityLifecycleViz';
import { resolveEntityName } from '@/lib/entity-naming';
import { QualiaEntityPanel } from '@/components/entity/QualiaEntityPanel';
import { CognitiveEntityPanel } from '@/components/entity/CognitiveEntityPanel';
import {
  COUNCIL_ROLES,
  riskColors,
  typeColors,
  statusColors,
  type Entity,
  type TerminalProposalSummary,
} from '@/components/entity/entity-model';

export function SwarmRegistryPanel() {
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('entity');
  const { user: currentUser, isAuthenticated } = useAuth();
  const isCouncilEligible = isAuthenticated && !!currentUser?.role && COUNCIL_ROLES.has(currentUser.role);
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newEntityName, setNewEntityName] = useState('');
  const [newEntityType, setNewEntityType] = useState<Entity['type']>('worker');
  const [terminalEntity, setTerminalEntity] = useState<string | null>(null);
  const [terminalCommand, setTerminalCommand] = useState('');
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
  const [qualiaEntity, setQualiaEntity] = useState<string | null>(null);
  const [cognitiveEntity, setCognitiveEntity] = useState<string | null>(null);

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
      // NOTE: entity.terminal is registered as a canonical macro (register(),
      // not registerLensAction()), and it scopes the sandboxed workspace to the
      // CALLING USER (ctx.actor.userId), not to a per-artifact id. The prior
      // implementation routed through apiHelpers.lens.run('entity', data.entityId, ...)
      // -> POST /api/lens/entity/:id/run -> the `lens.run` macro, which looks the
      // id up in STATE.lensArtifacts. data.entityId is a /api/worldmodel/entities
      // id, which is never a key in STATE.lensArtifacts, so that call 404'd with
      // "not found" on every single command, regardless of ENABLE_TERMINAL_EXEC.
      // runDomain hits POST /api/lens/run, which dispatches straight to the
      // registered macro (LENS_ACTIONS first, falls back to MACROS) with the
      // input as a virtual artifact — the correct path for a register()-only
      // macro like this one.
      const res = await apiHelpers.lens.runDomain('entity', 'terminal', { command: data.command });
      return res.data?.result ?? res.data;
    },
    onSuccess: (data) => {
      // entity.terminal returns one of: a disabled-flag reject, a blocked-pattern
      // reject, a council-approval-pending status, a reality-guard rejection, or
      // (only when TERMINAL_EXEC_ENABLED and the command is low-risk) a real
      // { exitCode, stdout, stderr } result. Render each honestly — no fabricated
      // "success" line for a command that didn't actually execute.
      const line = data.disabled
        ? `${data.error} (operator must set ENABLE_TERMINAL_EXEC=true)`
        : data.status === 'pending_council_approval'
        ? `${data.message} (proposal ${data.proposalId}, ${data.riskLevel} risk)`
        : data.ok === false
        ? `Error: ${data.error || 'command rejected'}`
        : 'exitCode' in data
        ? [
            data.stdout && String(data.stdout).trim(),
            data.stderr && String(data.stderr).trim() ? `stderr: ${String(data.stderr).trim()}` : null,
            `(exit ${data.exitCode})`,
          ].filter(Boolean).join('\n')
        : JSON.stringify(data);
      setTerminalOutput(prev => [...prev, `$ ${terminalCommand}`, line]);
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

  // Council approval queue — read-only listing via the new entity.terminal_pending
  // macro. Never fetched for a caller who doesn't look council-eligible (honest
  // gate, not just a hidden panel: we don't attempt the call and then swallow a
  // permission error).
  const {
    data: pendingApprovals,
    isLoading: pendingApprovalsLoading,
    isError: pendingApprovalsErrored,
  } = useQuery({
    queryKey: ['entity-terminal-pending'],
    queryFn: () => apiHelpers.lens.runDomain('entity', 'terminal_pending', {}).then(r => r.data?.result ?? r.data),
    enabled: isCouncilEligible,
    refetchInterval: isCouncilEligible ? 15000 : false,
  });

  const voteOnProposal = useMutation({
    mutationFn: async (data: { proposalId: string; vote: 'approve' | 'deny' | 'abstain' }) => {
      const res = await apiHelpers.lens.runDomain('entity', 'terminal_approve', data);
      return res.data?.result ?? res.data;
    },
    onSuccess: (data) => {
      // terminal_approve can honestly fail in-band (disabled flag, vote
      // rejected, proposal already resolved) even on an HTTP 200 — surface
      // that, never treat it as a silent success.
      if (!data || data.ok === false) {
        useUIStore.getState().addToast({ type: 'error', message: data?.error || 'Vote was rejected.' });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['entity-terminal-pending'] });
      const msg = data.status === 'pending'
        ? `Vote recorded (${data.votes?.approve ?? 0} approve / ${data.votes?.deny ?? 0} deny / ${data.votes?.abstain ?? 0} abstain).`
        : `Proposal ${data.status}${data.executionResult ? ` — exit ${data.executionResult.exitCode}` : ''}.`;
      useUIStore.getState().addToast({ type: 'success', message: msg });
    },
    onError: (err: Record<string, unknown>) => {
      useUIStore.getState().addToast({ type: 'error', message: (err?.message as string) || 'Vote failed to submit.' });
    },
  });

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
            <h1 className="text-xl font-bold">Swarm Registry</h1>
            <p className="text-sm text-gray-400">
              Create and manage swarm entities with terminal access
            </p>
          </div>
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
              <p className="text-gray-400">Terminal ready. Entity has council-gated access to system commands.</p>
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
            aria-label="Play">
              <Play className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Council Approval Queue — single surface (was duplicated). */}
      {isAuthenticated && (
        <div className="panel p-4 space-y-4 border-2 border-yellow-500/30">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-yellow-400" />
              Council Approval Queue
            </h3>
            {isCouncilEligible && Array.isArray(pendingApprovals?.pending) && (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                {pendingApprovals.pending.length} pending
              </span>
            )}
          </div>

          {!isCouncilEligible ? (
            <p className="text-sm text-gray-400 flex items-center gap-2">
              <Lock className="w-4 h-4 shrink-0" />
              You don&apos;t have council access to the terminal approval queue (requires owner, admin, or council role).
            </p>
          ) : pendingApprovalsLoading ? (
            <p className="text-sm text-gray-400 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading pending proposals...
            </p>
          ) : pendingApprovalsErrored || pendingApprovals?.ok === false ? (
            <p className="text-sm text-neon-pink">
              Failed to load the approval queue{pendingApprovals?.error ? `: ${pendingApprovals.error}` : '.'}
            </p>
          ) : (
            <>
              {!pendingApprovals?.pending || pendingApprovals.pending.length === 0 ? (
                <p className="text-sm text-gray-400">No pending terminal-command proposals.</p>
              ) : (
                <div className="space-y-3">
                  {pendingApprovals.pending.map((p: TerminalProposalSummary) => (
                    <div key={p.id} className={`rounded border p-3 space-y-2 ${riskColors[p.riskLevel] || 'border-lattice-border'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs text-gray-400">
                            Entity {p.entityId} · {new Date(p.createdAt).toLocaleString()}
                          </p>
                          <code className="text-sm font-mono text-white break-all">{p.command}</code>
                        </div>
                        <span className="text-xs uppercase font-semibold shrink-0">{p.riskLevel} risk</span>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400">
                        <span>
                          {p.votes.approve} approve · {p.votes.deny} deny · {p.votes.abstain} abstain
                          {' '}(needs {Math.round(p.threshold * 100)}% of decisive votes, min 3 total)
                        </span>
                        {p.myVote && <span className="text-neon-cyan">your vote: {p.myVote}</span>}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => voteOnProposal.mutate({ proposalId: p.id, vote: 'approve' })}
                          disabled={voteOnProposal.isPending}
                          className="btn-neon green text-xs flex items-center gap-1 px-3 py-1.5"
                        >
                          <CheckCircle2 className="w-3 h-3" /> Approve
                        </button>
                        <button
                          onClick={() => voteOnProposal.mutate({ proposalId: p.id, vote: 'deny' })}
                          disabled={voteOnProposal.isPending}
                          className="btn-neon pink text-xs flex items-center gap-1 px-3 py-1.5"
                        >
                          <XCircle className="w-3 h-3" /> Deny
                        </button>
                        <button
                          onClick={() => voteOnProposal.mutate({ proposalId: p.id, vote: 'abstain' })}
                          disabled={voteOnProposal.isPending}
                          className="btn-neon text-xs flex items-center gap-1 px-3 py-1.5"
                        >
                          <MinusCircle className="w-3 h-3" /> Abstain
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {Array.isArray(pendingApprovals?.recentHistory) && pendingApprovals.recentHistory.length > 0 && (
                <details className="text-xs text-gray-400">
                  <summary className="cursor-pointer hover:text-white">
                    Recently resolved ({pendingApprovals.recentHistory.length})
                  </summary>
                  <div className="mt-2 space-y-1">
                    {pendingApprovals.recentHistory.map((p: TerminalProposalSummary) => (
                      <div key={p.id} className="flex items-center justify-between gap-2">
                        <code className="font-mono truncate">{p.command}</code>
                        <span className={p.status === 'approved' ? 'text-neon-green' : 'text-neon-pink'}>{p.status}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      )}

      {/* Stats */}
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
                      <p className="text-[10px] text-gray-400 font-mono truncate">#{resolved.shortId}</p>
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
      </div>

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
    </div>
  );
}
