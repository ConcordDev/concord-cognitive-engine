'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';
import {
  Bot,
  Shield,
  Activity,
  Clock,
  Zap,
  Brain,
  Search,
  Play,
  Pause,
  Trash2,
  Plus,
  Snowflake,
  Flame,
  AlertTriangle,
  ChevronDown,
  X,
  Eye,
  FlaskConical,
  Swords,
  RefreshCw,
  Layers,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Agent {
  id: string;
  type: string;
  status: 'active' | 'paused' | string;
  territory?: string;
  config?: Record<string, unknown>;
  created_at?: string;
  last_tick?: string;
}

interface Finding {
  id: string;
  agent_id: string;
  agent_type?: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical' | string;
  title: string;
  detail?: string;
  timestamp: string;
  territory?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_TYPES = [
  { value: 'patrol', label: 'Patrol', icon: Shield, description: 'Territory patrol agent' },
  { value: 'integrity', label: 'Integrity', icon: Eye, description: 'Data integrity checker' },
  {
    value: 'hypothesis_tester',
    label: 'Hypothesis Tester',
    icon: FlaskConical,
    description: 'Tests hypotheses against data',
  },
  {
    value: 'debate_simulator',
    label: 'Debate Simulator',
    icon: Swords,
    description: 'Simulates multi-perspective debates',
  },
  {
    value: 'freshness',
    label: 'Freshness',
    icon: RefreshCw,
    description: 'Monitors data staleness',
  },
  {
    value: 'synthesis',
    label: 'Synthesis',
    icon: Layers,
    description: 'Synthesizes cross-domain insights',
  },
] as const;

const SEVERITY_BADGE_CLASSES: Record<string, string> = {
  info: 'bg-neon-blue/20 text-neon-blue',
  low: 'bg-neon-cyan/20 text-neon-cyan',
  medium: 'bg-yellow-400/20 text-yellow-400',
  high: 'bg-orange-400/20 text-orange-400',
  critical: 'bg-red-400/20 text-red-400',
};

const _SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function severityBadgeClass(sev: string): string {
  return SEVERITY_BADGE_CLASSES[sev] || 'bg-gray-400/20 text-gray-400';
}

function agentTypeIcon(type: string) {
  const match = AGENT_TYPES.find((t) => t.value === type);
  return match?.icon || Bot;
}

function agentTypeLabel(type: string) {
  const match = AGENT_TYPES.find((t) => t.value === type);
  return match?.label || type;
}

function relativeTime(ts: string | undefined): string {
  if (!ts) return 'never';
  const diff = Date.now() - new Date(ts).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Sovereign decree helper
// ---------------------------------------------------------------------------

function decree<T = unknown>(body: Record<string, unknown>): Promise<T> {
  return api.post('/api/run', body).then((r) => r.data as T);
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function AgentMonitorPage() {
  const queryClient = useQueryClient();

  // ---- Local state ----
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createType, setCreateType] = useState<string>(AGENT_TYPES[0].value);
  const [createConfig, setCreateConfig] = useState('{}');
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [findingsFilter, setFindingsFilter] = useState<string>('all');

  // ---- Queries ----

  const agentsQuery = useQuery<{ agents: Agent[] }>({
    queryKey: ['agents-monitor-list'],
    queryFn: () => decree({ action: 'agent-list' }),
    refetchInterval: 8000,
  });

  const findingsQuery = useQuery<{ findings: Finding[] }>({
    queryKey: ['agents-monitor-findings', findingsFilter],
    queryFn: () =>
      decree({
        action: 'agent-findings',
        data: { type: findingsFilter === 'all' ? undefined : findingsFilter },
      }),
    refetchInterval: 12000,
  });

  // ---- Mutations ----

  const createAgent = useMutation({
    mutationFn: () => {
      let configObj: Record<string, unknown> = {};
      try {
        configObj = JSON.parse(createConfig);
      } catch {
        // leave empty
      }
      return decree({ action: 'agent-create', data: { type: createType, config: configObj } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents-monitor-list'] });
      setShowCreateModal(false);
      setCreateConfig('{}');
    },
  });

  const pauseAgent = useMutation({
    mutationFn: (id: string) => decree({ action: 'agent-pause', target: id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents-monitor-list'] }),
  });

  const resumeAgent = useMutation({
    mutationFn: (id: string) => decree({ action: 'agent-resume', target: id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents-monitor-list'] }),
  });

  const destroyAgent = useMutation({
    mutationFn: (id: string) => decree({ action: 'agent-destroy', target: id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents-monitor-list'] });
      if (expandedAgent) setExpandedAgent(null);
    },
  });

  const freezeAll = useMutation({
    mutationFn: () => decree({ action: 'agents-freeze' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents-monitor-list'] }),
  });

  const thawAll = useMutation({
    mutationFn: () => decree({ action: 'agents-thaw' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents-monitor-list'] }),
  });

  // ---- Derived ----

  const agents: Agent[] = agentsQuery.data?.agents ?? [];
  const findings: Finding[] = findingsQuery.data?.findings ?? [];

  const sortedFindings = [...findings].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const activeCount = agents.filter((a) => a.status === 'active').length;
  const pausedCount = agents.filter((a) => a.status === 'paused').length;

  const criticalCount = findings.filter(
    (f) => f.severity === 'critical' || f.severity === 'high'
  ).length;

  // ---- Agent detail query (lazy per expanded agent) ----
  const agentStatusQuery = useQuery<{ agent: Agent & { findings?: Finding[] } }>({
    queryKey: ['agents-monitor-status', expandedAgent],
    queryFn: () => decree({ action: 'agent-status', target: expandedAgent! }),
    enabled: !!expandedAgent,
    refetchInterval: 10000,
  });

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-lattice-void text-white">
      {/* ================================================================== */}
      {/* Top bar                                                            */}
      {/* ================================================================== */}
      <header className="sticky top-0 z-30 bg-lattice-surface/80 backdrop-blur border-b border-lattice-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bot className="w-6 h-6 text-neon-cyan" />
            <div>
              <h1 className={ds.heading2}>Agent Monitor</h1>
              <p className={ds.textMuted}>System 13d &mdash; autonomous cognitive agents</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => freezeAll.mutate()}
              disabled={freezeAll.isPending}
              className={cn(ds.btnSecondary, 'text-sm')}
              title="Freeze all agents"
            >
              <Snowflake className="w-4 h-4" />
              <span className="hidden sm:inline">Freeze All</span>
            </button>
            <button
              onClick={() => thawAll.mutate()}
              disabled={thawAll.isPending}
              className={cn(ds.btnSecondary, 'text-sm')}
              title="Thaw all agents"
            >
              <Flame className="w-4 h-4" />
              <span className="hidden sm:inline">Thaw All</span>
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className={cn(ds.btnPrimary, 'text-sm')}
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">New Agent</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* ================================================================ */}
        {/* Summary stats                                                    */}
        {/* ================================================================ */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className={ds.panel}>
            <div className="flex items-center gap-2 mb-1">
              <Bot className="w-4 h-4 text-neon-cyan" />
              <span className={ds.textMuted}>Total Agents</span>
            </div>
            <p className="text-2xl font-bold">{agents.length}</p>
          </div>
          <div className={ds.panel}>
            <div className="flex items-center gap-2 mb-1">
              <Activity className="w-4 h-4 text-green-400" />
              <span className={ds.textMuted}>Active</span>
            </div>
            <p className="text-2xl font-bold text-green-400">{activeCount}</p>
          </div>
          <div className={ds.panel}>
            <div className="flex items-center gap-2 mb-1">
              <Pause className="w-4 h-4 text-yellow-400" />
              <span className={ds.textMuted}>Paused</span>
            </div>
            <p className="text-2xl font-bold text-yellow-400">{pausedCount}</p>
          </div>
          <div className={ds.panel}>
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              <span className={ds.textMuted}>Critical Findings</span>
            </div>
            <p className="text-2xl font-bold text-red-400">{criticalCount}</p>
          </div>
        </div>

        {/* ================================================================ */}
        {/* Main two-column layout                                           */}
        {/* ================================================================ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ------------- Left: Agent list (2/3) ------------- */}
          <section className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className={ds.heading3}>Agents</h2>
              {agentsQuery.isFetching && (
                <span className={cn(ds.textMuted, 'animate-pulse')}>refreshing...</span>
              )}
            </div>

            {agentsQuery.isLoading && (
              <div className={cn(ds.panel, 'py-12 text-center')}>
                <Bot className="w-8 h-8 text-gray-600 mx-auto mb-2 animate-pulse" />
                <p className={ds.textMuted}>Loading agents...</p>
              </div>
            )}

            {agentsQuery.isError && (
              <div className={cn(ds.panel, 'py-8 text-center')}>
                <AlertTriangle className="w-6 h-6 text-red-400 mx-auto mb-2" />
                <p className="text-red-400 text-sm mb-2">Failed to load agents</p>
                <button
                  onClick={() => agentsQuery.refetch()}
                  className={cn(ds.btnGhost, 'text-xs')}
                >
                  Retry
                </button>
              </div>
            )}

            {!agentsQuery.isLoading && agents.length === 0 && !agentsQuery.isError && (
              <div className={cn(ds.panel, 'py-12 text-center')}>
                <Bot className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                <p className={ds.textMuted}>No agents deployed yet.</p>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className={cn(ds.btnPrimary, 'mt-4 text-sm')}
                >
                  <Plus className="w-4 h-4" /> Create First Agent
                </button>
              </div>
            )}

            {/* Agent cards */}
            <div className="space-y-3">
              {agents.map((agent) => {
                const isActive = agent.status === 'active';
                const isPaused = agent.status === 'paused';
                const TypeIcon = agentTypeIcon(agent.type);
                const isExpanded = expandedAgent === agent.id;
                const agentFindings = sortedFindings.filter((f) => f.agent_id === agent.id);

                return (
                  <div
                    key={agent.id}
                    className={cn(
                      ds.panel,
                      'transition-all duration-200',
                      isExpanded && 'ring-1 ring-neon-cyan/40'
                    )}
                  >
                    {/* Card header */}
                    <div className="flex items-start gap-3">
                      {/* Icon + status dot */}
                      <div className="relative flex-shrink-0">
                        <div className="w-10 h-10 rounded-lg bg-lattice-void flex items-center justify-center">
                          <TypeIcon className="w-5 h-5 text-neon-cyan" />
                        </div>
                        <span
                          className={cn(
                            'absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-lattice-surface',
                            isActive && 'bg-green-400',
                            isPaused && 'bg-yellow-400',
                            !isActive && !isPaused && 'bg-gray-500'
                          )}
                        />
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-white truncate">
                            {agentTypeLabel(agent.type)}
                          </span>
                          <span
                            className={cn(
                              'text-xs px-2 py-0.5 rounded-full font-medium',
                              isActive && 'bg-green-400/20 text-green-400',
                              isPaused && 'bg-yellow-400/20 text-yellow-400',
                              !isActive && !isPaused && 'bg-gray-500/20 text-gray-400'
                            )}
                          >
                            {agent.status}
                          </span>
                          <span className={cn(ds.textMuted, 'text-xs font-mono truncate')}>
                            {agent.id}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-xs text-gray-500 flex-wrap">
                          {agent.territory && (
                            <span className="flex items-center gap-1">
                              <Search className="w-3 h-3" /> {agent.territory}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {relativeTime(agent.last_tick)}
                          </span>
                          {agentFindings.length > 0 && (
                            <span className="flex items-center gap-1">
                              <Zap className="w-3 h-3" /> {agentFindings.length} finding
                              {agentFindings.length !== 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {isActive ? (
                          <button
                            onClick={() => pauseAgent.mutate(agent.id)}
                            disabled={pauseAgent.isPending}
                            className={cn(ds.btnGhost, 'text-yellow-400 hover:text-yellow-300')}
                            title="Pause agent"
                          >
                            <Pause className="w-4 h-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => resumeAgent.mutate(agent.id)}
                            disabled={resumeAgent.isPending}
                            className={cn(ds.btnGhost, 'text-green-400 hover:text-green-300')}
                            title="Resume agent"
                          >
                            <Play className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => destroyAgent.mutate(agent.id)}
                          disabled={destroyAgent.isPending}
                          className={cn(ds.btnGhost, 'text-red-400 hover:text-red-300')}
                          title="Destroy agent"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setExpandedAgent(isExpanded ? null : agent.id)}
                          className={cn(ds.btnGhost)}
                          title="Toggle details"
                        >
                          <ChevronDown
                            className={cn(
                              'w-4 h-4 transition-transform',
                              isExpanded && 'rotate-180'
                            )}
                          />
                        </button>
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="mt-4 pt-4 border-t border-lattice-border space-y-3">
                        {agentStatusQuery.isLoading && (
                          <p className={cn(ds.textMuted, 'animate-pulse')}>Loading status...</p>
                        )}

                        {/* Config */}
                        {agent.config && Object.keys(agent.config).length > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                              Configuration
                            </h4>
                            <pre className="text-xs bg-lattice-void rounded-lg p-3 overflow-x-auto text-gray-300 font-mono">
                              {JSON.stringify(agent.config, null, 2)}
                            </pre>
                          </div>
                        )}

                        {/* Recent findings for this agent */}
                        {agentFindings.length > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                              Recent Findings
                            </h4>
                            <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
                              {agentFindings.slice(0, 10).map((f) => (
                                <div
                                  key={f.id}
                                  className="flex items-start gap-2 py-1.5 px-2 rounded bg-lattice-void/50"
                                >
                                  <span
                                    className={cn(
                                      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0',
                                      severityBadgeClass(f.severity)
                                    )}
                                  >
                                    {f.severity}
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm text-gray-200 truncate">{f.title}</p>
                                    {f.detail && (
                                      <p className="text-xs text-gray-500 truncate">{f.detail}</p>
                                    )}
                                  </div>
                                  <span className="text-xs text-gray-600 flex-shrink-0">
                                    {relativeTime(f.timestamp)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {agentFindings.length === 0 && (
                          <p className={ds.textMuted}>No findings from this agent yet.</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* ------------- Right: Findings timeline (1/3) ------------- */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className={ds.heading3}>Findings Timeline</h2>
              {findingsQuery.isFetching && (
                <span className={cn(ds.textMuted, 'animate-pulse text-xs')}>...</span>
              )}
            </div>

            {/* Filter by agent type */}
            <div>
              <select
                value={findingsFilter}
                onChange={(e) => setFindingsFilter(e.target.value)}
                className={cn(ds.select, 'text-sm')}
              >
                <option value="all">All types</option>
                {AGENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Scrollable findings list */}
            <div className={cn(ds.panel, 'p-0 overflow-hidden')}>
              <div className="max-h-[calc(100vh-320px)] overflow-y-auto divide-y divide-lattice-border/40">
                {findingsQuery.isLoading && (
                  <div className="p-6 text-center">
                    <Brain className="w-6 h-6 text-gray-600 mx-auto mb-2 animate-pulse" />
                    <p className={ds.textMuted}>Loading findings...</p>
                  </div>
                )}

                {!findingsQuery.isLoading && sortedFindings.length === 0 && (
                  <div className="p-6 text-center">
                    <Search className="w-6 h-6 text-gray-600 mx-auto mb-2" />
                    <p className={ds.textMuted}>No findings recorded.</p>
                  </div>
                )}

                {sortedFindings.map((finding) => (
                  <div
                    key={finding.id}
                    className="px-4 py-3 hover:bg-lattice-surface/50 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
                          severityBadgeClass(finding.severity)
                        )}
                      >
                        {finding.severity}
                      </span>
                      {finding.agent_type && (
                        <span className="text-xs text-gray-500">
                          {agentTypeLabel(finding.agent_type)}
                        </span>
                      )}
                      <span className="text-xs text-gray-600 ml-auto flex-shrink-0 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {relativeTime(finding.timestamp)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-200">{finding.title}</p>
                    {finding.detail && (
                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{finding.detail}</p>
                    )}
                    {finding.territory && (
                      <span className="inline-flex items-center gap-1 text-xs text-gray-600 mt-1">
                        <Search className="w-3 h-3" /> {finding.territory}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </main>

      {/* ================================================================== */}
      {/* Create Agent Modal                                                 */}
      {/* ================================================================== */}
      {showCreateModal && (
        <div className={ds.modalBackdrop} onClick={() => setShowCreateModal(false)}>
          <div className={ds.modalContainer}>
            <div className={cn(ds.modalPanel, 'max-w-lg')} onClick={(e) => e.stopPropagation()}>
              {/* Modal header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-lattice-border">
                <h2 className={cn(ds.heading3, 'flex items-center gap-2')}>
                  <Plus className="w-5 h-5 text-neon-cyan" />
                  Create Agent
                </h2>
                <button onClick={() => setShowCreateModal(false)} className={ds.btnGhost}>
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal body */}
              <div className="px-6 py-5 space-y-5">
                {/* Agent type selector */}
                <div>
                  <label className={ds.label}>Agent Type</label>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    {AGENT_TYPES.map((t) => {
                      const Icon = t.icon;
                      const isSelected = createType === t.value;
                      return (
                        <button
                          key={t.value}
                          onClick={() => setCreateType(t.value)}
                          className={cn(
                            'flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left transition-all text-sm',
                            isSelected
                              ? 'border-neon-cyan bg-neon-cyan/10 text-neon-cyan'
                              : 'border-lattice-border bg-lattice-void text-gray-400 hover:border-gray-500 hover:text-gray-200'
                          )}
                        >
                          <Icon className="w-4 h-4 flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="font-medium">{t.label}</p>
                            <p className="text-xs text-gray-500 truncate">{t.description}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Config JSON */}
                <div>
                  <label className={ds.label}>Configuration (JSON)</label>
                  <textarea
                    value={createConfig}
                    onChange={(e) => setCreateConfig(e.target.value)}
                    rows={4}
                    spellCheck={false}
                    className={cn(ds.input, 'font-mono text-sm resize-none')}
                    placeholder='{ "territory": "science", "depth": 3 }'
                  />
                </div>
              </div>

              {/* Modal footer */}
              <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-lattice-border">
                <button onClick={() => setShowCreateModal(false)} className={ds.btnSecondary}>
                  Cancel
                </button>
                <button
                  onClick={() => createAgent.mutate()}
                  disabled={createAgent.isPending}
                  className={ds.btnPrimary}
                >
                  {createAgent.isPending ? 'Deploying...' : 'Deploy Agent'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
