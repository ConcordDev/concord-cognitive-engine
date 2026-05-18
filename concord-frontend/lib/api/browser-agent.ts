/**
 * Browser-Agent lens — typed macro helper.
 */

import { api } from '@/lib/api/client';

export async function callBrowserAgentMacro<T = Record<string, unknown>>(
  name: string,
  input: Record<string, unknown> = {},
): Promise<T & { ok?: boolean; reason?: string }> {
  const r = await api.post('/api/lens/run', { domain: 'browser-agent', name, input });
  const env = (r?.data ?? {}) as { ok?: boolean; result?: T };
  const inner = (env.result ?? env) as T & { ok?: boolean; reason?: string };
  return inner;
}

export type BrowserTaskStatus =
  | 'pending' | 'planning' | 'awaiting_approval' | 'running'
  | 'paused' | 'completed' | 'failed' | 'cancelled' | 'budget_exceeded';

export interface BrowserTask {
  id: string;
  user_id: string;
  title: string;
  goal: string;
  starting_url?: string | null;
  status: BrowserTaskStatus;
  approval_mode: 'off' | 'destructive_only' | 'every_step';
  max_steps: number;
  max_cost_cents?: number | null;
  tool_allowlist?: string[] | null;
  total_steps: number;
  total_cost_cents: number;
  total_tokens: number;
  result_summary?: string | null;
  created_at: number;
  started_at?: number | null;
  completed_at?: number | null;
  updated_at: number;
}

export interface BrowserAction {
  id: number;
  task_id: string;
  step_index: number;
  kind: string;
  tool?: string | null;
  url?: string | null;
  selector?: string | null;
  value?: string | null;
  thought?: string | null;
  destructive: number;
  success: number;
  latency_ms?: number | null;
  cost_cents: number;
  tokens: number;
  screenshot_url?: string | null;
  created_at: number;
}

export interface BrowserApproval {
  id: number;
  task_id: string;
  step_index: number;
  reason: string;
  proposed_action_json: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  task_title?: string;
  created_at: number;
  expires_at?: number | null;
}

export interface BrowserBudget {
  user_id: string;
  daily_cents_cap: number;
  monthly_cents_cap: number;
  per_task_default_cents: number;
  concurrent_task_max: number;
  approval_mode_default: 'off' | 'destructive_only' | 'every_step';
}
