import { describe, it, expect } from 'vitest';
import {
  statusSentence,
  statusBody,
  statusReportDtuCall,
  statusThreadDraftCall,
  statusThreadDraftOutcome,
  indexStatusDrafts,
  openRisks,
  openMilestones,
  type StatusFacts,
} from '@/components/projects/projectStatusReport';

const project = { id: 'prj_1', name: 'North Star', key: 'NS', status: 'started', health: 'at_risk' };

const facts: StatusFacts = {
  project,
  dashboard: { totalTasks: 12, done: 7, completionPct: 58, overdue: 2, activeSprints: 1, openMilestones: 2, members: 4 },
  velocity: { series: [{ sprint: 'S1', committed: 10, completed: 8 }], avgVelocity: 8, completedSprints: 1 },
  cycle: { completedTasks: 7, avgCycleDays: 3.4, avgLeadDays: 5.1 },
  forecast: { remainingPoints: 5, avgVelocity: 8, projectedSprints: 1, basis: 1 },
  risks: [{ id: 'r1', name: 'Flaky ingest', severity: 'high', score: 12 }],
  milestones: [{ id: 'm1', name: 'Beta', dueDate: '2026-11-01', status: 'open' }],
};

describe('project status report', () => {
  it('states only the figures the backend reported', () => {
    const s = statusSentence(facts)!;
    expect(s).toContain('North Star (NS)');
    expect(s).toContain('7 of 12 tasks done (58%)');
    expect(s).toContain('2 overdue');
    expect(s).toContain('avg velocity 8 pts');
    expect(s).toContain('avg cycle time 3.4d');
    expect(s).toContain('1 open risk');
    expect(s).toContain('1 open milestone');
    expect(s).toContain('Health at risk');
  });

  it('refuses to summarise a project with no identity', () => {
    expect(statusSentence({ ...facts, project: null })).toBeNull();
    expect(statusSentence({ ...facts, project: { ...project, id: '' } })).toBeNull();
    expect(statusBody({ ...facts, project: null })).toBe('');
    expect(statusReportDtuCall({ ...facts, project: null })).toBeNull();
  });

  it('says so when the backend reported nothing, instead of inventing figures', () => {
    const bare: StatusFacts = { project, dashboard: null, velocity: null, cycle: null, forecast: null, risks: [], milestones: [] };
    expect(statusSentence(bare)).toContain('no reported figures yet');
    expect(statusBody(bare)).not.toContain('pts remaining');
    const call = statusReportDtuCall(bare)!;
    expect(call.input.machine).toMatchObject({ tasks: null, velocity: null, cycleTime: null, forecast: null });
  });

  it('reports an absent velocity basis as absent rather than a forecast', () => {
    const noBasis = { ...facts, forecast: { remainingPoints: 12, avgVelocity: 0, projectedSprints: null, basis: 0 } };
    expect(statusBody(noBasis)).toContain('no completed sprint yet');
    expect(statusBody(noBasis)).not.toMatch(/about \d+ sprint/);
  });

  it('ignores closed risks and finished milestones', () => {
    expect(openRisks([{ id: 'a', name: 'closed one', status: 'closed' }, { id: 'b', name: 'live one' }])).toHaveLength(1);
    expect(openMilestones([{ id: 'a', name: 'shipped', status: 'done' }, { id: 'b', name: 'beta', status: 'open' }])).toHaveLength(1);
    const s = statusSentence({ ...facts, risks: [{ id: 'a', name: 'closed one', status: 'closed' }], milestones: [{ id: 'b', name: 'shipped', status: 'done' }] })!;
    expect(s).not.toContain('open risk');
    expect(s).not.toContain('open milestone');
  });

  it('builds a private status-report DTU carrying the same numbers', () => {
    const call = statusReportDtuCall(facts)!;
    expect(call.domain).toBe('dtu');
    expect(call.action).toBe('create');
    expect(call.input.source).toBe('projects-lens:status-report');
    expect((call.input.meta as Record<string, unknown>).visibility).toBe('private');
    expect(call.input.machine).toMatchObject({
      kind: 'project_status_report',
      projectId: 'prj_1',
      tasks: { total: 12, done: 7, overdue: 2 },
      velocity: { avgVelocity: 8, completedSprints: 1 },
      cycleTime: { avgCycleDays: 3.4, avgLeadDays: 5.1 },
    });
  });

  it('will not draft without a real DTU id to cite', () => {
    expect(statusThreadDraftCall(facts, '')).toBeNull();
    expect(statusThreadDraftCall(facts, 'not an id')).toBeNull();
    const call = statusThreadDraftCall(facts, 'dtu_abc123')!;
    expect(call.domain).toBe('thread');
    expect(call.action).toBe('thread-draft');
    expect(call.input.citedDtuId).toBe('dtu_abc123');
    expect(String(call.input.content)).toContain('Nothing was published');
  });

  it('claims a draft only when Thread kept the exact cite and did not post', () => {
    const ok = { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_abc123' } } };
    expect(statusThreadDraftOutcome(ok, 'dtu_abc123')).toEqual({ draftId: 'th_1', status: 'draft', citedDtuId: 'dtu_abc123' });

    expect(statusThreadDraftOutcome({ ok: false, error: 'cited DTU not found' }, 'dtu_abc123')).toBeNull();
    expect(statusThreadDraftOutcome({ ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_other' } } }, 'dtu_abc123')).toBeNull();
    expect(statusThreadDraftOutcome({ ok: true, result: { draft: { id: 'th_1', status: 'published', citedDtuId: 'dtu_abc123' } } }, 'dtu_abc123')).toBeNull();
    expect(statusThreadDraftOutcome({ ok: true, result: {} }, 'dtu_abc123')).toBeNull();
    expect(statusThreadDraftOutcome(null, 'dtu_abc123')).toBeNull();
  });

  it('indexes drafts by the DTU they cite after a reload', () => {
    const index = indexStatusDrafts([
      { ok: true, result: { draft: { id: 'th_1', citedDtuId: 'dtu_abc123' } } },
      { ok: true, result: { draft: { id: 'th_2', citedDtuId: null } } },
      { ok: true, result: { draft: { id: 'th_3', citedDtuId: 'dtu_zzz' } } },
      { ok: false, error: 'draft not found' },
      null,
    ]);
    expect(index).toEqual({ dtu_abc123: 'th_1', dtu_zzz: 'th_3' });
    expect(indexStatusDrafts([{ draft: { id: 'th_4', citedDtuId: 'dtu_q' } }])).toEqual({ dtu_q: 'th_4' });
    expect(indexStatusDrafts(null)).toEqual({});
  });
});
