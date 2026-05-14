// Phase K — load all 6 game-mode modules so each calls
// `registerGameMode(mode)` at import time. Any caller that imports
// this barrel gets the full registry populated.

import architectMode      from './architect';
import crisisResponseMode from './crisis-response';
import expeditionMode     from './expedition';
import ghostHuntMode      from './ghost-hunt';
import masterForgeMode    from './master-forge';
import mentorMode         from './mentor';

export const ALL_GAME_MODES = [
  architectMode,
  crisisResponseMode,
  expeditionMode,
  ghostHuntMode,
  masterForgeMode,
  mentorMode,
];

// Re-export the orchestrator + helpers for convenience.
export {
  gameModeOrchestrator,
  startGameMode,
  getAllGameModes,
  getGameMode,
  registerGameMode,
} from '../game-mode-orchestrator';
