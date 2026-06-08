'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';

// ── Types ───────────────────────────────────────────────────────────────────────

interface AgentLogEntry {
  action: string;
  timestamp: string;
  result: 'success' | 'failure' | 'skipped';
}

interface SeedAgent {
  id: string;
  name: string;
  type: string;
  status: 'active' | 'paused' | 'error';
  lastRun: string;
  runsToday: number;
  dailyQuota: number;
  description: string;
  watching?: string;
  schedule?: string;
  logs: AgentLogEntry[];
}

/** Shape returned by the `agents.listSchedules` macro. */
interface BackendSchedule {
  id: string;
  agentId: string;
  agentName?: string;
  kind?: string;
  spec?: string;
  goal?: string;
  enabled?: boolean;
  createdAt?: string;
  lastFiredAt?: string | null;
  fireCount?: number;
}

function timeAgo(iso?: string | null): string {
  if (!iso) return 'never';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'never';
  const diff = Date.now() - t;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

/** Map a backend schedule into the card view-model the UI renders. */
function scheduleToAgent(s: BackendSchedule): SeedAgent {
  return {
    id: s.id,
    name: s.agentName || s.agentId || 'Agent',
    type: s.kind || 'custom',
    status: s.enabled === false ? 'paused' : 'active',
    lastRun: timeAgo(s.lastFiredAt),
    runsToday: s.fireCount || 0,
    dailyQuota: 100,
    description: s.goal || 'Scheduled objective',
    watching: s.kind === 'event' ? s.spec : undefined,
    schedule: s.kind && s.kind !== 'event' ? `${s.kind}: ${s.spec || ''}`.trim() : undefined,
    logs: [],
  };
}

const AGENT_TYPES = [
  { key: 'monitor', label: 'Monitor', color: 'bg-blue-500', desc: 'Continuously watch for events on the sensor network or event bus and log or escalate when conditions are met.' },
  { key: 'alert', label: 'Alert', color: 'bg-red-500', desc: 'Fire notifications when a metric crosses a threshold you define.' },
  { key: 'report', label: 'Report', color: 'bg-purple-500', desc: 'Generate scheduled PDF/HTML reports from live data.' },
  { key: 'auto_bid', label: 'Auto-Bid', color: 'bg-amber-500', desc: 'Automatically place bids on marketplace items matching your criteria.' },
  { key: 'market_watch', label: 'Market Watch', color: 'bg-teal-500', desc: 'Track marketplace listings for components that match search filters.' },
  { key: 'validation_watch', label: 'Validation Watch', color: 'bg-indigo-500', desc: 'Monitor DTU validation pipelines and alert on failures.' },
  { key: 'portfolio_manager', label: 'Portfolio Manager', color: 'bg-emerald-500', desc: 'Rebalance and optimize your component portfolio on a schedule.' },
  { key: 'custom', label: 'Custom', color: 'bg-gray-500', desc: 'Define your own trigger-condition-action rules from scratch.' },
];

const MONITOR_EVENTS = [
  'sensor:anomaly-detected',
  'sensor:threshold-exceeded',
  'dtu:validation-failed',
  'dtu:ownership-transferred',
  'marketplace:new-listing',
  'system:health-degraded',
];

const ALERT_METRICS = ['Temperature', 'Vibration', 'Load', 'Displacement', 'Humidity', 'Wind Speed'];
const REPORT_CONTENT = ['Portfolio Summary', 'Market Trends', 'Sensor Readings', 'Validation Results', 'Transaction History'];
const MATERIAL_FILTERS = ['Steel', 'Concrete', 'Timber', 'Composite', 'Aluminum', 'Any'];

// ── Helpers ────────────────────────────────────────────────────────────────────

function typeBadgeColor(type: string): string {
  const found = AGENT_TYPES.find((t) => t.key === type);
  return found ? found.color : 'bg-gray-500';
}

function statusDot(status: string): string {
  if (status === 'active') return 'bg-green-400';
  if (status === 'paused') return 'bg-yellow-400';
  return 'bg-red-400';
}

function resultBadge(result: string): { text: string; cls: string } {
  if (result === 'success') return { text: 'Success', cls: 'text-green-400 bg-green-400/10 border-green-400/20' };
  if (result === 'failure') return { text: 'Failure', cls: 'text-red-400 bg-red-400/10 border-red-400/20' };
  return { text: 'Skipped', cls: 'text-gray-400 bg-gray-400/10 border-gray-400/20' };
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function AgentBuilder() {
  const [tab, setTab] = useState<'my' | 'create'>('my');

  // My Agents state — real data from `agents.listSchedules`, empty until loaded.
  const [agents, setAgents] = useState<SeedAgent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    setAgentsLoading(true);
    try {
      const r = await lensRun<{ schedules?: BackendSchedule[] }>('agents', 'listSchedules', {});
      const schedules = r.data?.result?.schedules;
      setAgents(Array.isArray(schedules) ? schedules.map(scheduleToAgent) : []);
    } catch {
      setAgents([]); // honest empty on error — never fabricate
    } finally {
      setAgentsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  // Create Agent state
  const [selectedType, setSelectedType] = useState<string>('monitor');
  const [agentName, setAgentName] = useState('');
  const [activateOnCreate, setActivateOnCreate] = useState(true);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  // Monitor config
  const [monitorEvents, setMonitorEvents] = useState<string[]>([]);

  // Alert config
  const [alertMetric, setAlertMetric] = useState(ALERT_METRICS[0]);
  const [alertThreshold, setAlertThreshold] = useState('100');
  const [alertOperator, setAlertOperator] = useState<'above' | 'below'>('above');

  // Report config
  const [reportSchedule, setReportSchedule] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [reportContent, setReportContent] = useState<string[]>([]);

  // Market Watch config
  const [mwQuery, setMwQuery] = useState('');
  const [mwMinCitations, setMwMinCitations] = useState(50);
  const [mwMaterial, setMwMaterial] = useState('Any');

  // Custom config
  const [customRules, setCustomRules] = useState<{ trigger: string; condition: string; action: string }[]>([]);
  const [ruleTrigger, setRuleTrigger] = useState('');
  const [ruleCondition, setRuleCondition] = useState('');
  const [ruleAction, setRuleAction] = useState('');

  const selectedTypeInfo = useMemo(() => AGENT_TYPES.find((t) => t.key === selectedType), [selectedType]);

  const togglePause = async (id: string) => {
    // Optimistic flip, then persist via the real macro.
    setAgents((prev) =>
      prev.map((a) =>
        a.id === id ? { ...a, status: a.status === 'active' ? 'paused' : 'active' } as SeedAgent : a,
      ),
    );
    try {
      await lensRun('agents', 'toggleSchedule', { id });
    } catch {
      loadAgents(); // re-sync from backend if persist failed
    }
  };

  const toggleMonitorEvent = (evt: string) => {
    setMonitorEvents((prev) => (prev.includes(evt) ? prev.filter((e) => e !== evt) : [...prev, evt]));
  };

  const toggleReportContent = (item: string) => {
    setReportContent((prev) => (prev.includes(item) ? prev.filter((c) => c !== item) : [...prev, item]));
  };

  const addCustomRule = () => {
    if (!ruleTrigger || !ruleCondition || !ruleAction) return;
    setCustomRules((prev) => [...prev, { trigger: ruleTrigger, condition: ruleCondition, action: ruleAction }]);
    setRuleTrigger('');
    setRuleCondition('');
    setRuleAction('');
  };

  const handleTest = () => {
    setIsTesting(true);
    setTestResult('Simulating with sample event...');
    setTimeout(() => {
      const actions: Record<string, string> = {
        monitor: 'Log anomaly event and notify #ops channel',
        alert: `Send alert: ${alertMetric} ${alertOperator} ${alertThreshold}`,
        report: `Generate ${reportSchedule} report with ${reportContent.length || 1} sections`,
        auto_bid: 'Place bid of 250 credits on matching listing',
        market_watch: `Flag 2 new listings matching "${mwQuery || 'beams'}"`,
        validation_watch: 'Alert: DTU validation pipeline failure detected',
        portfolio_manager: 'Rebalance portfolio — sell 3, buy 1',
        custom: customRules.length > 0 ? `Execute rule: ${customRules[0].action}` : 'No rules defined',
      };
      setTestResult(`Agent would trigger: ${actions[selectedType] || 'Unknown action'}`);
      setIsTesting(false);
    }, 1500);
  };

  const handleCreate = async () => {
    if (!agentName.trim()) return;
    // Derive a spec from the type-specific config so the backend schedule is real.
    let kind = 'interval';
    let spec = '3600000';
    if (selectedType === 'monitor') {
      kind = 'event';
      spec = monitorEvents[0] || 'sensor:anomaly-detected';
    } else if (selectedType === 'report') {
      kind = 'interval';
      spec = reportSchedule === 'daily' ? '86400000' : reportSchedule === 'weekly' ? '604800000' : '2592000000';
    } else if (selectedType === 'custom' && customRules[0]) {
      kind = 'event';
      spec = customRules[0].trigger;
    }
    try {
      await lensRun('agents', 'createSchedule', {
        agentId: agentName.trim().toLowerCase().replace(/\s+/g, '-'),
        agentName: agentName.trim(),
        kind,
        spec,
        goal: selectedTypeInfo?.desc || agentName.trim(),
        enabled: activateOnCreate,
      });
      await loadAgents();
    } catch {
      // leave list as-is; surfaced via toast by the api client
    }
    setAgentName('');
    setTab('my');
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="w-full min-h-screen bg-lattice-void backdrop-blur-xl text-white p-6">
      <h1 className="text-2xl font-bold mb-1">Agent Builder</h1>
      <p className="text-sm text-gray-400 mb-6">Configure and monitor autonomous agents</p>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {(['my', 'create'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t ? 'bg-white/10 text-white border border-white/20' : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            {t === 'my' ? 'My Agents' : 'Create Agent'}
          </button>
        ))}
      </div>

      {/* ── My Agents Tab ─────────────────────────────────────────────────── */}
      {tab === 'my' && agentsLoading && (
        <p className="text-sm text-gray-400">Loading agents…</p>
      )}
      {tab === 'my' && !agentsLoading && agents.length === 0 && (
        <div className="border border-white/10 rounded-xl bg-white/5 p-8 text-center">
          <p className="text-sm text-gray-300 mb-1">No agents yet</p>
          <p className="text-xs text-gray-400 mb-4">Create a scheduled agent to monitor events, send alerts, or generate reports.</p>
          <button
            onClick={() => setTab('create')}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
          >
            Create your first agent
          </button>
        </div>
      )}
      {tab === 'my' && !agentsLoading && agents.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {agents.map((agent) => {
            const isExpanded = expandedAgent === agent.id;
            const quotaPct = Math.min((agent.runsToday / agent.dailyQuota) * 100, 100);
            return (
              <div
                key={agent.id}
                className="border border-white/10 rounded-xl bg-white/5 p-5 flex flex-col gap-3"
              >
                {/* Header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${statusDot(agent.status)}`} />
                    <span className="font-semibold text-base">{agent.name}</span>
                  </div>
                  <span
                    className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full text-white ${typeBadgeColor(agent.type)}`}
                  >
                    {agent.type.replace('_', ' ')}
                  </span>
                </div>

                {/* Meta */}
                <p className="text-xs text-gray-400">{agent.description}</p>

                <div className="grid grid-cols-2 gap-2 text-xs text-gray-300">
                  <div>
                    <span className="text-gray-400">Last run:</span> {agent.lastRun}
                  </div>
                  <div>
                    <span className="text-gray-400">Runs today:</span> {agent.runsToday}
                  </div>
                  {agent.watching && (
                    <div className="col-span-2">
                      <span className="text-gray-400">Watching:</span>{' '}
                      <code className="text-blue-300 bg-blue-400/10 px-1 rounded">{agent.watching}</code>
                    </div>
                  )}
                  {agent.schedule && (
                    <div className="col-span-2">
                      <span className="text-gray-400">Schedule:</span> {agent.schedule}
                    </div>
                  )}
                </div>

                {/* Quota bar */}
                <div>
                  <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                    <span>Daily usage</span>
                    <span>
                      {agent.runsToday}/{agent.dailyQuota}
                    </span>
                  </div>
                  <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        quotaPct > 80 ? 'bg-red-400' : quotaPct > 50 ? 'bg-yellow-400' : 'bg-green-400'
                      }`}
                      style={{ width: `${quotaPct}%` }}
                    />
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 mt-1">
                  <button
                    onClick={() => togglePause(agent.id)}
                    className={`text-xs px-3 py-1 rounded-lg border transition-colors ${
                      agent.status === 'active'
                        ? 'border-yellow-400/30 text-yellow-400 hover:bg-yellow-400/10'
                        : 'border-green-400/30 text-green-400 hover:bg-green-400/10'
                    }`}
                  >
                    {agent.status === 'active' ? 'Pause' : 'Resume'}
                  </button>
                  <button
                    onClick={() => setExpandedAgent(isExpanded ? null : agent.id)}
                    className="text-xs px-3 py-1 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                  >
                    {isExpanded ? 'Hide Logs' : 'View Logs'}
                  </button>
                </div>

                {/* Expanded logs */}
                {isExpanded && (
                  <div className="mt-2 border-t border-white/10 pt-3 space-y-2">
                    <span className="text-[10px] uppercase tracking-wider text-gray-400">Recent Logs</span>
                    {agent.logs.length === 0 && (
                      <p className="text-xs text-gray-400 italic">No log entries yet.</p>
                    )}
                    {agent.logs.map((log, i) => {
                      const badge = resultBadge(log.result);
                      return (
                        <div key={i} className="flex items-center justify-between text-xs gap-2">
                          <span className="text-gray-300 truncate flex-1">{log.action}</span>
                          <span className="text-gray-400 whitespace-nowrap">{log.timestamp}</span>
                          <span
                            className={`px-2 py-0.5 rounded border text-[10px] font-medium whitespace-nowrap ${badge.cls}`}
                          >
                            {badge.text}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Create Agent Tab ──────────────────────────────────────────────── */}
      {tab === 'create' && (
        <div className="max-w-2xl space-y-6">
          {/* Type selector */}
          <div>
            <label className="text-xs text-gray-400 uppercase tracking-wider mb-2 block">Agent Type</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {AGENT_TYPES.map((t) => (
                <button
                  key={t.key}
                  onClick={() => {
                    setSelectedType(t.key);
                    setTestResult(null);
                  }}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                    selectedType === t.key
                      ? 'border-white/30 bg-white/10 text-white'
                      : 'border-white/10 text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${t.color}`} />
                  {t.label}
                </button>
              ))}
            </div>
            {selectedTypeInfo && (
              <p className="mt-2 text-xs text-gray-400 bg-white/5 border border-white/10 rounded-lg p-3">
                {selectedTypeInfo.desc}
              </p>
            )}
          </div>

          {/* Type-specific config */}
          <div className="border border-white/10 rounded-xl bg-white/5 p-5 space-y-4">
            <span className="text-xs text-gray-400 uppercase tracking-wider">Configuration</span>

            {/* Monitor */}
            {selectedType === 'monitor' && (
              <div>
                <label className="text-xs text-gray-400 mb-2 block">Event types to watch</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {MONITOR_EVENTS.map((evt) => (
                    <label
                      key={evt}
                      className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer hover:text-white"
                    >
                      <input
                        type="checkbox"
                        checked={monitorEvents.includes(evt)}
                        onChange={() => toggleMonitorEvent(evt)}
                        className="rounded border-white/20 bg-white/5 text-blue-500 focus:ring-blue-500/30"
                      />
                      <code className="text-xs">{evt}</code>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Alert */}
            {selectedType === 'alert' && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Metric</label>
                  <select
                    value={alertMetric}
                    onChange={(e) => setAlertMetric(e.target.value)}
                    className="w-full bg-lattice-elevated border border-lattice-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30"
                  >
                    {ALERT_METRICS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="text-xs text-gray-400 mb-1 block">Operator</label>
                    <select
                      value={alertOperator}
                      onChange={(e) => setAlertOperator(e.target.value as 'above' | 'below')}
                      className="w-full bg-lattice-elevated border border-lattice-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30"
                    >
                      <option value="above">Above</option>
                      <option value="below">Below</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-gray-400 mb-1 block">Threshold</label>
                    <input
                      type="number"
                      value={alertThreshold}
                      onChange={(e) => setAlertThreshold(e.target.value)}
                      className="w-full bg-lattice-elevated border border-lattice-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Report */}
            {selectedType === 'report' && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Schedule</label>
                  <div className="flex gap-2">
                    {(['daily', 'weekly', 'monthly'] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setReportSchedule(s)}
                        className={`px-3 py-1.5 rounded-lg text-sm border transition-colors capitalize ${
                          reportSchedule === s
                            ? 'border-purple-400/40 bg-purple-400/10 text-purple-300'
                            : 'border-white/10 text-gray-400 hover:text-white'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-2 block">Content sections</label>
                  {REPORT_CONTENT.map((item) => (
                    <label
                      key={item}
                      className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer hover:text-white mb-1"
                    >
                      <input
                        type="checkbox"
                        checked={reportContent.includes(item)}
                        onChange={() => toggleReportContent(item)}
                        className="rounded border-white/20 bg-white/5 text-purple-500 focus:ring-purple-500/30"
                      />
                      {item}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Market Watch */}
            {selectedType === 'market_watch' && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Search query</label>
                  <input
                    type="text"
                    value={mwQuery}
                    onChange={(e) => setMwQuery(e.target.value)}
                    placeholder="e.g. structural beams, concrete panels..."
                    className="w-full bg-lattice-elevated border border-lattice-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-white/30"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">
                    Min citations: <span className="text-teal-300">{mwMinCitations}</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={500}
                    step={10}
                    value={mwMinCitations}
                    onChange={(e) => setMwMinCitations(Number(e.target.value))}
                    className="w-full accent-teal-400"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Material filter</label>
                  <select
                    value={mwMaterial}
                    onChange={(e) => setMwMaterial(e.target.value)}
                    className="w-full bg-lattice-elevated border border-lattice-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white/30"
                  >
                    {MATERIAL_FILTERS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Custom */}
            {selectedType === 'custom' && (
              <div className="space-y-3">
                <label className="text-xs text-gray-400 mb-1 block">Rules ({customRules.length})</label>
                {customRules.map((r, i) => (
                  <div key={i} className="text-xs bg-black/40 border border-white/10 rounded-lg p-2 flex flex-col gap-1">
                    <span><span className="text-gray-400">Trigger:</span> {r.trigger}</span>
                    <span><span className="text-gray-400">Condition:</span> {r.condition}</span>
                    <span><span className="text-gray-400">Action:</span> {r.action}</span>
                  </div>
                ))}
                <div className="grid grid-cols-1 gap-2">
                  <input
                    type="text"
                    value={ruleTrigger}
                    onChange={(e) => setRuleTrigger(e.target.value)}
                    placeholder="Trigger (e.g. sensor:anomaly-detected)"
                    className="w-full bg-lattice-elevated border border-lattice-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-white/30"
                  />
                  <input
                    type="text"
                    value={ruleCondition}
                    onChange={(e) => setRuleCondition(e.target.value)}
                    placeholder="Condition (e.g. severity > 7)"
                    className="w-full bg-lattice-elevated border border-lattice-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-white/30"
                  />
                  <input
                    type="text"
                    value={ruleAction}
                    onChange={(e) => setRuleAction(e.target.value)}
                    placeholder="Action (e.g. notify #ops)"
                    className="w-full bg-lattice-elevated border border-lattice-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-white/30"
                  />
                  <button
                    onClick={addCustomRule}
                    disabled={!ruleTrigger || !ruleCondition || !ruleAction}
                    className="px-4 py-2 rounded-lg bg-white/10 border border-white/10 text-sm text-white hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    + Add Rule
                  </button>
                </div>
              </div>
            )}

            {/* Fallback for types without special config */}
            {!['monitor', 'alert', 'report', 'market_watch', 'custom'].includes(selectedType) && (
              <p className="text-xs text-gray-400 italic">
                Default configuration will be applied. Customize after creation.
              </p>
            )}
          </div>

          {/* Name, activate, create */}
          <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
            <div className="flex-1 w-full">
              <label className="text-xs text-gray-400 uppercase tracking-wider mb-1 block">Agent Name</label>
              <input
                type="text"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder="My New Agent"
                className="w-full bg-lattice-elevated border border-lattice-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-white/30"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer whitespace-nowrap">
              <input
                type="checkbox"
                checked={activateOnCreate}
                onChange={() => setActivateOnCreate(!activateOnCreate)}
                className="rounded border-white/20 bg-white/5 text-green-500 focus:ring-green-500/30"
              />
              Activate immediately
            </label>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleCreate}
              disabled={!agentName.trim()}
              className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Create Agent
            </button>
            <button
              onClick={handleTest}
              disabled={isTesting}
              className="px-5 py-2.5 rounded-lg border border-white/10 text-sm text-gray-300 hover:text-white hover:bg-white/5 disabled:opacity-50 transition-colors"
            >
              {isTesting ? 'Testing...' : 'Test Agent'}
            </button>
          </div>

          {testResult && (
            <div className="bg-white/5 border border-white/10 rounded-lg p-3 text-sm text-gray-300">
              {testResult}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
