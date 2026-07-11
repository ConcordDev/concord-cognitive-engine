/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * persona-envelope — honest interpretation of a `/api/lens/run` response.
 *
 * The transport ALWAYS answers `{ ok: true, result: <macro return> }`. The
 * OUTER `ok` only reports that the HTTP round-trip succeeded — NOT that the
 * macro itself did. `/api/lens/run` unwraps exactly one `.result` layer
 * (`_unwrapLensEnvelope`, server.js), so:
 *   • a personas SUCCESS `{ ok:true, result:{ persona } }`  →  `result = { persona }`
 *     (no `ok` field on the payload), and
 *   • a personas FAILURE `{ ok:false, error }` (no `result` key) passes through
 *     UNCHANGED, landing at `result = { ok:false, error }`.
 * Therefore honest success detection MUST inspect `result.ok`, never the outer
 * `ok`. Checking only the outer `ok` is the fabricated-success bug: a rejected
 * publish/rate/install/delete would flash "success" while the backend refused
 * it. This helper is the single, correct interpretation used by every persona
 * call site (personas AND the legacy npc_persona pipeline, which returns its
 * own bare `{ ok, ... }` — the same `result.ok` check covers both shapes).
 */

import { lensRun } from '@/lib/api/client';

export interface PersonaEnvelope<T = any> {
  /** True only when transport AND the wrapped macro both succeeded. */
  ok: boolean;
  /** Macro-level error/reason on failure, else null. */
  error: string | null;
  /** Unwrapped macro payload (the real result on success; the failure body otherwise). */
  data: T | null;
}

export function readEnvelope<T = any>(
  r: { data?: { ok?: boolean; result?: any; error?: string | null } | null } | null | undefined,
): PersonaEnvelope<T> {
  const d = r?.data;
  const inner = d?.result;
  const transportOk = d?.ok === true;
  // The unwrapped payload is EITHER the macro's success body (no `ok` key for
  // the personas success shape) OR a passed-through `{ ok:false, ... }` failure
  // (personas) / a bare `{ ok, ... }` envelope (npc_persona). Only treat an
  // explicit `ok:false` as failure.
  const innerOk = inner && typeof inner === 'object' && 'ok' in inner ? inner.ok !== false : true;
  const ok = transportOk && innerOk;
  const error = ok ? null : (inner?.error || inner?.reason || d?.error || 'request_failed');
  return { ok, error, data: (inner ?? null) as T | null };
}

/** Dispatch a `personas` macro and return the honestly-interpreted envelope. */
export async function runPersona<T = any>(
  action: string,
  input: Record<string, unknown> = {},
): Promise<PersonaEnvelope<T>> {
  return readEnvelope<T>(await lensRun('personas', action, input));
}
