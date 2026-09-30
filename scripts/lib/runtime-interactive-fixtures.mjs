// Session fixtures for class-D/E stateful coverage — setup → invoke → teardown.

/**
 * @param {object} boot
 * @param {Function} boot.dispatchLensRun
 * @param {Function} boot.makeInternalCtx
 * @returns {Promise<{ ctx: object, seeds: Record<string, unknown> }>}
 */
export async function seedInteractiveSession(boot) {
  const { dispatchLensRun, makeInternalCtx } = boot;
  const ctx = makeInternalCtx("runtime-interactive-coverage");
  const db = globalThis._concordDB;
  const seeds = {};

  // Cache round-trip for cache.clear
  await dispatchLensRun("cache", "set", {
    key: "interactive-coverage-key",
    data: { probe: true },
    ttl: 60000,
  }, ctx);
  seeds.cacheKey = "interactive-coverage-key";

  // Audio room for spaces.* probes
  const roomRes = await dispatchLensRun("spaces", "create", {
    title: "Coverage Room",
    description: "stateful harness",
    maxListeners: 10,
  }, ctx);
  if (roomRes?.roomId) {
    seeds.roomId = roomRes.roomId;
  } else if (roomRes?.room?.id) {
    seeds.roomId = roomRes.room.id;
  }

  // DTU for dtu.delete / evidence macros
  const dtuRes = await dispatchLensRun("dtu", "create", {
    name: "interactive-coverage-dtu",
    kind: "note",
    human: "coverage seed",
    core: { claims: [{ text: "coverage" }] },
  }, ctx);
  if (dtuRes?.id) seeds.dtuId = dtuRes.id;
  else if (dtuRes?.result?.id) seeds.dtuId = dtuRes.result.id;

  // Sports career chain
  const league = await dispatchLensRun("sports_careers", "open_league", {
    name: "Coverage League",
    sport: "basketball",
  }, ctx);
  const leagueId = league?.leagueId || league?.result?.leagueId || league?.id;
  if (leagueId) {
    seeds.leagueId = leagueId;
    const team = await dispatchLensRun("sports_careers", "add_team", {
      leagueId,
      name: "Coverage Team",
    }, ctx);
    seeds.teamId = team?.teamId || team?.result?.teamId;
  }

  return { ctx, seeds, db };
}

/** @type {Record<string, (seeds: Record<string, unknown>) => object>} */
export const INTERACTIVE_INPUT_BUILDERS = {
  "spaces.get": (s) => ({ roomId: s.roomId || "__missing_room__" }),
  "spaces.leave": (s) => ({ roomId: s.roomId || "__missing_room__" }),
  "cache.clear": () => ({}),
  "dtu.delete": (s) => ({ id: s.dtuId || "missing-dtu" }),
  "emergent.evidence.deprecate": (s) => ({
    dtuId: s.dtuId || "missing-dtu",
    reason: "interactive_harness",
  }),
  "sports_careers.record_outcome": (s) => ({
    careerId: s.careerId || "missing-career",
    points: 10,
    wonMvp: false,
  }),
  "sports_careers.retire": (s) => ({ careerId: s.careerId || "missing-career" }),
  "chat.send": () => ({
    threadId: "interactive-thread",
    message: "coverage probe",
  }),
  "wallet.save": () => ({ label: "coverage-wallet", amount: 0 }),
  "marketplace.save": () => ({ listingId: "coverage-listing-missing" }),
  "personas.create": () => ({ name: "Coverage Persona", description: "harness" }),
  "world.spawn-npc": () => ({ worldId: "concordia-hub", name: "Coverage NPC" }),
};

export function buildInteractiveInput(macroId, seeds) {
  const builder = INTERACTIVE_INPUT_BUILDERS[macroId];
  if (builder) return builder(seeds);
  return { artifact: { id: `interactive-${macroId}`, data: {} } };
}
