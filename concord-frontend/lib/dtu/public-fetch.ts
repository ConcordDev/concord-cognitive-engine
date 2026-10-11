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

export async function fetchOwnerDtu(
  id: string,
  cookieHeader: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<OwnerDtuFetch> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (cookieHeader) headers.cookie = cookieHeader;
  try {
    const res = await fetchImpl(`${dtuBackendBase()}/api/dtus/${encodeURIComponent(id)}`, {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(DTU_PUBLIC_FETCH_TIMEOUT_MS),
    });
    if (res.status === 404 || !res.ok) return { status: res.status === 404 ? 404 : res.status, dtu: null };
    const data = await res.json();
    const dtu = (data && typeof data === 'object' && 'dtu' in data ? (data as { dtu?: unknown }).dtu : data) as unknown;
    if (!dtu || typeof dtu !== 'object') return { status: 404, dtu: null };
    return { status: 200, dtu: dtu as Record<string, unknown> };
  } catch {
    return { status: 404, dtu: null };
  }
}
