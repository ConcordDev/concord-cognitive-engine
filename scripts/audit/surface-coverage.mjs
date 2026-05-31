#!/usr/bin/env node
// scripts/audit/surface-coverage.mjs
//
// WAVE SCAN — Surface Coverage Audit + Gate.
//
// Turns "is it polished?" (infinite, subjective) into "does every player-facing
// surface fire a response, and here's the enumerated closed set?" (finite,
// checkable, gateable — the drift-gate pattern). Read-only: it enumerates the
// closed set, greps the codebase for REAL wired responses per channel (file:line
// proof, no assumptions), ranks the gaps by player-frequency × channels-missing,
// and emits a CI gate with a RATCHETING floor. It fixes NOTHING.
//
// Channels (binary per item): [visual] [audio] [animation] [legibility]
// Gate: no shipped player-verb may score below FLOOR/4 (start 1, ratchet to 2,3).
//
// Usage:
//   node scripts/audit/surface-coverage.mjs            # write manifest + print summary
//   node scripts/audit/surface-coverage.mjs --ci       # exit 1 on floor violations (CI)
//   FLOOR=2 node scripts/audit/surface-coverage.mjs --ci

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FE = path.join(ROOT, "concord-frontend");
const FLOOR = Number(process.env.FLOOR || 1);
const CI = process.argv.includes("--ci");

// ── helpers ──────────────────────────────────────────────────────────────────
function read(p) { try { return fs.readFileSync(p, "utf8"); } catch { return null; } }
function walk(dir, exts, out = []) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.name === "node_modules" || e.name === ".next" || e.name === ".git") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(full);
  }
  return out;
}
function rel(p) { return path.relative(ROOT, p); }

// Find the first file:line in a bucket of files that contains the literal event
// name (as a quoted string). Returns { fileLine } or null.
function findHit(name, files) {
  // Event names (contain ':') appear only as quoted strings; handler/identifier
  // tokens (no ':') appear unquoted in source — match those as a bare substring.
  const needles = name.includes(":")
    ? [`'${name}'`, `"${name}"`, `\`${name}\``]
    : [`'${name}'`, `"${name}"`, `\`${name}\``, name];
  for (const { path: fp, text, lines } of files) {
    let idx = -1;
    for (const n of needles) { const i = text.indexOf(n); if (i >= 0 && (idx < 0 || i < idx)) idx = i; }
    if (idx < 0) continue;
    // line number of idx
    let line = 1; for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) line++;
    return `${rel(fp)}:${line}`;
    void lines;
  }
  return null;
}

// ── load the frontend once, bucket files by channel ─────────────────────────
const feFiles = [...walk(path.join(FE, "components"), [".ts", ".tsx"]),
                 ...walk(path.join(FE, "lib"), [".ts", ".tsx"]),
                 ...walk(path.join(FE, "app"), [".ts", ".tsx"])]
  .map((p) => ({ path: p, text: read(p) || "" }))
  .filter((f) => f.text);

const bucket = (re) => feFiles.filter((f) => re.test(f.path));
const CHANNEL_FILES = {
  // a real VISIBLE response: VFX, juice, renderer, billboard, particle, decal
  visual: bucket(/Bridge\.tsx$|element-vfx|GameJuice|DamageBillboard|particle|renderer|VFX|juice\.ts$|combat-juice|hit-/i),
  // a real AUDIBLE response: soundscape, the audio mappings, sfx
  audio: bucket(/Soundscape|adaptive-score|world-audio|evo-sound|sfx|audio/i),
  // a real ANIMATION: avatar pose, combat-anim clip, gait, reflex, biomech, anim manager
  animation: bucket(/AvatarSystem3D|combat-anim|combat-biomech|pose-broker|gait|reflex|AnimationManager|motor-driver|impact-feel/i),
  // a real LEGIBILITY surface: the event feed, toasts, HUD, banners
  legibility: bucket(/EmergentEventFeed|Toast|HUD|Banner|Feed\.tsx$|ActivityTag|PersonalStake|DriftAlert|DamageBillboard|LevelUpJuice|QuestTracker/i),
};

// ── enumerate the closed set ─────────────────────────────────────────────────
const rows = []; // { id, name, category, source, frequency, shippedVerb }

// (1) Emergent events — from EmergentEventFeed TRACKED_EVENTS (these are, by
//     construction, in the legibility feed).
const feedText = read(path.join(FE, "components/world/EmergentEventFeed.tsx")) || "";
const feedNames = new Set();
for (const m of feedText.matchAll(/name:\s*'([^']+)'/g)) feedNames.add(m[1]);
for (const name of feedNames) rows.push({ name, category: "emergent_event", source: "EmergentEventFeed", frequency: 5, shippedVerb: false });

