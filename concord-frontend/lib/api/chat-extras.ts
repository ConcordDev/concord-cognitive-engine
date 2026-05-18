/**
 * Chat lens — typed macro helper for memory + projects + personas +
 * prompts + branches.
 */

import { api } from '@/lib/api/client';

export async function callChatMacro<T = Record<string, unknown>>(
  name: string,
  input: Record<string, unknown> = {},
): Promise<T & { ok?: boolean; reason?: string }> {
  const r = await api.post('/api/lens/run', { domain: 'chat', name, input });
  const env = (r?.data ?? {}) as { ok?: boolean; result?: T };
  const inner = (env.result ?? env) as T & { ok?: boolean; reason?: string };
  return inner;
}

export interface MemoryFact {
  id: number;
  user_id: string;
  project_id?: string | null;
  fact: string;
  kind: 'preference' | 'identity' | 'goal' | 'context' | 'constraint' | 'fact';
  enabled: number;
  confidence: number;
  hit_count: number;
  created_at: number;
  updated_at: number;
}

export interface ChatProject {
  id: string;
  owner_id: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: string;
  system_prompt?: string | null;
  brain_preference?: string | null;
  temperature?: number | null;
  visibility: string;
  attachedDtus?: { dtu_id: string; attached_at: number }[];
  created_at: number;
  updated_at: number;
}

export interface ChatPersona {
  id: string;
  owner_id: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  system_prompt: string;
  brain_slot: 'conscious' | 'subconscious' | 'utility' | 'repair' | 'multimodal';
  style_vector?: Record<string, unknown> | null;
  tool_allowlist?: string[] | null;
  visibility: string;
  usage_count: number;
}

export interface ChatPrompt {
  id: string;
  owner_id: string;
  title: string;
  body: string;
  category?: string | null;
  tags_json?: string | null;
  visibility: string;
  usage_count: number;
}
