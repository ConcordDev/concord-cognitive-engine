/**
 * Server-side fetch for /dtu/:id.
 * Relative NEXT_PUBLIC_API_URL (empty string) made Next fetch the page
 * itself and hang on the platform's ~60s timeout, and omitted the
 * viewer's cookies so the owner looked anonymous and got 404.
 */

export const DTU_PUBLIC_FETCH_TIMEOUT_MS = 5_000;

export function dtuBackendBase(): string {
  const explicit = process.env.BACKEND_URL;
  if (explicit && explicit.trim()) return explicit.replace(/\/$/, '');
  const pub = process.env.NEXT_PUBLIC_API_URL;
  if (pub && /^https?:\/\//i.test(pub)) return pub.replace(/\/$/, '');
  return 'http://127.0.0.1:5050';
}

export interface OwnerDtuFetch {
  status: number;
  dtu: Record<string, unknown> | null;
}

export interface OwnerDtuLookup extends OwnerDtuFetch {
  /** False when the backend could not be asked (timeout, network error). */
  reachable: boolean;
}

/**
 * Same lookup as fetchOwnerDtu, but says whether the backend actually
 * answered. The middleware 404 gate needs that distinction: a miss the
 * backend confirmed is a 404; "could not ask" must fall through to the page.
 */
export async function lookupOwnerDtu(
  id: string,
  cookieHeader: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<OwnerDtuLookup> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (cookieHeader) headers.cookie = cookieHeader;
  try {
    const res = await fetchImpl(`${dtuBackendBase()}/api/dtus/${encodeURIComponent(id)}`, {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(DTU_PUBLIC_FETCH_TIMEOUT_MS),
    });
    if (res.status === 404 || !res.ok) return { status: res.status === 404 ? 404 : res.status, dtu: null, reachable: true };
    const data = await res.json();
    const dtu = (data && typeof data === 'object' && 'dtu' in data ? (data as { dtu?: unknown }).dtu : data) as unknown;
    if (!dtu || typeof dtu !== 'object') return { status: 404, dtu: null, reachable: true };
    return { status: 200, dtu: dtu as Record<string, unknown>, reachable: true };
  } catch {
    return { status: 404, dtu: null, reachable: false };
  }
}

export async function fetchOwnerDtu(
  id: string,
  cookieHeader: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<OwnerDtuFetch> {
  const { status, dtu } = await lookupOwnerDtu(id, cookieHeader, fetchImpl);
  return { status, dtu };
}