// (2) Socket events — from event-shapes.js (the pinned emit contracts).
const shapesText = read(path.join(ROOT, "server/lib/event-shapes.js")) || "";
const shapeNames = new Set();
for (const m of shapesText.matchAll(/^\s*["']([a-z][a-z0-9:_-]+)["']\s*:/gim)) shapeNames.add(m[1]);
for (const name of shapeNames) {
  if (rows.some((r) => r.name === name)) continue;
  rows.push({ name, category: "socket_event", source: "event-shapes", frequency: 8, shippedVerb: false });
}

// (3) Core player verbs — curated closed set with their primary client signal +
//     a player-frequency weight (events/session order-of-magnitude). These are
//     the SHIPPED PLAYER VERBS the gate floors.
const CORE_VERBS = [
  { name: "combat:attack",      category: "combat",   frequency: 1000 },
  { name: "combat:dodge",       category: "combat",   frequency: 300 },
  { name: "combat:block",       category: "combat",   frequency: 250 },
  { name: "combat:kick",        category: "combat",   frequency: 200 },
  { name: "combat:grab",        category: "combat",   frequency: 120 },
  { name: "combat:impact",      category: "combat",   frequency: 900 },
  { name: "combat:stagger",     category: "combat",   frequency: 300 },
  { name: "combat:hit",         category: "combat",   frequency: 900 },
  { name: "player:move",        category: "movement", frequency: 5000 },
  { name: "concordia:emote",    category: "social",   frequency: 60 },
  { name: "social:ping",        category: "social",   frequency: 40 },
  { name: "fishing:cast",       category: "minigame", frequency: 80 },
  { name: "minigame:scored",    category: "minigame", frequency: 120 },
  { name: "marketplace:purchase", category: "economy", frequency: 30 },
  { name: "dtu:created",        category: "craft",    frequency: 50 },
  { name: "evo:asset-promoted", category: "evo",      frequency: 10 },
  { name: "world:building-state", category: "world_state", frequency: 70 },
  { name: "world:season-transition", category: "world_state", frequency: 2 },
  { name: "fishing:caught",     category: "minigame", frequency: 70 },
  { name: "quest:rewards_granted", category: "quest", frequency: 40 },
];
for (const v of CORE_VERBS) {
  const existing = rows.find((r) => r.name === v.name);
  if (existing) { existing.shippedVerb = true; existing.category = v.category; existing.frequency = Math.max(existing.frequency, v.frequency); }
  else rows.push({ name: v.name, category: v.category, source: "core-verb", frequency: v.frequency, shippedVerb: true });
}

// ── v2 calibration: the verb→response-event/handler CHAIN ────────────────────
// A verb's input event (e.g. combat:attack) is NOT where the response lives — the
// response fires under DOWNSTREAM events/handlers (combat:hit, combat:impact,
// concordia:combat-anim, footstep synthesis, gait). Per channel we look for ANY
// of these proof-tokens (event names OR handler/function identifiers), so a wired
// response isn't a false 0. Tokens default to [verb name]. A channel left empty
// here means "legitimately N/A" for that verb (e.g. a marketplace purchase has no
// avatar animation) — the FLOOR (≥1), not 4/4, is the gate.
const VERB_EMITS = {
  "combat:attack":  { visual: ["combat:impact", "combat:hit", "DamageBillboard", "element-vfx"], audio: ["hit-transient", "combat:hit", "playHit", "hit-thump"], animation: ["concordia:combat-anim", "handleCombatAnim", "buildBiomechClipMap"], legibility: ["DamageBillboard", "combat:hit"] },
  "combat:hit":     { visual: ["combat:impact", "DamageBillboard", "element-vfx", "hit-"], audio: ["hit-transient", "playHit", "hit-thump", "combat:hit"], animation: ["concordia:combat-anim", "handleCombatAnim"], legibility: ["DamageBillboard", "combat:hit"] },
  "combat:impact":  { visual: ["concordia:knockback", "concordia:hit-pause", "DamageBillboard"], audio: ["hit-transient", "hit-thump"], animation: ["concordia:hit-pause", "concordia:knockback", "handleCombatAnim"], legibility: ["DamageBillboard"] },
  "combat:stagger": { visual: ["combat:stagger", "knockback"], audio: ["hit-thump"], animation: ["combat:stagger", "stagger", "handleCombatAnim"], legibility: ["combat:stagger"] },
  "combat:dodge":   { visual: ["combat:dodge", "dodge"], audio: ["dodge", "whoosh", "ui_"], animation: ["combat:dodge", "dodge"], legibility: ["combat:dodge:perfect"] },
  "combat:block":   { visual: ["combat:block", "block"], audio: ["block", "parry"], animation: ["combat:block", "block"], legibility: ["combat:block:ack", "combat:parry:perfect"] },
  "combat:kick":    { visual: ["combat:impact", "combat:hit"], audio: ["hit-transient", "hit-thump"], animation: ["concordia:combat-anim", "handleCombatAnim"], legibility: ["DamageBillboard"] },
  "combat:grab":    { visual: ["combat:impact"], audio: ["hit-transient"], animation: ["concordia:combat-anim", "handleCombatAnim", "grab"], legibility: ["DamageBillboard"] },
  "player:move":    { visual: ["applyGaitPose", "synthesizeGait"], audio: ["footstep"], animation: ["synthesizeGait", "applyGaitPose", "requestGait"], legibility: [] },
  "concordia:emote": { visual: ["EmoteWheel", "emote"], audio: ["emote", "ui_"], animation: ["AnimationManager", "emote"], legibility: [] },
  "social:ping":    { visual: ["social:ping", "ping"], audio: ["ping", "ui_"], animation: [], legibility: ["social:ping"] },
  "fishing:cast":   { visual: ["fishing"], audio: ["fishing", "ui_"], animation: ["fishing", "cast"], legibility: ["fishing:caught", "fishing:bite"] },
  "fishing:caught": { visual: ["fishing"], audio: ["fishing"], animation: ["fishing"], legibility: ["fishing:caught"] },
  "minigame:scored": { visual: ["minigame", "juice"], audio: ["minigame", "ui_", "successJuice"], animation: [], legibility: ["minigame:scored", "minigame:complete"] },
  "marketplace:purchase": { visual: ["marketplace:purchase", "purchase"], audio: ["purchase", "coin", "ui_"], animation: [], legibility: ["marketplace:purchase", "Toast"] },
  "dtu:created":    { visual: ["dtu:created", "successJuice"], audio: ["ui_", "successJuice"], animation: [], legibility: ["dtu:created", "Toast"] },
  "evo:asset-promoted": { visual: ["evo:asset-promoted", "LevelUpJuice"], audio: ["fanfare", "LevelUpJuice"], animation: [], legibility: ["evo:asset-promoted"] },
  "world:building-state": { visual: ["world:building-state", "building-state", "applyStructuralStress"], audio: ["world:building-state", "creak"], animation: [], legibility: ["world:building-state"] },
  "world:season-transition": { visual: ["season", "SkyWeather"], audio: ["season"], animation: [], legibility: ["world:season-transition", "season"] },
  "quest:rewards_granted": { visual: ["quest", "successJuice"], audio: ["ui_", "fanfare"], animation: [], legibility: ["quest:rewards_granted", "QuestTracker", "Toast"] },
};

function findHitAny(tokens, files) {
  for (const t of tokens) { const h = findHit(t, files); if (h) return h; }
  return null;
}

// ── score the 4 channels per row (file:line proof or 0) ──────────────────────
for (const r of rows) {
  const emit = VERB_EMITS[r.name];
  const score1 = (chan, files) => {
    if (emit && emit[chan]) {
      if (emit[chan].length === 0) return "n/a"; // legitimately not-applicable for this verb
      return findHitAny([r.name, ...emit[chan]], files) || 0;
    }
    return findHit(r.name, files) || 0;
  };
  const visual = score1("visual", CHANNEL_FILES.visual);
  const audio = score1("audio", CHANNEL_FILES.audio);
  const animation = score1("animation", CHANNEL_FILES.animation);
  // legibility: in the feed (by construction) OR the chain tokens OR a HUD/toast hit
  const legib = feedNames.has(r.name) ? `concord-frontend/components/world/EmergentEventFeed.tsx (feed)` : score1("legibility", CHANNEL_FILES.legibility);
  r.channels = {
    visual: visual === "n/a" ? "n/a" : (visual || 0),
    audio: audio === "n/a" ? "n/a" : (audio || 0),
    animation: animation === "n/a" ? "n/a" : (animation || 0),
    legibility: legib === "n/a" ? "n/a" : (legib || 0),
  };
  const CH = ["visual", "audio", "animation", "legibility"];
  const isHit = (v) => typeof v === "string" && v !== "n/a";
  r.score = CH.reduce((n, c) => n + (isHit(r.channels[c]) ? 1 : 0), 0);            // real wired channels
  r.missing = CH.filter((c) => r.channels[c] === 0);                              // real misses (n/a excluded)
  r.applicable = CH.filter((c) => r.channels[c] !== "n/a").length;                // applicable channels
  r.gap = r.missing.length * r.frequency;                                         // ranking weight
}

// ── rank the gap queue ───────────────────────────────────────────────────────
const ranked = [...rows].sort((a, b) => b.gap - a.gap || b.frequency - a.frequency);

// ── gate ─────────────────────────────────────────────────────────────────────
const shippedVerbs = rows.filter((r) => r.shippedVerb);
const violations = shippedVerbs.filter((r) => r.score < FLOOR);

// ── write manifest ───────────────────────────────────────────────────────────
const outDir = path.join(ROOT, "audit");
fs.mkdirSync(outDir, { recursive: true });
const json = {
  generatedAt: new Date().toISOString(),
  floor: FLOOR,
  totals: {
    items: rows.length,
    shippedVerbs: shippedVerbs.length,
    floorViolations: violations.length,
    byScore: [0, 1, 2, 3, 4].map((s) => ({ score: s, count: rows.filter((r) => r.score === s).length })),
  },
  rows: rows.map((r) => ({ name: r.name, category: r.category, source: r.source, frequency: r.frequency, shippedVerb: r.shippedVerb, score: r.score, channels: r.channels })),
  rankedGapQueue: ranked.filter((r) => r.missing.length > 0).map((r) => ({ name: r.name, category: r.category, score: r.score, applicable: r.applicable, frequency: r.frequency, gapWeight: r.gap, missing: r.missing })),
};
fs.writeFileSync(path.join(outDir, "surface-coverage.json"), JSON.stringify(json, null, 2));

// markdown
const tick = (v) => (v === "n/a" ? "▫" : v ? "✅" : "⬜");
let md = `# Surface Coverage Audit\n\n_Generated ${json.generatedAt} · FLOOR=${FLOOR}_\n\n`;
md += `**${rows.length} surfaces** · **${shippedVerbs.length} shipped player-verbs** · `;
md += `**floor violations (score<${FLOOR}): ${violations.length}** (target 0)\n\n`;
md += `Score distribution: ${json.totals.byScore.map((b) => `${b.score}/4→${b.count}`).join(" · ")}\n\n`;
md += `## Top gap queue (player-frequency × channels-missing)\n\n| rank | surface | cat | score | freq | missing |\n|---|---|---|---|---|---|\n`;
ranked.filter((r) => r.missing.length > 0).slice(0, 30).forEach((r, i) => {
  md += `| ${i + 1} | \`${r.name}\` | ${r.category} | ${r.score}/${r.applicable} | ${r.frequency} | ${r.missing.join(", ")} |\n`;
});
md += `\n## Floor violations (shipped verbs scoring < ${FLOOR}/4)\n\n`;
md += violations.length ? violations.map((r) => `- \`${r.name}\` (${r.score}/4)`).join("\n") : "_none — floor satisfied_";
md += `\n\n## Full manifest (4-channel scores + file:line proof)\n\n| surface | v | a | an | leg | proof |\n|---|---|---|---|---|---|\n`;
for (const r of ranked) {
  const proof = ["visual", "audio", "animation", "legibility"].map((c) => (typeof r.channels[c] === "string" && r.channels[c] !== "n/a" ? `${c[0]}:${r.channels[c]}` : "")).filter(Boolean).join(" · ") || "—";
  md += `| \`${r.name}\` | ${tick(r.channels.visual)} | ${tick(r.channels.audio)} | ${tick(r.channels.animation)} | ${tick(r.channels.legibility)} | ${proof} |\n`;
}
fs.writeFileSync(path.join(outDir, "surface-coverage.md"), md);

// ── console summary ──────────────────────────────────────────────────────────
console.log(`[surface-coverage] ${rows.length} surfaces, ${shippedVerbs.length} shipped verbs, FLOOR=${FLOOR}`);
console.log(`[surface-coverage] score dist: ${json.totals.byScore.map((b) => `${b.score}/4=${b.count}`).join("  ")}`);
console.log(`[surface-coverage] floor violations (verb score<${FLOOR}): ${violations.length} (target 0)`);
console.log(`[surface-coverage] top gaps:`);
ranked.filter((r) => r.missing.length > 0).slice(0, 8).forEach((r, i) => console.log(`   ${i + 1}. ${r.name} (${r.score}/${r.applicable}, freq ${r.frequency}) missing: ${r.missing.join(", ")}`));
console.log(`[surface-coverage] wrote audit/surface-coverage.{json,md}`);

if (CI && violations.length > 0) {
  console.error(`[surface-coverage] GATE FAIL: ${violations.length} shipped verb(s) below floor ${FLOOR}/4`);
  process.exit(1);
}
