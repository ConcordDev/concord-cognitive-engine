// server/lib/combat/taxonomies.js
//
// Spell / power / skill taxonomy registries — the non-weapon side of the
// combat-classification pyramid. Sibling file to loadout.js.
//
// Three concerns, three registries:
//   - ELEMENT_INFO       — 24 elemental damage types (fire/ice/dark/void/…)
//   - SPELL_SCHOOL_INFO  — 16 spell-school archetypes (D&D 8 + extras)
//   - POWER_TYPE_INFO    — 24 superhero-style power archetypes
//   - SKILL_TYPE_INFO    — 10 skill categories (combat/movement/social/…)
//
// Each registry has an explicit `amorphous` row for player-invented entries.
// Inference functions accept a `meta` object whose `meta.amorphous === true`
// is the escape hatch that lets players invent their own classifications
// without a code change — same pattern as `inferWeaponClass`. This is what
// lets the player base evolve the game's vocabulary: a player can name a
// power "Solar Phase Walking", flag it amorphous in meta, and the system
// will accept + persist it without losing the taxonomy of the canonical
// 50+ archetypes that come built-in.
//
// Downstream readers:
//   - glyph-spells.js          — uses ELEMENT_INFO to validate spell elements
//   - skill-evolution.js       — uses SKILL_TYPE_INFO for tree organisation
//   - flow-engine.js           — consumes any of these as opaque tag strings
//   - npc-skill-author.js      — picks archetypes from SPELL_SCHOOL_INFO

// ─────────────────────────────────────────────────────────────────────────
// ELEMENTS — damage / interaction types
// ─────────────────────────────────────────────────────────────────────────
//
// 24 distinct elements. Each has a category (so downstream can group),
// physicality (matter|energy|psychic|metaphysical|hybrid), and a default
// affinity-bias direction for env-coupling. The existing 9 elements in
// glyph-spells.js (fire/water/ice/lightning/physical/bio/energy/psychic/
// refusal) are a strict subset — this expands the vocabulary without
// breaking the seed library.
export const ELEMENT_INFO = Object.freeze({
  // Classical 4
  fire:        { category: "classical", physicality: "energy" },
  water:       { category: "classical", physicality: "matter" },
  earth:       { category: "classical", physicality: "matter" },
  wind:        { category: "classical", physicality: "matter" },  // air/wind alias

  // Common extensions
  ice:         { category: "elemental", physicality: "matter" },
  lightning:   { category: "elemental", physicality: "energy" },
  metal:       { category: "elemental", physicality: "matter" },
  wood:        { category: "elemental", physicality: "matter" },  // Wu Xing 5th

  // Light / dark axis
  holy:        { category: "moral",     physicality: "metaphysical" },
  light:       { category: "moral",     physicality: "energy" },
  dark:        { category: "moral",     physicality: "metaphysical" },
  shadow:      { category: "moral",     physicality: "metaphysical" },
  void:        { category: "moral",     physicality: "metaphysical" },

  // Force / kinetic
  physical:    { category: "kinetic",   physicality: "matter" },
  force:       { category: "kinetic",   physicality: "energy" },
  gravity:     { category: "kinetic",   physicality: "metaphysical" },
  sonic:       { category: "kinetic",   physicality: "energy" },

  // Biological
  bio:         { category: "biological", physicality: "matter" },
  poison:      { category: "biological", physicality: "matter" },
  blood:       { category: "biological", physicality: "matter" },

  // Energy / techno
  energy:      { category: "energy",    physicality: "energy" },  // catch-all photonic / quantum
  radiation:   { category: "energy",    physicality: "energy" },
  arcane:      { category: "magical",   physicality: "metaphysical" },

  // Mental / temporal
  psychic:     { category: "mental",    physicality: "psychic" },
  time:        { category: "metaphysical", physicality: "metaphysical" },
  space:       { category: "metaphysical", physicality: "metaphysical" },

  // System-specific (concord-native)
  refusal:     { category: "concord",   physicality: "metaphysical" },

  // Amorphous — player-invented element with meta-driven physicality
  amorphous:   { category: "amorphous", physicality: "amorphous", amorphous: true },
});

