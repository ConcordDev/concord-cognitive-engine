/**
 * Honest-by-construction world-data status for the Concordia world lens.
 *
 * The 3D scene needs *a* district object to initialize, so it boots on the
 * DEMO_DISTRICT seed geometry (lib/world-lens/district-seed). The honesty
 * rule (master-plan W4): the player must never mistake that seed render for
 * live world state. Each live world fetch (nodes / buildings / npcs /
 * loot-bags) reports its outcome here, and the derived state drives an
 * unmissable-but-non-blocking overlay:
 *
 *   - 'loading'  → "Entering Concordia…" spinner (no fetch has resolved yet)
 *   - 'live'     → no overlay (at least one real world fetch succeeded —
 *                  the scene is showing genuine backend state, even if empty)
 *   - 'offline'  → "World data unavailable — showing local preview" banner
 *                  (every fetch failed; the seed render is explicitly labeled
 *                  a preview, never silently presented as live)
 *
 * Pure module — no React, no DOM — so the derivation is unit-testable
 * independently of the (huge, 3D) world page component.
 */

export type WorldDataState = 'loading' | 'live' | 'offline';

export type WorldFetchOutcome = 'pending' | 'ok' | 'error';

/** The live world fetches the page issues against /api/worlds/:id/... */
export type WorldDataSource = 'nodes' | 'buildings' | 'npcs' | 'lootBags';

export const WORLD_DATA_SOURCES: readonly WorldDataSource[] = [
  'nodes',
  'buildings',
  'npcs',
  'lootBags',
];

/** Fresh all-pending outcome map (new object each call — safe as useState init). */
export function initialWorldFetchOutcomes(): Record<WorldDataSource, WorldFetchOutcome> {
  return {
    nodes: 'pending',
    buildings: 'pending',
    npcs: 'pending',
    lootBags: 'pending',
  };
}

/**
 * Derive the presented state from per-source fetch outcomes.
 *
 * - Any source 'ok' → 'live'. An HTTP-ok response with zero buildings/NPCs is
 *   still genuine live world state (the world really is empty there).
 * - Every source 'error' → 'offline'. The seed render must be labeled a
 *   local preview.
 * - Otherwise (any still pending, none ok yet) → 'loading'.
 */
export function deriveWorldDataState(
  outcomes: Record<WorldDataSource, WorldFetchOutcome>
): WorldDataState {
  const values = WORLD_DATA_SOURCES.map((s) => outcomes[s] ?? 'pending');
  if (values.some((v) => v === 'ok')) return 'live';
  if (values.every((v) => v === 'error')) return 'offline';
  return 'loading';
}
