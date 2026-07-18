// lib/conkay/iterate-building.ts
//
// Phase S3-b — the live "Iterate" loop for building artifacts, honest core.
//
// Design decision (honest by construction): game-design.building-publish
// PERSISTS + spawns a building (mints a DTU, emits world:building-spawned), so
// re-running it on every "make it taller" would spam-create buildings. But a
// building's GEOMETRY is a pure function of its macro INPUT
// (normalizeBuildingPublish builds the rendered buildings[] entirely from the
// input; the result only supplies the id). So iterate re-derives the artifact
// LOCALLY through the same real render pipeline — instant, non-mutating, and
// truthful (the taller building shown IS the real building for that input).
// Committing the edit (a real building-publish re-run that persists) is the
// separate deliberate "Own it" step (Phase S4), not part of the fast loop.
//
// This module is the pure, unit-tested spine: propose an iteration from an
// utterance (parse → apply delta → diff, with honest rejections) and re-derive
// the new artifact. The React UI (BuildingIterateBar / BuildingAdapter) is a
// thin shell over these.

import {
  parseBuildingDimIntent,
  buildRerunInput,
  dimensionsFromInput,
  dimensionDiff,
  describeDelta,
  type BuildingDimensions,
  type DimensionDelta,
} from './delta-intent';
import { detectArtifact, type ConkayBuildingArtifact } from './artifact-kinds';

export interface IterationProposal {
  ok: true;
  delta: DimensionDelta;
  before: BuildingDimensions;
  after: BuildingDimensions;
  changed: ReturnType<typeof dimensionDiff>;
  newInput: Record<string, unknown> & { dimensions: BuildingDimensions };
  summary: string;
}

export type IterationRejectReason = 'no_intent' | 'no_dimensions' | 'no_change';

export interface IterationRejection {
  ok: false;
  reason: IterationRejectReason;
  message: string;
}

/**
 * Turn an utterance into a concrete, reviewable building iteration — or an
 * honest rejection. Never fabricates a change (invariant #4): an unparseable
 * utterance, an artifact with no dimensions, or a delta that clamps to a no-op
 * each return a worded rejection instead of a silent/fake edit.
 */
export function proposeBuildingIteration(
  sourceInput: Record<string, unknown>,
  utterance: string,
): IterationProposal | IterationRejection {
  const delta = parseBuildingDimIntent(utterance);
  if (!delta) {
    return {
      ok: false,
      reason: 'no_intent',
      message: "I didn't catch a size change to make — try “make it taller”, “wider by 3m”, or “set height to 20”.",
    };
  }
  const before = dimensionsFromInput(sourceInput);
  if (!before) {
    return { ok: false, reason: 'no_dimensions', message: 'This artifact has no editable dimensions.' };
  }
  const newInput = buildRerunInput(sourceInput, delta);
  if (!newInput) {
    return { ok: false, reason: 'no_dimensions', message: 'This artifact has no editable dimensions.' };
  }
  const after = newInput.dimensions;
  const changed = dimensionDiff(before, after);
  if (changed.length === 0) {
    return {
      ok: false,
      reason: 'no_change',
      message: 'That wouldn’t change the size — it’s already at the limit for that dimension.',
    };
  }
  return { ok: true, delta, before, after, changed, newInput, summary: describeDelta(delta) };
}

/**
 * Re-derive the building artifact from an accepted iteration's new input,
 * through the SAME detectArtifact registry that produced the original — so the
 * re-rendered building is the real render of the new input, not a hand-patched
 * copy. Reuses the existing building id as the lineage anchor. Returns null if
 * the new input somehow fails to normalize (honest STOP-POINT — keep the old).
 */
export function rederiveBuildingArtifact(
  prev: ConkayBuildingArtifact,
  newInput: Record<string, unknown>,
): ConkayBuildingArtifact | null {
  const buildingId = prev.buildings[0]?.id;
  if (!buildingId) return null;
  const next = detectArtifact('game-design', 'building-publish', newInput, { ok: true, buildingId });
  return next && next.kind === 'building' ? next : null;
}

/** The world the building was published into (from its macro input), or null. */
export function buildingWorldId(artifact: ConkayBuildingArtifact): string | null {
  const w = artifact.sourceInput?.worldId;
  return typeof w === 'string' && w.trim() ? w.trim() : null;
}

/**
 * S2-b (building) — whether "Step inside" is honest for this artifact. True only
 * when it's a PUBLISHED building (real dtuId + worldId) that has NOT been locally
 * edited: walking mounts the real persisted world, so an un-published edit (whose
 * new dimensions aren't in the world yet) would show the OLD building — dishonest.
 * The gate reuses the ownership signal: publish/revert the edit, then walk it.
 */
export function canStepInside(artifact: ConkayBuildingArtifact, edited: boolean): boolean {
  return !edited && !!artifact.dtuId && !!buildingWorldId(artifact);
}
