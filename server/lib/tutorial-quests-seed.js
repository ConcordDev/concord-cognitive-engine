// server/lib/tutorial-quests-seed.js
//
// Phase 13 follow-on — onboarding quest seeder.
//
// Found in playtest: a new player has no idea how to grow. The starter
// combat skill (Basic Strike) is granted automatically, but nothing
// tells the player they can author / evolve / publish their own skills,
// and nothing walks them through the substrate's growth mechanics.
//
// This seeder adds tutor NPCs to concordia-hub + a chain of onboarding
// quests that teaches the player the load-bearing primitives:
//   1. Forge Your First Skill         — author a custom skill DTU
//   2. Cite Another's Work            — first citation cascade event
//   3. Earn Your First Concord Coin   — first economic event
//
// These quests target the substrate's actual macros (skill.create,
// dtu.cite, etc.) so completion is a real engagement with the system,
// not a checklist click. The tutor NPC is conscious — an Agent of the
// Sovereign who teaches arrivals their first steps.
//
// Idempotent — re-runs are no-ops.

const TUTOR_NPC = {
  id: "first_teacher_arwen",
  world_id: "concordia-hub",
  archetype: "scholar",
  body_type: "humanoid",
  universe_type: "standard",
  faction: "sovereign_teachers",
  is_conscious: 1,        // Agent of the Sovereign — sovereign_protected
  is_immortal: 1,
  quest_giver: 1,
  level: 10,
  hp: 200,
  position: { x: 802, y: 0, z: 996 }, // just outside The Wanderer's Rest
  state: {
    name: "Arwen Firstteacher",
    title: "Teacher of First Arrivals",
    description: "An Agent of the Sovereign who meets every new arrival at The Wanderer's Rest. She does not teach combat. She teaches the substrate.",
  },
};

const TUTORIAL_QUESTS = [
  {
    id: "tutorial_forge_first_skill",
    title: "Forge Your First Skill",
    description: "Arwen Firstteacher will teach you to author a skill DTU of your own. Every skill in Concordia is an owned thing — yours forever, citable by others, earning you royalties when descendants build on it. Speak to Arwen, then use the skill_evolution.preview macro on your Basic Strike to see what a new variant could be, and skill_evolution.commit to make it real.",
    objectives: [
      { kind: "talk_to", target: "first_teacher_arwen", description: "Speak to Arwen Firstteacher at The Wanderer's Rest" },
      { kind: "macro_invoke", target: "skill_evolution.preview", description: "Preview a variant of your Basic Strike" },
      { kind: "macro_invoke", target: "skill_evolution.commit", description: "Commit your first authored skill" },
    ],
    reward: { cc: 5, xp: 100 },
  },
  {
    id: "tutorial_cite_another",
    title: "Cite Another's Work",
    description: "All knowledge in Concordia builds on other knowledge — this is the cascade that pays creators perpetually. Find a public DTU that helped you understand something, and cite it. The original author will earn from your citation as long as your work is read or cited in turn.",
    objectives: [
      { kind: "talk_to", target: "first_teacher_arwen", description: "Return to Arwen for the next lesson" },
      { kind: "macro_invoke", target: "dtu.cite", description: "Cite a public DTU created by someone else" },
    ],
    reward: { cc: 5, xp: 100 },
  },
  {
    id: "tutorial_first_payout",
    title: "Earn Your First Concord Coin",
    description: "Your work has value in Concordia from the moment it lands. Publish a DTU you authored — a thought, a recipe, a small skill, anything — and list it on the marketplace at any price. When someone cites or buys it, you earn. Even an NPC might find it useful. The platform takes 5%, you keep the rest, and royalties flow to you across generations.",
    objectives: [
      { kind: "talk_to", target: "first_teacher_arwen", description: "Tell Arwen you are ready to publish" },
      { kind: "macro_invoke", target: "marketplace.list", description: "List one of your DTUs on the marketplace" },
    ],
    reward: { cc: 10, xp: 200 },
  },
];

function safeGet(db, sql, params) {
  try { return db.prepare(sql).get(...params); } catch { return null; }
}

export function seedTutorialContent(db) {
  if (!db) return { ok: false, reason: "no_db" };
  let npcInserted = 0, questsInserted = 0;

  // 1) Tutor NPC
  const existing = safeGet(db, "SELECT id FROM world_npcs WHERE id = ?", [TUTOR_NPC.id]);
  if (!existing) {
    try {
      db.prepare(`INSERT INTO world_npcs
        (id, world_id, npc_type, archetype, body_type, universe_type, faction,
         is_conscious, is_immortal, quest_giver, level, current_hp, max_hp,
         spawn_location, current_location, state)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          TUTOR_NPC.id, TUTOR_NPC.world_id,
          TUTOR_NPC.archetype, TUTOR_NPC.archetype, TUTOR_NPC.body_type, TUTOR_NPC.universe_type, TUTOR_NPC.faction,
          TUTOR_NPC.is_conscious, TUTOR_NPC.is_immortal, TUTOR_NPC.quest_giver,
          TUTOR_NPC.level, TUTOR_NPC.hp, TUTOR_NPC.hp,
          JSON.stringify(TUTOR_NPC.position), JSON.stringify(TUTOR_NPC.position),
          JSON.stringify(TUTOR_NPC.state),
        );
      npcInserted = 1;
    } catch { /* lazy table create may not have all columns; safe no-op */ }
  }

  // 2) Tutorial quests — authored against concordia-hub, given by Arwen
  for (const q of TUTORIAL_QUESTS) {
    const exists = safeGet(db, "SELECT id FROM world_quests WHERE id = ?", [q.id]);
    if (exists) continue;
    try {
      db.prepare(`INSERT INTO world_quests
        (id, world_id, giver_npc_id, title, description, objectives_json, reward_json, status)
        VALUES (?,?,?,?,?,?,?,?)`).run(
          q.id, TUTOR_NPC.world_id, TUTOR_NPC.id,
          q.title, q.description,
          JSON.stringify(q.objectives),
          JSON.stringify(q.reward),
          "available",
        );
      questsInserted++;
    } catch { /* row insert silent — table shape varies by deploy */ }
  }

  return { ok: true, npcInserted, questsInserted };
}
