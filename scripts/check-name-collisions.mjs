#!/usr/bin/env node
// scripts/check-name-collisions.mjs
//
// Standalone CI gate for the "real-name / IP-name collision" content class
// (E3 in docs/CONTENT_INTEGRITY_SWEEP.md). Keeps that class at zero: once the
// owner-decision sweep renames a real living-people ethnonym or a trademarked
// franchise proper-noun that was reused for an UNRELATED fictional entity, this
// gate blocks any NEW such collision from re-entering content/**.
//
// This is a SELF-CONTAINED ratchet with its OWN baseline
// (audit/name-collisions/BASELINE.json). It deliberately does NOT touch the
// guard-protected detector suite (audit/detectors/BASELINE.json, the graders,
// autoloop/guard.mjs) — same standalone shape as scripts/check-doc-claims-all.mjs.
//
// Detection is a PRECISE dictionary ratchet, not an NLP scanner: it flags a
// content string only when it contains — token/word-boundary-aware — a term
// from a curated, finite, HIGH-confidence dictionary of well-known real names.
// Substring safety is load-bearing: "Cree" must not match "decree"/"screen",
// "Medici" must not match "medicine". Boundaries treat `_` and `"` as token
// separators so snake_case ids (e.g. `cree_eldest_walker`) are caught while
// `decree` is not.
//
// Usage:
//   node scripts/check-name-collisions.mjs            # human report
//   node scripts/check-name-collisions.mjs --ci       # exit 1 on any NEW collision
//   node scripts/check-name-collisions.mjs --json     # machine-readable
//   node scripts/check-name-collisions.mjs --report   # list EVERY match incl. baselined

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTENT_DIR = path.join(ROOT, "content");
const BASELINE_PATH = path.join(ROOT, "audit", "name-collisions", "BASELINE.json");

// ---------------------------------------------------------------------------
// The curated dictionary. HIGH-confidence only — every entry is an unambiguous
// real name whose reuse for an unrelated fictional entity is a genuine
// integrity collision. Deliberately excludes ambiguous common words (e.g.
// "Maya", "Sami", "Vulcan", "Stark") to keep false positives at zero.
// ---------------------------------------------------------------------------

// (a) Living peoples / ethnonyms (+ indigenous-language-derived coinages the
//     audit flagged). Reusing a living people's name for a fictional
//     ark-arrived people / beast / faction is the Cree→Corre class.
const REAL_NATIONS = [
  "Cree", "Zulu", "Maori", "Brahmin", "Cherokee", "Navajo", "Apache", "Inuit",
  "Aztec", "Comanche", "Iroquois", "Mohawk", "Lakota", "Sioux", "Ojibwe",
  "Seminole", "Shoshone", "Pashtun", "Yoruba", "Igbo", "Hausa", "Maasai",
  "Ainu", "Uyghur", "Tuareg", "Xhosa", "Cheyenne", "Blackfoot", "Hopi", "Zuni",
  "Haida", "Tlingit", "Wampanoag", "Chickasaw", "Choctaw",
  // Cree-language-derived tunya coinages (audit E2 findings #folded-in):
  "Naheya", "Wiyowak", "Okimaw",
];

// (b) Real historical people / dynasties reused for an unrelated fictional
//     entity. The E2 audit's largest finding — "Medici" (the Florentine dynasty
//     used as an alien ice-healer people) — was renamed to the coined "Vessine";
//     it's gated here so it can never re-enter content. (Absent from content
//     today, so this keeps --ci green.)
const REAL_HISTORICAL = [
  "Medici",
];

// (c) Flagship trademarked-franchise proper nouns. Reusing a signature IP name
//     (Arasaka, Nymeria, Kree, ...) for an unrelated fictional entity is the
//     IP-collision class. Multi-word phrases require the whole phrase so common
//     surname fragments (Holloway, Dunmore) don't fire on their own.
const TRADEMARKED_IP = [
  // audit E2 confirmed / owner-decision-pending:
  "Arasaka", "Nymeria", "Kree", "Mournhold", "Wintersday", "Polysteel",
  "Pyke", "Karthal", "Gloom Stalker", "Jorah Dunmore", "Marcus Holloway",
  // firearm brands (de-brand candidates):
  "Glock", "p229",
  // forward-protection: unmistakable franchise names (absent from content today,
  // gated so they can never enter):
  "Wolverine", "Gotham", "Rivendell", "Mordor", "Targaryen", "Vibranium",
  "Tyrell", "Gondor", "Winterfell", "Dothraki", "Valyria", "Lannister",
  "Wakanda", "Adamantium", "Mandalorian", "Xenomorph", "Klingon", "Skynet",
  "Cyberdyne", "Voldemort", "Hogwarts", "Sauron", "Gandalf", "Protoss", "Zerg",
  "Tiberium", "Weyland", "Nuka-Cola",
];

/** Build the term → category dictionary. */
export function buildDictionary() {
  const dict = new Map();
  for (const t of REAL_NATIONS) dict.set(t.toLowerCase(), { term: t, category: "REAL_NATIONS" });
  for (const t of REAL_HISTORICAL) dict.set(t.toLowerCase(), { term: t, category: "REAL_HISTORICAL" });
  for (const t of TRADEMARKED_IP) dict.set(t.toLowerCase(), { term: t, category: "TRADEMARKED_IP" });
  return dict;
}

/** Escape a term for use in a RegExp literal, spaces → flexible whitespace. */
function termToPattern(term) {
  return term
    .split(/\s+/)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
}

// Token boundary: alphanumerics belong to the token; everything else (incl. `_`
// and `"`) is a separator. This catches snake_case ids while rejecting
// substrings inside real words (decree / medicine / screen).
const BOUNDARY = { before: "(?<![A-Za-z0-9])", after: "(?![A-Za-z0-9])" };

