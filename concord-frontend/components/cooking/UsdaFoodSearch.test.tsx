import { describe, it, expect } from 'vitest';
import { usdaErrorText } from './UsdaFoodSearch';

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
    expect(usdaErrorText({ reason: 'usda_unreachable', error: 'fetch failed' })).toBe('USDA unreachable (fetch failed).');
  });
  it('handles a missing server response', () => {
    expect(usdaErrorText(null)).toMatch(/no response/);
  });
});
