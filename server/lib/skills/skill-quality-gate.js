// server/lib/skills/skill-quality-gate.js
// Validates that skill/spell descriptions are mechanically specific before allowing creation.
// Heuristic-based — no LLM dependency for the gate itself.

// Length cap on user-supplied descriptions / properties before any regex touches them.
// Skill descriptions are author-facing prose, never legitimately >2KB. The cap defangs
// polynomial-time ReDoS against adversarial input — every regex below runs in O(n) on
// strings ≤ MAX_DESC_LEN.
const MAX_DESC_LEN = 2000;
function clip(str) {
  if (typeof str !== "string") return "";
  return str.length > MAX_DESC_LEN ? str.slice(0, MAX_DESC_LEN) : str;
}

// ── Quality criteria ──────────────────────────────────────────────────────────

// Minimum mechanical terms that must appear based on skill category
const MECHANICAL_TERMS = {
  magic: [
    /mana/i, /\d+\s*(mana|mp)/i, /damage/i, /aoe|area|radius/i, /hand|cast|channel/i,
    /duration|second|tick/i, /cooldown/i, /range|meter|feet/i,
  ],
  physical: [
    /stamina/i, /\d+\s*(stamina|hp|health)/i, /damage/i,
    /range|melee|reach/i, /cooldown|recharge/i,
  ],
  power: [
    /bio.?power|energy/i, /\d+/i, /damage|effect/i,
    /duration|second/i,
  ],
  ranged: [
    /perception/i, /\d+\s*(meter|feet|m\b)/i, /damage/i,
    /ammo|projectile|shot/i, /accuracy|spread/i,
  ],
  cross: [
    /\d+/i, /damage|effect/i, /bar|mana|stamina|energy/i,
    /cooldown/i, /range|aoe|melee/i,
  ],
};

// Phrases that indicate vague/unacceptable descriptions
const VAGUE_PHRASES = [
  /^make .{1,30} (come out|happen|go)/i,
  /^(just|simply) (do|make|create)/i,
  /^i want .{1,30} (power|ability|skill)/i,
  /^(cool|awesome|epic|powerful) (skill|move|attack|spell)/i,
  /shoots? (fire|ice|lightning)$/i,  // too short, no mechanics
  /^super (powerful|strong|fast)/i,
];

// Required structural elements for a passing spec
const STRUCTURAL_CHECKS = {
  hasResourceBarMention: (desc) =>
    /mana|stamina|bio.?power|perception|energy/i.test(desc),
  hasDamageOrEffect: (desc) =>
    /damage|heal|stun|slow|burn|freeze|poison|paralyze|blind|silence|\d+\s*(hp|mp)/i.test(desc),
  hasNumberedValue: (desc) => /\d+/.test(desc),
  hasActivationDescription: (desc) =>
    /cast|channel|activate|swing|fire|launch|conjure|summon|leap|charge|strike|release/i.test(desc),
  hasTargetOrRange: (desc) =>
    /target|self|aoe|area|radius|range|melee|distance|feet|meter|\d+m\b/i.test(desc),
  minWordCount: (desc) => desc.trim().split(/\s+/).length >= 12,
};

// ── SKILL_BAR_MAP — which resource bar a skill type defaults to ───────────────
export const SKILL_BAR_MAP = {
  magic:       'mana',
  enchanting:  'mana',
  summoning:   'mana',
  alchemy:     'mana',
  power:       'bio_power',
  telepathy:   'bio_power',
  flight:      'bio_power',
  combat:      'stamina',
  survival:    'stamina',
  tactics:     'stamina',
  stealth:     'stamina',
  hacking:     'perception',
  technology:  'perception',
  engineering: 'perception',
  persuasion:  'perception',
  crafting:    'stamina',
  // cross-skills use multiple bars
  fire_martial: 'multi',
  tech_stealth: 'multi',
  bio_combat:   'multi',
  psi_tactics:  'multi',
  shadow_magic: 'multi',
  storm_archery:'multi',
  alchemy_bomb: 'multi',
};

// ── Cross-skill bar config ─────────────────────────────────────────────────────
export const CROSS_SKILL_BARS = {
  fire_martial: { primary: 'mana', secondary: 'stamina' },
  tech_stealth: { primary: 'perception', secondary: 'stamina' },
  bio_combat:   { primary: 'bio_power', secondary: 'stamina' },
  psi_tactics:  { primary: 'bio_power', secondary: 'perception' },
  shadow_magic: { primary: 'mana', secondary: 'stamina' },
  storm_archery:{ primary: 'mana', secondary: 'perception' },
  alchemy_bomb: { primary: 'mana', secondary: 'perception' },
};

// ── validateSkillQuality ──────────────────────────────────────────────────────

/**
 * Validate that a skill description is mechanically specific enough to create.
 *
 * @param {string} description  - The user's natural language skill description
 * @param {string} skillType    - Type bucket: 'magic'|'physical'|'power'|'ranged'|'cross'|...
 * @param {object} [opts]
 * @param {object} [opts.properties] - Structured properties the user provided (aoe_radius, range, bar_cost, etc.)
 * @returns {{ pass: boolean, score: number, errors: string[], suggestions: string[] }}
 */
