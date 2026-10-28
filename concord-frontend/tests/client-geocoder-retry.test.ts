/**
 * The geocoder's opt-in 503 (code "geocoder_unavailable") must NOT be
 * auto-retried by the API client: retryAfterS is a hint for the user
 * ("try again in N s"), and the geocoder's door is rate-limited to
 * 1 req/s — retrying would queue more lookups behind an outage.
 * A plain 503 without the code keeps the normal retry behaviour.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { api, isGeocoderUnavailablePayload } from '../lib/api/client';

function failingAdapter(status: number, data: unknown, counter: { n: number }) {
  return async (config: InternalAxiosRequestConfig) => {
    counter.n += 1;
    const response = { status, statusText: '', data, headers: {}, config } as AxiosResponse;
    throw new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', config, {}, response);
  };
}

describe('geocoder_unavailable client handling', () => {
  const originalAdapter = api.defaults.adapter;
  afterEach(() => { api.defaults.adapter = originalAdapter; });

  it('the predicate matches only the geocoder outage shape', () => {
    expect(isGeocoderUnavailablePayload({ code: 'geocoder_unavailable' })).toBe(true);
    expect(isGeocoderUnavailablePayload({ error: 'geocoder_unavailable' })).toBe(true);
    expect(isGeocoderUnavailablePayload({ code: 'shutting_down' })).toBe(false);
    expect(isGeocoderUnavailablePayload({ error: 'upstream_unavailable' })).toBe(false);
    expect(isGeocoderUnavailablePayload(null)).toBe(false);
    expect(isGeocoderUnavailablePayload('geocoder_unavailable')).toBe(false);
  });

  it('a 503 geocoder_unavailable is NOT retried (GET or POST)', async () => {
    const counter = { n: 0 };
    api.defaults.adapter = failingAdapter(
      503,
      { ok: false, code: 'geocoder_unavailable', error: 'geocoder_unavailable', retryAfterS: 30 },
      counter,
    );
    await expect(api.get('/api/lens/run')).rejects.toMatchObject({ response: { status: 503 } });
    expect(counter.n).toBe(1);
    await expect(api.post('/api/lens/run', {})).rejects.toMatchObject({ response: { status: 503 } });
    expect(counter.n).toBe(2);
  });

  it('a plain 503 without the geocoder code IS retried', async () => {
    const counter = { n: 0 };
    api.defaults.adapter = failingAdapter(503, { ok: false, error: 'boom', retryAfterS: 1 }, counter);
    await expect(api.get('/api/lens/run')).rejects.toMatchObject({ response: { status: 503 } });
    expect(counter.n).toBeGreaterThan(1);
  }, 20_000);
});
