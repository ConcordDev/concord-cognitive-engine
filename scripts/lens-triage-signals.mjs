// scripts/lens-triage-signals.mjs — read-only per-lens signals for docs/LENS_REDESIGN_TRIAGE.md.
//
// Regenerate the inputs first (one heavy process at a time), then run this:
//   node scripts/detect-lens-stacking.mjs          → audit/lens-stacking.json
//   node scripts/grade-ux-polish.mjs --honest      → audit/ux-polish.json
//   node scripts/grade-macro-depth.mjs --honest    → audit/macro-depth-honest.json
//   node scripts/lens-triage-signals.mjs [--out file.json]   (default /tmp/lens-triage.json)
// Then `git checkout -- audit/` (regenerated artifacts are not committed).
//
// Signals are leads, not verdicts: "identityFromInput" counts request-first identity
// (`input.userId || ctx.actor…`) in the lens's primary domain; "money" counts ledger /
// purchase / price references; Math.random and mock-word counts include legitimate uses
// (procedural game content, sampling, sampleRate). Each is confirmed in playbook step 1.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const A = path.join(ROOT, "audit");
const OUT = (() => { const i = process.argv.indexOf("--out"); return i > 0 ? process.argv[i + 1] : "/tmp/lens-triage.json"; })();
const FE = path.join(ROOT, "concord-frontend");
const SHARED = new Set(["lens", "ui", "common", "shell", "providers", "layout", "icons", "a11y"]);
const read = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };
const walk = (dir, out = []) => { let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of es) { const p = path.join(dir, e.name); if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "__tests__") walk(p, out); } else if (/\.(tsx?|jsx?)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p); } return out; };

// Lenses in the playbook Identity registry (docs/LENS_REDESIGN_PLAYBOOK.md).
const DONE = new Set(["retail", "conkay", "studio", "music", "code", "news", "market", "art", "chat", "podcast", "dtus", "film-studios", "animation", "graph", "photos", "board", "education"]);

