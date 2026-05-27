// server/domains/minigames.js
//
// Phase II Wave 19 — life-sim minigame domain macros. Four games
// share a unified resolver shape; each calls a pure-compute resolver
// from server/lib/minigame-resolvers.js.

import {
  resolveFishing,
  resolvePhotograph,
  resolveKaraoke,
  resolveMahjongHand,
  MINIGAME_CONSTANTS,
} from "../lib/minigame-resolvers.js";

export default function registerMinigameMacros(register) {
  register("fishing", "resolve_cast", async (_ctx, input = {}) => {
    return resolveFishing(input);
  });

  register("photography", "resolve_shot", async (_ctx, input = {}) => {
    return resolvePhotograph(input);
  });

  register("karaoke", "resolve_performance", async (_ctx, input = {}) => {
    return resolveKaraoke(input);
  });

  register("mahjong", "resolve_hand", async (_ctx, input = {}) => {
    return resolveMahjongHand(input);
  });

  register("minigames", "constants", async () => {
    return { ok: true, constants: MINIGAME_CONSTANTS };
  });
}
