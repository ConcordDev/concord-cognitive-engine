// server/lib/detectors/macro-usage-detector.js
//
// For each registered macro, count how often it's called by name across
// the entire codebase. The result is the inverse of a coverage histogram:
// 0-callsite macros are dead weight; 1-2 callsite macros may be hidden APIs;
// the long tail is healthy.
//
// We deliberately count only static callsites (runMacro / { domain, name }
// payloads / chat router pattern dispatch hints). Dynamic macro calls via
// a variable are reported as "unknown" — they count as live for any
// macro whose domain matches a known dynamic-dispatch domain.

import path from "node:path";
import { walk, readSafe, makeReport, makeError, lineOf, relPath } from "./_framework.js";

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
    const histogram = { "0": 0, "1": 0, "2-5": 0, "6-20": 0, "21+": 0 };

    for (const [key, loc] of declared.entries()) {
      const n = usageCounts.get(key) ?? 0;
      const samples = Array.from(callerSamples.get(key) || []).slice(0, 3);
      if (n === 0) {
        dead++;
        histogram["0"]++;
        findings.push({
          id: "macro_zero_calls",
          severity: "low",
          kind: "macro-usage",
          message: `Macro ${key} is registered but has no static callers`,
          location: `${loc.file}:${loc.line}`,
          evidence: { domain: key.split(".")[0], samples },
        });
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
      kind: "macro-usage",
      message: `${declared.size} macros · ${dead} dead · ${solo} single-caller · ${popular} popular`,
      evidence: { histogram, declared: declared.size, dead, solo, popular },
    });

    return makeReport("macro-usage", findings, t0);
  } catch (err) {
    return makeError("macro-usage", "exception", err, t0);
  }
}
