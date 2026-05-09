// server/lib/skill-interaction.js
// Skill evolution, mixing, and hybrid creation via subconscious brain.

import crypto from "crypto";

/**
 * Detect when an actor uses 2+ skills together and evaluate hybrid potential.
 *
 * @param {object} actor  { id, worldId }
 * @param {object[]} skillsUsed  array of DTU rows
 * @param {object} context  { worldId, challengeId?, targetId? }
 * @param {import('better-sqlite3').Database} db
 * @param {Function} selectBrain
 * @returns {Promise<object|null>}  created hybrid DTU or null
 */
export async function detectSkillInteraction(actor, skillsUsed, context, db, selectBrain) {
  if (skillsUsed.length < 2) return null;

  const key = skillsUsed.map(s => s.id).sort().join("+");
  if (hasCombined(actor.id, key, db)) return null;

  const evaluation = await evaluateHybridPotential(actor, skillsUsed, context, selectBrain);
  if (!evaluation?.viable) return null;

  return createHybridCandidate(actor, skillsUsed, evaluation, context, db, selectBrain);
}

/**
 * Check whether this actor has already produced a hybrid from this skill combination.
 * @param {string} actorId
 * @param {string} combinationKey  sorted skill IDs joined with "+"
 * @param {import('better-sqlite3').Database} db
 * @returns {boolean}
 */
export function hasCombined(actorId, combinationKey, db) {
  try {
    const result = db.prepare(`
      SELECT id FROM dtus
      WHERE creator_id = ?
        AND type = 'skill'
        AND json_extract(content, '$.hybridKey') = ?
      LIMIT 1
    `).get(actorId, combinationKey);
    return Boolean(result);
  } catch {
    return false;
  }
}

/**
 * Ask the subconscious brain whether a hybrid is viable.
 * @param {object} actor
 * @param {object[]} skills
 * @param {object} context
 * @param {Function} selectBrain
 * @returns {Promise<{ viable: boolean, noveltyScore: number, rationale: string }|null>}
 */
export async function evaluateHybridPotential(actor, skills, context, selectBrain) {
  try {
    const { handle } = await selectBrain("subconscious", {
      brainOverride: "subconscious",
      callerId: "concordia:hybrid-evaluation",
    });

    const prompt = `An actor in world "${context.worldId}" is using multiple skills simultaneously.

Skills used:
${skills.map(s => `- ${s.title}: ${s.content}`).join('\n')}

Evaluate whether these skills could combine into a novel hybrid skill.
Return JSON only:
{
  "viable": true/false,
  "noveltyScore": <0.0–1.0>,
  "rationale": "<1 sentence explaining why or why not>"
}`;

    const raw   = await handle.generate(prompt);
    const match = raw.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  } catch {
    return null;
  }
}

/**
 * Generate and persist a hybrid skill DTU.
 * Awards hybrid_contribution XP to each parent skill.
 *
 * @param {object} actor
 * @param {object[]} parentSkills
 * @param {object} evaluation
 * @param {object} context
 * @param {import('better-sqlite3').Database} db
 * @param {Function} selectBrain
 * @returns {Promise<object>}  new hybrid DTU row
 */
export async function createHybridCandidate(actor, parentSkills, evaluation, context, db, selectBrain) {
  let hybridSpec;

  try {
    const { handle } = await selectBrain("subconscious", {
      brainOverride: "subconscious",
      callerId: "concordia:hybrid-creation",
    });

    const prompt = `Create a hybrid skill from these parent skills in world "${context.worldId}".

Parents:
${parentSkills.map(s => `- ${s.title}`).join('\n')}

Rationale: ${evaluation.rationale}

Return JSON only:
{
  "title": "<hybrid skill name>",
  "content": {
    "domain": "<primary domain>",
    "description": "<2 sentences>",
    "parentSkills": ${JSON.stringify(parentSkills.map(s => s.id))}
  }
}`;

    const raw   = await handle.generate(prompt);
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) hybridSpec = JSON.parse(match[0]);
  } catch {
    // fallback spec
  }

  if (!hybridSpec) {
    hybridSpec = {
      title:   `${parentSkills[0].title}+${parentSkills[1].title}`,
      content: {
        domain:       "hybrid",
        description:  `A fusion of ${parentSkills.map(s => s.title).join(" and ")}.`,
        parentSkills: parentSkills.map(s => s.id),
      },
    };
  }

  // Embed the combination key to prevent re-creation
  const combinationKey = parentSkills.map(s => s.id).sort().join("+");
  hybridSpec.content.hybridKey = combinationKey;

  const newId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO dtus
      (id, type, title, content, creator_id, world_id, lineage, skill_level, total_experience, created_at)
    VALUES (?, 'skill', ?, ?, ?, ?, ?, 1.0, 0, unixepoch())
  `).run(
    newId,
    hybridSpec.title,
    JSON.stringify(hybridSpec.content),
    actor.id,
    context.worldId || "concordia-hub",
    JSON.stringify(parentSkills.map(s => s.id)),
  );

  // Award hybrid_contribution XP to each parent
  try {
    const { awardExperience } = await import("./skill-progression.js");
    for (const parent of parentSkills) {
      await awardExperience(
        parent,
        "hybrid_contribution",
        { worldId: context.worldId, userId: actor.id },
        db,
      );
    }
  } catch (_e) { /* non-fatal */ }

  // TODO: project explicit columns (auto-fix suggestion)

  const hybrid = db.prepare("SELECT * FROM dtus WHERE id = ?").get(newId);

  // Diffuse the hybrid (Phase 23)
  try {
    const { diffuseHybrid } = await import("./substrate-diffusion.js");
    await diffuseHybrid(hybrid, context.worldId, db);
  } catch (_e) { /* substrate-diffusion may not yet be loaded */ }

  return hybrid;
}

/**
 * When an NPC observes a skill being used, it may attempt to adopt it.
 * Delegates to npc-behaviors.js.
 *
 * @param {object} npc
 * @param {object} observedSkillUse
 * @param {import('better-sqlite3').Database} db
 * @param {Function} selectBrain
 */
export async function npcObserveSkillUse(npc, observedSkillUse, db, selectBrain) {
  const { npcObserveSkillUse: observe } = await import("./npc-behaviors.js");
  return observe(npc, observedSkillUse, db, selectBrain);
}