const ELEMENT_NAME_TO_KEY = [
  // Explicit amorphous markers — top of table so player-invented names
  // win over any constituent element words ("amorphous wave" → amorphous,
  // not water).
  [/amorphous|polymorphic|element[ _-]?less/i,         "amorphous"],
  // Compound markers (so "frost fire" / "blood fire" hit the dominant
  // element before the constituent ones).
  [/electric[ _-]?frost|frost[ _-]?electric/i,         "ice"],
  [/blood[ _-]?fire|blood[ _-]?magic|sanguine[ _-]?fire/i, "blood"],
  [/holy[ _-]?fire|sacred[ _-]?flame/i,                "holy"],
  // Time / space before ice (so "chrono freeze" → time, not ice).
  [/\btime\b|chrono|temporal/i,                "time"],
  [/\bspace\b|spatial|teleport(?!ing)/i,       "space"],
  // Force / telekinetic / gravity before physical (so "telekinetic push"
  // doesn't hit "kinetic" inside physical).
  [/telekinetic|\bforce[ _-]?(push|wave|bolt)|kinetic[ _-]?(push|wave|projection)/i, "force"],
  [/gravity|gravit|gravitic/i,                 "gravity"],
  // Now generic elements. Note no `\b` after the root keyword so compounds
  // like "fireball" / "earthquake" / "wisdom" still resolve.
  [/fire|flame|inferno|pyre|combust|blaze/i,   "fire"],
  [/\bice\b|frost|cryo|freeze|chill|hail/i,    "ice"],
  [/lightning|electric|electricity|thunder|shock|volt/i, "lightning"],
  [/water|aqua|hydro|tide|wave\b/i,            "water"],
  [/earth|stone|rock|terra|geo[ _-]/i,         "earth"],
  [/\bwind\b|\bair\b|aero|gale|tempest|cyclone/i, "wind"],
  [/\bmetal\b|iron[ _-]?(skin|blast)|steel|ferro/i, "metal"],
  [/\bwood\b|verdant|jungle|forest/i,          "wood"],
  [/holy|divine|sacred|sanctified|smite/i,     "holy"],
  [/\blight\b|radiant|solar|photon/i,          "light"],
  [/\bdark\b|umbral|abyss|nether/i,            "dark"],
  [/shadow|gloom|murk/i,                       "shadow"],
  [/\bvoid\b|null[ _-]|annihilat/i,            "void"],
  // physical — runs AFTER force pattern, so telekinetic stays force.
  [/physical|kinetic|brawl|impact|martial[ _-]?strike/i,"physical"],
  [/sonic|sound|sonic[ _-]?wave|resonance/i,   "sonic"],
  [/\bbio\b|biotic|nature|plant|life[ _-]?bolt/i,"bio"],
  [/poison|toxic|venom|acid/i,                 "poison"],
  [/\bblood\b|hemo|sanguine/i,                 "blood"],
  [/\benergy\b|quantum|prismatic/i,            "energy"],
  [/radiation|radioactive|gamma|atomic/i,      "radiation"],
  [/arcane|mystic|esoteric/i,                  "arcane"],
  [/psychic|mental|psionic/i,                  "psychic"],
  [/refusal|refused|refuse[ _-]?field/i,       "refusal"],
];

export function inferElement(name = "", meta = null) {
  if (meta && typeof meta === "object" && meta.amorphous === true) {
    return { element: "amorphous", category: "amorphous" };
  }
  for (const [rx, key] of ELEMENT_NAME_TO_KEY) {
    if (rx.test(name)) return { element: key, category: ELEMENT_INFO[key].category };
  }
  return { element: null, category: null };
}

