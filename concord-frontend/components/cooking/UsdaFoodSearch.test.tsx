import { describe, it, expect } from 'vitest';
import { usdaErrorText, toUsdaResult } from './UsdaFoodSearch';

describe('toUsdaResult (lensRun envelope)', () => {
  it('returns the macro result on success, so foods are actually read', () => {
    const r = toUsdaResult({ ok: true, result: { ok: true, foods: [{ fdcId: 1, description: 'Apple, raw' }], usingDemoKey: false }, error: null });
    expect(r?.ok).toBe(true);
    expect(r?.foods?.[0].description).toBe('Apple, raw');
  });
  it('keeps the server error text on failure (result is null)', () => {
    const r = toUsdaResult({ ok: false, result: null, error: 'USDA FoodData Central returned HTTP 400' });
    expect(r).toMatchObject({ ok: false, error: 'USDA FoodData Central returned HTTP 400' });
    expect(usdaErrorText(r)).toBe('USDA FoodData Central returned HTTP 400');
  });
  it('null envelope → null', () => {
    expect(toUsdaResult(null)).toBeNull();
  });
});

describe('usdaErrorText', () => {
  it('names the HTTP status and USDA message instead of "unreachable"', () => {
    const t = usdaErrorText({ reason: 'usda_http_error', status: 400, usdaMessage: 'bad dataType' });
    expect(t).toBe('USDA rejected the search (HTTP 400): bad dataType.');
    expect(t).not.toMatch(/unreachable/i);
  });
  it('omits the detail when USDA sent none', () => {
    expect(usdaErrorText({ reason: 'usda_http_error', status: 400, usdaMessage: null })).toBe('USDA rejected the search (HTTP 400).');
  });
  it('reports rate limiting, timeouts and network failures distinctly', () => {
    expect(usdaErrorText({ reason: 'usda_rate_limited', status: 429 })).toMatch(/rate limit/);
    expect(usdaErrorText({ reason: 'usda_timeout' })).toMatch(/did not answer/);
    expect(usdaErrorText({ reason: 'usda_unreachable', error: 'fetch failed' })).toBe('fetch failed');
  });
  it('handles a missing server response', () => {
    expect(usdaErrorText(null)).toMatch(/no response/);
  });
});
