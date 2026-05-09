/**
 * Tier-2 contract tests for Phase 6d — MacroClient.
 *
 * Run via: npm test -- macro-client
 */

import { MacroClient, configureMacroClient, getMacroClient } from '../api/macro-client';

describe('MacroClient', () => {
  it('runMacro returns ok when server returns { ok: true, data }', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: { hello: 'world' } }),
    });
    const client = new MacroClient({ baseUrl: 'http://test', fetchImpl: fetchImpl as unknown as typeof fetch });
    const r = await client.runMacro('foo', 'bar', { x: 1 });
    expect(r.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith('http://test/api/lens/run', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('attaches Bearer token when getAuthToken provided', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    const client = new MacroClient({
      baseUrl: 'http://test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getAuthToken: () => 'token-xyz',
    });
    await client.runMacro('foo', 'bar');
    const call = fetchImpl.mock.calls[0][1];
    expect(call.headers['authorization']).toBe('Bearer token-xyz');
  });

  it('returns http_error reason on non-ok response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    });
    const client = new MacroClient({
      baseUrl: 'http://test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retries: 0,
    });
    const r = await client.runMacro('foo', 'bar');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('http_error');
    expect(r.status).toBe(401);
  });

  it('retries on transient 503', async () => {
    let calls = 0;
    const fetchImpl = jest.fn().mockImplementation(() => {
      calls++;
      if (calls < 2) return Promise.resolve({ ok: false, status: 503, json: async () => ({}) });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
    });
    const client = new MacroClient({
      baseUrl: 'http://test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retries: 2,
    });
    const r = await client.runMacro('foo', 'bar');
    expect(r.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it('returns fetch_failed reason on network throw after retries', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('network down'));
    const client = new MacroClient({
      baseUrl: 'http://test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retries: 1,
    });
    const r = await client.runMacro('foo', 'bar');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('fetch_failed');
  });

  it('configureMacroClient + getMacroClient round-trip', () => {
    const c = configureMacroClient({ baseUrl: 'http://x' });
    expect(getMacroClient()).toBe(c);
  });
});
