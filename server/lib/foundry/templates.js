// @sync-fs-ok: template parse at publish/admin time, not the request hot path. Sync fs in this file is intentional and not on the user request path (audited 2026-06).
// server/lib/foundry/templates.js
//
// Foundry — game templates (Phase 6).
//
// A template is a pre-filled worldspec: a coherent starting set of
// systems with sensible configs, so a builder isn't staring at a blank
// canvas. They live as JSON in content/foundry-templates/ — same
// authored-content pattern as content/world/ and content/quests/ —
// so new templates are a file drop, no code change.
//
// foundry.create accepts a templateId and starts the new draft from
// the template's worldspec (still validated + normalized like any
// other spec, so a stale template can't corrupt anything).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// server/lib/foundry/ -> repo root -> content/foundry-templates
const TEMPLATES_DIR = path.resolve(__dirname, "../../../content/foundry-templates");

/** Parse one template file into the canonical { id, name, description, worldspec } shape. */
function parseTemplateFile(filePath) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null; // malformed template — skip, never crash the lens
  }
  const id = typeof raw.id === "string" ? raw.id : path.basename(filePath, ".json");
  if (!id || typeof raw.name !== "string") return null;
  return {
    id,
    name: raw.name,
    description: typeof raw.description === "string" ? raw.description : "",
    worldspec: {
      version: 1,
      template: id,
      theme: {
        universeType: typeof raw.universeType === "string" ? raw.universeType : "fantasy",
        displayName: raw.name,
        palette: null,
      },
      systems: Array.isArray(raw.systems) ? raw.systems : [],
      rules: Array.isArray(raw.rules) ? raw.rules : [],
    },
  };
}

/** Read every template from the content dir. Best-effort — a missing
 *  dir or a malformed file yields a shorter list, never an error. */
export function loadAllTemplates() {
  let files;
  try {
    files = fs.readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    const tpl = parseTemplateFile(path.join(TEMPLATES_DIR, f));
    if (tpl) out.push(tpl);
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** Summary list for the template picker — no full worldspec. */
export function listTemplates() {
  return loadAllTemplates().map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    universeType: t.worldspec.theme.universeType,
    systemCount: t.worldspec.systems.length,
  }));
}

/** One full template (with its worldspec) by id, or null. */
export function getTemplate(id) {
  if (!id) return null;
  return loadAllTemplates().find((t) => t.id === String(id)) || null;
}

export const TEMPLATES_INTERNALS = Object.freeze({ TEMPLATES_DIR, parseTemplateFile });
