/**
 * Tasks lens — typed macro helper. Wraps POST /api/lens/run so
 * callers see the unwrapped macro envelope directly.
 */

import { api } from '@/lib/api/client';

export async function callTasksMacro<T = Record<string, unknown>>(
  name: string,
  input: Record<string, unknown> = {},
): Promise<T & { ok?: boolean; reason?: string }> {
  const r = await api.post('/api/lens/run', { domain: 'tasks', name, input });
  const env = (r?.data ?? {}) as { ok?: boolean; result?: T };
  const inner = (env.result ?? env) as T & { ok?: boolean; reason?: string };
  return inner;
}

export interface Project {
  id: string;
  owner_id: string;
  key: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string;
  visibility: string;
  next_task_number: number;
  default_workflow_id: string;
  role?: string;
  created_at: number;
  updated_at: number;
}

export interface Task {
  id: string;
  project_id: string;
  task_key: string;
  parent_id?: string | null;
  type: string;
  title: string;
  description_html?: string | null;
  status_id: string;
  workflow_id: string;
  priority: 'urgent' | 'high' | 'medium' | 'low' | 'none';
  estimate?: number | null;
  estimate_unit: 'points' | 'hours';
  reporter_id: string;
  assignee_id?: string | null;
  due_at?: number | null;
  completed_at?: number | null;
  position: number;
  customFields?: Record<string, unknown>;
  labels?: string[];
  participants?: { user_id: string; role: string }[];
  dependencies?: { blocks: TaskRef[]; blockedBy: TaskRef[] };
  created_at: number;
  updated_at: number;
}

export interface TaskRef {
  task_key: string;
  title: string;
  status_id: string;
}

export interface Workflow {
  id: string;
  project_id: string;
  name: string;
  statuses: { id: string; name: string; category: string; color: string }[];
  transitions?: { from: string; to: string; name?: string }[] | null;
  default_status_id: string;
  is_default: number;
}

export interface Sprint {
  id: string;
  project_id: string;
  name: string;
  goal?: string | null;
  status: 'planned' | 'active' | 'completed' | 'archived';
  start_at?: number | null;
  end_at?: number | null;
}

export interface SavedView {
  id: string;
  owner_id: string;
  project_id?: string | null;
  name: string;
  view_kind: 'list' | 'board' | 'calendar' | 'timeline' | 'gallery';
  filters?: Record<string, unknown> | null;
  sort?: Record<string, unknown> | null;
  group_by?: string | null;
  is_default: number;
}
