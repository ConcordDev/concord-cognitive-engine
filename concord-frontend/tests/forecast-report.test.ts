import { describe, it, expect } from 'vitest';
import {
  forecastSentence,
  forecastBody,
  forecastReportDtuCall,
  forecastThreadDraftCall,
  forecastThreadDraftOutcome,
  indexForecastDrafts,
  type ForecastFacts,
} from '@/components/forecast/forecastReport';

const facts: ForecastFacts = {
  worldId: 'concordia-hub',
  forecast: {
    window_hours: 24,
    weather: { kind: 'rain', confidence: 0.72, temperature_c: 14.3, humidity_pct: 80 },
    ecology: { ecosystem_score: 3.42, trend: 'recovering', ecosystem_score_delta: 0.15 },
    factions: [
      { id: 'merchants', predicted_kind: 'trade', momentum: 0.6, eta_hours: 12, confidence: 0.55 },
    ],
    events: [
      { kind: 'migration', summary: 'Herders moving south', eta_hours: 6, confidence: 0.68 },
    ],
    drift: { likely_kind: 'resource_depletion', severity: 'high' },
    composedAt: 1791164779,
  },
};

describe('forecast report', () => {
  it('states only the figures the backend reported', () => {
    const s = forecastSentence(facts)!;
    expect(s).toContain('concordia-hub');
    expect(s).toContain('rain');
    expect(s).toContain('14.3°C');
    expect(s).toContain('80% humidity');
    expect(s).toContain('72% confidence');
    expect(s).toContain('ecology recovering');
    expect(s).toContain('1 faction moves');
    expect(s).toContain('1 premonitions');
    expect(s).toContain('drift resource_depletion (high)');
  });

  it('refuses to summarise a forecast with no world or no data', () => {
    expect(forecastSentence({ worldId: '', forecast: facts.forecast })).toBeNull();
    expect(forecastSentence({ worldId: 'x', forecast: null })).toBeNull();
    expect(forecastBody({ worldId: '', forecast: null })).toBe('');
    expect(forecastReportDtuCall({ worldId: '', forecast: null })).toBeNull();
  });

  it('says so when the forecast has no detail, instead of inventing figures', () => {
    const bare: ForecastFacts = {
      worldId: 'empty-world',
      forecast: { window_hours: 24, weather: null, ecology: null, factions: [], events: [], drift: null },
    };
    expect(forecastSentence(bare)).toContain('no forecast detail yet');
  });

  it('builds a private forecast-report DTU carrying the same numbers', () => {
    const call = forecastReportDtuCall(facts)!;
    expect(call.domain).toBe('dtu');
    expect(call.action).toBe('create');
    expect(call.input.source).toBe('forecast-lens:report');
    expect((call.input.meta as Record<string, unknown>).visibility).toBe('private');
    expect(call.input.machine).toMatchObject({
      kind: 'forecast_lens_report',
      worldId: 'concordia-hub',
      windowHours: 24,
      weatherKind: 'rain',
      temperatureC: 14.3,
      weatherConfidence: 0.72,
      ecologyTrend: 'recovering',
      ecosystemScore: 3.42,
      factionCount: 1,
      eventCount: 1,
      driftKind: 'resource_depletion',
      driftSeverity: 'high',
    });
  });

  it('will not draft without a real DTU id to cite', () => {
    expect(forecastThreadDraftCall(facts, '')).toBeNull();
    expect(forecastThreadDraftCall(facts, 'not an id')).toBeNull();
    const call = forecastThreadDraftCall(facts, 'dtu_abc123')!;
    expect(call.domain).toBe('thread');
    expect(call.action).toBe('thread-draft');
    expect(call.input.citedDtuId).toBe('dtu_abc123');
    expect(String(call.input.content)).toContain('No external weather service was contacted');
    expect(String(call.input.content)).toContain('Nothing was published');
  });

  it('claims a draft only when Thread kept the exact cite and did not post', () => {
    const ok = { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_abc123' } } };
    expect(forecastThreadDraftOutcome(ok, 'dtu_abc123')).toEqual({ draftId: 'th_1', status: 'draft', citedDtuId: 'dtu_abc123' });
    expect(forecastThreadDraftOutcome({ ok: false }, 'dtu_abc123')).toBeNull();
    expect(forecastThreadDraftOutcome({ ok: true, result: { draft: { id: 'th_1', status: 'published', citedDtuId: 'dtu_abc123' } } }, 'dtu_abc123')).toBeNull();
    expect(forecastThreadDraftOutcome(null, 'dtu_abc123')).toBeNull();
  });

  it('indexes drafts by the DTU they cite after a reload', () => {
    const index = indexForecastDrafts([
      { ok: true, result: { draft: { id: 'th_1', citedDtuId: 'dtu_abc123' } } },
      { ok: true, result: { draft: { id: 'th_3', citedDtuId: 'dtu_zzz' } } },
      null,
    ]);
    expect(index).toEqual({ dtu_abc123: 'th_1', dtu_zzz: 'th_3' });
    expect(indexForecastDrafts(null)).toEqual({});
  });

  it('body names the source and says no external service was contacted', () => {
    const body = forecastBody(facts);
    expect(body).toContain('Every figure here came from the Forecast domain');
    expect(body).toContain('No external weather service was contacted');
    expect(body).toContain('Nothing was published by saving this');
  });
});