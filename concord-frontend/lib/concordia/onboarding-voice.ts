// concord-frontend/lib/concordia/onboarding-voice.ts
//
// Track 3 (onboarding ceremony) — Concordia's voice during the First Cycle.
// The wizard teaches cook → eat → fight → commune; this maps each phase (and
// the First-Win follow-on steps) to a short in-world line the goddess speaks
// when the player reaches it, plus the one-time arrival line when a new player
// first enters the glade. Pure + total so it's unit-testable and the wizard
// just dispatches whatever string this returns.

/** The one-time line Concordia speaks when a brand-new player arrives. */
export const ARRIVAL_LINE =
  'Welcome to the glade, breath-of-mine. Walk with me — I will show you how to live here.';

const PHASE_LINES: Record<string, string> = {
  // First Cycle (mechanic onboarding)
  first_cycle_cook:    'First, warmth and a meal. Find a fire and cook — the world feeds those who tend it.',
  first_cycle_eat:     'Now eat what you made. Strength begins at the hearth.',
  first_cycle_fight:   'Something stirs. Raise your hands and meet it — I will not let you fall.',
  first_cycle_commune: 'Come, commune with me. Tell me what you have become.',
  // First Win (creator loop) follow-on steps
  create_dtu:          'Shape a thought into a DTU — the world remembers what you make.',
  create_artifact:     'Give your thought a body: generate or bring an artifact.',
  view_global:         'See it take its place in the Global weave, among all the rest.',
};

/** The Concordia line for a given onboarding phase/step id, or null if none. */
export function phaseVoiceLine(questId: string | null | undefined): string | null {
  if (!questId) return null;
  return PHASE_LINES[questId] ?? null;
}

/** Whether a phase/step id has an authored voice line (worth speaking). */
export function hasVoiceLine(questId: string | null | undefined): boolean {
  return phaseVoiceLine(questId) !== null;
}
