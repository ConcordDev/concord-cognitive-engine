import { describe, it, expect } from 'vitest';
import {
  sceneSentence,
  sceneBody,
  sceneReportDtuCall,
  sceneThreadDraftCall,
  sceneThreadDraftOutcome,
  indexSceneDrafts,
  type PhysicsFacts,
} from '@/components/physics/physicsSceneReport';

const facts: PhysicsFacts = {
  scene: {
    id: 'scene_001',
    name: 'Pendulum Lab',
    bodies: [
      { id: 'b1', mass: 1.0, kind: 'circle' },
      { id: 'b2', mass: 2.0, kind: 'box' },
    ],
    constraints: [{ id: 'c1', kind: 'rod' }],
    fluids: [],
    createdAt: '2026-10-05T00:00:00Z',
    updatedAt: '2026-10-05T01:00:00Z',
  },
  summary: {
    id: 'scene_001',
    name: 'Pendulum Lab',
    bodyCount: 2,
    constraintCount: 1,
    fluidCount: 0,
    shareCode: 'phx_abc',
  },
};

describe('physics scene report', () => {
  it('states only the figures the backend reported', () => {
    const s = sceneSentence(facts)!;
    expect(s).toContain('Pendulum Lab');
    expect(s).toContain('2 bodies');
    expect(s).toContain('1 constraints');
    expect(s).toContain('shared');
  });

  it('refuses to summarise a scene with no identity', () => {
    expect(sceneSentence({ scene: null, summary: null })).toBeNull();
    expect(sceneSentence({ scene: { id: '', name: '' }, summary: null })).toBeNull();
    expect(sceneBody({ scene: null, summary: null })).toBe('');
    expect(sceneReportDtuCall({ scene: null, summary: null })).toBeNull();
  });

  it('says so when the scene is empty, instead of inventing figures', () => {
    const bare: PhysicsFacts = {
      scene: { id: 'scene_2', name: 'Empty Scene' },
      summary: { id: 'scene_2', name: 'Empty Scene', bodyCount: 0, constraintCount: 0, fluidCount: 0 },
    };
    expect(sceneSentence(bare)).toContain('empty scene');
  });

  it('builds a private scene-report DTU carrying the same numbers', () => {
    const call = sceneReportDtuCall(facts)!;
    expect(call.domain).toBe('dtu');
    expect(call.action).toBe('create');
    expect(call.input.source).toBe('physics-lens:scene-report');
    expect((call.input.meta as Record<string, unknown>).visibility).toBe('private');
    expect(call.input.machine).toMatchObject({
      kind: 'physics_scene_report',
      sceneId: 'scene_001',
      sceneName: 'Pendulum Lab',
      bodyCount: 2,
      constraintCount: 1,
      fluidCount: 0,
      shareCode: 'phx_abc',
    });
  });

  it('will not draft without a real DTU id to cite', () => {
    expect(sceneThreadDraftCall(facts, '')).toBeNull();
    expect(sceneThreadDraftCall(facts, 'not an id')).toBeNull();
    const call = sceneThreadDraftCall(facts, 'dtu_abc123')!;
    expect(call.domain).toBe('thread');
    expect(call.action).toBe('thread-draft');
    expect(call.input.citedDtuId).toBe('dtu_abc123');
    expect(String(call.input.content)).toContain('Nothing was published');
  });

  it('claims a draft only when Thread kept the exact cite and did not post', () => {
    const ok = { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_abc123' } } };
    expect(sceneThreadDraftOutcome(ok, 'dtu_abc123')).toEqual({ draftId: 'th_1', status: 'draft', citedDtuId: 'dtu_abc123' });
    expect(sceneThreadDraftOutcome({ ok: false }, 'dtu_abc123')).toBeNull();
    expect(sceneThreadDraftOutcome({ ok: true, result: { draft: { id: 'th_1', status: 'published', citedDtuId: 'dtu_abc123' } } }, 'dtu_abc123')).toBeNull();
    expect(sceneThreadDraftOutcome(null, 'dtu_abc123')).toBeNull();
  });

  it('indexes drafts by the DTU they cite after a reload', () => {
    const index = indexSceneDrafts([
      { ok: true, result: { draft: { id: 'th_1', citedDtuId: 'dtu_abc123' } } },
      { ok: true, result: { draft: { id: 'th_3', citedDtuId: 'dtu_zzz' } } },
      null,
    ]);
    expect(index).toEqual({ dtu_abc123: 'th_1', dtu_zzz: 'th_3' });
    expect(indexSceneDrafts(null)).toEqual({});
  });

  it('body names the source and says nothing was published', () => {
    const body = sceneBody(facts);
    expect(body).toContain('Every figure here came from the Physics domain');
    expect(body).toContain('Nothing was published by saving this');
    expect(body).toContain('b1 (circle, 1kg)');
  });
});