/**
 * lensCall — one lens action, one honest envelope.
 *
 * Every redesigned lens wrote its own copy of this (retailApi, linerApi, …): run a
 * macro through /api/lens/run and turn the dispatch's shapes into `{ ok, result, error }`.
 * A handler refusal can arrive nested (`{ ok:true, result:{ ok:false, error } }`) or at
 * the top (`{ ok:false, error }`); both come back here as ok:false with the server's own
 * words, so a refusal can never read as a success.
 */

import { apiHelpers } from '@/lib/api/client';

export interface LensEnvelope<T> { ok: boolean; result?: T; error?: string; reason?: string; code?: string }

type Raw = { ok?: boolean; result?: unknown; error?: string; message?: string; reason?: string; code?: string };

export function unwrapLensResponse<T>(data: Raw | undefined | null): LensEnvelope<T> {
  if (!data || typeof data !== 'object') return { ok: false, error: 'No response from the server.' };
  const inner = data.result;
  if (data.ok && inner && typeof inner === 'object' && !Array.isArray(inner) && 'ok' in (inner as object)) {
    const r = inner as Raw;
    if (r.ok === false) return { ok: false, error: r.message || r.error || r.reason || 'refused', reason: r.reason, code: r.code };
    return { ok: true, result: ('result' in r ? r.result : r) as T };
  }
  if (data.ok === false) return { ok: false, error: data.message || data.error || data.reason || 'refused', reason: data.reason, code: data.code };
  return { ok: true, result: inner as T };
}

export async function lensCall<T>(domain: string, action: string, input: Record<string, unknown> = {}): Promise<LensEnvelope<T>> {
  try {
    const r = await apiHelpers.lens.runDomain(domain, action, { input });
    return unwrapLensResponse<T>((r as { data?: Raw }).data);
  } catch (e) {
    const err = e as { response?: { data?: Raw; status?: number }; message?: string };
    if (err.response?.data) { const u = unwrapLensResponse<T>(err.response.data); if (!u.ok) return u; }
    return { ok: false, error: err.message || 'Request failed' };
  }
}
