// server/lib/foundry/compiler.js
//
// Foundry — the Worldspec compiler (Phase 3).
//
// Turns a validated worldspec into the concrete artifacts a real
// `worlds` row needs: physics_modulators, rule_modulators, the
// content-seed declarations, and a Concord Link anchor spec.
//
// This is the "overlay" half of the hybrid publish model: a published
// Foundry game IS a real `worlds` row, but its behaviour is driven by
// modulators rather than an authored content/world/<id>/ directory.
// "Promotion" to a full first-class world node (persisted seed
// content) is a later flag — the compiler output is the same; only
// the seeding depth changes.
//
// How a system activates is declared on its registry entry's
// `activation`:
//   physics_modulator — config -> physics_modulators[key]
//   rule_modulator    — config -> rule_modulators[key]
//   heartbeat_optin   — config -> rule_modulators[key] + an explicit
//                       rule_modulators.foundry_heartbeats[key] = true
//                       marker (the per-world heartbeats already run;
//                       the marker lets future wiring gate them)
//   content_seed      — collected into contentSeeds[]; concord-link is
//                       special-cased into a concordLinkAnchor spec
//   always_on         — substrate/player-level; no per-world write
//
// Stub systems (status:'stub' — the Phase 7 net-new set) are SKIPPED:
// they're selectable + persist in the worldspec, but don't activate
// until Phase 7 flips their status. No compiler change needed then.

import { getSystem } from "./system-registry.js";

/**
 * Compile a (validated, normalized) worldspec into world artifacts.
 *
 * @param {object} worldspec
 * @returns {{
 *   physics_modulators: object,
 *   rule_modulators: object,
 *   contentSeeds: Array<{system,key,config}>,
 *   concordLinkAnchor: object|null,
 *   activatedSystems: string[],
 *   skippedStubs: string[],
 * }}
 */
export function compileWorldspec(worldspec) {
  const physics_modulators = {};
  const rule_modulators = {};
  const contentSeeds = [];
  let concordLinkAnchor = null;
  const activatedSystems = [];
  const skippedStubs = [];

  const systems = Array.isArray(worldspec?.systems) ? worldspec.systems : [];

  for (const entry of systems) {
    const sys = getSystem(entry && entry.id);
    if (!sys) continue; // unknown id — validation should have caught it
    if (sys.status === "stub") {
      skippedStubs.push(entry.id);
      continue; // not built yet — activates once Phase 7 ships
    }
    const config = entry.config && typeof entry.config === "object" ? entry.config : {};
    const { activation } = sys;
    activatedSystems.push(entry.id);

    switch (activation.kind) {
      case "physics_modulator":
        physics_modulators[activation.key] = config;
        break;
      case "rule_modulator":
        rule_modulators[activation.key] = config;
        break;
      case "heartbeat_optin":
        rule_modulators[activation.key] = config;
        (rule_modulators.foundry_heartbeats ||= {})[activation.key] = true;
        break;
      case "content_seed":
        contentSeeds.push({ system: entry.id, key: activation.key, config });
        if (entry.id === "concord-link") {
          concordLinkAnchor = {
            travelMode: config.travelMode || "portal",
            inboundOpen: config.inboundOpen !== false,
            outboundOpen: config.outboundOpen !== false,
          };
        }
        break;
      case "always_on":
      default:
        break; // substrate/player-level — nothing per-world to write
    }
  }

  // Provenance marker — lets the runtime + a future "promote" step
  // recognise a Foundry-built world and know what it was assembled from.
  rule_modulators.foundry = {
    worldspecVersion: worldspec?.version || 1,
    template: worldspec?.template || null,
    systems: activatedSystems,
    stubs: skippedStubs,
    contentSeeds: contentSeeds.map((c) => c.key),
  };

  return {
    physics_modulators,
    rule_modulators,
    contentSeeds,
    concordLinkAnchor,
    activatedSystems,
    skippedStubs,
  };
}

/**
 * Build the Concord Link anchor row spec for a freshly-published world.
 * Returns null when concord-link wasn't selected. The shape matches
 * what `concord_link_anchors` expects (see seedAnchorsFromWorldMeta).
 */
export function buildConcordLinkAnchor(worldId, worldName, anchorCfg) {
  if (!anchorCfg) return null;
  return {
    id: `anchor-${worldId}`,
    world_id: worldId,
    name: `${worldName} Gateway`,
    access_method: anchorCfg.travelMode || "portal",
    description: `Concord Link arrival point for ${worldName}, built in Foundry.`,
    location: null,
    controlled_by_faction: null,
    stability: 1.0,
  };
}
