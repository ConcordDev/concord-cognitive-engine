/**
 * A fitness activity report exists because the Fitness domain's
 * `activity-detail` macro returned the real activity — type, distance,
 * duration, pace, calories, heart rate, elevation, relative effort, and
 * split analysis. This module turns exactly that result into a sentence,
 * saves it as a private DTU, reads that DTU back, and hands it to Thread
 * as a draft.
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

export interface FitnessActivityDetail {
  id?: string;
  type?: string;
  name?: string;
  date?: string;
  distanceKm?: number;
  durationSec?: number;
  duration?: string;
  paceSecPerKm?: number | null;
  pace?: string | null;
  speedKmh?: number | null;
  elevationGainM?: number;
  avgHr?: number;
  maxHr?: number;
  calories?: number;
  caloriesPerKm?: number | null;
  relativeEffort?: number;
  splitAnalysis?: { splits: unknown[]; fastestKm: number; slowestKm: number } | null;
}

export interface FitnessActivityFacts {
  activity: FitnessActivityDetail | null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown, max = 120): string {
  return String(v == null ? '' : v).trim().slice(0, max);
}

/**
 * The activity report sentence, built only from the real detail. Null when
 * there is no activity, no id, or no identifying figures.
 */
export function activitySentence(facts: FitnessActivityFacts): string | null {
  const a = facts.activity;
  if (!a || !a.id) return null;
  const name = str(a.name, 60) || str(a.type, 40);
  if (!name) return null;
  const distance = num(a.distanceKm);
  const duration = num(a.durationSec);
  if (distance <= 0 && duration <= 0) return null;
  const parts: string[] = [];
  parts.push(name);
  if (a.date) parts.push(a.date);
  const metrics: string[] = [];
  if (distance > 0) metrics.push(`${distance} km`);
  if (duration > 0) metrics.push(a.duration || `${duration}s`);
  if (a.pace) metrics.push(`${a.pace}/km`);
  if (a.calories != null && a.calories > 0) metrics.push(`${a.calories} kcal`);
  if (a.avgHr != null && a.avgHr > 0) metrics.push(`${a.avgHr} bpm avg`);
  if (a.relativeEffort != null && Number.isFinite(a.relativeEffort)) metrics.push(`RE ${a.relativeEffort}`);
  return `${parts.join(' · ')}: ${metrics.join(', ')}.`;
}

/** The full body saved as the DTU. Empty when there is nothing honest to save. */
export function activityBody(facts: FitnessActivityFacts): string {
  const sentence = activitySentence(facts);
  const a = facts.activity;
  if (!sentence || !a) return '';
  const lines = [sentence, ''];
  lines.push(`Type: ${a.type || '-'}`);
  lines.push(`Date: ${a.date || '-'}`);
  if (a.distanceKm != null) lines.push(`Distance: ${num(a.distanceKm)} km`);
  if (a.durationSec != null) lines.push(`Duration: ${a.duration || `${num(a.durationSec)}s`}`);
  if (a.pace) lines.push(`Pace: ${a.pace}/km`);
  if (a.speedKmh != null && Number.isFinite(a.speedKmh)) lines.push(`Speed: ${a.speedKmh} km/h`);
  if (a.elevationGainM != null && a.elevationGainM > 0) lines.push(`Elevation gain: ${a.elevationGainM} m`);
  if (a.avgHr != null && a.avgHr > 0) lines.push(`Avg HR: ${a.avgHr} bpm`);
  if (a.maxHr != null && a.maxHr > 0) lines.push(`Max HR: ${a.maxHr} bpm`);
  if (a.calories != null && a.calories > 0) lines.push(`Calories: ${a.calories}`);
  if (a.caloriesPerKm != null && Number.isFinite(a.caloriesPerKm)) lines.push(`Calories/km: ${a.caloriesPerKm}`);
  if (a.relativeEffort != null && Number.isFinite(a.relativeEffort)) lines.push(`Relative effort: ${a.relativeEffort}`);
  if (a.splitAnalysis && Array.isArray(a.splitAnalysis.splits) && a.splitAnalysis.splits.length > 0) {
    lines.push(`Splits: ${a.splitAnalysis.splits.length} (fastest km ${a.splitAnalysis.fastestKm}, slowest km ${a.splitAnalysis.slowestKm})`);
  }
  lines.push('');
  lines.push('Every figure here came from the Fitness domain activity-detail macro in Concord. Nothing was published by saving this.');
  return lines.join('\n');
}

