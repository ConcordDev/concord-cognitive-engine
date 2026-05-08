#!/usr/bin/env node
// server/scripts/cartograph-reason.js
//
// Phase 9 / T4 — Cartograph reasoning pass.
//
// Consumes:
//   - audit/cartograph/SYSTEMS.json  (static graph)
//   - audit/detectors/REPORT.md      (latest detector findings)
//   - audit/detectors/BASELINE.json  (acknowledged set)
//
// Produces three reasoning maps + a combined index:
//   - REASONING_LOAD_BEARING.md  — which modules cascade-break N others if removed
//   - REASONING_STRESS.md        — which modules accumulate the most findings per LOC
//   - REASONING_OPPORTUNITY.md   — orphans worth wiring (smallest blast radius)
//   - REASONING.md / REASONING.json — combined summary
//
// Modes:
//   node scripts/cartograph-reason.js                  # full pass
//   node scripts/cartograph-reason.js --stress-only    # fast (LOC + findings only)
//   node scripts/cartograph-reason.js --diff           # vs previous REASONING.json

import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { walk, readSafe, relPath } from "../lib/detectors/_framework.js";
import { runAllDetectors } from "../lib/detectors/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../");
const OUT_DIR = path.join(REPO_ROOT, "audit", "cartograph");

const args = process.argv.slice(2);
const flags = {
  stressOnly: args.includes("--stress-only"),
  diff: args.includes("--diff"),
  json: args.includes("--json"),
};

async function loadSystems() {
  try {
    const raw = await readFile(path.join(OUT_DIR, "SYSTEMS.json"), "utf-8");
    return JSON.parse(raw);
  } catch { return null; }
}

async function loadPrevReasoning() {
  try {
    const raw = await readFile(path.join(OUT_DIR, "REASONING.json"), "utf-8");
    return JSON.parse(raw);
  } catch { return null; }
}

const IMPORT_RE = /import\s+(?:[^'"`]+?\s+from\s+)?['"`]([^'"`]+)['"`]|require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;

async function buildImportGraph() {
  const adjacency = new Map();
  const reverseAdj = new Map();
  const files = await walk(path.join(REPO_ROOT, "server"), [".js"]);
  for (const f of files) {
    if (/\/tests?\//.test(f) || /\.test\.js$/.test(f)) continue;
    const c = await readSafe(f);
    if (!c) continue;
    if (!adjacency.has(f)) adjacency.set(f, new Set());
    let m;
    IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(c)) != null) {
      const spec = m[1] || m[2];
      if (!spec || (!spec.startsWith(".") && !spec.startsWith("/"))) continue;
      const targetBase = path.resolve(path.dirname(f), spec);
      const tries = [targetBase, targetBase + ".js", targetBase + "/index.js"];
      for (const t of tries) {
        if (files.includes(t)) {
          adjacency.get(f).add(t);
          if (!reverseAdj.has(t)) reverseAdj.set(t, new Set());
          reverseAdj.get(t).add(f);
          break;
        }
      }
    }
  }
  return { adjacency, reverseAdj, files };
}

function transitiveImporters(reverseAdj, target, max = 1000) {
  const out = new Set();
  const queue = [target];
  while (queue.length > 0 && out.size < max) {
    const cur = queue.shift();
    const ups = reverseAdj.get(cur) || new Set();
    for (const u of ups) {
      if (out.has(u)) continue;
      out.add(u);
      queue.push(u);
    }
  }
  return out;
}

function severityWeight(sev) {
  return ({ critical: 4, high: 3, medium: 2, low: 1, info: 0 })[sev] ?? 0;
}

