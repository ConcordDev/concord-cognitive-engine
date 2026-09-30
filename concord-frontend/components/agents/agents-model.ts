'use client';

import {
  Bot, Search, Eye, Brain, Shield, Workflow,
} from 'lucide-react';

export interface Agent {
  id: string;
  name: string;
  type?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
  lastTick?: string;
  status?: string;
  description?: string;
  goals?: string[];
  tools?: string[];
  memory?: { key: string; value: string; timestamp: string }[];
  logs?: { timestamp: string; level: string; message: string }[];
  tickCount?: number;
  successRate?: number;
  avgLatency?: number;
  createdAt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  startedAt?: string;
  stoppedAt?: string;
  isAgent?: boolean;
}

export type AgentFilter = 'all' | 'active' | 'dormant' | 'error';
export type AgentDetailTab = 'overview' | 'logs' | 'memory' | 'config';
export type AgentsView = 'fleet' | 'roster' | 'fork';

/** Shape returned by the real `agents.executeRun` lens action. */
export interface AgentRunStep {
  index: number; tool: string; toolKind: string; input: string;
  output: Record<string, unknown>; latencyMs: number; tokens: number; status: string; ts: string;
}
export interface AgentRunResult {
  id: string; agentId: string; agentName: string; goal: string; status: string;
  stoppedReason: string | null; steps: AgentRunStep[]; stepCount: number;
  totalLatencyMs: number; totalTokens: number; startedAt: string; finishedAt: string;
}

/** Shape returned by `agents.listTaskDefinitions`. */
export interface TaskDefinition {
  id: string; name: string; requiredSkills: string[]; priority: string;
  description: string; createdAt: string;
}

export const AGENT_TYPES = [
  { id: 'general', label: 'General', icon: Bot, color: 'text-gray-400', description: 'Multi-purpose agent' },
  { id: 'research', label: 'Research', icon: Search, color: 'text-neon-cyan', description: 'Information gathering and synthesis' },
  { id: 'critic', label: 'Critic', icon: Eye, color: 'text-neon-purple', description: 'Analysis and quality review' },
  { id: 'synthesizer', label: 'Synthesizer', icon: Brain, color: 'text-neon-pink', description: 'Content generation and creation' },
  { id: 'monitor', label: 'Monitor', icon: Shield, color: 'text-neon-green', description: 'System health and alerts' },
  { id: 'orchestrator', label: 'Orchestrator', icon: Workflow, color: 'text-neon-yellow', description: 'Coordinates other agents' },
] as const;

export const AVAILABLE_TOOLS = [
  'web_search', 'dtu_create', 'dtu_read', 'dtu_update', 'summarize', 'classify',
  'music_analyze', 'score_harmony', 'suggest', 'audio_analyze', 'eq_suggest',
  'dynamics_check', 'lufs_measure', 'audio_fingerprint', 'tag_assign', 'graph_connect',
  'db_query', 'graph_check', 'metric_read', 'alert_send', 'text_generate',
  'rhyme_find', 'syllable_count', 'code_execute', 'file_read', 'file_write',
];

export function getStatusColor(status?: string) {
  switch (status) {
    case 'running': return 'bg-green-400';
    case 'idle': return 'bg-yellow-400';
    case 'error': return 'bg-red-400';
    default: return 'bg-gray-500';
  }
}

export function getStatusLabel(agent: Agent) {
  if (!agent.enabled) return 'Dormant';
  return agent.status === 'running' ? 'Running' : agent.status === 'error' ? 'Error' : 'Idle';
}

export function getLogColor(level: string) {
  switch (level) {
    case 'error': return 'text-red-400';
    case 'warn': return 'text-yellow-400';
    default: return 'text-gray-400';
  }
}

export function typeInfo(type?: string) {
  return AGENT_TYPES.find(t => t.id === type) || AGENT_TYPES[0];
}
