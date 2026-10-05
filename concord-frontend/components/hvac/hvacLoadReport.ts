/**
 * An HVAC load report exists because the HVAC domain's `loadCalculation`
 * macro returned a real estimate (a square-foot rule of thumb adjusted for
 * climate, insulation and stories; not an ACCA Manual J calculation) — heating BTU,
 * cooling BTU, tonnage, equipment size, and a recommendation. This module
 * turns exactly that result into a sentence, saves it as a private DTU,
 * reads that DTU back, and hands it to Thread as a draft.
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

export interface HvacLoadInputs {
  squareFootage: number;
  stories: number;
  insulation: string;
  climate: string;
}

export interface HvacLoadResult {
  squareFootage?: number;
  heatingBTU?: number;
  coolingBTU?: number;
  requiredBTU?: number;
  tonnage?: number;
  tonnageRecommended?: string;
  unitSize?: string;
  equipmentSize?: string;
  estimatedCost?: number;
  energyEstimate?: string;
  seerRecommendation?: string;
  recommendation?: string;
}

export interface HvacLoadFacts {
  inputs: HvacLoadInputs;
  result: HvacLoadResult | null;
  /** Id of the saved estimate in the user's load history, when saved. */
  loadId?: string;
}

/**
 * The load report sentence, built only from the real result. Null when
 * there is no result or no identifying figures.
 */
export function loadSentence(facts: HvacLoadFacts): string | null {
  const r = facts.result;
  const sqft = Number(facts.inputs?.squareFootage);
  if (!r || !Number.isFinite(sqft) || sqft <= 0) return null;
  const cooling = Number(r.coolingBTU);
  const heating = Number(r.heatingBTU);
  if (!Number.isFinite(cooling) || !Number.isFinite(heating)) return null;
  const tons = r.tonnageRecommended || (Number.isFinite(r.tonnage) ? `${r.tonnage} ton` : '');
  return `${sqft.toLocaleString()} sf ${facts.inputs.climate}: ${heating.toLocaleString()} BTU heat, ${cooling.toLocaleString()} BTU cool${tons ? `, ${tons}` : ''}.`;
}

/** The full body saved as the DTU. Empty when there is nothing honest to save. */
export function loadBody(facts: HvacLoadFacts): string {
  const sentence = loadSentence(facts);
  if (!sentence) return '';
  const r = facts.result!;
  const lines = [sentence];
  lines.push(`Square footage: ${(r.squareFootage ?? facts.inputs.squareFootage).toLocaleString()} sf.`);
  lines.push(`Stories: ${facts.inputs.stories}.`);
  lines.push(`Insulation: ${facts.inputs.insulation}.`);
  lines.push(`Climate: ${facts.inputs.climate}.`);
  if (r.requiredBTU != null) lines.push(`Required BTU: ${r.requiredBTU.toLocaleString()}.`);
  lines.push(`Heating: ${r.heatingBTU?.toLocaleString() ?? '?'} BTU/hr.`);
  lines.push(`Cooling: ${r.coolingBTU?.toLocaleString() ?? '?'} BTU/hr.`);
  if (r.tonnageRecommended) lines.push(`Tonnage: ${r.tonnageRecommended}.`);
  if (r.equipmentSize) lines.push(`Equipment: ${r.equipmentSize}.`);
  if (r.seerRecommendation) lines.push(`SEER: ${r.seerRecommendation}.`);
  if (r.estimatedCost != null) lines.push(`Estimated cost: $${r.estimatedCost.toLocaleString()}.`);
  if (r.energyEstimate) lines.push(`Energy: ${r.energyEstimate}.`);
  if (r.recommendation) lines.push(`Note: ${r.recommendation}`);
  if (facts.loadId) lines.push(`Load estimate id: ${facts.loadId}.`);
  lines.push('Every figure here came from the HVAC domain load estimate in Concord (square-foot rule of thumb adjusted for climate, insulation and stories; not an ACCA Manual J calculation). Nothing was published by saving this.');
  return lines.join('\n');
}

/** The machine payload — the same load result, structured. */
export function loadMachine(facts: HvacLoadFacts): Record<string, unknown> | null {
  if (!loadSentence(facts)) return null;
  const r = facts.result!;
  return {
    kind: 'hvac_load_report',
    loadId: facts.loadId ?? null,
    method: 'square-foot rule of thumb (not ACCA Manual J)',
    squareFootage: r.squareFootage ?? facts.inputs.squareFootage,
    stories: facts.inputs.stories,
    insulation: facts.inputs.insulation,
    climate: facts.inputs.climate,
    heatingBTU: r.heatingBTU ?? null,
    coolingBTU: r.coolingBTU ?? null,
    requiredBTU: r.requiredBTU ?? null,
    tonnage: r.tonnage ?? null,
    tonnageRecommended: r.tonnageRecommended ?? null,
    equipmentSize: r.equipmentSize ?? null,
    seerRecommendation: r.seerRecommendation ?? null,
    estimatedCost: r.estimatedCost ?? null,
  };
}

/** The private DTU that records this load result. Null when nothing can be saved. */
export function loadReportDtuCall(facts: HvacLoadFacts): ReceiptCall | null {
  const body = loadBody(facts);
  const sentence = loadSentence(facts);
  const machine = loadMachine(facts);
  if (!body || !sentence || !machine) return null;
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      // The load id keeps two identical estimates from colliding on the
      // global exact-title dedup (duplicate_blocked).
      title: `${sentence.slice(0, 80)}${facts.loadId ? ` · ${facts.loadId}` : ''}`,
      tags: ['hvac', 'load-calc', 'load-estimate', String(facts.inputs.climate || 'climate').toLowerCase()],
      source: 'hvac-lens:load-report',
      human: { summary: body },
      core: { definitions: [sentence], claims: [body.slice(0, 240)] },
      machine,
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'hvac',
      },
    },
  };
}

export { dtuRecordId, dtuReadBackCall, dtuReadBackMatches };

/**
 * The Thread draft carrying that load report. Thread stores a draft — it
 * does not publish. Null when there is no real DTU id to cite.
 */
export function loadThreadDraftCall(
  facts: HvacLoadFacts,
  dtuId: string,
  platform = 'x',
): ReceiptCall | null {
  const id = String(dtuId || '').trim();
  const sentence = loadSentence(facts);
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !sentence) return null;
  return {
    domain: 'thread',
    action: 'thread-draft',
    input: {
      title: `HVAC load — ${facts.inputs.squareFootage}sf ${facts.inputs.climate}`.slice(0, 120),
      content: loadBody(facts),
      platform,
      citedDtuId: id,
    },
  };
}

export interface LoadDraftResult {
  draftId: string;
  status: string;
  citedDtuId: string;
}

/** What the screen may claim about a Thread draft. Null when it did not land. */
export function loadThreadDraftOutcome(
  data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined,
  dtuId: string,
): LoadDraftResult | null {
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
export function indexLoadDrafts(details: unknown): Record<string, string> {
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