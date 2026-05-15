// server/routes/blueprints.js
// Convert any lens DTU into a Concordia blueprint recipe.
// Mounted at /api/blueprints.

import { Router } from "express";
import crypto from "crypto";
import { TASK_PROMPTS } from "../lib/prompt-registry.js";

const MATERIAL_IDS = [
  "stone", "clay", "wood", "sand", "iron_ore", "coal", "glass",
  "copper_wire", "rubber", "steel", "lens_crystal", "mythril_ore", "dragon_stone",
];

export default function createBlueprintsRouter({ requireAuth, db }) {
  const router = Router();
  const auth = requireAuth;
  const _userId = (req) => req.user?.id || req.headers["x-user-id"] || null;

  /**
   * POST /api/blueprints/from-dtu
   * Takes a personal locker DTU id, calls AI to generate a crafting recipe from the design,
   * then saves it back to the personal locker as a blueprint DTU.
   */
  router.post("/from-dtu", auth, async (req, res) => {
    try {
      const userId = _userId(req);
      const { dtuId } = req.body;
      if (!dtuId) return res.status(400).json({ ok: false, error: "dtuId required" });

      // Load the source DTU from personal locker
      const row = db.prepare(`SELECT * FROM personal_dtus WHERE id = ? AND user_id = ?`).get(dtuId, userId);
      if (!row) return res.status(404).json({ ok: false, error: "DTU not found in your locker" });

      // Build prompt context from the DTU's title
      const designTitle = row.title || "design";

      const { selectBrain } = await import("../lib/inference/router.js");
      const brain = selectBrain("subconscious", { callerId: "concordia:blueprint-gen" });

      const prompt = TASK_PROMPTS.blueprintCraftingRecipe({ designTitle, materialIds: MATERIAL_IDS });

      const aiRes = await brain.complete([{ role: "user", content: prompt }]);
      const raw = aiRes?.content?.[0]?.text ?? "";
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return res.status(500).json({ ok: false, error: "AI did not return valid JSON" });

      let recipe;
      try {
        recipe = JSON.parse(jsonMatch[0]);
      } catch {
        return res.status(500).json({ ok: false, error: "Failed to parse AI recipe" });
      }

      // Validate shape
      if (!Array.isArray(recipe.requiredMaterials) || typeof recipe.requiredToolTier !== "number") {
        return res.status(500).json({ ok: false, error: "Invalid recipe shape from AI" });
      }

      // Save blueprint to personal locker
      const blueprintId = crypto.randomUUID();
      const blueprintContent = JSON.stringify({
        type: "concordia_blueprint",
        sourceDtuId: dtuId,
        designTitle,
        requiredMaterials: recipe.requiredMaterials,
        requiredToolTier: recipe.requiredToolTier,
        complexityScore: recipe.complexityScore ?? 50,
        craftingSteps: recipe.craftingSteps ?? [],
        generatedAt: new Date().toISOString(),
      });

      // Store as plaintext blueprint (no encryption needed for recipes — they're game data)
      db.prepare(`
        INSERT INTO personal_dtus (id, user_id, created_at, lens_domain, content_type, title, encrypted_content, iv, auth_tag)
        VALUES (?, ?, datetime('now'), 'blueprint', 'application/json', ?, ?, ?, ?)
      `).run(
        blueprintId,
        userId,
        `Blueprint: ${designTitle}`,
        Buffer.from(blueprintContent),
        Buffer.alloc(12),
        Buffer.alloc(16),
      );

      res.status(201).json({
        ok: true,
        blueprintId,
        designTitle,
        recipe: {
          requiredMaterials: recipe.requiredMaterials,
          requiredToolTier: recipe.requiredToolTier,
          complexityScore: recipe.complexityScore ?? 50,
          craftingSteps: recipe.craftingSteps ?? [],
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  /**
   * GET /api/blueprints — list all blueprints in player's locker
   */
  router.get("/", auth, (req, res) => {
    try {
      const userId = _userId(req);
      const blueprints = db.prepare(`
        SELECT id, title, created_at FROM personal_dtus
        WHERE user_id = ? AND lens_domain = 'blueprint'
        ORDER BY created_at DESC
      `).all(userId);
      res.json({ ok: true, blueprints });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  /**
   * GET /api/blueprints/:id — load a specific blueprint's recipe
   */
  router.get("/:id", auth, (req, res) => {
    try {
      const userId = _userId(req);
      const row = db.prepare(`SELECT * FROM personal_dtus WHERE id = ? AND user_id = ? AND lens_domain = 'blueprint'`).get(req.params.id, userId);
      if (!row) return res.status(404).json({ ok: false, error: "blueprint_not_found" });

      let recipe = {};
      try {
        recipe = JSON.parse(row.encrypted_content.toString());
      } catch { /* corrupt — return empty */ }

      res.json({ ok: true, blueprint: { id: row.id, title: row.title, createdAt: row.created_at, ...recipe } });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  return router;
}