async function loadFindings() {
  console.log("[cartograph-reason] running detectors for stress map…");
  const report = await runAllDetectors({ root: REPO_ROOT });
  const map = new Map(); // path -> { count, weight }
  for (const r of report.reports || []) {
    for (const f of r.findings || []) {
      if (f.severity === "info") continue;
      const loc = (f.location || "").split(":")[0];
      if (!loc) continue;
      if (!map.has(loc)) map.set(loc, { count: 0, weight: 0 });
      map.get(loc).count++;
      map.get(loc).weight += severityWeight(f.severity);
    }
  }
  return { byPath: map, totals: report.totals };
}

async function buildLoadBearingMap(reverseAdj, files) {
  const out = [];
  for (const f of files) {
    const cascade = transitiveImporters(reverseAdj, f);
    if (cascade.size > 0) {
      out.push({
        path: relPath(REPO_ROOT, f),
        directImporters: (reverseAdj.get(f) || new Set()).size,
        cascadeSize: cascade.size,
      });
    }
  }
  out.sort((a, b) => b.cascadeSize - a.cascadeSize);
  return out;
}

async function buildStressMap(files, findings) {
  const out = [];
  for (const f of files) {
    const c = await readSafe(f);
    const loc = c ? c.split("\n").length : 0;
    const rel = relPath(REPO_ROOT, f);
    const stat = findings.byPath.get(rel) || { count: 0, weight: 0 };
    if (stat.weight === 0) continue;
    const stress = loc > 0 ? Math.round((stat.weight / Math.max(loc, 50)) * 1000) / 1000 : 0;
    out.push({
      path: rel,
      loc,
      findingCount: stat.count,
      weight: stat.weight,
      stress,
    });
  }
  out.sort((a, b) => b.stress - a.stress);
  return out;
}

