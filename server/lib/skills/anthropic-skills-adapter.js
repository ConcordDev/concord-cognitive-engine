// @sync-fs-ok: skill loader runs at boot and on first invocation; small file count
// server/lib/skills/anthropic-skills-adapter.js
// Bidirectional adapter between Anthropic Agent Skills format (SKILL.md)
// and Concord's EMERGENT.md format.
//
// Anthropic SKILL.md frontmatter fields:
//   name, description, when-to-use (optional), category (optional), loads (optional)
//   Plus optional: inputSchema, outputSchema, examples
//
// Concord EMERGENT.md frontmatter fields:
//   name, description, when_to_use, loads (eager|on-demand), category (core|domain|user)

import fs from "node:fs";
import path from "node:path";

const FRONTMATTER_PATTERN = /^---\n([\s\S]+?)\n---\n?([\s\S]*)$/;

/**
 * Parse SKILL.md or EMERGENT.md frontmatter.
 * Handles both simple `key: value` and basic quoted strings.
 */
function parseFrontmatter(text) {
  const match = text.match(FRONTMATTER_PATTERN);
  if (!match) return { meta: {}, body: text };
  const meta = {};
  for (const line of match[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim().replace(/^["']|["']$/g, "");
    if (key) meta[key] = val;
  }
  return { meta, body: (match[2] || "").trim() };
}

/**
 * Serialize frontmatter back to YAML-like block.
 */
function serializeFrontmatter(meta) {
  const lines = Object.entries(meta)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---`;
}

/**
 * Import an Anthropic Agent Skill from a SKILL.md file path.
 * Returns an EMERGENT.md-compatible skill object ready for registration.
 *
 * @param {string} skillMdPath - absolute path to SKILL.md file
 * @returns {{ name: string, description: string, emergentMd: string, meta: object } | null}
 */
export function importAnthropicSkill(skillMdPath) {
  let text;
  try {
    text = fs.readFileSync(skillMdPath, "utf-8");
  } catch {
    return null;
  }

  const { meta, body } = parseFrontmatter(text);

  if (!meta.name) return null;

  // Map Anthropic fields → Concord fields
  const concordMeta = {
    name: meta.name,
    description: meta.description || meta.name,
    when_to_use: meta["when-to-use"] || meta.when_to_use || meta.description || "",
    loads: meta.loads || "eager",
    category: meta.category || "domain",
    source: "anthropic_import",
  };

  // Compose EMERGENT.md content
  const emergentMd = `${serializeFrontmatter(concordMeta)}\n\n${body}`.trim();

  return {
    name: concordMeta.name,
    description: concordMeta.description,
    emergentMd,
    meta: concordMeta,
  };
}

/**
 * Import an Anthropic Skill from a directory containing SKILL.md.
 *
 * @param {string} skillDir - directory with SKILL.md inside
 * @returns {object | null}
 */
export function importAnthropicSkillDir(skillDir) {
  const skillMdPath = path.join(skillDir, "SKILL.md");
  if (!fs.existsSync(skillMdPath)) return null;
  return importAnthropicSkill(skillMdPath);
}

/**
 * Export a Concord EMERGENT.md skill to Anthropic SKILL.md format.
 *
 * @param {string} emergentMdPath - absolute path to EMERGENT.md
 * @returns {string | null} - SKILL.md text, or null on failure
 */
export function exportToAnthropicFormat(emergentMdPath) {
  let text;
  try {
    text = fs.readFileSync(emergentMdPath, "utf-8");
  } catch {
    return null;
  }

  const { meta, body } = parseFrontmatter(text);
  if (!meta.name) return null;

  const anthropicMeta = {
    name: meta.name,
    description: meta.description || "",
    ...(meta.when_to_use ? { "when-to-use": meta.when_to_use } : {}),
    ...(meta.category ? { category: meta.category } : {}),
    ...(meta.loads ? { loads: meta.loads } : {}),
  };

  return `${serializeFrontmatter(anthropicMeta)}\n\n${body}`.trim();
}

/**
 * Bulk-import all Anthropic skills from a directory tree.
 * Looks for SKILL.md files recursively.
 *
 * @param {string} rootDir
 * @returns {Array<{name, description, emergentMd, meta}>}
 */
export function importAnthropicSkillTree(rootDir) {
  const results = [];
  try {
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        results.push(...importAnthropicSkillTree(full));
      } else if (entry.name === "SKILL.md") {
        const skill = importAnthropicSkill(full);
        if (skill) results.push(skill);
      }
    }
  } catch { /* dir not found or unreadable */ }
  return results;
}

/**
 * Write an imported Anthropic skill as EMERGENT.md into the Concord skills directory.
 * Creates a subdirectory named after the skill.
 *
 * @param {string} skill - result from importAnthropicSkill or importAnthropicSkillDir
 * @param {string} targetDir - skills root (default: skills/imported/)
 * @returns {string} path to written EMERGENT.md
 */
export function writeSkillToRegistry(skill, targetDir) {
  if (typeof targetDir !== "string" || !targetDir) {
    throw new Error("writeSkillToRegistry: targetDir is required");
  }
  // Tighten safeName: strip path separators, then collapse anything not in
  // [a-z0-9_-] to a single dash. Reject empty / dot-only names outright.
  const rawName = String(skill?.name || "").replace(/[\\/]/g, "");
  const safeName = rawName.replace(/[^a-z0-9-_]/gi, "-").toLowerCase();
  if (!safeName || /^[.-]+$/.test(safeName)) {
    throw new Error("writeSkillToRegistry: skill.name resolves to an unsafe filename");
  }

  // Resolve to absolute paths and assert the output stays under targetDir.
  // path.join with attacker-controlled segments cannot prevent traversal on
  // its own; this containment check is what makes the operation CodeQL-clean
  // and actually safe.
  const rootAbs = path.resolve(targetDir);
  const skillDirAbs = path.resolve(rootAbs, safeName);
  if (!skillDirAbs.startsWith(rootAbs + path.sep) && skillDirAbs !== rootAbs) {
    throw new Error("writeSkillToRegistry: resolved skill dir escaped target root");
  }
  const outPathAbs = path.resolve(skillDirAbs, "EMERGENT.md");
  if (!outPathAbs.startsWith(skillDirAbs + path.sep)) {
    throw new Error("writeSkillToRegistry: resolved file escaped skill dir");
  }

  fs.mkdirSync(skillDirAbs, { recursive: true });
  fs.writeFileSync(outPathAbs, skill.emergentMd, "utf-8");
  return outPathAbs;
}
