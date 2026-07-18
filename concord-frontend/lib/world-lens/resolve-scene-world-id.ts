// lib/world-lens/resolve-scene-world-id.ts
//
// S2-a — the single source of truth for which world a `ConcordiaScene` binds
// its world-scoped fetches to (terrain deformation, hydrology, world
// renderers, water-plane registration).
//
// The scene is PROP-DRIVEN: the `districtId` prop IS the worldId. The world
// lens passes `activeDistrict.id` (kept in sync with the localStorage active
// world on travel); an artifact host — the Foundry preview, or ConKay's
// "step in" affordance (Phase S2-b) — passes the artifact's `previewWorldId`.
// Binding the fetches to the prop is what makes a hosted scene fetch ITS
// world's terrain/water/renderers instead of leaking the viewer's ambient
// active world.
//
// The ambient `localStorage['concordia:activeWorldId']` and the
// `'concordia-hub'` literal are the fallback ONLY when the prop is empty/blank
// — preserving the pre-S2-a behavior for any caller that mounts without a
// districtId. Extracted to its own module (rather than living inside
// ConcordiaScene.tsx, which pulls in Three.js/Rapier and can't be imported in
// a jsdom unit test) so the binding rule is directly, honestly testable.

/**
 * Resolve the world a ConcordiaScene binds to. Prefers the prop-supplied
 * `districtId`; falls back to the ambient active world, then `'concordia-hub'`.
 * Whitespace-only values are treated as absent.
 *
 * @param districtId    the scene's `districtId` prop (the intended world)
 * @param ambientWorldId the ambient `localStorage['concordia:activeWorldId']`
 *                       (pass null/undefined when unavailable, e.g. SSR)
 * @returns the resolved worldId — never empty
 */
export function resolveSceneWorldId(
  districtId: string | null | undefined,
  ambientWorldId?: string | null,
): string {
  const prop = typeof districtId === 'string' ? districtId.trim() : '';
  if (prop) return prop;
  const ambient = typeof ambientWorldId === 'string' ? ambientWorldId.trim() : '';
  if (ambient) return ambient;
  return 'concordia-hub';
}
