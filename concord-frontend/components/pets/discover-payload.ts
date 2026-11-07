/**
 * Discover panels read the lensRun envelope. A live macro that returns
 * `{ ok: true, facts }` has no `result` key, so lensRun parks that object
 * on `data.result`. Reading `data.facts` is always empty and shows nothing.
 */

export interface DiscoverEnvelope {
  ok?: boolean;
  error?: string | null;
  reason?: string | null;
  result?: unknown;
}

export function discoverItems(
  envelope: DiscoverEnvelope | null | undefined,
  key: string,
): { items: unknown[]; error: string | null } {
  if (!envelope) return { items: [], error: 'fetch_failed' };
  if (envelope.ok === false) {
    return { items: [], error: envelope.error || envelope.reason || 'fetch_failed' };
  }
  const payload = envelope.result && typeof envelope.result === 'object'
    ? envelope.result as Record<string, unknown>
    : envelope as Record<string, unknown>;
  if (payload.ok === false) {
    const reason = typeof payload.reason === 'string' ? payload.reason : '';
    const err = typeof payload.error === 'string' ? payload.error : '';
    return { items: [], error: reason || err || 'fetch_failed' };
  }
  const raw = payload[key];
  const items = Array.isArray(raw) ? raw.filter((item) => item != null && item !== '') : [];
  if (items.length === 0) return { items: [], error: 'no_content' };
  return { items, error: null };
}
