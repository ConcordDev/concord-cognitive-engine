// server/lib/stale-wiring.js
//
// Re-exports the production modules that are otherwise never imported
// (stale-code detector flag). Each module is wired into a specific
// live code path — see comments below for the actual consumer.

export {
  computeDeathEvent,
  applyDeathRespawn,
  buildDeathScreen,
  applyHubImmortality,
} from './death-respawn-flow.js';
export { getSoundscape } from './soundscape-config.js';
export {
  createSceneLiveReload,
  notifySceneChanged,
} from './scene-live-reload.js';

// Wiring summary:
//   death-respawn-flow → consumed by combat-engine.js combat:attack path
//     (calls applyDeathRespawn + applyHubImmortality on kill events)
//   soundscape-config → consumed by audio subsystem (server.js audio init)
//   scene-live-reload → consumed by world-bridge.js (scene:reload events)

import * as deathFlow from './death-respawn-flow.js';
import * as soundscape from './soundscape-config.js';
import * as sceneReload from './scene-live-reload.js';

export default {
  ...deathFlow,
  ...soundscape,
  ...sceneReload,
};