// ---- registered macros, by domain (whole server, excluding tests) ----
const reg = new Map();
const serverFiles = walk(path.join(ROOT, "server")).filter((f) => !f.includes("/tests/") && !f.includes("/node_modules/"));
const REG_RE = /\b(?:register|registerLensAction)\(\s*['"]([a-zA-Z0-9_.-]+)['"]\s*,\s*['"]([a-zA-Z0-9_.-]+)['"]/g;
const domainText = new Map();
for (const f of serverFiles) {
  const t = read(f); let m;
  while ((m = REG_RE.exec(t))) { if (!reg.has(m[1])) reg.set(m[1], new Set()); reg.get(m[1]).add(m[2]); }
}
for (const f of fs.readdirSync(path.join(ROOT, "server/domains"))) if (f.endsWith(".js")) domainText.set(f.slice(0, -3), read(path.join(ROOT, "server/domains", f)));

// ---- prior tool outputs ----
const stacking = new Map(JSON.parse(read(path.join(A, "lens-stacking.json"))).rows.map((r) => [r.lens, r]));
const ux = new Map(JSON.parse(read(path.join(A, "ux-polish.json"))).lenses.map((r) => [r.lens, r]));
const depth = JSON.parse(read(path.join(A, "macro-depth-honest.json")));
const byDomain = depth.byDomain;
const W = depth.tierWeights;
const destText = read(path.join(FE, "lib/destinations.ts"));
const absorbedBy = new Map();
for (const m of destText.matchAll(/\{ id: '([a-z0-9-]+)'[^}]*?absorbs: \[([^\]]*)\]/gs)) for (const s of m[2].matchAll(/'([a-z0-9-]+)'/g)) absorbedBy.set(s[1], m[1]);
const destIds = new Set([...destText.matchAll(/\{ id: '([a-z0-9-]+)', name:/g)].map((m) => m[1]));

const lenses = fs.readdirSync(path.join(FE, "app/lenses"), { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith("[")).map((e) => e.name);

const rows = [];
for (const lens of lenses) {
  // files: the lens's page dir, its own components dir, and component dirs its files import (one hop, not shared)
  const files = new Set(walk(path.join(FE, "app/lenses", lens)));
  const compDirs = new Set();
  if (fs.existsSync(path.join(FE, "components", lens))) compDirs.add(lens);
  for (const f of [...files]) for (const m of read(f).matchAll(/@\/components\/([a-z0-9-]+)\//g)) if (!SHARED.has(m[1])) compDirs.add(m[1]);
  for (const d of compDirs) for (const f of walk(path.join(FE, "components", d))) files.add(f);
  const text = [...files].map(read).join("\n");
  const loc = text.split("\n").length;

  // domains it calls
  const doms = new Set();
  for (const m of text.matchAll(/(?:lensRun|runLens|useLensRun|runMacro|callMacro|macro)\(\s*['"]([a-z0-9_-]+)['"]/g)) doms.add(m[1]);
  for (const m of text.matchAll(/domain:\s*['"]([a-z0-9_-]+)['"]/g)) doms.add(m[1]);
  for (const m of text.matchAll(/const\s+DOMAIN\s*=\s*['"]([a-z0-9_-]+)['"]/g)) doms.add(m[1]);
  if (reg.has(lens)) doms.add(lens);
  const ownDoms = [...doms].filter((d) => reg.has(d));

  // primary domain: its own name if registered, else the domain its files reference most
  const freq = new Map();
  for (const d of ownDoms) freq.set(d, (text.match(new RegExp(`['"]${d}['"]`, "g")) || []).length);
  const primary = reg.has(lens) ? lens : ([...freq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null);
  const pReg = primary ? reg.get(primary) : new Set();
  let pSurf = 0; const pUnsurf = [];
  for (const mac of pReg) { if (new RegExp(`['"\`]${mac.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"\`]`).test(text)) pSurf++; else pUnsurf.push(mac); }
  // macros: registered for its own-name domain (or all domains it calls), and how many are named in its files
  let regCount = 0, surfaced = 0;
  const unsurfacedList = [];
  for (const d of ownDoms) {
    for (const mac of reg.get(d)) { regCount++; if (new RegExp(`['"\`]${mac.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"\`]`).test(text)) surfaced++; else unsurfacedList.push(`${d}.${mac}`); }
  }

  // backend depth (honest) over the domains it calls
  let dTot = 0, dW = 0, stubs = 0;
  for (const d of ownDoms) { const b = byDomain[d]; if (!b) continue; dTot += b.total; stubs += b.stub; dW += b.stub * W.stub + b.functional * W.functional + b.utility * W.utility + b["production-grade"] * W["production-grade"]; }
  const depthScore = dTot ? dW / dTot : null;

  // money + identity in its domain files
  const dt = ownDoms.map((d) => domainText.get(d) || "").join("\n");
  const pdt = primary ? (domainText.get(primary) || "") : "";
  const money = (pdt.match(/walletDebit|walletCredit|purchaseWithRoyalties|economy_ledger|mintCoins|transferCoins|creditWallet|debitWallet|marketplace\.(?:list|purchase)|\bprice(?:Cc)?\b/g) || []).length;
  const identityFromInput = (pdt.match(/\b(?:input|params|body|data)\.(?:userId|ownerId|actorId|playerId)\s*(?:\|\||\?\?)\s*(?:ctx|aid|uid|actor)/g) || []).length;

  // fake-data / generic signals in the frontend
  const mathRandom = (text.match(/Math\.random\(/g) || []).length;
  const mockWords = (text.match(/\b(?:mock|MOCK|demo|DEMO|sample[A-Z_]|SAMPLE_|fake|FAKE|dummy|DUMMY|lorem)\w*/g) || []).length;
  const literalArrays = (text.match(/const\s+[A-Z][A-Z0-9_]{2,}\s*(?::[^=]+)?=\s*\[\s*\{/g) || []).length;
  const genericBits = (text.match(/<(?:UniversalActions|LensFeaturePanel|AutoActionStrip|ManifestActionBar)\b/g) || []).length;

  // churn
  let commits = 0;
  try { commits = Number(execSync(`git -C ${ROOT} log --oneline -- concord-frontend/app/lenses/${lens} | wc -l`, { encoding: "utf8" }).trim()); } catch {}

  // capability map: open deferred items
  const cm = read(path.join(ROOT, "docs/lens-specs", `${lens}-capability-map.md`));
  const deferred = cm ? cm.split("\n").filter((l) => /deferred|genuinely missing|not yet|needs? a (?:data source|feed)/i.test(l) && !/closed|shipped|done/i.test(l)).length : null;
  const needsData = cm ? /data.sourcing|needs? (?:a )?(?:real )?(?:feed|data source|api)|licensed data|paid feed/i.test(cm) : false;

  const st = stacking.get(lens), u = ux.get(lens);
  rows.push({
    lens, done: DONE.has(lens), destination: destIds.has(lens) ? lens : (absorbedBy.get(lens) || null), isDestination: destIds.has(lens),
    loc, files: files.size, compDirs: [...compDirs], domains: ownDoms,
    primary, pMacros: pReg.size, pSurfaced: pSurf, pUnsurfaced: pReg.size - pSurf, pUnsurfacedSample: pUnsurf.slice(0, 8),
    macros: regCount, surfaced, unsurfaced: regCount - surfaced,
    depth: depthScore == null ? null : Number(depthScore.toFixed(3)), stubs,
    money, identityFromInput,
    mathRandom, mockWords, literalArrays, genericBits,
    stacking: st?.stackingScore ?? null, uxTier: u?.tier ?? null, uxPillars: u?.pillarsPresent ?? null, uxAnti: u?.antiPatterns ?? null,
    commits, capMap: Boolean(cm), deferred, needsData,
  });
}
fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
console.log(rows.length, "lenses;", rows.filter((r) => r.done).length, "redesigned; →", OUT);
