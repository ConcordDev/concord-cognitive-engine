/**
 * A forecast report exists because the Forecast domain's `compose` and
 * `recent` macros returned the real 24h outlook for a world — weather,
 * ecology, factions, events, and drift. This module turns exactly that
 * result into a sentence, saves it as a private DTU, reads that DTU back,
 * and hands it to Thread as a draft.
 *
 * Every figure below comes from a macro response. A figure the backend did
 * not return is reported as missing, never invented. Nothing here publishes
 * anything: a Thread draft is a draft until the user posts it themselves.
 */

import {
  dtuRecordId,
  dtuReadBackCall,
  dtuReadBackMatches,
  type ReceiptCall,
} from '@/components/wallet/walletReceipt';

export interface ForecastWeather {
  kind: string;
  confidence: number;
  temperature_c: number | null;
  humidity_pct?: number | null;
}

export interface ForecastEcology {
  ecosystem_score: number;
  trend: string;
  ecosystem_score_delta: number;
}

export interface ForecastFaction {
  id: string;
  predicted_kind: string;
  momentum: number;
  eta_hours: number | null;
  confidence: number;
}

export interface ForecastEvent {
  kind: string;
  summary: string;
  eta_hours: number | null;
  confidence: number;
}

export interface ForecastDrift {
  likely_kind: string;
  severity: string;
}

export interface ForecastData {
  window_hours: number;
  weather: ForecastWeather | null;
  ecology: ForecastEcology | null;
  factions: ForecastFaction[];
  events: ForecastEvent[];
  drift: ForecastDrift | null;
  composedAt?: number;
}

