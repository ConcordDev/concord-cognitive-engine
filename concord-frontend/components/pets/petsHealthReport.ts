/**
 * A pet health record report exists because the Pets domain's
 * `health-record-export` macro returned the real record — vaccines,
 * medications, vet visits, weights, and symptoms for one pet, plus a
 * summary with counts. This module turns exactly that result into a
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

export interface PetRecordSummary {
  vaccineCount?: number;
  overdueVaccines?: number;
  activeMedications?: number;
  vetVisitCount?: number;
  latestWeightKg?: number | null;
}

export interface PetRecordPet {
  name?: string;
  species?: string;
  breed?: string | null;
  sex?: string;
  birthdate?: string | null;
  ageYears?: number | null;
  ageMonths?: number | null;
  weightKg?: number | null;
  microchipId?: string | null;
  neutered?: boolean;
}

export interface PetHealthRecord {
  spec?: string;
  generatedAt?: string;
  pet?: PetRecordPet;
  vaccines?: unknown[];
  medications?: unknown[];
  vetVisits?: unknown[];
  weights?: unknown[];
  symptoms?: unknown[];
  summary?: PetRecordSummary;
}

export interface PetsHealthFacts {
  petName: string;
  species: string;
  record: PetHealthRecord | null;
  text: string;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown, max = 120): string {
  return String(v == null ? '' : v).trim().slice(0, max);
}

/**
 * The health record sentence, built only from the real record's pet +
 * summary. Null when there is no record, no pet name, or no summary counts.
 */
export function healthSentence(facts: PetsHealthFacts): string | null {
  const r = facts.record;
  const name = str(facts.petName, 80) || str(r?.pet?.name, 80);
  if (!r || !name) return null;
  const sum = r.summary;
  if (!sum || sum.vaccineCount == null) return null;
  const vaccineCount = num(sum.vaccineCount);
  const overdue = num(sum.overdueVaccines);
  const activeMeds = num(sum.activeMedications);
  const vetVisits = num(sum.vetVisitCount);
  const latestWeight = sum.latestWeightKg == null ? null : Number(sum.latestWeightKg);
  const breed = str(r.pet?.breed, 80);
  const species = str(facts.species, 40) || str(r.pet?.species, 40);
  const parts: string[] = [name];
  if (breed) parts.push(breed);
  if (species) parts.push(species);
  const head = parts.join(' · ');
  const tail: string[] = [];
  tail.push(`${vaccineCount} vaccine${vaccineCount === 1 ? '' : 's'}${overdue > 0 ? ` (${overdue} overdue)` : ''}`);
  if (activeMeds > 0) tail.push(`${activeMeds} active medication${activeMeds === 1 ? '' : 's'}`);
  if (vetVisits > 0) tail.push(`${vetVisits} vet visit${vetVisits === 1 ? '' : 's'}`);
  if (latestWeight != null && Number.isFinite(latestWeight)) tail.push(`latest weight ${latestWeight} kg`);
  return `${head}: ${tail.join(', ')}.`;
}

/** The full body saved as the DTU. Empty when there is nothing honest to save. */
export function healthBody(facts: PetsHealthFacts): string {
  const sentence = healthSentence(facts);
  const text = str(facts.text, 8000);
  if (!sentence || !text) return '';
  const lines = [sentence, '', text];
  lines.push('Every figure here came from the Pets domain health-record-export macro in Concord. Nothing was published by saving this.');
  return lines.join('\n');
}

/** The machine payload — the same record the macro returned, structured. */
export function healthMachine(facts: PetsHealthFacts): Record<string, unknown> | null {
  if (!healthSentence(facts)) return null;
  const r = facts.record!;
  return {
    kind: 'pet_health_record',
    spec: r.spec || 'concord-pet-health-record/v1',
    generatedAt: r.generatedAt || null,
    pet: r.pet || null,
    summary: r.summary || null,
    vaccineCount: num(r.summary?.vaccineCount),
    overdueVaccines: num(r.summary?.overdueVaccines),
    activeMedications: num(r.summary?.activeMedications),
    vetVisitCount: num(r.summary?.vetVisitCount),
    latestWeightKg: r.summary?.latestWeightKg == null ? null : Number(r.summary.latestWeightKg),
  };
}

/** The private DTU that records this health record. Null when nothing can be saved. */
export function healthRecordDtuCall(facts: PetsHealthFacts): ReceiptCall | null {
  const body = healthBody(facts);
  const sentence = healthSentence(facts);
  const machine = healthMachine(facts);
  if (!body || !sentence || !machine) return null;
  const tags = ['pets', 'health-record', String(facts.species || 'pet').toLowerCase()];
  if (facts.record?.pet?.breed) tags.push(String(facts.record.pet.breed).toLowerCase());
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: sentence.slice(0, 80),
      tags,
      source: 'pets-lens:health-record',
      human: { summary: body },
      core: { definitions: [sentence], claims: [body.slice(0, 240)] },
      machine,
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'pets',
      },
    },
  };
}

export { dtuRecordId, dtuReadBackCall, dtuReadBackMatches };

/**
 * The Thread draft carrying that health record. Thread stores a draft — it
 * does not publish. Null when there is no real DTU id to cite.
 */
export function healthThreadDraftCall(
  facts: PetsHealthFacts,
  dtuId: string,
  platform = 'x',
): ReceiptCall | null {
  const id = String(dtuId || '').trim();
  const sentence = healthSentence(facts);
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !sentence) return null;
  const name = str(facts.petName, 60) || 'pet';
  return {
    domain: 'thread',
    action: 'thread-draft',
    input: {
      title: `Pet health record — ${name}`.slice(0, 120),
      content: healthBody(facts),
      platform,
      citedDtuId: id,
    },
  };
}

export interface HealthDraftResult {
  draftId: string;
  status: string;
  citedDtuId: string;
}

/** What the screen may claim about a Thread draft. Null when it did not land. */
export function healthThreadDraftOutcome(
  data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined,
  dtuId: string,
): HealthDraftResult | null {
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
export function indexHealthDrafts(details: unknown): Record<string, string> {
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