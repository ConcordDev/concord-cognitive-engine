/**
 * Docs lens — typed macro helpers.
 *
 * Wraps `POST /api/lens/run` so callers get the unwrapped macro
 * result directly instead of digging through axios `.data.result`.
 */

import { api } from '@/lib/api/client';

export interface MacroEnvelope<T = unknown> {
  ok: boolean;
  reason?: string;
  [k: string]: unknown;
  result?: T;
}

export async function callDocsMacro<T = Record<string, unknown>>(
  name: string,
  input: Record<string, unknown> = {},
): Promise<T & { ok?: boolean; reason?: string }> {
  const r = await api.post('/api/lens/run', { domain: 'docs', name, input });
  const env = (r?.data ?? {}) as MacroEnvelope<T>;
  // server wraps in { ok: true, result: <macroReturn> } — unwrap so
  // callers see the macro's own return shape directly.
  const inner = (env.result ?? env) as T & { ok?: boolean; reason?: string };
  return inner;
}
