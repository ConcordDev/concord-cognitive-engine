// shared macro helper for all Concordia HUD panels
export async function macro(domain: string, name: string, input: Record<string, unknown> = {}) {
  try {
    const r = await fetch('/api/lens/run', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, name, input }),
    });
    if (!r.ok) return null;
    // POST /api/lens/run always wraps the macro's own payload as
    // { ok:true, result: PAYLOAD } — the outer `ok` is a transport flag,
    // not the macro's success/failure. Every caller of this helper reads
    // fields (schemes, jobs, stamina, ...) directly off the return value,
    // so unwrap here once instead of leaving every panel to read `.result`.
    const body = await r.json();
    return body?.result ?? body;
  } catch { return null; }
}

export function readActiveWorldId(): string {
  if (typeof window === 'undefined') return 'concordia-hub';
  return window.localStorage.getItem('concordia:activeWorldId') || 'concordia-hub';
}
