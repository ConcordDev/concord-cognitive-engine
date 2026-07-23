// Building-interact dispatch — pulled out of the world page's raycaster
// building-click handler (`handleConcordiaBuildingClick`,
// app/lenses/world/page.tsx) as a small, real, exported testability seam.
// The raycaster hit test itself (deciding WHEN a building was clicked) lives
// inside ConcordiaScene's Three.js scene graph and needs a live WebGL
// context jsdom can't provide; this function is the actual runtime call the
// world page's click handler invokes once it resolves a hit, so a test can
// drive the real dispatch path (CustomEvent name + detail shape, including
// playerX/playerZ) without needing WebGL. No behavior changed — this is the
// exact same try/dispatch that used to be written inline.

export interface BuildingInteractDetail {
  buildingId: string;
  worldId: string;
  playerX: number;
  playerZ: number;
}

export function dispatchBuildingInteractEvent(detail: BuildingInteractDetail): void {
  try {
    window.dispatchEvent(new CustomEvent('concordia:building-interact', { detail }));
  } catch { /* dispatch best-effort */ }
}
