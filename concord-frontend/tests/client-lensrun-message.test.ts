/**
 * lensRun must carry a shaped lens failure's human `message` alongside
 * its machine `error` code (Review F15). The server shapes a macro
 * refusal as a 4xx body { ok:false, error:<code>, message:<human> };
 * lensRun's catch used to read only `error`, so every consumer
 * downstream had nothing but the code — or, in the repos workspace, a
 * flattened "network error" — to show the user. `error` keeps the
 * code (callers branch on it); `message` is the display text.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { api, lensRun } from '../lib/api/client';

describe('lensRun — shaped failure message carry', () => {
  const originalAdapter = api.defaults.adapter;
  afterEach(() => { api.defaults.adapter = originalAdapter; });

  it('a 4xx shaped refusal returns the code in error and the human sentence in message', async () => {
    api.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      const response = {
        status: 400, statusText: '', headers: {}, config,
        data: { ok: false, error: 'branch_in_open_pr', message: 'Pull request #1 is still open against "feat" — merge or close it first.' },
      } as AxiosResponse;
      throw new AxiosError('Request failed with status code 400', 'ERR_BAD_RESPONSE', config, {}, response);
    };
    const r = await lensRun('repos', 'branch-delete', { repoId: 'r1', name: 'feat' });
    expect(r.data.ok).toBe(false);
    expect(r.data.error).toBe('branch_in_open_pr');
    expect(r.data.message).toBe('Pull request #1 is still open against "feat" — merge or close it first.');
  });

  it('a failure body without a message yields message: null (never a fabricated sentence)', async () => {
    api.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      const response = {
        status: 422, statusText: '', headers: {}, config,
        data: { ok: false, error: 'commit_message_required' },
      } as AxiosResponse;
      throw new AxiosError('Request failed with status code 422', 'ERR_BAD_RESPONSE', config, {}, response);
    };
    const r = await lensRun('repos', 'file-save', {});
    expect(r.data.ok).toBe(false);
    expect(r.data.error).toBe('commit_message_required');
    expect(r.data.message).toBeNull();
  });

  it('a 200 terminal { ok:false } body also carries its message', async () => {
    api.defaults.adapter = async (config: InternalAxiosRequestConfig) => ({
      status: 200, statusText: '', headers: {}, config,
      data: { ok: false, error: 'upstream_unavailable', message: 'The feed is unreachable right now.' },
    } as AxiosResponse);
    const r = await lensRun('atlas', 'geocode', {});
    expect(r.data.ok).toBe(false);
    expect(r.data.error).toBe('upstream_unavailable');
    expect(r.data.message).toBe('The feed is unreachable right now.');
  });
});
