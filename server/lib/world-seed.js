// server/lib/world-seed.js
// Idempotent seeding of the 6 canonical Concordia worlds on server start.

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
  {
    id: "fable-world",
    name: "Fable World",
    universe_type: "fantasy",
    description: "A realm of magic, mythic creatures, and medieval constraints. Technology does not function here.",
    physics_modulators: JSON.stringify({ magic_density: 1.0, tech_suppression: 1.0 }),
    rule_modulators: JSON.stringify({
      combatAllowed: true,
      skill_resistance: {
        hacking:    { threshold: 999999, scaling: 0 },
        technology: { threshold: 999999, scaling: 0 },
        magic:      { threshold: 5,      scaling: 1.2 },
        flight:     { threshold: 20,     scaling: 1.0 },
      },
      skill_effectiveness_rules: {
        magic:      { multiplier: 1.5 },
        technology: { multiplier: 0.0 },
        default:    { multiplier: 0.8 },
      },
    }),
  },
  {
    id: "superhero-world",
    name: "Superhero World",
    universe_type: "superpowered",
    description: "Comic-book physics, power categories, and city-scale heroism or villainy.",
    physics_modulators: JSON.stringify({ power_amplification: 2.0, structural_resilience: 3.0 }),
    rule_modulators: JSON.stringify({
      combatAllowed: true,
      skill_resistance: {
        power: { threshold: 10, scaling: 1.5 },
        magic: { threshold: 30, scaling: 0.8 },
      },
      skill_effectiveness_rules: {
        power:   { multiplier: 2.0 },
        default: { multiplier: 1.0 },
      },
    }),
  },
  {
    id: "wasteland-world",
    name: "Wasteland",
    universe_type: "post_apocalyptic",
    description: "Irradiated ruins, faction politics, and scarce resources. Survival demands harsh trade-offs.",
    physics_modulators: JSON.stringify({ radiation_level: 0.6, resource_scarcity: 0.4 }),
    rule_modulators: JSON.stringify({
      combatAllowed: true,
      skill_resistance: {
        magic:    { threshold: 999999, scaling: 0 },
        survival: { threshold: 1,      scaling: 1.0 },
        combat:   { threshold: 5,      scaling: 1.1 },
      },
      skill_effectiveness_rules: {
        survival: { multiplier: 1.5 },
        magic:    { multiplier: 0.0 },
        default:  { multiplier: 0.9 },
      },
    }),
  },
  {
    id: "crime-city",
    name: "Crime City",
    universe_type: "urban_crime",
    description: "A city where criminal economics thrive, vehicle theft is currency, and power shifts hourly.",
    physics_modulators: JSON.stringify({ law_enforcement_density: 0.3 }),
    rule_modulators: JSON.stringify({
      combatAllowed: true,
      skill_resistance: {
        hacking:       { threshold: 10, scaling: 1.2 },
        stealth:       { threshold: 5,  scaling: 1.3 },
        persuasion:    { threshold: 5,  scaling: 1.1 },
      },
      skill_effectiveness_rules: {
        hacking:    { multiplier: 1.3 },
        stealth:    { multiplier: 1.2 },
        default:    { multiplier: 1.0 },
      },
    }),
  },
  {
    id: "war-zone",
    name: "War Zone",
    universe_type: "military",
    description: "Active military conflict, tactical squad dynamics, and strategic resource control.",
    physics_modulators: JSON.stringify({ explosives_yield: 1.5, cover_effectiveness: 1.2 }),
    rule_modulators: JSON.stringify({
      combatAllowed: true,
      skill_resistance: {
        combat:   { threshold: 5,      scaling: 1.2 },
        tactics:  { threshold: 10,     scaling: 1.3 },
        magic:    { threshold: 999999, scaling: 0   },
      },
      skill_effectiveness_rules: {
        combat:  { multiplier: 1.5 },
        tactics: { multiplier: 1.4 },
        magic:   { multiplier: 0.0 },
        default: { multiplier: 1.0 },
      },
    }),
  },
];

/**
 * Idempotently insert the 6 canonical worlds. Safe to call on every server start.
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
