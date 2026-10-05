/**
 * An astronomy observation report exists because the Astronomy domain's
 * `observation-log` macro returned the real observation — id, targetId,
 * targetName, date, conditions, notes, rating, createdAt. This module
 * turns exactly that result into a sentence, saves it as a private DTU,
 * reads that DTU back, and hands it to Thread as a draft.
 *
 * Every figure below comes from a macro response. A figure the backend
 * did not return is reported as missing, never invented. Nothing here
 * publishes anything: a Thread draft is a draft until the user posts it.
 */

import {
  dtuRecordId,
  dtuReadBackCall,
  dtuReadBackMatches,
  type ReceiptCall,
} from '@/components/wallet/walletReceipt';

export interface AstroObservation {
  id?: string;
  targetId?: string;
  targetName?: string;
  sessionId?: string | null;
  date?: string;
  equipment?: string | null;
  conditions?: string | null;
  notes?: string | null;
  rating?: number;
  createdAt?: string;
}

export interface AstroReportFacts {
  observation: AstroObservation | null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown, max = 120): string {
  return String(v == null ? '' : v).trim().slice(0, max);
}

/**
 * The observation report sentence, built only from the real observation.
 * Null when there is no observation, no id, or no target name.
 */
export function astroSentence(facts: AstroReportFacts): string | null {
  const o = facts.observation;
  if (!o || !o.id || !o.targetName) return null;
  const date = str(o.date, 10);
  const rating = Math.max(0, Math.min(5, Math.round(num(o.rating))));
  return `${date} ${o.targetName}: ${rating}★ observation.`;
}

/** The full body saved as the DTU. Empty when there is nothing honest to save. */
export function astroBody(facts: AstroReportFacts): string {
  const sentence = astroSentence(facts);
  const o = facts.observation;
  if (!sentence || !o) return '';
  const lines = [sentence, ''];
  lines.push(`Observation ID: ${o.id || '-'}`);
  lines.push(`Target: ${str(o.targetName, 120) || '-'}`);
  lines.push(`Target ID: ${str(o.targetId, 60) || '-'}`);
  lines.push(`Date: ${str(o.date, 10) || '-'}`);
  if (o.conditions) lines.push(`Conditions: ${str(o.conditions, 120)}`);
  if (o.equipment) lines.push(`Equipment: ${str(o.equipment, 120)}`);
  if (o.notes) lines.push(`Notes: ${str(o.notes, 800)}`);
  lines.push(`Rating: ${Math.max(0, Math.min(5, Math.round(num(o.rating))))}/5`);
  if (o.createdAt) lines.push(`Logged: ${str(o.createdAt, 30)}`);
  lines.push('');
  lines.push('Every figure here came from the Astronomy domain observation-log macro in Concord. Nothing was published by saving this.');
  return lines.join('\n');
}

/** The machine payload — the same observation the macro returned, structured. */
export function astroMachine(facts: AstroReportFacts): Record<string, unknown> | null {
  const o = facts.observation;
  if (!astroSentence(facts) || !o) return null;
  return {
    kind: 'astronomy_observation_report',
    observationId: o.id || null,
    targetId: o.targetId || null,
    targetName: o.targetName || null,
    date: o.date || null,
    rating: Math.max(0, Math.min(5, Math.round(num(o.rating)))),
  };
}

/** The private DTU that records this observation. Null when nothing can be saved. */
export function astroDtuCall(facts: AstroReportFacts): ReceiptCall | null {
  const body = astroBody(facts);
  const sentence = astroSentence(facts);
  const machine = astroMachine(facts);
  if (!body || !sentence || !machine) return null;
  const tags = ['astronomy', 'observation'];
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: sentence.slice(0, 80),
      tags,
      source: 'astronomy-lens:observation-report',
      human: { summary: body },
      core: { definitions: [sentence], claims: [body.slice(0, 240)] },
      machine,
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'astronomy',
      },
    },
  };
}

export { dtuRecordId, dtuReadBackCall, dtuReadBackMatches };

/**
 * The Thread draft carrying that observation report. Thread stores a
 * draft — it does not publish. Null when there is no real DTU id to cite.
 */
export function astroThreadDraftCall(
  facts: AstroReportFacts,
  dtuId: string,
  platform = 'x',
): ReceiptCall | null {
  const id = String(dtuId || '').trim();
  const sentence = astroSentence(facts);
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !sentence) return null;
  const o = facts.observation!;
  const name = str(o.targetName, 40) || 'observation';
  return {
    domain: 'thread',
    action: 'thread-draft',
    input: {
      title: `Astronomy observation — ${name}`.slice(0, 120),
      content: astroBody(facts),
      platform,
      citedDtuId: id,
    },
  };
}

export interface AstroDraftResult {
  draftId: string;
  status: string;
  citedDtuId: string;
}

/** What the screen may claim about a Thread draft. Null when it did not land. */
export function astroThreadDraftOutcome(
  data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined,
  dtuId: string,
): AstroDraftResult | null {
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
export function indexAstroDrafts(details: unknown): Record<string, string> {
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