async function buildOpportunityMap(adjacency, reverseAdj, files) {
  const out = [];
  // Tag relevance lookup: small modules whose tags overlap with active clusters.
  const clusterTags = ["economy", "narrative", "self-care", "world", "persistence", "governance"];
  for (const f of files) {
    const fanIn = (reverseAdj.get(f) || new Set()).size;
    if (fanIn > 0) continue; // only orphans
    const rel = relPath(REPO_ROOT, f);
    const c = await readSafe(f);
    const loc = c ? c.split("\n").length : 0;
    if (loc < 10) continue; // skip stubs
    const tags = clusterTags.filter(t => rel.includes(t) || (c && c.toLowerCase().includes(t)));
    out.push({
      path: rel,
      loc,
      tags,
      score: tags.length * 100 - loc, // small modules with good tags rank high
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, 80);
}

function renderTable(rows, columns) {
  const header = `| ${columns.join(" | ")} |\n|${columns.map(() => "---").join("|")}|`;
  const body = rows.map(r => `| ${columns.map(c => r[c] ?? "").join(" | ")} |`).join("\n");
  return `${header}\n${body}`;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log("[cartograph-reason] mode:", flags.stressOnly ? "stress-only" : flags.diff ? "diff" : "full");

  const findings = await loadFindings();

  if (flags.stressOnly) {
    const { adjacency: _adj, reverseAdj: _rev, files } = await buildImportGraph();
    const stress = await buildStressMap(files, findings);
    const md = `# Stress map\n\nGenerated ${new Date().toISOString()}.\nTop modules by detector findings × severity per LOC.\n\n${renderTable(stress.slice(0, 50), ["path", "loc", "findingCount", "weight", "stress"])}\n`;
    await writeFile(path.join(OUT_DIR, "REASONING_STRESS.md"), md);
    console.log(`[cartograph-reason] wrote REASONING_STRESS.md (${stress.length} entries)`);
    return;
  }

  console.log("[cartograph-reason] building import graph…");
  const { adjacency, reverseAdj, files } = await buildImportGraph();
  console.log(`[cartograph-reason]   ${files.length} server modules`);

  const [loadBearing, stress, opportunity] = await Promise.all([
    buildLoadBearingMap(reverseAdj, files),
    buildStressMap(files, findings),
    buildOpportunityMap(adjacency, reverseAdj, files),
  ]);

  const reasoning = {
    generatedAt: new Date().toISOString(),
    stats: { fileCount: files.length, totalFindings: findings.totals.total },
    loadBearing: loadBearing.slice(0, 100),
    stress: stress.slice(0, 100),
    opportunity: opportunity.slice(0, 80),
  };

  // Diff mode — compare against previous REASONING.json
  if (flags.diff) {
    const prev = await loadPrevReasoning();
    if (!prev) { console.log("No prior REASONING.json — skipping diff"); }
    else {
      const prevTopStress = new Set(prev.stress.slice(0, 20).map(x => x.path));
      const nowTopStress = new Set(reasoning.stress.slice(0, 20).map(x => x.path));
      const dropped = [...prevTopStress].filter(p => !nowTopStress.has(p));
      const added = [...nowTopStress].filter(p => !prevTopStress.has(p));
      console.log(`Stress map movement (top 20):\n  added: ${added.join(", ") || "(none)"}\n  dropped: ${dropped.join(", ") || "(none)"}`);
    }
  }

  await writeFile(path.join(OUT_DIR, "REASONING.json"), JSON.stringify(reasoning, null, 2));

  await writeFile(path.join(OUT_DIR, "REASONING_LOAD_BEARING.md"), [
    "# Load-bearing map",
    "",
    `Generated ${reasoning.generatedAt}. Modules ranked by transitive importer cascade size — i.e. if removed, how many other modules' imports break.`,
    "",
    renderTable(loadBearing.slice(0, 50), ["path", "directImporters", "cascadeSize"]),
    "",
  ].join("\n"));

  await writeFile(path.join(OUT_DIR, "REASONING_STRESS.md"), [
    "# Stress map",
    "",
    `Generated ${reasoning.generatedAt}. Modules ranked by (detector findings × severity weight) / LOC. Highest-stress modules are the best candidates for refactor.`,
    "",
    renderTable(stress.slice(0, 50), ["path", "loc", "findingCount", "weight", "stress"]),
    "",
  ].join("\n"));

  await writeFile(path.join(OUT_DIR, "REASONING_OPPORTUNITY.md"), [
    "# Opportunity map",
    "",
    `Generated ${reasoning.generatedAt}. Orphan modules (zero fan-in) ranked by tag-relevance vs LOC. Small modules with active-cluster tags are easiest to wire in.`,
    "",
    renderTable(opportunity.slice(0, 40), ["path", "loc", "tags", "score"]),
    "",
  ].join("\n"));

  await writeFile(path.join(OUT_DIR, "REASONING.md"), [
    "# Cartograph reasoning",
    "",
    `Generated ${reasoning.generatedAt}.`,
    "",
    `- Files scanned: ${files.length}`,
    `- Total active detector findings: ${findings.totals.total}`,
    `- See REASONING_LOAD_BEARING.md, REASONING_STRESS.md, REASONING_OPPORTUNITY.md.`,
    "",
    "## Top 5 most stressful modules",
    "",
    stress.slice(0, 5).map(s => `- \`${s.path}\` — stress ${s.stress} (${s.findingCount} findings, weight ${s.weight}, ${s.loc} LOC)`).join("\n"),
    "",
    "## Top 5 most load-bearing modules",
    "",
    loadBearing.slice(0, 5).map(l => `- \`${l.path}\` — cascadeSize ${l.cascadeSize}`).join("\n"),
    "",
    "## Top 5 wiring opportunities",
    "",
    opportunity.slice(0, 5).map(o => `- \`${o.path}\` — tags [${(o.tags || []).join(", ")}], ${o.loc} LOC, score ${o.score}`).join("\n"),
    "",
  ].join("\n"));

  console.log("[cartograph-reason] DONE — wrote 4 files to", OUT_DIR);
}

main().catch((err) => {
  console.error("[cartograph-reason] failed:", err?.stack || err?.message || err);
  process.exit(1);
});
