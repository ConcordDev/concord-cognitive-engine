/**
 * A hypothesis registry report exists because the Hypothesis domain's
 * `preregister` and `recordOutcome` macros stored a real pre-registration
 * with its outcome verdict. This module turns exactly that record into a
 * sentence, saves it as a private DTU, reads that DTU back, and hands it
 * to Thread as a draft.
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

export interface PreRegOutcome {
  verdict?: string;
  pValue?: number | null;
  effectSize?: number | null;
  reject?: boolean;
  predictionConfirmed?: boolean;
  observedDirection?: string;
  resolvedAt?: string;
}

export interface PreRegRecord {
  id: string;
  statement: string;
  predictedDirection?: string;
  plannedTest?: string | null;
  alpha?: number;
  plannedSampleSize?: number | null;
  status?: string;
  outcome?: PreRegOutcome | null;
  registeredAt?: string;
  notes?: string;
}

/**
 * The registry sentence, built only from the real record. Null when there
 * is no record at all.
 */
export function registrySentence(rec: PreRegRecord | null | undefined): string | null {
  const id = String(rec?.id || '').trim();
  const statement = String(rec?.statement || '').trim();
  if (!id || !statement) return null;

  const parts: string[] = [];
  const status = String(rec?.status || 'registered').trim();
  const outcome = rec?.outcome;
  if (outcome?.verdict) {
    parts.push(`verdict: ${outcome.verdict}`);
  }
  if (status === 'resolved' && outcome) {
    if (typeof outcome.predictionConfirmed === 'boolean') {
      parts.push(`prediction ${outcome.predictionConfirmed ? 'confirmed' : 'not confirmed'}`);
    }
    if (Number.isFinite(outcome.pValue)) {
      parts.push(`p=${Number(outcome.pValue).toFixed(4)}`);
    }
    if (Number.isFinite(outcome.effectSize)) {
      parts.push(`d=${Number(outcome.effectSize).toFixed(3)}`);
    }
  } else {
    parts.push(`status: ${status}`);
  }
  if (rec?.plannedTest) parts.push(`planned: ${rec.plannedTest}`);
  if (rec && Number.isFinite(rec.alpha)) parts.push(`α=${rec.alpha}`);

  const lead = statement.length > 60 ? `${statement.slice(0, 57)}…` : statement;
  return `${lead} — ${parts.join(', ')}.`;
}

/** The full body saved as the DTU. Empty when there is nothing honest to save. */
export function registryBody(rec: PreRegRecord | null | undefined): string {
  const sentence = registrySentence(rec);
  if (!sentence) return '';
  const lines = [sentence];
  if (rec?.id) lines.push(`Pre-registration ID: ${rec.id}.`);
  if (rec?.registeredAt) lines.push(`Registered: ${rec.registeredAt}.`);
  if (rec?.plannedSampleSize) lines.push(`Planned sample size: ${rec.plannedSampleSize}.`);
  if (rec?.predictedDirection) lines.push(`Predicted direction: ${rec.predictedDirection}.`);
  const outcome = rec?.outcome;
  if (outcome?.resolvedAt) lines.push(`Outcome recorded: ${outcome.resolvedAt}.`);
  if (typeof outcome?.reject === 'boolean') lines.push(`H₀ ${outcome.reject ? 'rejected' : 'not rejected'}.`);
  if (outcome?.observedDirection) lines.push(`Observed direction: ${outcome.observedDirection}.`);
  if (rec?.notes) lines.push(`Notes: ${rec.notes}.`);
  lines.push('Every figure here came from the Hypothesis domain in Concord. Nothing was published by saving this.');
  return lines.join('\n');
}

/** The machine payload — the same record, structured. */
export function registryMachine(rec: PreRegRecord | null | undefined): Record<string, unknown> | null {
  if (!registrySentence(rec)) return null;
  const outcome = rec?.outcome;
  return {
    kind: 'hypothesis_registry_report',
    preRegId: String(rec?.id || ''),
    statement: String(rec?.statement || ''),
    status: String(rec?.status || 'registered'),
    plannedTest: String(rec?.plannedTest || ''),
    alpha: Number(rec?.alpha) || 0,
    predictedDirection: String(rec?.predictedDirection || ''),
    verdict: outcome?.verdict || null,
    pValue: outcome && Number.isFinite(outcome.pValue) ? Number(outcome.pValue) : null,
    effectSize: outcome && Number.isFinite(outcome.effectSize) ? Number(outcome.effectSize) : null,
    predictionConfirmed: outcome?.predictionConfirmed ?? null,
  };
}

/** The private DTU that records this pre-registration. Null when nothing can be saved. */
export function registryDtuCall(rec: PreRegRecord | null | undefined): ReceiptCall | null {
  const body = registryBody(rec);
  const sentence = registrySentence(rec);
  const machine = registryMachine(rec);
  if (!body || !sentence || !machine) return null;
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: sentence.slice(0, 80),
      tags: ['hypothesis', 'preregistration', String(rec?.status || 'registered').toLowerCase()],
      source: 'hypothesis-lens:preregistration',
      human: { summary: body },
      core: { definitions: [sentence], claims: [body.slice(0, 240)] },
      machine,
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'hypothesis',
        hypothesis: {
          preRegId: String(rec?.id || ''),
          statement: String(rec?.statement || '').slice(0, 200),
        },
      },
    },
  };
}

export { dtuRecordId, dtuReadBackCall, dtuReadBackMatches };

/**
 * The Thread draft carrying that registry report. Thread stores a draft —
 * it does not publish. Null when there is no real DTU id to cite.
 */
export function registryThreadDraftCall(
  rec: PreRegRecord | null | undefined,
  dtuId: string,
  platform = 'x',
): ReceiptCall | null {
  const id = String(dtuId || '').trim();
  const sentence = registrySentence(rec);
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !sentence) return null;
  return {
    domain: 'thread',
    action: 'thread-draft',
    input: {
      title: String(rec?.statement || 'Hypothesis pre-registration').slice(0, 120),
      content: registryBody(rec),
      platform,
      citedDtuId: id,
    },
  };
}

export interface RegistryDraftResult {
  draftId: string;
  status: string;
  citedDtuId: string;
}

/** What the screen may claim about a Thread draft. Null when it did not land. */
export function registryThreadDraftOutcome(
  data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined,
  dtuId: string,
): RegistryDraftResult | null {
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
export function indexRegistryDrafts(details: unknown): Record<string, string> {
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