export interface ForecastFacts {
  worldId: string;
  forecast: ForecastData | null;
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

function temp(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v.toFixed(1)}°C`;
}

/**
 * The forecast sentence, built only from the real data. Null when there is
 * no forecast at all.
 */
export function forecastSentence(facts: ForecastFacts): string | null {
  const f = facts.forecast;
  const worldId = String(facts.worldId || '').trim();
  if (!f || !worldId) return null;

  const parts: string[] = [];
  if (f.weather) {
    const w = f.weather;
    parts.push(w.kind);
    if (w.temperature_c != null) parts.push(temp(w.temperature_c));
    if (w.humidity_pct != null) parts.push(`${w.humidity_pct}% humidity`);
    parts.push(`${pct(w.confidence)} confidence`);
  }
  if (f.ecology) {
    parts.push(`ecology ${f.ecology.trend}`);
  }
  if (f.factions.length > 0) parts.push(`${f.factions.length} faction moves`);
  if (f.events.length > 0) parts.push(`${f.events.length} premonitions`);
  if (f.drift) parts.push(`drift ${f.drift.likely_kind} (${f.drift.severity})`);

  return `${worldId}: ${parts.length > 0 ? parts.join(', ') : 'no forecast detail yet'}.`;
}

/** The full body saved as the DTU. Empty when there is nothing honest to save. */
export function forecastBody(facts: ForecastFacts): string {
  const sentence = forecastSentence(facts);
  if (!sentence) return '';
  const lines = [sentence];
  const f = facts.forecast!;
  if (f.window_hours) lines.push(`Window: ${f.window_hours}h.`);
  if (f.weather) {
    lines.push(`Weather: ${f.weather.kind}, ${temp(f.weather.temperature_c)}, ${pct(f.weather.confidence)} confidence.`);
  }
  if (f.ecology) {
    lines.push(`Ecology: ${f.ecology.trend}, score ${f.ecology.ecosystem_score?.toFixed(2) ?? '—'}.`);
  }
  if (f.factions.length > 0) {
    lines.push(`Factions: ${f.factions.map((x) => `${x.id} (${x.predicted_kind}, ${pct(x.confidence)})`).join('; ')}.`);
  }
  if (f.events.length > 0) {
    lines.push(`Premonitions: ${f.events.map((e) => `${e.summary} (${e.kind}, ${pct(e.confidence)})`).join('; ')}.`);
  }
  if (f.drift) {
    lines.push(`Drift: ${f.drift.likely_kind}, severity ${f.drift.severity}.`);
  }
  if (f.composedAt) {
    lines.push(`Composed: ${new Date(f.composedAt * 1000).toLocaleString()}.`);
  }
  lines.push('Every figure here came from the Forecast domain in Concord. No external weather service was contacted. Nothing was published by saving this.');
  return lines.join('\n');
}

/** The machine payload — the same forecast, structured. */
export function forecastMachine(facts: ForecastFacts): Record<string, unknown> | null {
  if (!forecastSentence(facts)) return null;
  const f = facts.forecast!;
  return {
    kind: 'forecast_lens_report',
    worldId: facts.worldId,
    windowHours: f.window_hours,
    weatherKind: f.weather?.kind ?? null,
    temperatureC: f.weather?.temperature_c ?? null,
    weatherConfidence: f.weather?.confidence ?? null,
    ecologyTrend: f.ecology?.trend ?? null,
    ecosystemScore: f.ecology?.ecosystem_score ?? null,
    factionCount: f.factions.length,
    eventCount: f.events.length,
    driftKind: f.drift?.likely_kind ?? null,
    driftSeverity: f.drift?.severity ?? null,
    composedAt: f.composedAt ?? null,
  };
}

/** The private DTU that records this forecast. Null when nothing can be saved. */
export function forecastReportDtuCall(facts: ForecastFacts): ReceiptCall | null {
  const body = forecastBody(facts);
  const sentence = forecastSentence(facts);
  const machine = forecastMachine(facts);
  if (!body || !sentence || !machine) return null;
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: sentence.slice(0, 80),
      tags: ['forecast', 'weather', 'forecast-report', facts.worldId.toLowerCase()],
      source: 'forecast-lens:report',
      human: { summary: body },
      core: { definitions: [sentence], claims: [body.slice(0, 240)] },
      machine,
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'forecast',
        forecast: {
          worldId: facts.worldId,
          weatherKind: String(facts.forecast?.weather?.kind ?? ''),
        },
      },
    },
  };
}

export { dtuRecordId, dtuReadBackCall, dtuReadBackMatches };

/**
 * The Thread draft carrying that forecast report. Thread stores a draft —
 * it does not publish. Null when there is no real DTU id to cite.
 */
export function forecastThreadDraftCall(
  facts: ForecastFacts,
  dtuId: string,
  platform = 'x',
): ReceiptCall | null {
  const id = String(dtuId || '').trim();
  const sentence = forecastSentence(facts);
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !sentence) return null;
  return {
    domain: 'thread',
    action: 'thread-draft',
    input: {
      title: `${facts.worldId} forecast`.slice(0, 120),
      content: forecastBody(facts),
      platform,
      citedDtuId: id,
    },
  };
}

export interface ForecastDraftResult {
  draftId: string;
  status: string;
  citedDtuId: string;
}

/** What the screen may claim about a Thread draft. Null when it did not land. */
export function forecastThreadDraftOutcome(
  data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined,
  dtuId: string,
): ForecastDraftResult | null {
  if (!data || data.ok === false) return null;
  const result = data.result && typeof data.result === 'object' ? (data.result as Record<string, unknown>) : null;
  const draft = result?.draft && typeof result.draft === 'object' ? (result.draft as Record<string, unknown>) : null;
  if (!draft) return null;
  const draftId = String(draft.id || '').trim();
  const cited = String(draft.citedDtuId || '').trim();
  const status = String(draft.status || '').trim();
  if (!draftId || cited !== String(dtuId).trim() || status !== 'draft') return null;
  return { draftId, status, citedDtuId: cited };
}

/**
 * Index the drafts Thread already holds by the DTU they cite, so a reload
 * shows the same "Drafted in Thread" the send reported.
 */
export function indexForecastDrafts(details: unknown): Record<string, string> {
  const list = Array.isArray(details) ? details : [];
  const out: Record<string, string> = {};
  for (const entry of list) {
    const envelope = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
    if (!envelope || envelope.ok === false) continue;
    const result = envelope.result && typeof envelope.result === 'object' ? (envelope.result as Record<string, unknown>) : envelope;
    const draft = result?.draft && typeof result.draft === 'object' ? (result.draft as Record<string, unknown>) : null;
    if (!draft) continue;
    const draftId = String(draft.id || '').trim();
    const cited = String(draft.citedDtuId || '').trim();
    if (!draftId || !cited || out[cited]) continue;
    out[cited] = draftId;
  }
  return out;
}