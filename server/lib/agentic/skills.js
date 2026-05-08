// @sync-fs-ok: skill registry boot-loads frontmatter; file count is small + bounded
// server/lib/agentic/skills.js
// Skill registry loader — reads EMERGENT.md files from the skills/ directory.
// Eager skills load frontmatter at startup. On-demand skills load full content when called.

import fs from "node:fs";
import path from "node:path";

const SKILLS_ROOT = path.resolve(process.cwd(), "skills");
const FRONTMATTER_PATTERN = /^---\n([\s\S]+?)\n---/;

/**
 * Parse EMERGENT.md frontmatter into a plain object.
 * Supports simple key: value pairs (no nested YAML).
 */
function parseFrontmatter(content) {
  const match = content.match(FRONTMATTER_PATTERN);
  if (!match) return {};
  const meta = {};
  for (const line of match[1].split("\n")) {
    const [key, ...rest] = line.split(":");
    if (key?.trim()) meta[key.trim()] = rest.join(":").trim();
  }
  return meta;
}

/**
 * Walk a directory recursively and find all EMERGENT.md files.
 */
function findSkillFiles(dir) {
  const results = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) results.push(...findSkillFiles(fullPath));
      else if (entry.name === "EMERGENT.md") results.push(fullPath);
    }
  } catch { /* directory may not exist */ }
  return results;
}

class SkillRegistry {
  constructor() {
    this.eagerSkills = new Map();   // name → frontmatter (pre-loaded)
    this.skillPaths = new Map();    // name → file path
    this._initialized = false;
  }

  /**
   * Initialize the registry by scanning the skills/ directory.
   * Call once at server startup.
   */
  async initialize() {
    if (this._initialized) return;
    this._initialized = true;

    const files = findSkillFiles(SKILLS_ROOT);
    for (const file of files) {
      try {
        const content = fs.readFileSync(file, "utf-8");
        const meta = parseFrontmatter(content);
        if (!meta.name) continue;

        this.skillPaths.set(meta.name, file);

        if (meta.loads === "eager" || !meta.loads) {
          this.eagerSkills.set(meta.name, { ...meta, _path: file });
        }
      } catch { /* skip unreadable files */ }
    }
  }

  /**
   * Load the full content of a skill by name.
   * @param {string} skillName
   * @returns {Promise<{meta: object, content: string} | null>}
   */
  async loadFull(skillName) {
    const filePath = this.skillPaths.get(skillName);
    if (!filePath) return null;
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const meta = parseFrontmatter(raw);
      const content = raw.replace(FRONTMATTER_PATTERN, "").trim();
      return { meta, content };
    } catch { return null; }
  }

  /**
   * Describe available skills for a given scope (for injection into prompts).
   * @param {string} [scope] - optional filter ('core', 'domain', 'user')
   * @returns {string}
   */
  describeAvailable(scope) {
    const skills = [...this.eagerSkills.values()].filter(s => {
      if (!scope) return true;
      const skillPath = s._path || "";
      return skillPath.includes(`/${scope}/`);
    });

    if (!skills.length) return "";
    return "Available skills:\n" + skills.map(s => `- ${s.name}: ${s.description || ""}`).join("\n");
  }

  /**
   * Get skill count and names by category.
   */
  stats() {
    return {
      total: this.skillPaths.size,
      eager: this.eagerSkills.size,
      names: [...this.skillPaths.keys()],
    };
  }

  /**
   * Alias for initialize() — backward compat with server.js call sites.
   */
  scan() {
    return this.initialize();
  }
}

// Singleton registry — shared across the process
export const skillRegistry = new SkillRegistry();
export { SkillRegistry };