// ─────────────────────────────────────────────────────────────────────────
// SPELL SCHOOLS — what kind of magic this is
// ─────────────────────────────────────────────────────────────────────────
export const SPELL_SCHOOL_INFO = Object.freeze({
  // D&D 8 schools
  evocation:     { intent: "manipulate energy / create damage" },
  conjuration:   { intent: "summon / move matter from elsewhere" },
  illusion:      { intent: "alter perception / create false sensory input" },
  enchantment:   { intent: "imbue / charm / dominate a target" },
  divination:    { intent: "reveal hidden information" },
  necromancy:    { intent: "manipulate life force / death / undeath" },
  transmutation: { intent: "transform matter / properties" },
  abjuration:    { intent: "ward / protect / banish" },

  // Extended catalog
  martial:       { intent: "weapon-augmenting / chi / aura strikes" },
  runic:         { intent: "static glyph-based wards or traps" },
  draconic:      { intent: "breath-form elemental magic" },
  blood:         { intent: "cost-paid magic, often self-harm" },
  spirit:        { intent: "channelling external entities / ancestors" },
  wild:          { intent: "chaotic / randomised magic" },
  ritual:        { intent: "long-duration coordinated casts" },
  psionic:       { intent: "mental energy without external focus" },

  // Player-invented
  amorphous:     { intent: "player-defined school", amorphous: true },
});

const SPELL_NAME_TO_SCHOOL = [
  // Specialised schools first (so they win over generic D&D 8 matches
  // when keywords overlap — e.g. "rune ward" → runic, not abjuration).
  [/psionic|mind[ _-]?(blast|spike|link|read)|telepath/i,       "psionic"],
  [/rune\b|glyph[ _-]?ward|sigil[ _-]?trap/i,                   "runic"],
  [/chi\b|aura[ _-]?strike|martial[ _-]?focus|inner[ _-]?fire/i,"martial"],
  [/dragon[ _-]?(breath|fire)|breath[ _-]?weapon/i,             "draconic"],
  [/blood[ _-]?(pact|magic|rite)|hemo[ _-]?craft|sanguin/i,     "blood"],
  [/spirit[ _-]?(call|channel|ward)|ancestor[ _-]?(call|sight)|shamanic/i, "spirit"],
  [/wild[ _-]?(magic|surge)|chaos[ _-]?bolt|surge\b/i,          "wild"],
  [/ritual|long[ _-]?cast|circle[ _-]?cast/i,                   "ritual"],

  // D&D 8 schools (generic — last)
  [/evoke|evocation|bolt\b|blast|nova|barrage|missile|beam/i,   "evocation"],
  [/conjur|summon|portal|gate\b|fetch|teleport/i,               "conjuration"],
  [/illusion|mirror[ _-]?image|invisib|phantasm|veil|disguise/i,"illusion"],
  [/charm|enthrall|enchant|dominate|sleep[ _-]?spell|hypno/i,   "enchantment"],
  [/divine\s+(sense|sight)|scry|farsight|augur|fortune|reveal/i,"divination"],
  [/necro|raise[ _-]?dead|drain[ _-]?life|undead|death[ _-]?magic|wraith/i, "necromancy"],
  [/transmut|polymorph|metamorph|transform[ _-]?(self|other)/i, "transmutation"],
  [/abjur|ward|shield[ _-]?spell|barrier|dispel|protect/i,      "abjuration"],
];

export function inferSpellSchool(name = "", meta = null) {
  if (meta && typeof meta === "object" && meta.amorphous === true) {
    return { school: "amorphous" };
  }
  for (const [rx, key] of SPELL_NAME_TO_SCHOOL) {
    if (rx.test(name)) return { school: key };
  }
  return { school: null };
}

