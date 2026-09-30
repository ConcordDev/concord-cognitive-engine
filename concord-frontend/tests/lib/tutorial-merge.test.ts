import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Phase 1b tutorial consolidation: OnboardingTutorial's 9-step content
 * (gather/craft/palette/npc-menu/workbench/mode-launch) merged into
 * tutorialManager as real tiny-hint steps instead of a separate fullscreen
 * modal running a parallel state machine off the same events. Every new
 * PlayerAction value here is a string a real, already-existing call site
 * dispatches (verified by grep against the frontend before adding these),
 * except 'palette-opened', which was newly wired at its dispatch site
 * (components/world/concordia-hud/CommandPalette.tsx) as part of this
 * same change — OnboardingTutorial's equivalent step expected that exact
 * token too, but nothing ever dispatched it.
 *
 * tutorialManager is a module-level singleton backed by localStorage, so
 * each test resets modules + clears storage to get a genuinely fresh
 * instance rather than fighting shared state across tests.
 */

const MERGED_ACTION_SEQUENCE = [
  'moved-significant-distance', 'rotated-camera', 'sprinted', 'near-npc',
  'completed-dialogue', 'gathered', 'crafted', 'placed-object',
  'entered-combat', 'used-hotbar-skill', 'palette-opened', 'npc-menu-opened',
  'workbench-interact', 'entered-lens-portal', 'mode-started', 'sent-quick-message',
] as const;

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe('tutorialManager — merged step content', () => {
  it('walks through the entire merged step order, firing a hint for every real action token', async () => {
    const { tutorialManager } = await import('@/lib/concordia/onboarding/tutorial');
    const hints: (string | null)[] = [];
    tutorialManager.onHint((h) => hints.push(h?.message ?? null));
    tutorialManager.start(); // fires the first step's hint
    for (const action of MERGED_ACTION_SEQUENCE) {
      tutorialManager.advance(action);
    }
    expect(tutorialManager.isDone).toBe(true);
    // One hint per start() + one per successful advance() = sequence length + 1.
    expect(hints.length).toBe(MERGED_ACTION_SEQUENCE.length + 1);
    // The final advance reaches 'done', whose hint is null.
    expect(hints[hints.length - 1]).toBeNull();
  });

  it('an action that does not match the current required step is a no-op', async () => {
    const { tutorialManager } = await import('@/lib/concordia/onboarding/tutorial');
    const before = tutorialManager.state.step;
    tutorialManager.advance('crafted'); // movement-basic requires moved-significant-distance
    expect(tutorialManager.state.step).toBe(before);
  });

  it('gather-materials and craft-item are genuinely distinct steps from first-creation (not a rename)', async () => {
    const { tutorialManager } = await import('@/lib/concordia/onboarding/tutorial');
    tutorialManager.advance('moved-significant-distance');
    tutorialManager.advance('rotated-camera');
    tutorialManager.advance('sprinted');
    tutorialManager.advance('near-npc');
    tutorialManager.advance('completed-dialogue');
    expect(tutorialManager.state.step).toBe('gather-materials');
    tutorialManager.advance('gathered');
    expect(tutorialManager.state.step).toBe('craft-item');
    tutorialManager.advance('crafted');
    expect(tutorialManager.state.step).toBe('first-creation');
  });

  it('exposes real topic labels for every merged step (HelpMenu replay list)', async () => {
    const { TUTORIAL_TOPICS } = await import('@/lib/concordia/onboarding/tutorial');
    expect(TUTORIAL_TOPICS['gather-materials']).toBe('Gathering Materials');
    expect(TUTORIAL_TOPICS['craft-item']).toBe('Crafting');
    expect(TUTORIAL_TOPICS['command-palette']).toBe('Command Palette');
    expect(TUTORIAL_TOPICS['npc-context-menu']).toBe('NPC Menu');
    expect(TUTORIAL_TOPICS['workbench-interact']).toBe('Workbenches');
    expect(TUTORIAL_TOPICS['game-mode-launch']).toBe('Game Modes');
  });

  it('writes the legacy world_lens_visited key on skip, so PostTutorialHints (unmigrated) still gets its expected signal', async () => {
    const { tutorialManager } = await import('@/lib/concordia/onboarding/tutorial');
    expect(localStorage.getItem('world_lens_visited')).toBeNull();
    tutorialManager.skip(false);
    expect(localStorage.getItem('world_lens_visited')).toBe('1');
  });

  it('writes world_lens_visited once the step machine reaches done via advance(), not just on skip', async () => {
    const { tutorialManager } = await import('@/lib/concordia/onboarding/tutorial');
    expect(localStorage.getItem('world_lens_visited')).toBeNull();
    for (const action of MERGED_ACTION_SEQUENCE) tutorialManager.advance(action);
    expect(tutorialManager.isDone).toBe(true);
    expect(localStorage.getItem('world_lens_visited')).toBe('1');
  });
});

