// server/lib/detectors/architectural-hub-detector.js
//
// Phase 6 / T1 — architectural kind detector.
//
// Reads audit/cartograph/SYSTEMS.json (or computes a fresh import graph
// when the cartograph hasn't been run). Computes per-module:
//   - fan-in   (how many files import this module)
//   - fan-out  (how many imports inside this module)
//   - centrality (a simple betweenness approximation)
//
// Emits findings:
//   - fan-in > 50 → high (split risk)
//   - fan-in × fan-out > 1000 → critical (hub-of-hubs)
//   - cycle in import graph involving > 3 modules → high

import path from "node:path";
import { readFile } from "node:fs/promises";
import { walk, readSafe, makeReport, makeError, relPath } from "./_framework.js";

const FAN_IN_THRESHOLD = 50;
const HUB_OF_HUBS_THRESHOLD = 1000;
const IMPORT_RE = /import\s+(?:[^'"`]+?\s+from\s+)?['"`]([^'"`]+)['"`]|require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;

async function buildImportGraph(root) {
  const adjacency = new Map();   // module -> Set<imports>
  const reverseAdj = new Map();  // module -> Set<importers>

  const files = await walk(path.join(root, "server"), [".js"]);
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
        if (adjacency.has(t) || files.includes(t)) {
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

function detectCycles(adjacency, max = 50) {
  const visited = new Set();
  const cycles = [];
  function dfs(node, stack) {
    if (cycles.length >= max) return;
    if (stack.has(node)) {
      const start = [...stack].indexOf(node);
      const cycle = [...stack].slice(start).concat(node);
      if (cycle.length > 3) cycles.push(cycle);
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    stack.add(node);
    const out = adjacency.get(node) || new Set();
    for (const n of out) dfs(n, stack);
    stack.delete(node);
  }
  for (const node of adjacency.keys()) {
    dfs(node, new Set());
    if (cycles.length >= max) break;
  }
  return cycles;
}

export async function runArchitecturalHubDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  if (!root) return makeError("architectural-hub", "no_root", null, t0);

  try {
    const findings = [];
    const { adjacency, reverseAdj, files } = await buildImportGraph(root);

    let hubsCount = 0, hubOfHubs = 0, cyclesCount = 0, leafUtilities = 0;
    for (const f of files) {
      const fanIn = (reverseAdj.get(f) || new Set()).size;
      const fanOut = (adjacency.get(f) || new Set()).size;
      if (fanIn <= FAN_IN_THRESHOLD) continue;

      // Leaf utility demotion — a module with fan-out 0 imports nothing
      // local, so it does no orchestration work. Loggers, type-only
      // re-export modules, constants files all land here. They are widely
      // imported by design; "splitting" them just moves the leaf to a
      // different path. Demote to info, not "split risk".
      const isLeafUtility = fanOut === 0;
      if (isLeafUtility) {
        leafUtilities++;
        findings.push({
          id: "architectural_leaf_utility",
          severity: "info",
          kind: "architectural",
          category: "structure",
          subject: { kind: "module", path: relPath(root, f) },
          message: `Module ${relPath(root, f)} fan-in=${fanIn} fan-out=0 (leaf utility — wide use is by design)`,
          location: relPath(root, f),
          evidence: { fanIn, fanOut, kind: "leaf_utility" },
        });
        continue;
      }

      hubsCount++;
      const product = fanIn * fanOut;
      const isHubOfHubs = product > HUB_OF_HUBS_THRESHOLD;
      if (isHubOfHubs) hubOfHubs++;
      findings.push({
        id: isHubOfHubs ? "architectural_hub_of_hubs" : "architectural_hub_split_risk",
        severity: isHubOfHubs ? "critical" : "high",
        kind: "architectural",
        category: "structure",
        subject: { kind: "module", path: relPath(root, f) },
        message: `Module ${relPath(root, f)} fan-in=${fanIn} fan-out=${fanOut}${isHubOfHubs ? " (hub-of-hubs)" : ""}`,
        location: relPath(root, f),
        evidence: { fanIn, fanOut, product },
        fixHint: "split_module",
      });
      if (findings.length >= 60) break;
    }

    // Cycle detection
    const cycles = detectCycles(adjacency, 20);
    cyclesCount = cycles.length;
    for (const cycle of cycles.slice(0, 10)) {
      const rels = cycle.map(c => relPath(root, c));
      findings.push({
        id: "architectural_import_cycle",
        severity: "high",
        kind: "architectural",
        category: "structure",
        message: `Import cycle of ${cycle.length} modules: ${rels.slice(0, 4).join(" → ")}${rels.length > 4 ? " → …" : ""}`,
        location: rels[0],
        evidence: { cycle: rels },
        fixHint: "break_cycle_via_interface",
      });
    }

    findings.unshift({
      id: "architectural_hub_summary",
      severity: "info",
      kind: "architectural",
      category: "structure",
      message: `Scanned ${files.length} server modules · ${hubsCount} hubs · ${hubOfHubs} hub-of-hubs · ${cyclesCount} cycles`,
      evidence: { fileCount: files.length, hubsCount, hubOfHubs, cyclesCount },
    });

    return makeReport("architectural-hub", findings, t0);
  } catch (err) {
    return makeError("architectural-hub", "exception", err, t0);
  }
}