export function validateSkillQuality(description, skillType, opts = {}) {
  const errors = [];
  const suggestions = [];
  const { properties = {} } = opts;

  if (!description || typeof description !== 'string') {
    return { pass: false, score: 0, errors: ['No description provided'], suggestions: ['Describe your skill in detail'] };
  }

  const desc = clip(description).trim();

  // ── Vague phrase check ────────────────────────────────────────────────────
  for (const pat of VAGUE_PHRASES) {
    if (pat.test(desc)) {
      errors.push(`Description is too vague: "${desc.substring(0, 50)}..."`);
      suggestions.push('Be specific about mechanics: damage values, resource costs, range, and area of effect');
    }
  }

  // ── Structural checks ─────────────────────────────────────────────────────
  let structureScore = 0;
  const totalChecks = Object.keys(STRUCTURAL_CHECKS).length;

  if (!STRUCTURAL_CHECKS.minWordCount(desc)) {
    errors.push(`Description too short (${desc.split(/\s+/).length} words) — minimum 12 words required`);
    suggestions.push('Describe what the skill does, what resource it costs, and its range/area');
  } else {
    structureScore++;
  }

  if (!STRUCTURAL_CHECKS.hasResourceBarMention(desc) && !properties.resource_bar) {
    errors.push('Must specify which resource bar this skill uses (mana, stamina, bio power, or perception)');
    suggestions.push('Example: "costs 15 mana per second" or "uses 10 stamina per strike"');
  } else {
    structureScore++;
  }

  if (!STRUCTURAL_CHECKS.hasDamageOrEffect(desc)) {
    errors.push('Must specify what the skill does — damage, healing, or a status effect');
    suggestions.push('Example: "deals 8 fire damage per tick" or "heals 20 HP over 5 seconds"');
  } else {
    structureScore++;
  }

  if (!STRUCTURAL_CHECKS.hasNumberedValue(desc) && Object.keys(properties).length < 2) {
    errors.push('Must include at least one numeric value (damage, cost, range, duration, etc.)');
    suggestions.push('Example: "5 meter radius", "20 mana cost", "2 second cooldown"');
  } else {
    structureScore++;
  }

  if (!STRUCTURAL_CHECKS.hasActivationDescription(desc) && !properties.activation) {
    // Warning, not error
    suggestions.push('Consider specifying how the skill is activated (cast, channel, strike, etc.)');
  } else {
    structureScore++;
  }

  if (!STRUCTURAL_CHECKS.hasTargetOrRange(desc) && !properties.range && !properties.aoe_radius) {
    errors.push('Must specify targeting: single target, area (AoE), range, or melee');
    suggestions.push('Example: "5 meter AoE centered on caster" or "single target at melee range"');
  } else {
    structureScore++;
  }

  // ── Score ─────────────────────────────────────────────────────────────────
  const score = Math.round((structureScore / totalChecks) * 100);
  const pass = errors.length === 0 && score >= 60;

  return { pass, score, errors, suggestions };
}

// ── extractBarCost ────────────────────────────────────────────────────────────
/**
 * Extract resource bar and cost from a description or properties object.
 * Used when creating a skill DTU to populate the data.resource_bar / data.bar_cost fields.
 */
export function extractBarCost(description, skillType, properties = {}) {
  const defaultBar = SKILL_BAR_MAP[skillType] || 'stamina';
  let bar = properties.resource_bar || defaultBar;
  let cost = properties.bar_cost;

  if (!cost) {
    // Try to parse cost from description (clip first — see MAX_DESC_LEN note above)
    const clipped = clip(description);
    const manaMatch = clipped.match(/(\d+)\s*mana/i);
    const staminaMatch = clipped.match(/(\d+)\s*stamina/i);
    const bioMatch = clipped.match(/(\d+)\s*(bio.?power|energy)/i);
    const percMatch = clipped.match(/(\d+)\s*perception/i);

    if (manaMatch) { bar = 'mana'; cost = parseFloat(manaMatch[1]); }
    else if (staminaMatch) { bar = 'stamina'; cost = parseFloat(staminaMatch[1]); }
    else if (bioMatch) { bar = 'bio_power'; cost = parseFloat(bioMatch[1]); }
    else if (percMatch) { bar = 'perception'; cost = parseFloat(percMatch[1]); }
    else {
      // Default costs by bar type
      const defaults = { mana: 15, stamina: 10, bio_power: 20, perception: 12 };
      cost = defaults[bar] || 10;
    }
  }

  // Cross-skill secondary bar
  const crossConfig = CROSS_SKILL_BARS[skillType];
  if (crossConfig) {
    return {
      resource_bar: 'multi',
      bar_cost: cost,
      secondary_bar: crossConfig.secondary,
      secondary_bar_cost: Math.round(cost * 0.6),
    };
  }

  return { resource_bar: bar, bar_cost: cost };
}

// ── getSkillElementFromDescription ───────────────────────────────────────────
export function getSkillElement(description, skillType) {
  const d = clip(description).toLowerCase();
  if (/\bfire\b|flame|burn|heat/i.test(d)) return 'fire';
  if (/\bice\b|frost|freeze|cold/i.test(d)) return 'ice';
  if (/lightning|thunder|electric|shock/i.test(d)) return 'lightning';
  if (/poison|venom|toxic/i.test(d)) return 'poison';
  if (/bio|organic|cellular|mutate/i.test(d)) return 'bio';
  if (/energy|plasma|force|kinetic/i.test(d)) return 'energy';
  if (['combat', 'survival', 'tactics'].includes(skillType)) return 'physical';
  return 'none';
}
