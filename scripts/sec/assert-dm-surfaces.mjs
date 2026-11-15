#!/usr/bin/env node
/**
 * assert-dm-surfaces.mjs — SB-10 acceptance gate (Mega Plan v2, Track B).
 *
 * Fails (exit 1) when a grep-found DM symbol is missing from the inventory
 * doc `audit/sec/DM-SURFACES.md`; passes (exit 0) when the doc is complete.
 *
 * The symbol set is DERIVED from the sources at run time — the regex list
 * below is applied to the named source files and every distinct match must
 * appear verbatim in the doc. If a future change adds a DM route, layer
 * function, or message action, this script fails until the doc names it.
 *
 * Usage:
 *   node scripts/sec/assert-dm-surfaces.mjs [docPath]
 * docPath defaults to audit/sec/DM-SURFACES.md (resolved from the repo root,
 * two levels up from this script). Passing a truncated copy is the negative
 * control: it must fail.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const docPath = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(repoRoot, "audit/sec/DM-SURFACES.md");

function read(rel) {
  try {
    return readFileSync(resolve(repoRoot, rel), "utf8");
  } catch {
    return null;
  }
}

/** Each entry: a source file + a regex whose capture group 1 is a DM symbol
 *  that must appear verbatim in the doc. */
const SOURCES = [
  {
    file: "server/emergent/social-layer.js",
    patterns: [
      /export function (getMessages|getConversations|markMessagesRead|recallMessage|sendMessage)\b/g,
      /function (isDmParticipant|getConversationId|dmDenied)\b/g,
    ],
  },
  {
    file: "server/lib/social-loop.js",
    patterns: [
      /export function (listMessageRequests|acceptMessageRequest|declineMessageRequest|hideMessageForUser)\b/g,
    ],
  },
  {
    file: "server/routes/social-core.js",
    patterns: [/router\.(?:get|post|delete)\("(\/dm[^"]*)"/g],
  },
  {
    file: "server/server.js",
    patterns: [
      /app\.(?:get|post|delete)\("(\/api\/social\/dm[^"]*)"/g,
      /function (makeCtx|getActorFromReq)\b/g,
    ],
  },
  {
    file: "server/domains/social.js",
    patterns: [/registerLensAction\("social", "(sendMessage|inbox|conversation)"/g],
  },
  {
    file: "server/domains/message.js",
    patterns: [
      /registerLensAction\("message", "([^"]+)"/g,
      /function (msgActor|isChannelMember|usesShared)\b/g,
    ],
  },
  {
    file: "server/lib/social-persist.js",
    patterns: [/\b(social_dm_threads|social_dm_messages)\b/g],
  },
];

/** Literal anchors the doc must carry regardless of grep derivation: the
 *  verdict line, the MCP real-auth tool name, and the bypass identity. */
const LITERAL_ANCHORS = [
  /ctx\.userId is client-reachable: (YES|NO)/,
  "run_lens_action",
  "mcp-anonymous",
];

const doc = (() => {
  try {
    return readFileSync(docPath, "utf8");
  } catch {
    console.error(`assert-dm-surfaces: cannot read doc at ${docPath}`);
    process.exit(2);
  }
})();

const missing = [];
const found = new Set();

for (const { file, patterns } of SOURCES) {
  const src = read(file);
  if (src === null) {
    missing.push(`SOURCE UNREADABLE: ${file}`);
    continue;
  }
  for (const re of patterns) {
    for (const m of src.matchAll(re)) {
      const symbol = m[1];
      if (!symbol) continue;
      found.add(symbol);
      if (!doc.includes(symbol)) missing.push(`${symbol}  (from ${file})`);
    }
  }
}

for (const anchor of LITERAL_ANCHORS) {
  const ok = typeof anchor === "string" ? doc.includes(anchor) : anchor.test(doc);
  if (!ok) missing.push(`ANCHOR: ${String(anchor)}`);
}

if (missing.length > 0) {
  console.error(`assert-dm-surfaces: FAIL — ${missing.length} grep-found DM symbol(s) missing from ${docPath}:`);
  for (const s of [...new Set(missing)]) console.error(`  - ${s}`);
  process.exit(1);
}

console.log(`assert-dm-surfaces: PASS — ${found.size} grep-found DM symbols + ${LITERAL_ANCHORS.length} anchors all present in ${docPath}`);
