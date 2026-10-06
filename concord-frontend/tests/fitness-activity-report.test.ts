import { describe, it, expect } from 'vitest';
import {
  activitySentence,
  activityBody,
  activityDtuCall,
  activityThreadDraftCall,
  activityThreadDraftOutcome,
  indexActivityDrafts,
  type FitnessActivityFacts,
} from '@/components/fitness/fitnessActivityReport';

const facts: FitnessActivityFacts = {
  activity: {
    id: 'act_1',
    type: 'run',
    name: 'Morning Run',
    date: '2026-10-05',
    distanceKm: 5.2,
    durationSec: 1872,
    duration: '31m',
    paceSecPerKm: 360,
    pace: '6:00',
    speedKmh: 10.0,
    elevationGainM: 42,
    avgHr: 152,
    maxHr: 168,
    calories: 385,
    caloriesPerKm: 74,
    relativeEffort: 72,
    splitAnalysis: { splits: [{ km: 1, seconds: 350 }, { km: 2, seconds: 360 }], fastestKm: 1, slowestKm: 2 },
  },
};

describe('fitness activity report', () => {
  it('states only the figures the backend reported', () => {
    const s = activitySentence(facts)!;
    expect(s).toContain('Morning Run');
    expect(s).toContain('2026-10-05');
    expect(s).toContain('5.2 km');
    expect(s).toContain('31m');
    expect(s).toContain('6:00/km');
    expect(s).toContain('385 kcal');
    expect(s).toContain('152 bpm avg');
    expect(s).toContain('RE 72');
  });

  it('refuses to summarise an activity with no id or no distance/duration', () => {
    expect(activitySentence({ activity: null })).toBeNull();
    expect(activitySentence({ activity: { id: 'act_1', type: 'run', name: 'X' } })).toBeNull();
    expect(activitySentence({ activity: { id: 'act_1', type: 'run', name: 'X', distanceKm: 0, durationSec: 0 } })).toBeNull();
    expect(activityBody({ activity: null })).toBe('');
    expect(activityDtuCall({ activity: null })).toBeNull();
  });

  it('builds a private DTU call with fitness/activity tags and fitness-lens source', () => {
    const call = activityDtuCall(facts)!;
    expect(call.domain).toBe('dtu');
    expect(call.action).toBe('create');
    const input = call.input as Record<string, unknown>;
    expect(input.source).toBe('fitness-lens:activity-report');
    const meta = input.meta as Record<string, unknown>;
    expect(meta.visibility).toBe('private');
    const tags = input.tags as string[];
    expect(tags).toContain('fitness');
    expect(tags).toContain('activity');
    expect(tags).toContain('run');
    const machine = input.machine as Record<string, unknown>;
    expect(machine.kind).toBe('fitness_activity_report');
    expect(machine.distanceKm).toBe(5.2);
    expect(machine.splitCount).toBe(2);
  });

  it('builds a Thread draft call that cites a real DTU id', () => {
    const call = activityThreadDraftCall(facts, 'dtu_f1', 'x')!;
    expect(call.domain).toBe('thread');
    expect(call.action).toBe('thread-draft');
    const input = call.input as Record<string, unknown>;
    expect(input.citedDtuId).toBe('dtu_f1');
    expect(String(input.title)).toContain('Morning Run');
    expect(String(input.content)).toContain('Morning Run');
  });

  it('refuses to draft without a real DTU id', () => {
    expect(activityThreadDraftCall(facts, '', 'x')).toBeNull();
    expect(activityThreadDraftCall(facts, 'has space', 'x')).toBeNull();
    expect(activityThreadDraftCall({ activity: null }, 'dtu_f1', 'x')).toBeNull();
  });

  it('accepts a Thread draft that is draft status citing the exact DTU', () => {
    const outcome = activityThreadDraftOutcome(
      { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_f1' } } },
      'dtu_f1',
    );
    expect(outcome).toEqual({ draftId: 'th_1', status: 'draft', citedDtuId: 'dtu_f1' });
  });

  it('rejects a Thread draft that does not cite the exact DTU', () => {
    expect(activityThreadDraftOutcome(
      { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_other' } } },
      'dtu_f1',
    )).toBeNull();
  });

  it('rejects a Thread draft that is not draft status', () => {
    expect(activityThreadDraftOutcome(
      { ok: true, result: { draft: { id: 'th_1', status: 'posted', citedDtuId: 'dtu_f1' } } },
      'dtu_f1',
    )).toBeNull();
  });

  it('indexes drafts by cited DTU id', () => {
    const idx = indexActivityDrafts([
      { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_f1' } } },
      { ok: true, result: { draft: { id: 'th_2', status: 'draft', citedDtuId: 'dtu_f2' } } },
      { ok: false },
      null,
    ]);
    expect(idx).toEqual({ dtu_f1: 'th_1', dtu_f2: 'th_2' });
  });

  it('includes split analysis in the body when present', () => {
    const body = activityBody(facts);
    expect(body).toContain('Splits: 2 (fastest km 1, slowest km 2)');
  });
});