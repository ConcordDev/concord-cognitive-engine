import { describe, it, expect, afterEach } from 'vitest';
import { dtuBackendBase, fetchOwnerDtu } from '@/lib/dtu/public-fetch';

describe('fetchOwnerDtu', () => {
  const prevBackend = process.env.BACKEND_URL;
  const prevPublic = process.env.NEXT_PUBLIC_API_URL;

  afterEach(() => {
    if (prevBackend === undefined) delete process.env.BACKEND_URL;
    else process.env.BACKEND_URL = prevBackend;
    if (prevPublic === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = prevPublic;
  });

  it('prefers BACKEND_URL and ignores a relative public URL', () => {
    process.env.BACKEND_URL = 'http://backend.internal:5050/';
    process.env.NEXT_PUBLIC_API_URL = '';
    expect(dtuBackendBase()).toBe('http://backend.internal:5050');
    delete process.env.BACKEND_URL;
    process.env.NEXT_PUBLIC_API_URL = '';
    expect(dtuBackendBase()).toBe('http://127.0.0.1:5050');
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:5050';
    expect(dtuBackendBase()).toBe('http://localhost:5050');
  });

  it('forwards cookies, uses a 5s timeout, and returns the owner DTU', async () => {
    process.env.BACKEND_URL = 'http://backend.test';
    let seen: { url: string; cookie?: string; signal?: AbortSignal } | null = null;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen = { url, cookie: (init?.headers as Record<string, string>).cookie, signal: init?.signal ?? undefined };
      return new Response(JSON.stringify({ dtu: { id: 'd1', title: 'Owned' } }), { status: 200 });
    }) as typeof fetch;
    const out = await fetchOwnerDtu('d1', 'concord_auth=abc', fetchImpl);
    expect(out.status).toBe(200);
    expect(out.dtu?.title).toBe('Owned');
    expect(seen!.url).toBe('http://backend.test/api/dtus/d1');
    expect(seen!.cookie).toBe('concord_auth=abc');
    expect(seen!.signal).toBeInstanceOf(AbortSignal);
  });

  it('maps 404 and timeouts to a miss', async () => {
    process.env.BACKEND_URL = 'http://backend.test';
    const missing = await fetchOwnerDtu('nope', null, (async () => new Response('{}', { status: 404 })) as typeof fetch);
    expect(missing).toEqual({ status: 404, dtu: null });
    const hung = await fetchOwnerDtu('slow', 'c=1', (async () => { throw new Error('timeout'); }) as typeof fetch);
    expect(hung).toEqual({ status: 404, dtu: null });
    const empty = await fetchOwnerDtu('x', null, (async () => new Response('null', { status: 200 })) as typeof fetch);
    expect(empty.status).toBe(404);
  });
});
