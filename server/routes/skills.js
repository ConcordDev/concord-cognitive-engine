/**
 * Skills Routes — Anthropic skill import/export for emergent agents.
 *
 * Mounted at /api/skills
 */

import { Router } from "express";
import path from "path";
import fs from "fs";
import { asyncHandler } from "../lib/async-handler.js";
import {
  importAnthropicSkill,
  importAnthropicSkillDir,
  exportToAnthropicFormat,
  writeSkillToRegistry,
} from "../lib/skills/anthropic-skills-adapter.js";

export default function createSkillsRouter({ requireAuth, DATA_DIR } = {}) {
  const router = Router();
  const auth = requireAuth ? requireAuth() : (_req, _res, next) => next();

  const skillsBaseDir = DATA_DIR
    ? path.join(DATA_DIR, "skills")
    : path.join(process.cwd(), "data", "skills");

  // GET /api/skills/export/:emergentId — export an emergent's skills in Anthropic format
  router.get("/export/:emergentId", asyncHandler(async (req, res) => {
    const skillsDir = path.join(skillsBaseDir, req.params.emergentId);
    const skillPath = path.join(skillsDir, "skills.md");
    if (!fs.existsSync(skillPath)) {
      return res.status(404).json({ ok: false, error: "No skills found for this emergent" });
    }
    const exported = exportToAnthropicFormat(skillPath);
    res.json({ ok: true, exported });
  }));

  // POST /api/skills/import — import a skill from an uploaded markdown path
  router.post("/import", auth, asyncHandler(async (req, res) => {
    const { skillPath, emergentId } = req.body;
    if (!skillPath) return res.status(400).json({ ok: false, error: "skillPath required" });
    const skill = importAnthropicSkill(skillPath);
    if (emergentId) {
      const targetDir = path.join(skillsBaseDir, emergentId);
      fs.mkdirSync(targetDir, { recursive: true });
      writeSkillToRegistry(skill, targetDir);
    }
    res.json({ ok: true, skill });
  }));

  // POST /api/skills/import-dir — bulk import from a directory
  router.post("/import-dir", auth, asyncHandler(async (req, res) => {
    const { dir, emergentId } = req.body;
    if (!dir) return res.status(400).json({ ok: false, error: "dir required" });
    const skills = importAnthropicSkillDir(dir);
    if (emergentId && skills.length > 0) {
      const targetDir = path.join(skillsBaseDir, emergentId);
      fs.mkdirSync(targetDir, { recursive: true });
      for (const skill of skills) writeSkillToRegistry(skill, targetDir);
    }
    res.json({ ok: true, count: skills.length, skills });
  }));

  return router;
}
