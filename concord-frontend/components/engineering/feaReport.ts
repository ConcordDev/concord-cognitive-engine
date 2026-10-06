/**
 * An engineering FEA report exists because the Engineering domain's
 * `runFEA` macro returned the real solve — displacements, stresses,
 * utilization, reactions, and a summary. This module turns exactly that
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

export interface FeaSummary {
  maxDisplacement: number;
  maxUtilization: number;
  allPass: boolean;
  memberCount?: number;
  nodeCount?: number;
}

export interface FeaResult {
  jobId?: string | null;
  elapsedMs?: number;
  summary?: FeaSummary;
  displacements?: unknown[];
  memberForces?: unknown[];
  stresses?: unknown[];
  utilization?: Array<{ id: string; utilization: number; pass: boolean }>;
  reactions?: unknown[];
  contour?: Array<{ id: string; utilization: number; band: string; pass: boolean }>;
}

export interface EngineeringFacts {
  jobName: string;
  result: FeaResult | null;
}

function fmt(n: number, digits = 4): string {
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

/**
 * The FEA report sentence, built only from the real summary. Null when
 * there is no result at all.
 */
export function feaSentence(facts: EngineeringFacts): string | null {
  const r = facts.result;
  const name = String(facts.jobName || '').trim();
  if (!r || !r.summary || !name) return null;
  const s = r.summary;
  const parts: string[] = [];
  parts.push(`${s.memberCount ?? '?'} members`);
  parts.push(`${s.nodeCount ?? '?'} nodes`);
  parts.push(`max util ${fmt(s.maxUtilization, 3)}`);
  parts.push(`max disp ${fmt(s.maxDisplacement, 4)}`);
  parts.push(s.allPass ? 'all pass' : 'has failures');
  return `${name}: ${parts.join(', ')}.`;
}

/** The full body saved as the DTU. Empty when there is nothing honest to save. */
export function feaBody(facts: EngineeringFacts): string {
  const sentence = feaSentence(facts);
  if (!sentence) return '';
  const lines = [sentence];
  const r = facts.result!;
  const s = r.summary!;
  if (r.jobId) lines.push(`Job: ${r.jobId}.`);
  if (r.elapsedMs != null) lines.push(`Elapsed: ${r.elapsedMs}ms.`);
  if (s.memberCount != null) lines.push(`Members: ${s.memberCount}.`);
  if (s.nodeCount != null) lines.push(`Nodes: ${s.nodeCount}.`);
  lines.push(`Max displacement: ${fmt(s.maxDisplacement, 6)}.`);
  lines.push(`Max utilization: ${fmt(s.maxUtilization, 4)}.`);
  lines.push(`All pass: ${s.allPass ? 'yes' : 'no'}.`);
  if (Array.isArray(r.utilization) && r.utilization.length > 0) {
    const failed = r.utilization.filter((u) => !u.pass);
    if (failed.length > 0) {
      lines.push(`Failed members: ${failed.map((u) => u.id).join(', ')}.`);
    } else {
      lines.push('Failed members: none.');
    }
  }
  lines.push('Every figure here came from the Engineering domain FEA solver in Concord. Nothing was published by saving this.');
  return lines.join('\n');
}

/** The machine payload — the same FEA result, structured. */
export function feaMachine(facts: EngineeringFacts): Record<string, unknown> | null {
  if (!feaSentence(facts)) return null;
  const r = facts.result!;
  const s = r.summary!;
  return {
    kind: 'engineering_fea_report',
    jobName: facts.jobName,
    jobId: r.jobId ?? null,
    elapsedMs: r.elapsedMs ?? null,
    memberCount: s.memberCount ?? 0,
    nodeCount: s.nodeCount ?? 0,
    maxDisplacement: s.maxDisplacement,
    maxUtilization: s.maxUtilization,
    allPass: s.allPass,
    failedCount: Array.isArray(r.utilization) ? r.utilization.filter((u) => !u.pass).length : 0,
  };
}

/** The private DTU that records this FEA result. Null when nothing can be saved. */
export function feaReportDtuCall(facts: EngineeringFacts): ReceiptCall | null {
  const body = feaBody(facts);
  const sentence = feaSentence(facts);
  const machine = feaMachine(facts);
  if (!body || !sentence || !machine) return null;
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      // Exact-title duplicates are blocked store-wide, so two runs with the
      // same summary would collide; the sim job id makes the title unique.
      title: `${sentence.slice(0, 80)}${facts.result?.jobId ? ` · ${String(facts.result.jobId).slice(0, 40)}` : ''}`,
      tags: ['engineering', 'fea', 'fea-report', String(facts.jobName || 'fea').toLowerCase().replace(/\s+/g, '-')],
      source: 'engineering-lens:fea-report',
      human: { summary: body },
      core: { definitions: [sentence], claims: [body.slice(0, 240)] },
      machine,
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'engineering',
      },
    },
  };
}

export { dtuRecordId, dtuReadBackCall, dtuReadBackMatches };

/**
 * The Thread draft carrying that FEA report. Thread stores a draft — it
 * does not publish. Null when there is no real DTU id to cite.
 */
export function feaThreadDraftCall(
  facts: EngineeringFacts,
  dtuId: string,
  platform = 'x',
): ReceiptCall | null {
  const id = String(dtuId || '').trim();
  const sentence = feaSentence(facts);
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !sentence) return null;
  return {
    domain: 'thread',
    action: 'thread-draft',
    input: {
      title: `${facts.jobName} FEA report`.slice(0, 120),
      content: feaBody(facts),
      platform,
      citedDtuId: id,
    },
  };
}

export interface FeaDraftResult {
  draftId: string;
  status: string;
  citedDtuId: string;
}

/** What the screen may claim about a Thread draft. Null when it did not land. */
export function feaThreadDraftOutcome(
  data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined,
  dtuId: string,
): FeaDraftResult | null {
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
export function indexFeaDrafts(details: unknown): Record<string, string> {
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