import { describe, it, expect } from 'vitest';
import {
  PRODUCTIZATION_PHASES,
  getProductionPhases,
  getCurrentPhase,
  getPhaseByLens,
  areDependenciesMet,
  getTotalArtifactCount,
  getTotalEngineCount,
} from '@/lib/lenses/productization-roadmap';


describe('PRODUCTIZATION_PHASES', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(PRODUCTIZATION_PHASES)).toBe(true);
    expect(PRODUCTIZATION_PHASES.length).toBeGreaterThan(0);
  });

  it('every phase has required fields', () => {
    for (const phase of PRODUCTIZATION_PHASES) {
      expect(typeof phase.order).toBe('number');
      expect(typeof phase.lensId).toBe('string');
      expect(phase.lensId.length).toBeGreaterThan(0);
      expect(typeof phase.name).toBe('string');
      expect(typeof phase.rationale).toBe('string');
      expect(Array.isArray(phase.dependsOn)).toBe(true);
      expect(Array.isArray(phase.artifacts)).toBe(true);
      expect(phase.artifacts.length).toBeGreaterThan(0);
      expect(Array.isArray(phase.engines)).toBe(true);
      expect(phase.engines.length).toBeGreaterThan(0);
      expect(Array.isArray(phase.pipelines)).toBe(true);
      expect(phase.pipelines.length).toBeGreaterThan(0);
      expect(Array.isArray(phase.acceptanceCriteria)).toBe(true);
      expect(phase.acceptanceCriteria.length).toBeGreaterThan(0);
      expect(Array.isArray(phase.incumbents)).toBe(true);
      expect(['blocked', 'ready', 'in_progress', 'completed']).toContain(phase.status);
    }
  });

  it('every artifact has required fields', () => {
    for (const phase of PRODUCTIZATION_PHASES) {
      for (const artifact of phase.artifacts) {
        expect(typeof artifact.name).toBe('string');
        expect(typeof artifact.persistsWithoutDTU).toBe('boolean');
        expect(typeof artifact.storageDomain).toBe('string');
        expect(Array.isArray(artifact.requiredFields)).toBe(true);
        expect(artifact.requiredFields.length).toBeGreaterThan(0);
      }
    }
  });

  it('every engine has required fields', () => {
    for (const phase of PRODUCTIZATION_PHASES) {
      for (const engine of phase.engines) {
        expect(typeof engine.name).toBe('string');
        expect(typeof engine.description).toBe('string');
        expect(['automatic', 'on_demand', 'scheduled']).toContain(engine.trigger);
      }
    }
  });

  it('every pipeline has required fields', () => {
    for (const phase of PRODUCTIZATION_PHASES) {
      for (const pipeline of phase.pipelines) {
        expect(typeof pipeline.name).toBe('string');
        expect(Array.isArray(pipeline.steps)).toBe(true);
        expect(pipeline.steps.length).toBeGreaterThanOrEqual(3);
        expect(Array.isArray(pipeline.engines)).toBe(true);
      }
    }
  });

  it('has unique order numbers', () => {
    const orders = PRODUCTIZATION_PHASES.map(p => p.order);
    const unique = new Set(orders);
    expect(unique.size).toBe(orders.length);
  });

  it('has unique lens IDs', () => {
    const lensIds = PRODUCTIZATION_PHASES.map(p => p.lensId);
    const unique = new Set(lensIds);
    expect(unique.size).toBe(lensIds.length);
  });

  it('phase 1 is paper (Research)', () => {
    const phase1 = PRODUCTIZATION_PHASES.find(p => p.order === 1);
    expect(phase1).toBeDefined();
    expect(phase1!.lensId).toBe('paper');
    expect(phase1!.name).toBe('Research');
  });

  it('phase 1 has no dependencies', () => {
    const phase1 = PRODUCTIZATION_PHASES.find(p => p.order === 1);
    expect(phase1!.dependsOn).toEqual([]);
  });

  it('phase 2 depends on phase 1', () => {
    const phase2 = PRODUCTIZATION_PHASES.find(p => p.order === 2);
    expect(phase2).toBeDefined();
    expect(phase2!.dependsOn).toContain(1);
  });

  it('all artifacts persist without DTU', () => {
    for (const phase of PRODUCTIZATION_PHASES) {
      for (const artifact of phase.artifacts) {
        expect(artifact.persistsWithoutDTU).toBe(true);
      }
    }
  });
});

