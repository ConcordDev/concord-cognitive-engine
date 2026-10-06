import { describe, it, expect } from 'vitest';
import {
  patientSentence,
  patientBody,
  patientDtuCall,
  patientThreadDraftCall,
  patientThreadDraftOutcome,
  indexPatientDrafts,
  type HealthcareChartFacts,
} from '@/components/healthcare/healthcarePatientReport';

const facts: HealthcareChartFacts = {
  patient: {
    id: 'pat_1',
    mrn: 'MRN-000001',
    firstName: 'Jane',
    lastName: 'Doe',
    dob: '1980-05-15',
    sex: 'F',
    phone: '555-1234',
    email: 'jane@example.com',
    insurancePlan: 'Blue Cross',
    insuranceMemberId: 'BC123456',
  },
  problems: [{ id: 'pr1' }, { id: 'pr2' }],
  allergies: [{ id: 'al1' }],
  vitals: [{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }],
  labs: [{ id: 'l1' }, { id: 'l2' }],
  immunizations: [{ id: 'im1' }],
  encounters: [{ id: 'en1' }, { id: 'en2' }],
};

describe('healthcare patient summary report', () => {
  it('states only the figures the backend reported', () => {
    const s = patientSentence(facts)!;
    expect(s).toContain('Doe, Jane');
    expect(s).toContain('MRN-000001');
    expect(s).toContain('DOB 1980-05-15');
    expect(s).toContain('F');
    expect(s).toContain('Blue Cross');
    expect(s).toContain('2 problems');
    expect(s).toContain('1 allergy');
    expect(s).toContain('3 vitals');
    expect(s).toContain('2 labs');
    expect(s).toContain('1 immun');
    expect(s).toContain('2 encounters');
  });

  it('refuses to summarise a patient with no id or no name', () => {
    expect(patientSentence({ patient: null })).toBeNull();
    expect(patientSentence({ patient: { id: 'pat_1', firstName: '', lastName: 'X' } })).toBeNull();
    expect(patientSentence({ patient: { id: '', firstName: 'A', lastName: 'B' } })).toBeNull();
    expect(patientBody({ patient: null })).toBe('');
    expect(patientDtuCall({ patient: null })).toBeNull();
  });

  it('builds a private DTU call with healthcare/patient/chart tags and healthcare-lens source', () => {
    const call = patientDtuCall(facts)!;
    expect(call.domain).toBe('dtu');
    expect(call.action).toBe('create');
    const input = call.input as Record<string, unknown>;
    expect(input.source).toBe('healthcare-lens:patient-summary');
    const meta = input.meta as Record<string, unknown>;
    expect(meta.visibility).toBe('private');
    const tags = input.tags as string[];
    expect(tags).toContain('healthcare');
    expect(tags).toContain('patient');
    expect(tags).toContain('chart');
    const machine = input.machine as Record<string, unknown>;
    expect(machine.kind).toBe('healthcare_patient_summary');
    expect(machine.patientId).toBe('pat_1');
    expect(machine.mrn).toBe('MRN-000001');
    expect(machine.problemCount).toBe(2);
    expect(machine.allergyCount).toBe(1);
    expect(machine.vitalCount).toBe(3);
    expect(machine.encounterCount).toBe(2);
  });

  it('builds a Thread draft call that cites a real DTU id', () => {
    const call = patientThreadDraftCall(facts, 'dtu_h1', 'x')!;
    expect(call.domain).toBe('thread');
    expect(call.action).toBe('thread-draft');
    const input = call.input as Record<string, unknown>;
    expect(input.citedDtuId).toBe('dtu_h1');
    expect(String(input.title)).toContain('Doe, Jane');
    expect(String(input.content)).toContain('Doe, Jane');
  });

  it('refuses to draft without a real DTU id', () => {
    expect(patientThreadDraftCall(facts, '', 'x')).toBeNull();
    expect(patientThreadDraftCall(facts, 'has space', 'x')).toBeNull();
    expect(patientThreadDraftCall({ patient: null }, 'dtu_h1', 'x')).toBeNull();
  });

  it('accepts a Thread draft that is draft status citing the exact DTU', () => {
    const outcome = patientThreadDraftOutcome(
      { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_h1' } } },
      'dtu_h1',
    );
    expect(outcome).toEqual({ draftId: 'th_1', status: 'draft', citedDtuId: 'dtu_h1' });
  });

  it('rejects a Thread draft that does not cite the exact DTU', () => {
    expect(patientThreadDraftOutcome(
      { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_other' } } },
      'dtu_h1',
    )).toBeNull();
  });

  it('rejects a Thread draft that is not draft status', () => {
    expect(patientThreadDraftOutcome(
      { ok: true, result: { draft: { id: 'th_1', status: 'posted', citedDtuId: 'dtu_h1' } } },
      'dtu_h1',
    )).toBeNull();
  });

  it('indexes drafts by cited DTU id', () => {
    const idx = indexPatientDrafts([
      { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_h1' } } },
      { ok: true, result: { draft: { id: 'th_2', status: 'draft', citedDtuId: 'dtu_h2' } } },
      { ok: false },
      null,
    ]);
    expect(idx).toEqual({ dtu_h1: 'th_1', dtu_h2: 'th_2' });
  });

  it('includes chart counts in the body', () => {
    const body = patientBody(facts);
    expect(body).toContain('Problems: 2');
    expect(body).toContain('Allergies: 1');
    expect(body).toContain('Vitals: 3');
    expect(body).toContain('Labs: 2');
    expect(body).toContain('Immunizations: 1');
    expect(body).toContain('Encounters: 2');
  });
});