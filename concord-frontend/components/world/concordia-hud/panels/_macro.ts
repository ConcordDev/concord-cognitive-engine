// shared macro helper for all Concordia HUD panels
export async function macro(domain: string, name: string, input: Record<string, unknown> = {}) {
  try {
    const r = await fetch('/api/lens/run', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, name, input }),
    });
    return r.ok ? r.json() : null;
  } catch { return null; }
}

export function readActiveWorldId(): string {
  if (typeof window === 'undefined') return 'concordia-hub';
  return window.localStorage.getItem('concordia:activeWorldId') || 'concordia-hub';
}
