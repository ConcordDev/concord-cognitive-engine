import { describe, it, expect } from 'vitest';
import {
  projectSentence,
  projectBody,
  projectDtuCall,
  projectThreadDraftCall,
  projectThreadDraftOutcome,
  indexProjectDrafts,
  type StudioProjectFacts,
} from '@/components/studio/studioProjectReport';

const facts: StudioProjectFacts = {
  project: {
    id: 'proj_1',
    name: 'Proof Track',
    bpm: 128,
    timeSignature: '4/4',
    masterVolume: 0.8,
    tracks: [
      { id: 'trk_1', name: 'Lead', kind: 'synth', volume: 0.8, muted: false },
    ],
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
  },
};

describe('studio project report', () => {
  it('states only the figures the backend reported', () => {
    const s = projectSentence(facts)!;
    expect(s).toContain('Proof Track');
    expect(s).toContain('128 bpm');
    expect(s).toContain('4/4');
    expect(s).toContain('1 track');
  });

  it('refuses to summarise a project with no id, name, or bpm', () => {
    expect(projectSentence({ project: null })).toBeNull();
    expect(projectSentence({ project: { id: '', name: 'x', bpm: 120 } })).toBeNull();
    expect(projectSentence({ project: { id: 'p', name: '', bpm: 120 } })).toBeNull();
    expect(projectSentence({ project: { id: 'p', name: 'x', bpm: 0 } })).toBeNull();
    expect(projectBody({ project: null })).toBe('');
    expect(projectDtuCall({ project: null })).toBeNull();
  });

  it('builds a private DTU call that cites the real project', () => {
    const call = projectDtuCall(facts)!;
    expect(call.domain).toBe('dtu');
    expect(call.action).toBe('create');
    expect(call.input.source).toBe('studio-lens:project-report');
    expect(call.input.meta.visibility).toBe('private');
    expect((call.input.machine as Record<string, unknown>).kind).toBe('studio_lens_project_report');
    expect((call.input.machine as Record<string, unknown>).projectId).toBe('proj_1');
  });

  it('builds a Thread draft call that cites the DTU id', () => {
    const call = projectThreadDraftCall(facts, 'dtu_abc')!;
    expect(call.domain).toBe('thread');
    expect(call.action).toBe('thread-draft');
    expect(call.input.citedDtuId).toBe('dtu_abc');
  });

  it('refuses a Thread draft call with no DTU id', () => {
    expect(projectThreadDraftCall(facts, '')).toBeNull();
    expect(projectThreadDraftCall({ project: null }, 'dtu_abc')).toBeNull();
  });

  it('accepts a real draft outcome that cites the right DTU and stays draft', () => {
    const outcome = projectThreadDraftOutcome(
      { ok: true, result: { draft: { id: 'drf_1', status: 'draft', citedDtuId: 'dtu_abc' } } },
      'dtu_abc',
    )!;
    expect(outcome.draftId).toBe('drf_1');
    expect(outcome.status).toBe('draft');
    expect(outcome.citedDtuId).toBe('dtu_abc');
  });

  it('rejects a draft outcome that does not cite the same DTU or is not draft', () => {
    expect(projectThreadDraftOutcome({ ok: true, result: { draft: { id: 'drf_1', status: 'draft', citedDtuId: 'other' } } }, 'dtu_abc')).toBeNull();
    expect(projectThreadDraftOutcome({ ok: true, result: { draft: { id: 'drf_1', status: 'posted', citedDtuId: 'dtu_abc' } } }, 'dtu_abc')).toBeNull();
    expect(projectThreadDraftOutcome({ ok: false }, 'dtu_abc')).toBeNull();
  });

  it('indexes drafts by the DTU they cite', () => {
    const idx = indexProjectDrafts([
      { ok: true, result: { draft: { id: 'drf_1', status: 'draft', citedDtuId: 'dtu_a' } } },
      { ok: true, result: { draft: { id: 'drf_2', status: 'draft', citedDtuId: 'dtu_b' } } },
    ]);
    expect(idx.dtu_a).toBe('drf_1');
    expect(idx.dtu_b).toBe('drf_2');
  });
});