import { describe, it, expect, beforeEach } from 'vitest';
import { TutorialManager } from '@/lib/concordia/onboarding/tutorial';

describe('TutorialManager', () => {
  let mgr: TutorialManager;

  beforeEach(() => {
    // Fresh instance each test — bypasses localStorage
    mgr = new TutorialManager();
  });

  it('starts at movement-basic step', () => {
    expect(mgr.state.step).toBe('movement-basic');
  });

  it('advances on correct player action', () => {
    mgr.advance('moved-significant-distance');
    expect(mgr.state.step).toBe('camera-control');
  });

  it('does not advance on wrong action', () => {
    mgr.advance('rotated-camera');  // wrong action for current step
    expect(mgr.state.step).toBe('movement-basic');
  });

  it('records completed steps', () => {
    mgr.advance('moved-significant-distance');
    expect(mgr.state.stepsCompleted).toContain('movement-basic');
  });

  it('skip marks tutorial as done', () => {
    mgr.skip();
    expect(mgr.isDone).toBe(true);
  });

  it('advancing after skip is a no-op', () => {
    mgr.skip();
    mgr.advance('moved-significant-distance');
    expect(mgr.state.step).toBe('movement-basic');
  });

  it('fires hint callback on start', () => {
    const hints: unknown[] = [];
    mgr.onHint(h => hints.push(h));
    mgr.start();
    expect(hints).toHaveLength(1);
    expect(hints[0]).not.toBeNull();
  });

  it('fires null hint callback on skip', () => {
    const hints: unknown[] = [];
    mgr.onHint(h => hints.push(h));
    mgr.skip();
    expect(hints[hints.length - 1]).toBeNull();
  });

  it('progresses through all steps', () => {
    // World Lens Phase 1b (tutorial consolidation) merged OnboardingTutorial's
    // unique steps (gather-materials/craft-item/command-palette/
    // npc-context-menu/workbench-interact/game-mode-launch) into this same
    // step machine — this sequence now covers the full merged order, matching
    // tests/lib/tutorial-merge.test.ts's MERGED_ACTION_SEQUENCE (the
    // authoritative source for the merged step content).
    const actions = [
      'moved-significant-distance',
      'rotated-camera',
      'sprinted',
      'near-npc',
      'completed-dialogue',
      'gathered',
      'crafted',
      'placed-object',
      'entered-combat',
      'used-hotbar-skill',
      'palette-opened',
      'npc-menu-opened',
      'workbench-interact',
      'entered-lens-portal',
      'mode-started',
      'sent-quick-message',
    ] as const;
    for (const action of actions) {
      mgr.advance(action);
    }
    expect(mgr.state.step).toBe('done');
    expect(mgr.isDone).toBe(true);
  });
});