/**
 * Pure, unit-testable core. Given a text and a dictionary (Map keyed by
 * lowercased term → {term, category}), return the list of collisions found.
 * Substring-safe via token boundaries.
 * @returns {Array<{term:string, category:string, matched:string}>}
 */
export function findCollisions(text, { dictionary } = {}) {
  if (typeof text !== "string" || !text) return [];
  const dict = dictionary || buildDictionary();
  const hits = [];
  for (const { term, category } of dict.values()) {
    const re = new RegExp(`${BOUNDARY.before}${termToPattern(term)}${BOUNDARY.after}`, "gi");
    let m;
    while ((m = re.exec(text)) !== null) {
      hits.push({ term, category, matched: m[0] });
      if (m.index === re.lastIndex) re.lastIndex++; // zero-width guard
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Baseline: accepted exceptions + known-pending owner decisions.
// ---------------------------------------------------------------------------

function loadBaseline() {
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    return { acceptedTerms: [], knownPending: [] };
  }
}

/** Normalize a path to a forward-slash repo-relative string. */
function relPath(abs) {
  return path.relative(ROOT, abs).split(path.sep).join("/");
}

/**
 * Is a given (term, file) match covered by the baseline?
 * A match is accepted if the term is globally accepted, OR a knownPending entry
 * for that term lists a scope (path prefix) that the file falls under.
 */
export function isBaselined(term, relFile, baseline) {
  const lc = term.toLowerCase();
  if ((baseline.acceptedTerms || []).some((t) => t.toLowerCase() === lc)) return true;
  for (const entry of baseline.knownPending || []) {
    if (entry.term.toLowerCase() !== lc) continue;
    if ((entry.scopes || []).some((s) => relFile === s || relFile.startsWith(s))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Content walk.
// ---------------------------------------------------------------------------

function listContentJson(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) listContentJson(p, acc);
    else if (ent.isFile() && ent.name.endsWith(".json")) acc.push(p);
  }
  return acc;
}

/** Collect every scannable string (leaf string values + object keys) from JSON. */
function collectStrings(node, out) {
  if (typeof node === "string") {
    out.push(node);
  } else if (Array.isArray(node)) {
    for (const v of node) collectStrings(v, out);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      out.push(k);
      collectStrings(v, out);
    }
  }
}

export function scanContent({ dictionary, baseline } = {}) {
  const dict = dictionary || buildDictionary();
  const bl = baseline || loadBaseline();
  const files = listContentJson(CONTENT_DIR);
  let valuesScanned = 0;
  const matches = []; // { term, category, file, matched, baselined }
  for (const abs of files) {
    const rel = relPath(abs);
    let data;
    try {
      data = JSON.parse(fs.readFileSync(abs, "utf8"));
    } catch {
      continue; // malformed JSON is another gate's problem
    }
    const strings = [];
    collectStrings(data, strings);
    valuesScanned += strings.length;
    const seen = new Set();
    for (const s of strings) {
      for (const hit of findCollisions(s, { dictionary: dict })) {
        const key = `${hit.term} ${rel}`;
        if (seen.has(key)) continue; // one row per (term,file)
        seen.add(key);
        matches.push({
          term: hit.term,
          category: hit.category,
          file: rel,
          matched: hit.matched,
          baselined: isBaselined(hit.term, rel, bl),
        });
      }
    }
  }
  return { filesScanned: files.length, valuesScanned, matches };
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const CI = argv.includes("--ci");
  const JSON_OUT = argv.includes("--json");
  const REPORT = argv.includes("--report");

  const dictionary = buildDictionary();
  const baseline = loadBaseline();
  const { filesScanned, valuesScanned, matches } = scanContent({ dictionary, baseline });
  const violations = matches.filter((m) => !m.baselined);

  if (JSON_OUT) {
    console.log(JSON.stringify({
      dictionarySize: dictionary.size,
      filesScanned,
      valuesScanned,
      totalMatches: matches.length,
      baselinedMatches: matches.length - violations.length,
      violations,
    }, null, 2));
    if (CI && violations.length) process.exit(1);
    return;
  }

  console.log(`name-collision gate — dictionary=${dictionary.size} terms, ` +
    `scanned ${valuesScanned} strings across ${filesScanned} content files`);

  if (REPORT) {
    console.log("\nAll dictionary matches (incl. baselined):");
    for (const m of matches.sort((a, b) => a.term.localeCompare(b.term) || a.file.localeCompare(b.file))) {
      console.log(`  ${m.baselined ? "·" : "✗"} [${m.category}] ${m.term}  (${m.matched})  ${m.file}`);
    }
  }

  if (!violations.length) {
    console.log(`\n✓ 0 new real-name/IP collisions ` +
      `(${matches.length} known match(es) covered by baseline)`);
    return;
  }

  console.log(`\n✗ ${violations.length} NEW real-name/IP collision(s):\n`);
  for (const v of violations.sort((a, b) => a.term.localeCompare(b.term) || a.file.localeCompare(b.file))) {
    console.log(`  [${v.category}] "${v.term}" in ${v.file}  (matched "${v.matched}")`);
    const kind = v.category === "REAL_NATIONS" ? "living-people / ethnonym name"
      : v.category === "REAL_HISTORICAL" ? "historical person / dynasty name"
        : "trademarked-franchise proper noun";
    console.log(`     why: "${v.term}" is a well-known real ${kind} reused for a fictional entity.`);
  }
  console.log(`\nTo resolve: get an owner rename (log it in docs/CONTENT_INTEGRITY_SWEEP.md) ` +
    `and sweep it to zero, OR — if this is a deliberate keep — add it to ` +
    `audit/name-collisions/BASELINE.json with a reason.`);

  if (CI) process.exit(1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
