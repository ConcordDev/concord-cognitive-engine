// lib/concordia/progressive-disclosure.ts
//
// WAVE FTUE — FTUE2 (cognitive-load reduction / progressive disclosure). A
// 1.36M-LOC, 253-lens world is a cognitive-overload risk by construction: the
// research is unambiguous that the opening must hide all but the essential and
// teach-when-relevant. This is the PURE disclosure policy — which feature
// CATEGORIES are visible at each onboarding stage — so the cold-open surfaces
// one thing at a time and a new player is never lost. The AppShell gates UI on
// it (behind CONCORD_FTUE_DISCLOSURE; flag off → everything visible == today).

export type DisclosureStage = "arrival" | "first_action" | "first_win" | "free";

// Ordered stages — a player advances arrival → … → free.
export const DISCLOSURE_STAGES: DisclosureStage[] = ["arrival", "first_action", "first_win", "free"];

// Feature categories, each unlocked at (and after) a stage. Everything is
// visible at "free" (normal play). The opening shows only "core".
export type FeatureCategory =
  | "core"        // move, look, the single first verb — always visible
  | "interact"    // talk / pick up / use — after the first action
  | "progression" // skills, inventory, quests — after the first win
  | "economy" | "social" | "creation" | "world_sim" | "advanced"; // the deep surface — free play

const UNLOCKED_AT: Record<FeatureCategory, DisclosureStage> = {
  core:        "arrival",
  interact:    "first_action",
  progression: "first_win",
  economy:     "free",
  social:      "free",
  creation:    "free",
  world_sim:   "free",
  advanced:    "free",
};

const stageIndex = (s: DisclosureStage) => Math.max(0, DISCLOSURE_STAGES.indexOf(s));

/** Is a feature category disclosed (visible) at the given stage? */
export function isDisclosed(category: FeatureCategory, stage: DisclosureStage): boolean {
  const need = UNLOCKED_AT[category];
  if (!need) return true; // unknown category → don't hide it
  return stageIndex(stage) >= stageIndex(need);
}

/** All categories visible at a stage (for building the cold-open UI set). */
export function disclosedCategories(stage: DisclosureStage): FeatureCategory[] {
  return (Object.keys(UNLOCKED_AT) as FeatureCategory[]).filter((c) => isDisclosed(c, stage));
}

/** The next stage after the current one (terminal at "free"). */
export function nextStage(stage: DisclosureStage): DisclosureStage {
  const i = stageIndex(stage);
  return DISCLOSURE_STAGES[Math.min(i + 1, DISCLOSURE_STAGES.length - 1)];
}
