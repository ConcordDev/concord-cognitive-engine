/**
 * player-position-broadcast — the single writer for the two window globals
 * that 9+ world-lens satellite components read every frame/tick:
 * `window.__concordiaPlayerPos` and `window.__concordiaNpcPositions`.
 *
 * Wave 4 finding #8 (docs/concordia-specs/runtime-health-capability-map.md):
 * both globals were documented in-place ("set by AvatarSystem3D") across
 * ExtractionRunHUD, DangerBandHUD, PowerClusterLayer, LensStationPrompt,
 * vehicle-renderer, NPCSchemeOverhearTip, WorldMarkers, ChatSystem,
 * avatar-aura-renderer, water-grid-renderer, and play-action — but nothing
 * ever wrote them. Confirmed real consequences: ExtractionRunHUD's
 * nearest-zone computation never ran (Extract button could never enable
 * through it), DangerBandHUD always computed from world origin (0,0),
 * PowerClusterLayer proximity pickups never fired, LensStationPrompt's
 * building-approach prompt never surfaced, vehicle-renderer's mount prompt
 * never appeared, and NPCSchemeOverhearTip's 30m earshot gate silently
 * bypassed itself (playerPos was always null, so its
 * `if (playerPos && npcPos)` block never ran and every scheme-resolution
 * toast fired regardless of distance — failing OPEN, the opposite of the
 * intended fail-closed gate).
 *
 * AvatarSystem3D is the sole writer, called once per frame from its
 * `avatarGroup.userData.update` loop (it already owns the live position
 * refs there) and cleared on unmount so a stale pointer doesn't leak into
 * a lens where the avatar system isn't mounted.
 */

export interface BroadcastVec3 {
  x: number;
  y: number;
  z: number;
}

declare global {
  interface Window {
    __concordiaPlayerPos?: BroadcastVec3;
    __concordiaNpcPositions?: Record<string, BroadcastVec3>;
  }
}

/**
 * Publishes the live player position. AvatarSystem3D passes the SAME
 * mutable ref object every frame (`playerPositionRef.current`, mutated in
 * place by the physics loop) — this is a plain property assignment, not a
 * copy, so there is no per-frame allocation cost and no need to throttle
 * it (consistent with `cameraLookState`'s un-throttled per-frame mutation
 * elsewhere in this codebase — see lib/world-lens/camera-look-state.ts).
 */
export function publishPlayerPosition(pos: BroadcastVec3): void {
  if (typeof window === 'undefined') return;
  window.__concordiaPlayerPos = pos;
}

/**
 * Publishes live NPC positions keyed by npc id, matching the id space
 * `world_npcs.id` / `npc_schemes.npc_id` use elsewhere (e.g.
 * `scheme.plotterId` in NPCSchemeOverhearTip). Rebuilt fresh each frame
 * from the currently-tracked NPC meshes (bounded by MAX_FULLY_ANIMATED, so
 * the per-frame object build is cheap) so despawned/out-of-range NPCs drop
 * out automatically instead of leaving stale coordinates behind.
 */
export function publishNpcPositions(positions: Record<string, BroadcastVec3>): void {
  if (typeof window === 'undefined') return;
  window.__concordiaNpcPositions = positions;
}

/** Clears both globals. Call on AvatarSystem3D unmount. */
export function clearPlayerPositionBroadcast(): void {
  if (typeof window === 'undefined') return;
  delete window.__concordiaPlayerPos;
  delete window.__concordiaNpcPositions;
}