describe('getProductionPhases', () => {
  it('returns all phases sorted by order', () => {
    const phases = getProductionPhases();
    expect(phases.length).toBe(PRODUCTIZATION_PHASES.length);
    for (let i = 1; i < phases.length; i++) {
      expect(phases[i].order).toBeGreaterThan(phases[i - 1].order);
    }
  });

  it('returns a new array (not mutating original)', () => {
    const phases = getProductionPhases();
    expect(phases).not.toBe(PRODUCTIZATION_PHASES);
  });

  it('first element is order 1', () => {
    const phases = getProductionPhases();
    expect(phases[0].order).toBe(1);
  });
});

describe('getCurrentPhase', () => {
  it('returns the first non-completed phase', () => {
    const current = getCurrentPhase();
    expect(current).toBeDefined();
    expect(current!.status).not.toBe('completed');
  });

  it('returns phase 1 (paper) since its status is ready', () => {
    const current = getCurrentPhase();
    expect(current!.lensId).toBe('paper');
    expect(current!.status).toBe('ready');
  });
});

describe('getPhaseByLens', () => {
  it('returns phase for known lens', () => {
    const phase = getPhaseByLens('paper');
    expect(phase).toBeDefined();
    expect(phase!.lensId).toBe('paper');
    expect(phase!.order).toBe(1);
  });

  it('returns phase for sim', () => {
    const phase = getPhaseByLens('sim');
    expect(phase).toBeDefined();
    expect(phase!.lensId).toBe('sim');
    expect(phase!.name).toBe('Simulation');
  });

  it('returns undefined for lens without a phase', () => {
    expect(getPhaseByLens('nonexistent')).toBeUndefined();
  });

  it('returns the chat phase (Phase 28)', () => {
    const phase = getPhaseByLens('chat');
    expect(phase).toBeDefined();
    expect(phase!.lensId).toBe('chat');
    expect(phase!.name).toBe('Chat');
  });
});

describe('areDependenciesMet', () => {
  it('returns true for phase 1 (no dependencies)', () => {
    const phase1 = PRODUCTIZATION_PHASES.find(p => p.order === 1)!;
    expect(areDependenciesMet(phase1)).toBe(true);
  });

  it('returns false for phase 2 (depends on phase 1 which is not completed)', () => {
    const phase2 = PRODUCTIZATION_PHASES.find(p => p.order === 2)!;
    // Phase 1 status is 'ready', not 'completed'
    expect(areDependenciesMet(phase2)).toBe(false);
  });

  it('returns false for phase 3 (depends on 1 and 2)', () => {
    const phase3 = PRODUCTIZATION_PHASES.find(p => p.order === 3)!;
    expect(areDependenciesMet(phase3)).toBe(false);
  });

  it('returns true for a phase with empty dependsOn', () => {
    // Create a mock phase with no deps
    const mockPhase = { ...PRODUCTIZATION_PHASES[0], dependsOn: [] };
    expect(areDependenciesMet(mockPhase)).toBe(true);
  });
});

describe('getTotalArtifactCount', () => {
  it('returns a positive number', () => {
    const count = getTotalArtifactCount();
    expect(count).toBeGreaterThan(0);
  });

  it('equals the sum of all phase artifact counts', () => {
    const expected = PRODUCTIZATION_PHASES.reduce((sum, p) => sum + p.artifacts.length, 0);
    expect(getTotalArtifactCount()).toBe(expected);
  });
});

describe('getTotalEngineCount', () => {
  it('returns a positive number', () => {
    const count = getTotalEngineCount();
    expect(count).toBeGreaterThan(0);
  });

  it('equals the sum of all phase engine counts', () => {
    const expected = PRODUCTIZATION_PHASES.reduce((sum, p) => sum + p.engines.length, 0);
    expect(getTotalEngineCount()).toBe(expected);
  });
});
