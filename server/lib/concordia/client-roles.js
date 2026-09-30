// server/lib/concordia/client-roles.js
//
// Concordia has one kernel and several presentation surfaces. This module
// is the contract so a new mechanic is not accidentally added to a client
// that is not allowed to resolve it.
//
//   UNITY / GODOT / THREE.JS     presentation + input + animation
//   GAMEPLAY LAYER               feel, quest UI, traversal chrome
//   WORLD SIMULATION KERNEL      heartbeats (this process)
//   CONSEQUENCE / MEMORY / DTUs  persist
//
// Unity and Godot are game clients. The Three.js world-lens is the web OS
// viewport (HUD, DTU, presence, stations) — not combat authority. The
// living-world Vite `src/game/` tree is a browser prototype superseded by
// the in-repo Unity client presenting this kernel.

export const CLIENT_ROLES = Object.freeze({
  unity: Object.freeze({
    id: "unity",
    role: "game_client",
    layer: "presentation",
    kernel: false,
    path: "/unity-ws",
  }),
  godot: Object.freeze({
    id: "godot",
    role: "game_client",
    layer: "presentation",
    kernel: false,
    path: "/godot-ws",
  }),
  threejs_world_lens: Object.freeze({
    id: "threejs_world_lens",
    role: "web_os_viewport",
    layer: "presentation",
    kernel: false,
    path: "/lenses/world",
  }),
  living_world_vite: Object.freeze({
    id: "living_world_vite",
    role: "browser_prototype",
    layer: "spec",
    kernel: false,
    supersededBy: "unity",
  }),
  server: Object.freeze({
    id: "server",
    role: "kernel",
    layer: "kernel",
    kernel: true,
  }),
});

/** Client → kernel. Presentation must not resolve these locally when connected. */
export const INTENT_EVENTS = Object.freeze([
  "player:move",
  "combat:attack",
  "combat:dodge",
  "scene:request",
]);

/** Kernel → client. Safe to apply as presentation. */
export const PRESENTATION_EVENTS = Object.freeze([
  "combat:impact",
  "combat:hit",
  "combat:attack:ack",
  "combat:dodge:ack",
  "scene:data",
  "player:move:ack",
]);

export function roleFor(clientId) {
  if (typeof clientId !== "string") return null;
  return CLIENT_ROLES[clientId] || null;
}

/** Only the Concord kernel may decide hit/miss/damage/HP. */
export function mayResolveCombat(clientId) {
  return roleFor(clientId)?.kernel === true;
}