// DET-C batch 4 — closes a real dead-event-listener finding: TutorialHighlight
// (components/world/WorldOsSurface.tsx) has a genuine `concordia:tutorial-highlight`
// listener with zero dispatchers anywhere in the frontend. tutorialManager is
// now the single real dispatcher, keyed off the same step-advance/replay/skip
// transitions that already drive the hint toast — never a fabricated token
// for a step with no real DOM anchor.
describe('tutorialManager — concordia:tutorial-highlight dispatch (dead-listener closure)', () => {
  it('dispatches the real crafting-button token when the craft-item step is shown', async () => {
    const { tutorialManager } = await import('@/lib/concordia/onboarding/tutorial');
    const tokens: (string | null | undefined)[] = [];
    const onHighlight = (e: Event) => tokens.push((e as CustomEvent).detail?.token);
    window.addEventListener('concordia:tutorial-highlight', onHighlight);
    try {
      tutorialManager.advance('moved-significant-distance');
      tutorialManager.advance('rotated-camera');
      tutorialManager.advance('sprinted');
      tutorialManager.advance('near-npc');
      tutorialManager.advance('completed-dialogue');
      tutorialManager.advance('gathered'); // -> craft-item
      expect(tutorialManager.state.step).toBe('craft-item');
      expect(tokens[tokens.length - 1]).toBe('crafting-button');
    } finally {
      window.removeEventListener('concordia:tutorial-highlight', onHighlight);
    }
  });

  it('dispatches token:null for steps with no real DOM anchor — never invents one', async () => {
    const { tutorialManager } = await import('@/lib/concordia/onboarding/tutorial');
    const tokens: (string | null | undefined)[] = [];
    const onHighlight = (e: Event) => tokens.push((e as CustomEvent).detail?.token);
    window.addEventListener('concordia:tutorial-highlight', onHighlight);
    try {
      tutorialManager.start(); // movement-basic — no anchor mapped
      expect(tokens[tokens.length - 1]).toBeNull();
    } finally {
      window.removeEventListener('concordia:tutorial-highlight', onHighlight);
    }
  });

  it('clears the highlight (token:null) on skip', async () => {
    const { tutorialManager } = await import('@/lib/concordia/onboarding/tutorial');
    const tokens: (string | null | undefined)[] = [];
    const onHighlight = (e: Event) => tokens.push((e as CustomEvent).detail?.token);
    window.addEventListener('concordia:tutorial-highlight', onHighlight);
    try {
      tutorialManager.skip(false);
      expect(tokens[tokens.length - 1]).toBeNull();
    } finally {
      window.removeEventListener('concordia:tutorial-highlight', onHighlight);
    }
  });

  it('replaying craft-item from the Help menu re-dispatches its real token', async () => {
    const { tutorialManager } = await import('@/lib/concordia/onboarding/tutorial');
    const tokens: (string | null | undefined)[] = [];
    const onHighlight = (e: Event) => tokens.push((e as CustomEvent).detail?.token);
    window.addEventListener('concordia:tutorial-highlight', onHighlight);
    try {
      tutorialManager.replay('craft-item');
      expect(tokens[tokens.length - 1]).toBe('crafting-button');
    } finally {
      window.removeEventListener('concordia:tutorial-highlight', onHighlight);
    }
  });
});
