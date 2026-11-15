import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';

/**
 * GB-1536 §6e — the client.ts backstop. When the page is a guest page:
 * a non-GET request is NEVER sent (typed GuestActionBlocked + the
 * signup modal opens); a /api/lens/run call on the guest-read mirror
 * list IS sent (the server's spec registry is the authority); GETs
 * pass; a guest 401 opens the modal instead of the old hard redirect
 * to /login. The adapter stub proves "sent" vs "not sent" exactly.
 */

const opener = vi.fn();

vi.mock('@/lib/guest-bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/guest-bridge')>();
  return {
    ...actual,
    openGuestAuth: (returnTo?: string) => opener(returnTo),
  };
});

import { api, GuestActionBlocked } from '@/lib/api/client';
import { setGuestMode } from '@/lib/guest-bridge';

const adapterCalls: AxiosRequestConfig[] = [];
function okAdapter(config: AxiosRequestConfig): Promise<AxiosResponse> {
  adapterCalls.push(config);
  return Promise.resolve({
    data: { ok: true },
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  } as AxiosResponse);
}

describe('client.ts guest backstop (GB-1536)', () => {
  beforeEach(() => {
    opener.mockClear();
    adapterCalls.length = 0;
    api.defaults.adapter = okAdapter;
    window.history.pushState({}, '', '/lenses/chem');
  });
  afterEach(() => {
    setGuestMode(false);
  });

  it('a guest POST to a write endpoint is never sent — typed rejection + modal opens', async () => {
    setGuestMode(true);
    await expect(api.post('/api/lens/code', { title: 'x' })).rejects.toBeInstanceOf(GuestActionBlocked);
    expect(adapterCalls).toHaveLength(0);
    expect(opener).toHaveBeenCalledTimes(1);
    expect(opener.mock.calls[0][0]).toContain('/lenses/chem');
  });

  it('a guest PUT/DELETE is never sent either', async () => {
    setGuestMode(true);
    await expect(api.put('/api/lens/code/abc', {})).rejects.toBeInstanceOf(GuestActionBlocked);
    await expect(api.delete('/api/lens/code/abc')).rejects.toBeInstanceOf(GuestActionBlocked);
    expect(adapterCalls).toHaveLength(0);
  });

  it('a guest lensRun on the guest-read list IS sent (server decides)', async () => {
    setGuestMode(true);
    const res = await api.post('/api/lens/run', { domain: 'lens', action: 'list', input: { domain: 'feed' } });
    expect(res.data).toEqual({ ok: true });
    expect(adapterCalls).toHaveLength(1);
    expect(opener).not.toHaveBeenCalled();
  });

  it('a guest lensRun NOT on the guest-read list is never sent', async () => {
    setGuestMode(true);
    await expect(
      api.post('/api/lens/run', { domain: 'code', action: 'snippets-save', input: {} }),
    ).rejects.toBeInstanceOf(GuestActionBlocked);
    expect(adapterCalls).toHaveLength(0);
    expect(opener).toHaveBeenCalledTimes(1);
  });

  it('guest GETs pass through untouched', async () => {
    setGuestMode(true);
    const res = await api.get('/api/lens/feed');
    expect(res.data).toEqual({ ok: true });
    expect(adapterCalls).toHaveLength(1);
    expect(opener).not.toHaveBeenCalled();
  });

  it('a signed-in user is unaffected by the backstop', async () => {
    setGuestMode(false);
    const res = await api.post('/api/lens/code', { title: 'x' });
    expect(res.data).toEqual({ ok: true });
    expect(adapterCalls).toHaveLength(1);
    expect(opener).not.toHaveBeenCalled();
  });

  it('a guest 401 on a mutation opens the modal — no navigation, no refresh attempt', async () => {
    setGuestMode(true);
    const err401 = {
      response: { status: 401, data: { ok: false } },
      config: { url: '/api/lens/run', method: 'post' },
      isAxiosError: true,
    };
    api.defaults.adapter = (config: AxiosRequestConfig) => {
      adapterCalls.push(config);
      // The guest-read exception lets this reach the adapter; the
      // adapter answers 401 (e.g. the action was not guestRead after all).
      return Promise.reject({ ...err401, config });
    };
    await expect(
      api.post('/api/lens/run', { domain: 'lens', action: 'list', input: {} }),
    ).rejects.toMatchObject({ response: { status: 401 } });
    expect(opener).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/lenses/chem'); // still here
  });
});