// ─────────────────────────────────────────────────────────────────────────
// POWERS — superhero-style innate abilities
// ─────────────────────────────────────────────────────────────────────────
//
// Distinct from spells: powers are passive-or-toggled traits the user *is*,
// not formulas the user *casts*. A character can have multiple powers
// stacked (super-strength + flight + heat vision). Spells consume mana;
// powers consume stamina or willpower depending on category.
export const POWER_TYPE_INFO = Object.freeze({
  flight:           { category: "movement",     resource: "stamina" },
  super_speed:      { category: "movement",     resource: "stamina" },
  teleport:         { category: "movement",     resource: "willpower" },
  phasing:          { category: "movement",     resource: "willpower" },  // walk through walls
  intangibility:    { category: "movement",     resource: "willpower" },

  super_strength:   { category: "physical",     resource: "stamina" },
  super_durability: { category: "physical",     resource: "passive" },
  regeneration:     { category: "physical",     resource: "passive" },
  invulnerability:  { category: "physical",     resource: "passive" },

  telepathy:        { category: "mental",       resource: "willpower" },
  telekinesis:      { category: "mental",       resource: "willpower" },
  mind_control:     { category: "mental",       resource: "willpower" },
  precognition:     { category: "mental",       resource: "willpower" },

  shapeshifting:    { category: "transmutation", resource: "willpower" },
  size_alter:       { category: "transmutation", resource: "stamina" },
  duplication:      { category: "transmutation", resource: "willpower" },
  invisibility:     { category: "perception",   resource: "willpower" },
  enhanced_senses:  { category: "perception",   resource: "passive" },

  elemental_control:{ category: "energy",       resource: "willpower" },
  energy_projection:{ category: "energy",       resource: "stamina" },
  healing_touch:    { category: "support",      resource: "willpower" },

  time_control:     { category: "metaphysical", resource: "willpower" },
  reality_warp:     { category: "metaphysical", resource: "willpower" },

  // Player-invented superpower
  amorphous:        { category: "amorphous",    resource: "amorphous", amorphous: true },
});

const POWER_NAME_TO_KEY = [
  // Movement
  [/flight|flying|levitat|hover\b/i,                            "flight"],
  [/super[ _-]?speed|hyper[ _-]?speed|speedster|sonic[ _-]?run/i,"super_speed"],
  [/teleport(?:ation)?|blink|step\b/i,                          "teleport"],
  [/phase[ _-]?(walking|shift)|phasing/i,                       "phasing"],
  [/intangib|ghost[ _-]?form|incorporeal/i,                     "intangibility"],

  // Physical
  [/super[ _-]?strength|herculean|titan[ _-]?strength/i,        "super_strength"],
  [/super[ _-]?(durability|tough)|iron[ _-]?skin|stone[ _-]?skin/i, "super_durability"],
  [/regenerat|heal[ _-]?factor|wolverine[ _-]?factor/i,         "regeneration"],
  [/invulnerab|immortal/i,                                      "invulnerability"],

  // Mental
  [/telepath|mind[ _-]?read/i,                                  "telepathy"],
  [/telekinesis|telekinetic|psychokinetic|tk\b/i,               "telekinesis"],
  [/mind[ _-]?control|hypno[ _-]?control|domination/i,          "mind_control"],
  [/precogniti|future[ _-]?sight|foresee/i,                     "precognition"],

  // Transmutation
  [/shapeshift|shape[ _-]?shift|metamorph|polymorph[ _-]?self/i,"shapeshifting"],
  [/size[ _-]?(alter|change|shift)|gigant|miniatur/i,           "size_alter"],
  [/duplica|multipli[ _-]?body/i,                               "duplication"],

  // Perception
  [/invisib/i,                                                  "invisibility"],
  [/enhanced[ _-]?sens|x[ _-]?ray[ _-]?vision|heat[ _-]?vision|night[ _-]?vision|super[ _-]?sens/i, "enhanced_senses"],

  // Energy
  [/elemental[ _-]?control|element[ _-]?bend|control[ _-]?(fire|water|ice|earth)/i, "elemental_control"],
  [/energy[ _-]?(projection|blast|beam)|optic[ _-]?blast|eye[ _-]?beam/i, "energy_projection"],

  // Support
  [/healing[ _-]?(touch|hands?)|laying[ _-]?on[ _-]?hands/i,    "healing_touch"],

  // Metaphysical
  [/time[ _-]?(stop|control|slow|rewind)|chrono[ _-]?walk/i,    "time_control"],
  [/reality[ _-]?(warp|bend)|cosmic[ _-]?awareness/i,           "reality_warp"],
];

