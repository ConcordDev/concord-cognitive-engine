// server/lib/npc-behaviors.js
// Discrete NPC behaviour actions called from NPCAgent.tick().

import crypto from "crypto";

/**
 * Multi-tick structure building. On completion emits a creation DTU.
 * @param {import('./npc-simulator.js').NPCAgent} npc
 * @param {string} structureType
 * @param {{ x: number, y: number, z?: number }} location
 * @param {import('better-sqlite3').Database} db
 */
export async function buildStructure(npc, structureType, location, db) {
  const state = npc.state;
  state.buildProgress = (state.buildProgress || 0) + 0.2;

  if (state.buildProgress >= 1.0) {
    state.buildProgress = 0;
    state.buildTarget   = null;

    const creationId = crypto.randomUUID();
    try {
      db.prepare(`
        INSERT INTO dtus (id, type, title, content, creator_id, world_id, created_at)
        VALUES (?, 'concordia_creation', ?, ?, ?, ?, unixepoch())
      `).run(
        creationId,
        `${npc.npcType} ${structureType}`,
        JSON.stringify({ structureType, location, builtBy: npc.id }),
        npc.id,
        npc.worldId,
      );
    } catch (_e) {
      // dtus table schema may vary; non-fatal
    }
  }
}

/**
 * Practice a skill, awarding experience via skill-progression when available.
 * @param {import('./npc-simulator.js').NPCAgent} npc
 * @param {string} skillId
 * @param {import('better-sqlite3').Database} db
 */
export async function practiceSkill(npc, skillId, db) {
  npc.state.practiceCount = (npc.state.practiceCount || 0) + 1;

  // Dynamically pull skill-progression if it has been initialised
  try {
    const { awardExperience } = await import("./skill-progression.js");
    const skill = db.prepare("SELECT * FROM dtus WHERE id = ?").get(skillId);
    if (skill) {
      await awardExperience(skill, "practice", { worldId: npc.worldId, npcId: npc.id }, db);
    }
  } catch (_e) {
    // skill-progression may not yet be seeded; safe to skip
  }
}

/**
 * Find the highest-level skill practitioners in a world for a given domain.
 * @param {string} worldId
 * @param {string} skillDomain
 * @param {import('better-sqlite3').Database} db
 * @returns {object[]}
 */
export function findMastersInWorld(worldId, skillDomain, db) {
  return db.prepare(`
    SELECT n.id, n.npc_type, n.state, d.id as skill_id, d.skill_level
    FROM world_npcs n
    JOIN dtus d ON d.creator_id = n.id AND d.type = 'skill'
    WHERE n.world_id = ?
      AND json_extract(d.content, '$.domain') = ?
    ORDER BY d.skill_level DESC
    LIMIT 10
  `).all(worldId, skillDomain);
}

/**
 * Evaluate a nearby creation and record the NPC's reaction.
 * Called from NPCAgent.tick() when a concordia_creation DTU is nearby.
 * @param {import('./npc-simulator.js').NPCAgent} npc
 * @param {object} creation  DTU row
 * @param {import('better-sqlite3').Database} db
 * @param {Function} selectBrain  from inference/router.js
 */
export async function npcEvaluateNearbyCreation(npc, creation, db, selectBrain) {
  const alreadyEvaluated = (npc.state.evaluatedCreations || []).includes(creation.id);
  if (alreadyEvaluated) return;

  let reaction = "ignore";

  try {
    const { handle } = await selectBrain("subconscious", {
      brainOverride: "subconscious",
      callerId: "world:npc:evaluate-creation",
    });

    const prompt = `NPC profile: ${JSON.stringify({ type: npc.npcType, needs: npc.needs })}
Creation: ${JSON.stringify({ title: creation.title, content: creation.content })}
World: ${npc.worldId}

Respond with a single JSON object: { "reaction": "<ignore|claim|use|admire|build_nearby|modify>", "reason": "<short string>" }`;

    const raw = await handle.generate(prompt);
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) reaction = JSON.parse(match[0]).reaction || "ignore";
  } catch (_e) {
    // brain unavailable — fallback to ignore
  }

  npc.state.evaluatedCreations = [...(npc.state.evaluatedCreations || []), creation.id];

  // Persist updated NPC state
  db.prepare("UPDATE world_npcs SET state = ? WHERE id = ?").run(
    JSON.stringify(npc.state),
    npc.id,
  );
}

/**
 * Called when an NPC observes a skill being used nearby.
 * Stores the observation and may trigger adoption evaluation.
 * @param {import('./npc-simulator.js').NPCAgent} npc
 * @param {object} observedSkillUse  { skillId, skillTitle, userId, context }
 * @param {import('better-sqlite3').Database} db
 * @param {Function} selectBrain
 */
export async function npcObserveSkillUse(npc, observedSkillUse, db, selectBrain) {
  const observations = npc.state.observations || [];
  observations.push({ ...observedSkillUse, observedAt: Date.now() });
  // Keep last 20 observations
  npc.state.observations = observations.slice(-20);

  if (_shouldAttemptAdoption(npc, observedSkillUse.skillId)) {
    await npcAttemptSkillAdoption(npc, observedSkillUse, db, selectBrain);
  }
}

function _shouldAttemptAdoption(npc, skillId) {
  const observations = (npc.state.observations || []).filter(o => o.skillId === skillId);
  return observations.length >= 3 && !(npc.state.adoptedSkills || []).includes(skillId);
}

/**
 * NPC attempts to adopt an observed skill, adapting it to the world substrate.
 */
async function npcAttemptSkillAdoption(npc, observedSkillUse, db, selectBrain) {
  try {
    const { handle } = await selectBrain("subconscious", {
      brainOverride: "subconscious",
      callerId: "world:npc:skill-adoption",
    });

    const prompt = `NPC profile: ${JSON.stringify({ type: npc.npcType, worldId: npc.worldId })}
Observed skill: ${JSON.stringify(observedSkillUse)}

Adapt this skill to the NPC's substrate and capabilities. Return JSON:
{ "title": "<adapted skill name>", "content": { "domain": "<domain>", "description": "<short>" }, "viable": true/false }`;

    const raw = await handle.generate(prompt);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return;

    const parsed = JSON.parse(match[0]);
    if (!parsed.viable) return;

    const newSkillId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO dtus (id, type, title, content, creator_id, world_id, created_at)
      VALUES (?, 'skill', ?, ?, ?, ?, unixepoch())
    `).run(
      newSkillId,
      parsed.title,
      JSON.stringify(parsed.content),
      npc.id,
      npc.worldId,
    );

    npc.state.adoptedSkills = [...(npc.state.adoptedSkills || []), observedSkillUse.skillId];
    db.prepare("UPDATE world_npcs SET state = ? WHERE id = ?").run(
      JSON.stringify(npc.state),
      npc.id,
    );
  } catch (_e) {
    // non-fatal
  }
}
