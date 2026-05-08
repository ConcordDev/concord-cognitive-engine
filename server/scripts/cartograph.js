#!/usr/bin/env node
// server/scripts/cartograph.js
//
// CLI entry for the Concord codebase cartographer.
//
// Usage:
//   node server/scripts/cartograph.js                     # full run
//   node server/scripts/cartograph.js --static            # skip runtime boot
//   node server/scripts/cartograph.js --json-only         # SYSTEMS.json only
//   node server/scripts/cartograph.js --diff              # diff vs committed
//
// Outputs land in audit/cartograph/.

import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { staticParseAll } from "./cartographer/static-parse.js";
import { runtimeIntrospect } from "./cartographer/runtime-introspect.js";
import { crossReferenceAll } from "./cartographer/cross-reference.js";
import { computeCoverage } from "./cartographer/universe-coverage.js";
import { renderAll } from "./cartographer/render.js";
import { NOVELTY_TAGS } from "./cartographer/novelty-tags.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../");
const OUT_DIR = path.join(REPO_ROOT, "audit", "cartograph");

const args = process.argv.slice(2);
const flags = {
  static:    args.includes("--static"),
  jsonOnly:  args.includes("--json-only"),
  diff:      args.includes("--diff"),
};

async function main() {
  const t0 = Date.now();
  await mkdir(OUT_DIR, { recursive: true });

  console.log("[cartograph] static parse…");
  const staticData = await staticParseAll(REPO_ROOT);
  console.log(`[cartograph]   ${staticData.tables.length} tables, ${staticData.routes.length} routes, ${staticData.socketEvents.length} socket events, ${staticData.envVars.length} env vars in ${staticData.elapsedMs}ms`);

  let runtimeData;
  if (flags.static) {
    console.log("[cartograph] --static: skipping runtime introspect");
    runtimeData = { booted: false, reason: "static_mode" };
  } else {
    console.log("[cartograph] runtime introspect (booting child)…");
    runtimeData = await runtimeIntrospect(REPO_ROOT);
    if (runtimeData.booted) {
      console.log(`[cartograph]   booted in ${runtimeData.bootDurationMs}ms; ${runtimeData.macros.length} macros, ${runtimeData.heartbeats.length} heartbeats, ${runtimeData.lensManifests.length} lens manifests, ${runtimeData.moduleRegistry.length} modules`);
    } else {
      console.log(`[cartograph]   runtime introspect failed: ${runtimeData.reason}`);
    }
  }

  console.log("[cartograph] cross-reference…");
  const crossRef = await crossReferenceAll(REPO_ROOT, staticData, runtimeData);
  console.log(`[cartograph]   ${crossRef.deadTables.length} dead tables, ${crossRef.orphanModules.length} orphan modules, ${crossRef.dormantModules.length} dormant modules, ${crossRef.headlessBackends.length} headless backends, ${crossRef.orphanLenses.length} orphan lenses`);

  console.log("[cartograph] universe coverage…");
  const coverage = computeCoverage(staticData, runtimeData);
  const inScope = coverage.filter(c => c.scope === "in");
  const present = inScope.filter(c => c.status === "present").length;
  console.log(`[cartograph]   ${present}/${inScope.length} in-scope categories present`);

  // Drift detection — comments-vs-truth
  const drift = await detectDrift(REPO_ROOT, staticData, runtimeData);

  const stats = {
    tableCount: staticData.tables.length,
    routeCount: staticData.routes.length,
    macroCount: runtimeData.macros?.length ?? staticData.macroCallsites.length,
    macroDomainCount: new Set((runtimeData.macros ?? staticData.macroCallsites).map(m => m.domain)).size,
    heartbeatCount: runtimeData.heartbeats?.length ?? staticData.heartbeatCallsites.length,
    lensCount: staticData.lensDirs.length,
    moduleCount: runtimeData.moduleRegistry?.length ?? 0,
    deadTableCount: crossRef.deadTables.length,
    orphanModuleCount: crossRef.orphanModules.length,
    dormantModuleCount: crossRef.dormantModules.length,
    coverageInScope: inScope.length,
    coveragePresent: present,
  };

  const report = {
    generatedAt: new Date().toISOString(),
    generatedBy: `cartographer-${process.version}`,
    static: {
      tables:        staticData.tables,
      routes:        staticData.routes,
      socketEvents:  staticData.socketEvents,
      envVars:       staticData.envVars,
      migrations:    staticData.migrations,
      lensDirs:      staticData.lensDirs,
      heartbeatCallsites: staticData.heartbeatCallsites,
      macroCallsites:     staticData.macroCallsites,
      tableRefs:     staticData.tableRefs,
    },
    runtime: {
      booted: runtimeData.booted,
      bootDurationMs:  runtimeData.bootDurationMs ?? 0,
      reason:          runtimeData.reason ?? null,
      macros:          runtimeData.macros ?? [],
      heartbeats:      runtimeData.heartbeats ?? [],
      lensManifests:   runtimeData.lensManifests ?? [],
      moduleRegistry:  runtimeData.moduleRegistry ?? [],
      ghostFleetStatus: runtimeData.ghostFleetStatus ?? [],
    },
    crossRef,
    coverage,
    novelty: NOVELTY_TAGS.map(n => ({ moduleId: n.moduleId, tag: n.tag, reason: n.title })),
    drift,
    stats,
  };

  const jsonPath = path.join(OUT_DIR, "SYSTEMS.json");
  const stable = stableStringify(report);
  await writeFile(jsonPath, stable + "\n", "utf-8");
  console.log(`[cartograph] wrote ${jsonPath} (${stable.length} bytes)`);

  if (flags.diff) {
    return runDiff(jsonPath, stable);
  }

  if (!flags.jsonOnly) {
    console.log("[cartograph] rendering markdown + dot…");
    await renderAll(OUT_DIR, report, NOVELTY_TAGS);
    console.log(`[cartograph] wrote SYSTEMS.md / GAPS.md / NOVEL.md / CARTOGRAPH_DRIFT.md / CARTOGRAPH_WIRING_STATUS.md / systems-graph.dot`);
  }

  console.log(`[cartograph] DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return 0;
}

async function runDiff(jsonPath, currentStable) {
  let prior;
  try {
    prior = await readFile(jsonPath + ".prev", "utf-8");
  } catch {
    // First run — no diff to compute. Save snapshot for next time.
    await writeFile(jsonPath + ".prev", currentStable + "\n", "utf-8");
    console.log("[cartograph] --diff: no prior snapshot, baseline saved");
    return 0;
  }
  const priorObj = JSON.parse(prior);
  const currentObj = JSON.parse(currentStable);
  const drifts = diffStable(priorObj, currentObj);
  if (drifts.length === 0) {
    console.log("[cartograph] --diff: no impactful changes");
    return 0;
  }
  console.log(`[cartograph] --diff: ${drifts.length} impactful field(s) changed:`);
  for (const d of drifts) console.log(`  - ${d.path}: ${d.from} → ${d.to}`);
  // Update snapshot only when explicitly told via env var
  if (process.env.CONCORD_CARTOGRAPHER_ACCEPT === "true") {
    await writeFile(jsonPath + ".prev", currentStable + "\n", "utf-8");
    console.log("[cartograph] --diff: snapshot updated (CONCORD_CARTOGRAPHER_ACCEPT=true)");
    return 0;
  }
  return 1;
}

function diffStable(prior, current) {
  const out = [];
  // Compare only impactful counts/fields
  const fields = [
    ["stats.macroCount"], ["stats.heartbeatCount"], ["stats.tableCount"],
    ["stats.routeCount"], ["stats.lensCount"], ["stats.moduleCount"],
    ["stats.deadTableCount"], ["stats.orphanModuleCount"], ["stats.dormantModuleCount"],
    ["stats.coverageInScope"], ["stats.coveragePresent"],
  ];
  for (const [pth] of fields) {
    const p = getPath(prior, pth);
    const c = getPath(current, pth);
    if (p !== c) out.push({ path: pth, from: p, to: c });
  }
  return out;
}

function getPath(obj, dotPath) {
  return dotPath.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}

/** Deterministic JSON: object keys sorted, arrays preserve order. */
function stableStringify(obj) {
  return JSON.stringify(obj, (key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const sorted = {};
      for (const k of Object.keys(value).sort()) sorted[k] = value[k];
      return sorted;
    }
    return value;
  }, 2);
}

async function detectDrift(repoRoot, staticData, runtimeData) {
  const drift = [];
  // server.js Ghost Fleet header — comment may say a count that's wrong
  try {
    const serverJs = await readFile(path.join(repoRoot, "server", "server.js"), "utf-8");
    const ghostCommentMatch = serverJs.match(/Wire\s+(\d+)\s+Dormant\s+Emergent\s+Modules/i);
    if (ghostCommentMatch) {
      const claim = parseInt(ghostCommentMatch[1], 10);
      // Count register("d", "n", ...) inside initGhostFleet block
      const ghostFleetStart = serverJs.indexOf("async function initGhostFleet");
      const ghostFleetEnd = serverJs.indexOf("// ── Artifact Garbage Collection", ghostFleetStart);
      const block = ghostFleetStart > -1 && ghostFleetEnd > -1
        ? serverJs.slice(ghostFleetStart, ghostFleetEnd)
        : "";
      const registerCount = (block.match(/await import\(/g) || []).length;
      if (Math.abs(claim - registerCount) >= 2) {
        const lineN = lineOfMatch(serverJs, ghostCommentMatch.index);
        drift.push({
          file: "server/server.js",
          line: lineN,
          claim: `${claim} dormant modules`,
          actual: registerCount,
          delta: registerCount - claim,
        });
      }
    }
  } catch { /* ignore */ }

  // Heartbeat count drift — CLAUDE.md sometimes states a number
  try {
    const claudeMd = await readFile(path.join(repoRoot, "CLAUDE.md"), "utf-8");
    const hbMatch = claudeMd.match(/(\d+)\s+heartbeats?\s+registered/i);
    if (hbMatch) {
      const claim = parseInt(hbMatch[1], 10);
      const actual = runtimeData.heartbeats?.length ?? staticData.heartbeatCallsites.length;
      if (Math.abs(claim - actual) >= 2) {
        drift.push({
          file: "CLAUDE.md",
          line: lineOfMatch(claudeMd, hbMatch.index),
          claim: `${claim} heartbeats registered`,
          actual,
          delta: actual - claim,
        });
      }
    }
  } catch { /* ignore */ }

  // Lens count drift
  try {
    const claudeMd = await readFile(path.join(repoRoot, "CLAUDE.md"), "utf-8");
    const lensMatch = claudeMd.match(/(\d+)\s+(?:domain\s+)?lenses?/i);
    if (lensMatch) {
      const claim = parseInt(lensMatch[1], 10);
      const actual = staticData.lensDirs.length;
      if (Math.abs(claim - actual) >= 5) {
        drift.push({
          file: "CLAUDE.md",
          line: lineOfMatch(claudeMd, lensMatch.index),
          claim: `${claim} lenses`,
          actual,
          delta: actual - claim,
        });
      }
    }
  } catch { /* ignore */ }

  return drift;
}

function lineOfMatch(content, idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) if (content.charCodeAt(i) === 10) n++;
  return n;
}

main().then(code => process.exit(code ?? 0)).catch(err => {
  console.error("[cartograph] fatal:", err?.stack || err?.message);
  process.exit(2);
});