export function inferPowerType(name = "", meta = null) {
  if (meta && typeof meta === "object" && meta.amorphous === true) {
    return { power: "amorphous", category: "amorphous" };
  }
  for (const [rx, key] of POWER_NAME_TO_KEY) {
    if (rx.test(name)) return { power: key, category: POWER_TYPE_INFO[key].category };
  }
  return { power: null, category: null };
}

// ─────────────────────────────────────────────────────────────────────────
// SKILLS — non-magical learned abilities
// ─────────────────────────────────────────────────────────────────────────
export const SKILL_TYPE_INFO = Object.freeze({
  combat:      { trainable: true },   // weapon mastery, martial forms
  movement:    { trainable: true },   // parkour, swim, climb, run
  crafting:    { trainable: true },   // forge, alchemy, smithing, cook
  social:      { trainable: true },   // persuade, intimidate, perform
  perception:  { trainable: true },   // observe, track, deduce
  survival:    { trainable: true },   // forage, shelter, fire-craft
  magical:     { trainable: true },   // spellcraft, glyph-comp
  mental:      { trainable: true },   // memory, focus, recall
  performance: { trainable: true },   // music, dance, theatre
  technical:   { trainable: true },   // hack, lockpick, engineer
  amorphous:   { trainable: true, amorphous: true },
});

const SKILL_NAME_TO_KEY = [
  // Magical first (so "spellcraft" hits magical, not "craft" → crafting).
  [/spellcraft|sorcer|witch|wizard|magic[ _-]?theory|glyph/i, "magical"],
  [/combat|martial|fight|brawl|swords?manship|gunner/i, "combat"],
  [/parkour|climb|swim|sprint|tumbl|free[ _-]?run/i,    "movement"],
  [/forge|craft|smith|alchemy|tailor|cook|brew/i,       "crafting"],
  [/persua|intimid|leader|barter|negotia|charm/i,       "social"],
  [/observ|notice|track|deduc|investig|search/i,        "perception"],
  [/surviv|forag|wilderness|hunt|trapper/i,             "survival"],
  [/memory|recall|focus|concentrat|meditat/i,           "mental"],
  [/music|dance|theatre|perform|sing|instrument/i,      "performance"],
  [/hack|lockpick|engineer|tinker|electronic/i,         "technical"],
];

export function inferSkillType(name = "", meta = null) {
  if (meta && typeof meta === "object" && meta.amorphous === true) {
    return { skill: "amorphous" };
  }
  for (const [rx, key] of SKILL_NAME_TO_KEY) {
    if (rx.test(name)) return { skill: key };
  }
  return { skill: null };
}

// ─────────────────────────────────────────────────────────────────────────
// Convenience: lookup by key (returns metadata row, null if not registered)
// ─────────────────────────────────────────────────────────────────────────
export function getElementInfo(key)     { return key && ELEMENT_INFO[key]     ? ELEMENT_INFO[key]     : null; }
export function getSpellSchoolInfo(key) { return key && SPELL_SCHOOL_INFO[key] ? SPELL_SCHOOL_INFO[key] : null; }
export function getPowerTypeInfo(key)   { return key && POWER_TYPE_INFO[key]   ? POWER_TYPE_INFO[key]   : null; }
export function getSkillTypeInfo(key)   { return key && SKILL_TYPE_INFO[key]   ? SKILL_TYPE_INFO[key]   : null; }
