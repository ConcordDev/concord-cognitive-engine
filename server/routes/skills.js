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

// Emergent ids are slugs: no path separators, no `..`, no leading dot.
const EMERGENT_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

function isValidEmergentId(id) {
  return typeof id === "string" && EMERGENT_ID_RE.test(id) && id !== "__proto__" && id !== "constructor" && id !== "prototype";
}

// Constrain a user-supplied path to live under `rootAbs`. Returns the resolved
// absolute path, or null if it escapes the root.
function containedPath(rootAbs, userPath) {
  if (typeof userPath !== "string" || !userPath) return null;
  const resolved = path.resolve(rootAbs, userPath);
  if (resolved !== rootAbs && !resolved.startsWith(rootAbs + path.sep)) return null;
  return resolved;
}

export default function createSkillsRouter({ requireAuth, DATA_DIR } = {}) {
  const router = Router();
  const auth = requireAuth ? requireAuth() : (_req, _res, next) => next();

  const skillsBaseDir = DATA_DIR
    ? path.join(DATA_DIR, "skills")
    : path.join(process.cwd(), "data", "skills");
  const skillsBaseAbs = path.resolve(skillsBaseDir);
  // Imports are constrained to live under a dedicated import-root so a user
  // can't ask the server to read or recurse arbitrary filesystem paths.
  const importRootAbs = path.resolve(DATA_DIR
    ? path.join(DATA_DIR, "skill-imports")
    : path.join(process.cwd(), "data", "skill-imports"));

  // GET /api/skills/export/:emergentId — export an emergent's skills in Anthropic format
  router.get("/export/:emergentId", asyncHandler(async (req, res) => {
    const { emergentId } = req.params;
    if (!isValidEmergentId(emergentId)) {
      return res.status(400).json({ ok: false, error: "invalid emergentId" });
    }
    const skillsDir = path.resolve(skillsBaseAbs, emergentId);
    if (!skillsDir.startsWith(skillsBaseAbs + path.sep)) {
      return res.status(400).json({ ok: false, error: "invalid emergentId" });
    }
    const skillPath = path.join(skillsDir, "skills.md");
    try {
      await fs.promises.access(skillPath);
    } catch {
      return res.status(404).json({ ok: false, error: "No skills found for this emergent" });
    }
    const exported = exportToAnthropicFormat(skillPath);
    res.json({ ok: true, exported });
  }));

  // POST /api/skills/import — import a skill from a markdown file inside skill-imports/
  router.post("/import", auth, asyncHandler(async (req, res) => {
    const { skillPath: requestedPath, emergentId } = req.body || {};
    if (!requestedPath) return res.status(400).json({ ok: false, error: "skillPath required" });
    const safePath = containedPath(importRootAbs, requestedPath);
    if (!safePath) return res.status(400).json({ ok: false, error: "skillPath must live inside data/skill-imports" });
    const skill = importAnthropicSkill(safePath);
    if (emergentId) {
      if (!isValidEmergentId(emergentId)) return res.status(400).json({ ok: false, error: "invalid emergentId" });
      const targetDir = path.resolve(skillsBaseAbs, emergentId);
      if (!targetDir.startsWith(skillsBaseAbs + path.sep)) {
        return res.status(400).json({ ok: false, error: "invalid emergentId" });
      }
      fs.mkdirSync(targetDir, { recursive: true });
      writeSkillToRegistry(skill, targetDir);
    }
    res.json({ ok: true, skill });
  }));

  // POST /api/skills/import-dir — bulk import from a directory inside skill-imports/
  router.post("/import-dir", auth, asyncHandler(async (req, res) => {
    const { dir: requestedDir, emergentId } = req.body || {};
    if (!requestedDir) return res.status(400).json({ ok: false, error: "dir required" });
    const safeDir = containedPath(importRootAbs, requestedDir);
    if (!safeDir) return res.status(400).json({ ok: false, error: "dir must live inside data/skill-imports" });
    const skills = importAnthropicSkillDir(safeDir);
    if (emergentId && skills.length > 0) {
      if (!isValidEmergentId(emergentId)) return res.status(400).json({ ok: false, error: "invalid emergentId" });
      const targetDir = path.resolve(skillsBaseAbs, emergentId);
      if (!targetDir.startsWith(skillsBaseAbs + path.sep)) {
        return res.status(400).json({ ok: false, error: "invalid emergentId" });
      }
      fs.mkdirSync(targetDir, { recursive: true });
      for (const skill of skills) writeSkillToRegistry(skill, targetDir);
    }
    res.json({ ok: true, count: skills.length, skills });
  }));

  return router;
}
