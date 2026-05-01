// server/routes/crafting.js
// Crafting system API: recipe design, validation, execution, skill DTUs.
// Mounted at /api/crafting

import { Router } from "express";
import crypto from "node:crypto";
import {
  getPlayerSkills,
  gainSkillXP,
} from "../lib/skills/skill-engine.js";
import {
  validateDesign,
} from "../lib/crafting/recipe-validator.js";
import {
  executeCraft,
  createSkillDTU,
} from "../lib/crafting/craft-engine.js";
import {
  validateSkillQuality,
  extractBarCost,
  getSkillElement,
  SKILL_BAR_MAP,
} from "../lib/skills/skill-quality-gate.js";
import {
  checkCrossSkillUnlock,
  getOrInitPlayerBars,
  consumeResourceBar,
  regenerateResourceBars,
} from "../lib/combat/damage-calculator.js";

// ── Helper: parse rule_modulators from a world row ───────────────────────────
function _parseRules(world) {
  if (!world) return {};
  const raw = world.rule_modulators;
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

// ── Router factory ────────────────────────────────────────────────────────────

export function createCraftingRouter({ db, requireAuth }) {
  const router = Router();

  // ── POST /api/crafting/validate — preview validation (no auth required) ────
  router.post("/validate", (req, res) => {
    try {
      const { spec, worldId } = req.body;
      if (!spec) return res.status(400).json({ ok: false, error: "spec required" });

      const world = worldId
        ? db.prepare("SELECT * FROM worlds WHERE id = ?").get(worldId)
        : null;
      const worldRules = _parseRules(world);
      const worldType = world?.world_type || 'standard';

      // Get player skills if authenticated
      const userId = req.user?.id;
      const playerSkills = userId ? getPlayerSkills(db, userId) : [];

      const result = validateDesign(spec, playerSkills, worldRules, worldType);
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── POST /api/crafting/design — create a recipe DTU (auth required) ────────
  router.post("/design", requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const { spec, worldId, name } = req.body;

      if (!spec) return res.status(400).json({ ok: false, error: "spec required" });

      const world = worldId
        ? db.prepare("SELECT * FROM worlds WHERE id = ?").get(worldId)
        : null;
      const worldRules = _parseRules(world);
      const worldType = world?.world_type || 'standard';

      const playerSkills = getPlayerSkills(db, userId);
      const validation = validateDesign(spec, playerSkills, worldRules, worldType);

      if (!validation.valid) {
        return res.status(422).json({
          ok: false,
          error: "Recipe design is not valid in this world",
          errors: validation.errors,
          warnings: validation.warnings,
        });
      }

      // Create recipe DTU
      const recipeId = crypto.randomUUID();
      const recipeName = name || spec.name || `Recipe: ${spec.output_subtype || spec.output_type}`;
      const recipeData = {
        spec,
        world_type: worldType,
        resource_requirements: validation.resource_requirements,
        skill_requirements: validation.skill_requirements,
        estimated_stats: validation.estimated_stats,
        output_type: spec.output_type || 'item',
      };

      db.prepare(`
        INSERT INTO dtus (id, creator_id, type, name, data, skill_level)
        VALUES (?, ?, 'recipe', ?, ?, ?)
      `).run(
        recipeId,
        userId,
        recipeName,
        JSON.stringify(recipeData),
        0  // recipes don't have a skill_level themselves
      );

      const recipe = {
        id: recipeId,
        name: recipeName,
        data: recipeData,
      };

      res.json({ ok: true, recipe, warnings: validation.warnings });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── POST /api/crafting/execute — execute a recipe (auth required) ──────────
  router.post("/execute", requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const { recipeId, worldId } = req.body;

      if (!recipeId) return res.status(400).json({ ok: false, error: "recipeId required" });
      if (!worldId)  return res.status(400).json({ ok: false, error: "worldId required" });

      const result = executeCraft(db, userId, worldId, recipeId);
      if (!result.ok) {
        return res.status(422).json(result);
      }
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── GET /api/crafting/recipes — list player's recipe DTUs ────────────────
  router.get("/recipes", requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const recipes = db.prepare(`
        SELECT * FROM dtus
        WHERE creator_id = ? AND type = 'recipe'
        ORDER BY created_at DESC
        LIMIT 50
      `).all(userId);

      // Parse data JSON for each recipe
      const enriched = recipes.map(r => ({
        ...r,
        data: (() => { try { return JSON.parse(r.data); } catch { return r.data; } })(),
      }));

      res.json({ ok: true, recipes: enriched });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── POST /api/crafting/skills/validate-quality — quality gate check ────────
  router.post("/skills/validate-quality", (req, res) => {
    try {
      const { description, skill_type, properties } = req.body;
      if (!description) return res.status(400).json({ ok: false, error: "description required" });

      const result = validateSkillQuality(description, skill_type || 'magic', { properties });
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── POST /api/crafting/skills/design — create a spell/ability DTU ─────────
  router.post("/skills/design", requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const { spec, worldId } = req.body;

      if (!spec) return res.status(400).json({ ok: false, error: "spec required" });
      if (!worldId) return res.status(400).json({ ok: false, error: "worldId required" });

      const world = db.prepare("SELECT * FROM worlds WHERE id = ?").get(worldId);
      if (!world) return res.status(404).json({ ok: false, error: "World not found" });

      const worldType = world.world_type || 'standard';
      const skillType = spec.skill_type || spec.output_type || 'ability';

      // ── Quality gate — must pass before creating skill DTU ────────────────
      if (spec.description) {
        const qualityCheck = validateSkillQuality(spec.description, skillType, {
          properties: spec.properties || {},
        });
        if (!qualityCheck.pass) {
          return res.status(422).json({
            ok: false,
            error: "Skill description does not meet quality requirements",
            quality: qualityCheck,
          });
        }
      }

      // ── Cross-skill prerequisite check ────────────────────────────────────
      if (SKILL_BAR_MAP[skillType] === 'multi') {
        const unlock = checkCrossSkillUnlock(db, userId, skillType);
        if (!unlock.eligible) {
          return res.status(422).json({
            ok: false,
            error: `Cross-skill '${skillType}' requires higher prerequisite skills`,
            missing: unlock.missing,
          });
        }
      }

      // ── Enrich spec with bar/element data ─────────────────────────────────
      const barCost = extractBarCost(spec.description || '', skillType, spec.properties || {});
      const element = getSkillElement(spec.description || '', skillType);
      const enrichedSpec = { ...spec, ...barCost, element };

      const result = createSkillDTU(db, userId, worldId, worldType, enrichedSpec);

      if (!result.ok) {
        return res.status(422).json(result);
      }
      res.json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── GET /api/crafting/skills — player skill levels + skill DTUs ───────────
  router.get("/skills", requireAuth, (req, res) => {
    try {
      const userId = req.user.id;

      const skillLevels = db.prepare(
        "SELECT * FROM player_skill_levels WHERE user_id = ? ORDER BY skill_type, level DESC"
      ).all(userId);

      const skillDTUs = db.prepare(`
        SELECT * FROM dtus
        WHERE creator_id = ? AND type IN ('spell', 'ability')
        ORDER BY created_at DESC
        LIMIT 100
      `).all(userId).map(d => ({
        ...d,
        data: (() => { try { return JSON.parse(d.data); } catch { return d.data; } })(),
      }));

      res.json({ ok: true, skillLevels, skillDTUs });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── GET /api/crafting/skills/cross-unlock/:skillType — check prereqs ────────
  router.get("/skills/cross-unlock/:skillType", requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const { skillType } = req.params;
      const result = checkCrossSkillUnlock(db, userId, skillType);
      res.json({ ok: true, skillType, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── GET /api/crafting/resource-bars/:worldId — get player resource bars ────
  router.get("/resource-bars/:worldId", requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const { worldId } = req.params;
      const bars = regenerateResourceBars(db, userId, worldId);
      res.json({ ok: true, bars });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── POST /api/crafting/skills/train — manually add XP to a skill ─────────
  router.post("/skills/train", requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const { skill_type, worldId, xp } = req.body;

      if (!skill_type) return res.status(400).json({ ok: false, error: "skill_type required" });
      if (!xp || xp <= 0) return res.status(400).json({ ok: false, error: "xp must be a positive number" });

      const world = worldId
        ? db.prepare("SELECT world_type FROM worlds WHERE id = ?").get(worldId)
        : null;
      const worldType = world?.world_type || 'standard';

      const result = gainSkillXP(db, userId, skill_type, worldType, xp);
      res.json({ ok: true, ...result, skill_type, worldType });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}

export default createCraftingRouter;