/** The machine payload — the same activity the macro returned, structured. */
export function activityMachine(facts: FitnessActivityFacts): Record<string, unknown> | null {
  const a = facts.activity;
  if (!activitySentence(facts) || !a) return null;
  return {
    kind: 'fitness_activity_report',
    activityId: a.id || null,
    type: a.type || null,
    name: a.name || null,
    date: a.date || null,
    distanceKm: a.distanceKm != null ? num(a.distanceKm) : null,
    durationSec: a.durationSec != null ? num(a.durationSec) : null,
    paceSecPerKm: a.paceSecPerKm != null ? Number(a.paceSecPerKm) : null,
    speedKmh: a.speedKmh != null && Number.isFinite(a.speedKmh) ? Number(a.speedKmh) : null,
    elevationGainM: a.elevationGainM != null ? num(a.elevationGainM) : null,
    avgHr: a.avgHr != null ? num(a.avgHr) : null,
    maxHr: a.maxHr != null ? num(a.maxHr) : null,
    calories: a.calories != null ? num(a.calories) : null,
    caloriesPerKm: a.caloriesPerKm != null && Number.isFinite(a.caloriesPerKm) ? Number(a.caloriesPerKm) : null,
    relativeEffort: a.relativeEffort != null && Number.isFinite(a.relativeEffort) ? Number(a.relativeEffort) : null,
    splitCount: a.splitAnalysis?.splits?.length || 0,
  };
}

/** The private DTU that records this activity. Null when nothing can be saved. */
export function activityDtuCall(facts: FitnessActivityFacts): ReceiptCall | null {
  const body = activityBody(facts);
  const sentence = activitySentence(facts);
  const machine = activityMachine(facts);
  if (!body || !sentence || !machine) return null;
  const a = facts.activity!;
  const tags = ['fitness', 'activity', String(a.type || 'workout').toLowerCase()];
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: sentence.slice(0, 80),
      tags,
      source: 'fitness-lens:activity-report',
      human: { summary: body },
      core: { definitions: [sentence], claims: [body.slice(0, 240)] },
      machine,
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'fitness',
      },
    },
  };
}

export { dtuRecordId, dtuReadBackCall, dtuReadBackMatches };

/**
 * The Thread draft carrying that activity report. Thread stores a draft — it
 * does not publish. Null when there is no real DTU id to cite.
 */
export function activityThreadDraftCall(
  facts: FitnessActivityFacts,
  dtuId: string,
  platform = 'x',
): ReceiptCall | null {
  const id = String(dtuId || '').trim();
  const sentence = activitySentence(facts);
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !sentence) return null;
  const a = facts.activity!;
  const name = str(a.name, 50) || str(a.type, 40) || 'activity';
  return {
    domain: 'thread',
    action: 'thread-draft',
    input: {
      title: `Fitness activity — ${name}`.slice(0, 120),
      content: activityBody(facts),
      platform,
      citedDtuId: id,
    },
  };
}

export interface ActivityDraftResult {
  draftId: string;
  status: string;
  citedDtuId: string;
}

/** What the screen may claim about a Thread draft. Null when it did not land. */
export function activityThreadDraftOutcome(
  data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined,
  dtuId: string,
): ActivityDraftResult | null {
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
export function indexActivityDrafts(details: unknown): Record<string, string> {
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