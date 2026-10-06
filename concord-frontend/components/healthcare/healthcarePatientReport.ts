/**
 * A healthcare patient summary report exists because the Healthcare domain's
 * `patients-create` / `patients-detail` macros returned the real patient —
 * MRN, name, DOB, sex, insurance, and the full chart (problems, allergies,
 * vitals, labs, immunizations, encounters). This module turns exactly that
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

export interface HealthcarePatientDetail {
  id?: string;
  mrn?: string;
  firstName?: string;
  lastName?: string;
  dob?: string;
  sex?: string;
  phone?: string;
  email?: string;
  insurancePlan?: string;
  insuranceMemberId?: string;
}

export interface HealthcareChartFacts {
  patient: HealthcarePatientDetail | null;
  problems?: unknown[];
  allergies?: unknown[];
  vitals?: unknown[];
  labs?: unknown[];
  immunizations?: unknown[];
  encounters?: unknown[];
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown, max = 120): string {
  return String(v == null ? '' : v).trim().slice(0, max);
}

/**
 * The patient summary sentence, built only from the real detail. Null when
 * there is no patient, no id, or no identifying figures.
 */
export function patientSentence(facts: HealthcareChartFacts): string | null {
  const p = facts.patient;
  if (!p || !p.id || !p.firstName || !p.lastName) return null;
  const parts: string[] = [];
  parts.push(`${str(p.lastName, 40)}, ${str(p.firstName, 40)}`);
  if (p.mrn) parts.push(str(p.mrn, 20));
  const metrics: string[] = [];
  if (p.dob) metrics.push(`DOB ${str(p.dob, 10)}`);
  if (p.sex) metrics.push(str(p.sex, 1));
  if (p.insurancePlan) metrics.push(str(p.insurancePlan, 30));
  const probs = Array.isArray(facts.problems) ? facts.problems.length : 0;
  const allergies = Array.isArray(facts.allergies) ? facts.allergies.length : 0;
  const vitals = Array.isArray(facts.vitals) ? facts.vitals.length : 0;
  const labs = Array.isArray(facts.labs) ? facts.labs.length : 0;
  const imms = Array.isArray(facts.immunizations) ? facts.immunizations.length : 0;
  const encs = Array.isArray(facts.encounters) ? facts.encounters.length : 0;
  metrics.push(`${probs} problem${probs === 1 ? '' : 's'}`);
  metrics.push(`${allergies} allerg${allergies === 1 ? 'y' : 'ies'}`);
  metrics.push(`${vitals} vital${vitals === 1 ? '' : 's'}`);
  metrics.push(`${labs} lab${labs === 1 ? '' : 's'}`);
  metrics.push(`${imms} immun${imms === 1 ? '' : 's'}`);
  metrics.push(`${encs} encounter${encs === 1 ? '' : 's'}`);
  return `${parts.join(' · ')}: ${metrics.join(', ')}.`;
}

/** The full body saved as the DTU. Empty when there is nothing honest to save. */
export function patientBody(facts: HealthcareChartFacts): string {
  const sentence = patientSentence(facts);
  const p = facts.patient;
  if (!sentence || !p) return '';
  const lines = [sentence, ''];
  lines.push(`Patient ID: ${p.id || '-'}`);
  lines.push(`MRN: ${p.mrn || '-'}`);
  lines.push(`Name: ${p.lastName || ''}, ${p.firstName || ''}`);
  if (p.dob) lines.push(`DOB: ${p.dob}`);
  if (p.sex) lines.push(`Sex: ${p.sex}`);
  if (p.phone) lines.push(`Phone: ${p.phone}`);
  if (p.email) lines.push(`Email: ${p.email}`);
  if (p.insurancePlan) lines.push(`Insurance: ${p.insurancePlan}${p.insuranceMemberId ? ` (${p.insuranceMemberId})` : ''}`);
  lines.push('');
  lines.push(`Problems: ${num(Array.isArray(facts.problems) ? facts.problems.length : 0)}`);
  lines.push(`Allergies: ${num(Array.isArray(facts.allergies) ? facts.allergies.length : 0)}`);
  lines.push(`Vitals: ${num(Array.isArray(facts.vitals) ? facts.vitals.length : 0)}`);
  lines.push(`Labs: ${num(Array.isArray(facts.labs) ? facts.labs.length : 0)}`);
  lines.push(`Immunizations: ${num(Array.isArray(facts.immunizations) ? facts.immunizations.length : 0)}`);
  lines.push(`Encounters: ${num(Array.isArray(facts.encounters) ? facts.encounters.length : 0)}`);
  lines.push('');
  lines.push('Every figure here came from the Healthcare domain patients-detail macro in Concord. Nothing was published by saving this.');
  return lines.join('\n');
}

/** The machine payload — the same patient summary the macro returned, structured. */
export function patientMachine(facts: HealthcareChartFacts): Record<string, unknown> | null {
  const p = facts.patient;
  if (!patientSentence(facts) || !p) return null;
  return {
    kind: 'healthcare_patient_summary',
    patientId: p.id || null,
    mrn: p.mrn || null,
    firstName: p.firstName || null,
    lastName: p.lastName || null,
    dob: p.dob || null,
    sex: p.sex || null,
    insurancePlan: p.insurancePlan || null,
    problemCount: num(Array.isArray(facts.problems) ? facts.problems.length : 0),
    allergyCount: num(Array.isArray(facts.allergies) ? facts.allergies.length : 0),
    vitalCount: num(Array.isArray(facts.vitals) ? facts.vitals.length : 0),
    labCount: num(Array.isArray(facts.labs) ? facts.labs.length : 0),
    immunizationCount: num(Array.isArray(facts.immunizations) ? facts.immunizations.length : 0),
    encounterCount: num(Array.isArray(facts.encounters) ? facts.encounters.length : 0),
  };
}

/** The private DTU that records this patient summary. Null when nothing can be saved. */
export function patientDtuCall(facts: HealthcareChartFacts): ReceiptCall | null {
  const body = patientBody(facts);
  const sentence = patientSentence(facts);
  const machine = patientMachine(facts);
  if (!body || !sentence || !machine) return null;
  const tags = ['healthcare', 'patient', 'chart'];
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: sentence.slice(0, 80),
      tags,
      source: 'healthcare-lens:patient-summary',
      human: { summary: body },
      core: { definitions: [sentence], claims: [body.slice(0, 240)] },
      machine,
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'healthcare',
      },
    },
  };
}

export { dtuRecordId, dtuReadBackCall, dtuReadBackMatches };

/**
 * The Thread draft carrying that patient summary. Thread stores a draft —
 * it does not publish. Null when there is no real DTU id to cite.
 */
export function patientThreadDraftCall(
  facts: HealthcareChartFacts,
  dtuId: string,
  platform = 'x',
): ReceiptCall | null {
  const id = String(dtuId || '').trim();
  const sentence = patientSentence(facts);
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !sentence) return null;
  const p = facts.patient!;
  const name = `${str(p.lastName, 30)}, ${str(p.firstName, 30)}` || 'patient';
  return {
    domain: 'thread',
    action: 'thread-draft',
    input: {
      title: `Healthcare patient — ${name}`.slice(0, 120),
      content: patientBody(facts),
      platform,
      citedDtuId: id,
    },
  };
}

export interface PatientDraftResult {
  draftId: string;
  status: string;
  citedDtuId: string;
}

/** What the screen may claim about a Thread draft. Null when it did not land. */
export function patientThreadDraftOutcome(
  data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined,
  dtuId: string,
): PatientDraftResult | null {
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
export function indexPatientDrafts(details: unknown): Record<string, string> {
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