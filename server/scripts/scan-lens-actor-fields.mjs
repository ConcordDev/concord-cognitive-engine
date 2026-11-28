// server/scripts/scan-lens-actor-fields.mjs
//
// Which lens actions read an actor-shaped field (userId, ownerId, actorId,
// playerId) from their input, and how. Used by the /api/lens/run identity
// guard (lib/actor-identity.js) and pinned by tests/lens-run-actor-identity.test.js.
//
//   "fallback": the field stands in for the caller (`input.userId || ctx.actor…`).
//               These are the bug: the guard rejects a mismatch, and the site
//               itself must read the session first.
//   "session":  the session wins and the field is only a backup
//               (`ctx.actor.userId || input.userId`): safe, and still an actor field.
//   "direct":   the field is read with no session fallback on the line. Either it
//               names someone else on purpose (follow, share, an admin acting on an
//               account) — then it must be in TARGET_FIELDS in lib/actor-identity.js —
//               or it is the caller, which is the bug in another shape.
//
//   node scripts/scan-lens-actor-fields.mjs [--json]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(HERE, "..");
export const ACTOR_FIELDS = ["userId", "ownerId", "actorId", "playerId"];
const F = ACTOR_FIELDS.join("|");
const REG = /\b(?:register|registerLensAction)\(\s*['"]([a-zA-Z0-9_.-]+)['"]\s*,\s*['"]([a-zA-Z0-9_.-]+)['"]/g;
const READ = new RegExp(String.raw`\b(?:input|params)\s*(?:\?\.|\.|&&\s*(?:input|params)\.)\s*(${F})\b`, "g");
const DESTRUCT = /\{([^{}]*)\}\s*=\s*(?:input|params)\b/g;
const SESSION = new RegExp(String.raw`(?:ctx|aid|uid|actor|req)[^;]*(?:\|\||\?\?)\s*(?:input|params)\??\.(?:${F})\b`);
const FALLBACK = new RegExp(String.raw`\b(?:input|params)\??\.(?:${F})\s*(?:\|\||\?\?)\s*(?:ctx|aid|uid|actor|String\(ctx|req)`);

function regionsOf(file) {
  const t = fs.readFileSync(file, "utf8");
  const marks = [...t.matchAll(REG)].map((m) => ({ domain: m[1], action: m[2], at: m.index }));
  return marks.map((m, i) => ({ ...m, file: path.relative(SERVER, file), text: t.slice(m.at, i + 1 < marks.length ? marks[i + 1].at : t.length), line: t.slice(0, m.at).split("\n").length }));
}

export function scanLensActorFields({ root = SERVER } = {}) {
  const files = [path.join(root, "server.js"), ...fs.readdirSync(path.join(root, "domains")).filter((f) => f.endsWith(".js")).map((f) => path.join(root, "domains", f))];
  const out = [];
  for (const file of files) {
    for (const r of regionsOf(file)) {
      const fields = new Map();
      for (const line of r.text.split("\n")) {
        if (/^\s*(?:\/\/|\*)/.test(line)) continue;
        for (const m of line.matchAll(READ)) {
          const kind = FALLBACK.test(line) ? "fallback" : SESSION.test(line) ? "session" : "direct";
          const rank = { fallback: 3, direct: 2, session: 1 };
          if (!fields.has(m[1]) || rank[kind] > rank[fields.get(m[1])]) fields.set(m[1], kind);
        }
        for (const m of line.matchAll(DESTRUCT)) for (const f of ACTOR_FIELDS) if (new RegExp(`\\b${f}\\b`).test(m[1]) && !fields.has(f)) fields.set(f, "fallback");
      }
      for (const [field, kind] of fields) out.push({ domain: r.domain, action: r.action, field, kind, file: r.file, line: r.line });
    }
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const rows = scanLensActorFields();
  if (process.argv.includes("--json")) console.log(JSON.stringify(rows, null, 1));
  else {
    for (const k of ["fallback", "direct", "session"]) {
      const rs = rows.filter((r) => r.kind === k);
      console.log(`\n${k}: ${rs.length}`);
      for (const r of rs) console.log(`  ${r.domain}.${r.action} ${r.field}  (${r.file}:${r.line})`);
    }
  }
}
