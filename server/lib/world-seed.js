// server/lib/world-seed.js
// Idempotent seeding of the Concordia hub on server start.
//
// This used to seed six "canonical" worlds (fable-world, superhero-world,
// wasteland-world, crime-city, war-zone) from before the authored megaworld
// regions existed. Migration 489 merged those into the authored regions
// (crime, superhero, fantasy) or retired them (owner decision 2026-10-23);
// seeding them here would recreate them as active, simulated worlds on a
// fresh install. The authored regions are created from content/world.

const SEED_WORLDS = [
  {
    id: "concordia-hub",
    name: "Concordia Hub",
    universe_type: "standard",
    description: "The central nexus of Concordia. Standard physics, civic cooperation, and no mainland combat.",
    physics_modulators: JSON.stringify({ gravity: 1.0, speed_multiplier: 1.0 }),
    rule_modulators: JSON.stringify({
      combatAllowed: false,
      skill_resistance: {},
      skill_effectiveness_rules: { default: { multiplier: 1.0 } },
    }),
  },
];

/**
 * Idempotently insert the hub world. Safe to call on every server start.
 * @param {import('better-sqlite3').Database} db
 */
export function seedWorlds(db) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO worlds
      (id, name, universe_type, description, physics_modulators, rule_modulators)
    VALUES
      (@id, @name, @universe_type, @description, @physics_modulators, @rule_modulators)
  `);

  const seedAll = db.transaction(() => {
    for (const world of SEED_WORLDS) insert.run(world);
  });

  seedAll();

  // Seed resource nodes + seed cities for each canonical world (idempotent, non-blocking).
  import('./world-seeder.js').then(({ seedWorldContent }) => {
    for (const world of SEED_WORLDS) {
      seedWorldContent(db, world.id, world.universe_type);
    }
  }).catch(() => { /* non-fatal — runs on next world visit if tables aren't ready yet */ });
}
