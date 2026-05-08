// server/lib/detectors/macro-usage-detector.js
//
// For each registered macro, count how often it's called by name across
// the entire codebase. The result is the inverse of a coverage histogram:
// 0-callsite macros are dead weight; 1-2 callsite macros may be hidden APIs;
// the long tail is healthy.
//
// Recognizes three reach paths:
//   1. Static calls — runMacro("d", "n", …) and { domain: "d", name: "n" } payloads.
//   2. Open dispatchers — files annotated `// @macro-dispatcher` that do
//      runMacro(<var>, <var>, …) reach EVERY registered macro. Macros with
//      only this reach path are downgraded to severity:info with a
//      `dispatcher_reach` note.
//   3. Lens manifests — server/lib/lens-manifest.js declarations.

import path from "node:path";
import {
  walk, readSafe, makeReport, makeError, lineOf, relPath,
  loadOpenDispatchers, loadLensManifestMacros,
} from "./_framework.js";

const REGISTER_RE = /register\s*\(\s*['"`]([a-zA-Z0-9_-]+)['"`]\s*,\s*['"`]([a-zA-Z0-9_.\-]+)['"`]/g;
const RUN_MACRO_RE = /runMacro\s*\(\s*['"`]([a-zA-Z0-9_-]+)['"`]\s*,\s*['"`]([a-zA-Z0-9_.\-]+)['"`]/g;
const LENS_RUN_BODY_RE = /domain\s*:\s*['"`]([a-zA-Z0-9_-]+)['"`]\s*,\s*name\s*:\s*['"`]([a-zA-Z0-9_.\-]+)['"`]/g;

export async function runMacroUsageDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  if (!root) return makeError("macro-usage", "no_root", null, t0);

  try {
    const serverDir = path.join(root, "server");
    const frontendDir = path.join(root, "concord-frontend");
    const allFiles = [
      ...await walk(serverDir, [".js"]),
      ...await walk(frontendDir, [".js", ".ts", ".tsx", ".jsx"]),
    ];

    const dispatchers = await loadOpenDispatchers(root);
    const manifestKeys = await loadLensManifestMacros(root);

    const declared = new Map();           // domain.name -> {file, line}
    const usageCounts = new Map();        // domain.name -> n
    const callerSamples = new Map();      // domain.name -> Set("file:line")

    for (const f of allFiles) {
      const c = await readSafe(f);
      if (!c) continue;
      const isTest = /\/tests?\//.test(f);
      const isServerJs = /server\/server\.js$/.test(f);

      if (!isTest && isServerJs) {
        let m;
        REGISTER_RE.lastIndex = 0;
        while ((m = REGISTER_RE.exec(c)) != null) {
          const key = `${m[1]}.${m[2]}`;
          if (!declared.has(key)) declared.set(key, { file: relPath(root, f), line: lineOf(c, m.index) });
        }
      }
      let m;
      RUN_MACRO_RE.lastIndex = 0;
      while ((m = RUN_MACRO_RE.exec(c)) != null) {
        const key = `${m[1]}.${m[2]}`;
        usageCounts.set(key, (usageCounts.get(key) || 0) + 1);
        if (!callerSamples.has(key)) callerSamples.set(key, new Set());
        callerSamples.get(key).add(`${relPath(root, f)}:${lineOf(c, m.index)}`);
      }
      LENS_RUN_BODY_RE.lastIndex = 0;
      while ((m = LENS_RUN_BODY_RE.exec(c)) != null) {
        const key = `${m[1]}.${m[2]}`;
        usageCounts.set(key, (usageCounts.get(key) || 0) + 1);
      }
    }

    const findings = [];
    let dead = 0;
    let solo = 0;
    let popular = 0;
    let dispatcherReach = 0;
    const histogram = { "0": 0, "1": 0, "2-5": 0, "6-20": 0, "21+": 0 };

    const dispatcherActive = dispatchers.length > 0;

    for (const [key, loc] of declared.entries()) {
      const n = usageCounts.get(key) ?? 0;
      const samples = Array.from(callerSamples.get(key) || []).slice(0, 3);
      const inManifest = manifestKeys.has(key);

      if (n === 0) {
        histogram["0"]++;
        // Reachable via dispatcher OR lens manifest? Downgrade.
        if (dispatcherActive || inManifest) {
          dispatcherReach++;
          findings.push({
            id: "macro_dispatcher_reach",
            severity: "info",
            kind: "static",
            category: "macro-usage",
            message: `Macro ${key} has no static callers but is reachable via ${
              inManifest ? "lens manifest" : "open dispatcher"
            }`,
            location: `${loc.file}:${loc.line}`,
            evidence: {
              domain: key.split(".")[0],
              dispatcher: dispatchers[0]?.file ?? null,
              inManifest,
            },
          });
        } else {
          dead++;
          findings.push({
            id: "macro_zero_calls",
            severity: "low",
            kind: "static",
            category: "macro-usage",
            message: `Macro ${key} is registered but has no static callers`,
            location: `${loc.file}:${loc.line}`,
            evidence: { domain: key.split(".")[0], samples },
            fixHint: "verify_dynamic_dispatch_or_remove",
          });
        }
      } else if (n === 1) {
        solo++;
        histogram["1"]++;
      } else if (n <= 5) histogram["2-5"]++;
      else if (n <= 20) histogram["6-20"]++;
      else { histogram["21+"]++; popular++; }
    }

    // Headline summary as info-level finding so the lens UI shows the histogram.
    findings.unshift({
      id: "macro_usage_summary",
      severity: "info",
      kind: "static",
      category: "macro-usage",
      message: `${declared.size} macros · ${dead} dead · ${solo} single-caller · ${popular} popular · ${dispatcherReach} dispatcher-reach`,
      evidence: {
        histogram, declared: declared.size, dead, solo, popular, dispatcherReach,
        dispatchers: dispatchers.map(d => d.file),
        manifestMacroCount: manifestKeys.size,
      },
    });

    // One dispatcher_reach finding per registered dispatcher so the
    // mechanism is observable in reports.
    for (const d of dispatchers) {
      findings.push({
        id: "dispatcher_reach",
        severity: "info",
        kind: "static",
        category: "macro-usage",
        message: `Open dispatcher detected — all macros reachable via ${d.file}:${d.line}`,
        location: `${d.file}:${d.line}`,
        evidence: { domainVar: d.domainVar, nameVar: d.nameVar },
      });
    }

    return makeReport("macro-usage", findings, t0);
  } catch (err) {
    return makeError("macro-usage", "exception", err, t0);
  }
}
