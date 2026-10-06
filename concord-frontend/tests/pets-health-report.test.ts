import { describe, it, expect } from 'vitest';
import {
  healthSentence,
  healthBody,
  healthRecordDtuCall,
  healthThreadDraftCall,
  healthThreadDraftOutcome,
  indexHealthDrafts,
  type PetsHealthFacts,
} from '@/components/pets/petsHealthReport';

const facts: PetsHealthFacts = {
  petName: 'Mochi',
  species: 'dog',
  record: {
    spec: 'concord-pet-health-record/v1',
    generatedAt: '2026-10-05T00:00:00Z',
    pet: {
      name: 'Mochi',
      species: 'dog',
      breed: 'Shiba Inu',
      sex: 'female',
      birthdate: '2022-04-01',
      ageYears: 4,
      ageMonths: 6,
      weightKg: 9.5,
      microchipId: 'CHIP-123',
      neutered: true,
    },
    vaccines: [{ name: 'Rabies', date: '2026-05-01', nextDueDate: '2027-05-01', vet: 'Dr. Lin', status: 'scheduled' }],
    medications: [{ name: 'Apoquel', dosage: '16mg', frequency: 'daily', startDate: '2026-06-01', endDate: null, active: true }],
    vetVisits: [{ date: '2026-05-01', reason: 'checkup', diagnosis: null, vet: 'Dr. Lin', cost: 80 }],
    weights: [{ date: '2026-09-01', weightKg: 9.4 }],
    symptoms: [],
    summary: {
      vaccineCount: 1,
      overdueVaccines: 0,
      activeMedications: 1,
      vetVisitCount: 1,
      latestWeightKg: 9.4,
    },
  },
  text: 'PET HEALTH RECORD — Mochi\nGenerated 2026-10-05T00:00:00Z\n\nSpecies: dog  Breed: Shiba Inu  Sex: female',
};

describe('pets health record report', () => {
  it('states only the figures the backend reported', () => {
    const s = healthSentence(facts)!;
    expect(s).toContain('Mochi');
    expect(s).toContain('Shiba Inu');
    expect(s).toContain('1 vaccine');
    expect(s).toContain('1 active medication');
    expect(s).toContain('1 vet visit');
    expect(s).toContain('latest weight 9.4 kg');
  });

  it('flags overdue vaccines in the sentence', () => {
    const overdueFacts: PetsHealthFacts = {
      petName: 'Mochi',
      species: 'dog',
      record: {
        ...facts.record!,
        summary: { vaccineCount: 2, overdueVaccines: 1, activeMedications: 0, vetVisitCount: 0, latestWeightKg: null },
      },
      text: 'PET HEALTH RECORD — Mochi',
    };
    const s = healthSentence(overdueFacts)!;
    expect(s).toContain('2 vaccines (1 overdue)');
  });

  it('refuses to summarise a record with no pet name or no summary', () => {
    expect(healthSentence({ petName: '', species: 'dog', record: null, text: '' })).toBeNull();
    expect(healthSentence({ petName: 'Mochi', species: 'dog', record: { pet: { name: 'Mochi' } }, text: 'x' })).toBeNull();
    expect(healthBody({ petName: '', species: 'dog', record: null, text: '' })).toBe('');
    expect(healthRecordDtuCall({ petName: '', species: 'dog', record: null, text: '' })).toBeNull();
  });

  it('builds a private DTU call with pet/breed tags and pets-lens source', () => {
    const call = healthRecordDtuCall(facts)!;
    expect(call.domain).toBe('dtu');
    expect(call.action).toBe('create');
    const input = call.input as Record<string, unknown>;
    expect(input.source).toBe('pets-lens:health-record');
    const meta = input.meta as Record<string, unknown>;
    expect(meta.visibility).toBe('private');
    const tags = input.tags as string[];
    expect(tags).toContain('pets');
    expect(tags).toContain('health-record');
    expect(tags).toContain('dog');
    expect(tags).toContain('shiba inu');
    const machine = input.machine as Record<string, unknown>;
    expect(machine.kind).toBe('pet_health_record');
    expect(machine.vaccineCount).toBe(1);
  });

  it('builds a Thread draft call that cites a real DTU id', () => {
    const call = healthThreadDraftCall(facts, 'dtu_p1', 'x')!;
    expect(call.domain).toBe('thread');
    expect(call.action).toBe('thread-draft');
    const input = call.input as Record<string, unknown>;
    expect(input.citedDtuId).toBe('dtu_p1');
    expect(String(input.title)).toContain('Mochi');
    expect(String(input.content)).toContain('Mochi');
  });

  it('refuses to draft without a real DTU id', () => {
    expect(healthThreadDraftCall(facts, '', 'x')).toBeNull();
    expect(healthThreadDraftCall(facts, 'has space', 'x')).toBeNull();
    expect(healthThreadDraftCall({ petName: '', species: 'dog', record: null, text: '' }, 'dtu_p1', 'x')).toBeNull();
  });

  it('accepts a Thread draft that is draft status citing the exact DTU', () => {
    const outcome = healthThreadDraftOutcome(
      { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_p1' } } },
      'dtu_p1',
    );
    expect(outcome).toEqual({ draftId: 'th_1', status: 'draft', citedDtuId: 'dtu_p1' });
  });

  it('rejects a Thread draft that does not cite the exact DTU', () => {
    expect(healthThreadDraftOutcome(
      { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_other' } } },
      'dtu_p1',
    )).toBeNull();
  });

  it('rejects a Thread draft that is not draft status', () => {
    expect(healthThreadDraftOutcome(
      { ok: true, result: { draft: { id: 'th_1', status: 'posted', citedDtuId: 'dtu_p1' } } },
      'dtu_p1',
    )).toBeNull();
  });

  it('indexes drafts by cited DTU id', () => {
    const idx = indexHealthDrafts([
      { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_p1' } } },
      { ok: true, result: { draft: { id: 'th_2', status: 'draft', citedDtuId: 'dtu_p2' } } },
      { ok: false },
      null,
    ]);
    expect(idx).toEqual({ dtu_p1: 'th_1', dtu_p2: 'th_2' });
  });
});