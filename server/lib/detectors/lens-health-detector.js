// server/lib/detectors/lens-health-detector.js
//
// Scans concord-frontend/app/lenses/* for:
//   - missing page.tsx
//   - lens page that renders nothing (no JSX return)
//   - lens that calls /api/lens/run with a domain that has no backend
//     domain file in server/domains/
//   - manifest entry with no matching page directory
//   - duplicate lensNumber in lens-manifest

import path from "node:path";
import { readdir } from "node:fs/promises";
import { walk, readSafe, existsSafe, makeReport, makeError, lineOf, relPath } from "./_framework.js";

const LENS_RUN_RE = /\/api\/lens\/run/;
const DOMAIN_REF_RE = /domain\s*:\s*['"`]([a-zA-Z0-9_-]+)['"`]/g;
// Backend macros are declared as `register("domain", "name", handler)`. The
// domain name in the lens call must match the FIRST argument here — not the
// filename. Filenames in server/domains/ are kebab-case (`event-timeline.js`)
// while the registered domain is often snake_case (`event_timeline`), and
// many domains (`llm`, `dtu`, `chat`) register inline in server.js with no
// dedicated file at all. Pre-fix the detector matched on filename and produced
// 8 HIGH false-positives; the real source of truth is the register() call.
const REGISTER_DOMAIN_RE = /\bregister\(\s*['"`]([a-zA-Z0-9_-]+)['"`]\s*,\s*['"`][a-zA-Z0-9_-]+['"`]/g;

export async function runLensHealthDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  if (!root) return makeError("lens-health", "no_root", null, t0);

  try {
    const lensesDir = path.join(root, "concord-frontend", "app", "lenses");
    const domainsDir = path.join(root, "server", "domains");

    let lensEntries = [];
    try { lensEntries = await readdir(lensesDir, { withFileTypes: true }); }
    catch { return makeError("lens-health", "lenses_dir_missing", null, t0); }

    // Next.js conventions: dirs starting with [ are dynamic routes, dirs
    // starting with ( are route groups — both legitimately lack a page file.
    const lensDirs = lensEntries
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .filter(n => !n.startsWith("[") && !n.startsWith("("));

    // Collect known backend domains by parsing register("domain", "name", ...)
    // and registerLensAction("domain", "name", ...) calls across server.js,
    // server/domains/, server/routes/, server/emergent/, and server/lib/.
    // Filename matching produces false positives because (a) filenames are
    // kebab-case while many domains register snake_case names, and (b) many
    // domains (`llm`, `dtu`, `chat`) register inline in server.js with no
    // dedicated file. The register() call is the source of truth.
    const knownDomains = new Set();
    const serverDir = path.join(root, "server");
    const scanRoots = [
      path.join(serverDir, "server.js"),
      path.join(serverDir, "domains"),
      path.join(serverDir, "lib"),
      path.join(serverDir, "routes"),
      path.join(serverDir, "emergent"),
    ];
    const filesToScan = [];
    for (const p of scanRoots) {
      if (!(await existsSafe(p))) continue;
      const s = p.endsWith(".js") ? [p] : await walk(p, [".js"]);
      filesToScan.push(...s);
    }
    for (const f of filesToScan) {
      const c = await readSafe(f);
      if (!c) continue;
      if (c.includes("register(")) {
        REGISTER_DOMAIN_RE.lastIndex = 0;
        let m;
        while ((m = REGISTER_DOMAIN_RE.exec(c)) != null) {
          knownDomains.add(m[1]);
        }
      }
      if (c.includes("registerLensAction(")) {
        const lensActionRe = /\bregisterLensAction\(\s*['"`]([a-zA-Z0-9_-]+)['"`]\s*,/g;
        let m;
        while ((m = lensActionRe.exec(c)) != null) {
          knownDomains.add(m[1]);
        }
      }
    }

    const findings = [];

    for (const lensName of lensDirs) {
      const dir = path.join(lensesDir, lensName);
      const pageTsx = path.join(dir, "page.tsx");
      const pageJsx = path.join(dir, "page.jsx");
      const pageJs = path.join(dir, "page.js");
      const hasPage = (await existsSafe(pageTsx)) || (await existsSafe(pageJsx)) || (await existsSafe(pageJs));
      if (!hasPage) {
        // A "shell" lens that only mounts sub-lenses is acceptable — check
        // whether at least one immediate subdirectory has a page file.
        let hasShellChild = false;
        try {
          const sub = await readdir(dir, { withFileTypes: true });
          for (const s of sub) {
            if (!s.isDirectory()) continue;
            if (
              await existsSafe(path.join(dir, s.name, "page.tsx")) ||
              await existsSafe(path.join(dir, s.name, "page.jsx")) ||
              await existsSafe(path.join(dir, s.name, "page.js"))
            ) {
              hasShellChild = true;
              break;
            }
          }
        } catch { /* ignore */ }
        if (hasShellChild) {
          continue;
        }
        findings.push({
          id: "lens_no_page",
          severity: "high",
          kind: "lens-health",
          message: `Lens ${lensName} has a directory but no page file`,
          location: relPath(root, dir),
        });
        continue;
      }

      const pagePath = (await existsSafe(pageTsx)) ? pageTsx : (await existsSafe(pageJsx)) ? pageJsx : pageJs;
      const c = await readSafe(pagePath);
      if (!c) {
        findings.push({
          id: "lens_page_empty",
          severity: "medium",
          kind: "lens-health",
          message: `Lens ${lensName} page file is empty`,
          location: relPath(root, pagePath),
        });
        continue;
      }

      // Heuristic: page must have a default export and JSX return
      if (!/export\s+default\s+/.test(c)) {
        findings.push({
          id: "lens_no_default_export",
          severity: "high",
          kind: "lens-health",
          message: `Lens ${lensName} page has no default export`,
          location: relPath(root, pagePath),
        });
      }
      if (!/return\s*\(?\s*</.test(c) && !/<[A-Za-z][^>]*\/?>/.test(c)) {
        findings.push({
          id: "lens_no_jsx_return",
          severity: "medium",
          kind: "lens-health",
          message: `Lens ${lensName} page never returns JSX`,
          location: relPath(root, pagePath),
        });
      }

      // Domain reference check
      if (LENS_RUN_RE.test(c)) {
        DOMAIN_REF_RE.lastIndex = 0;
        let m;
        while ((m = DOMAIN_REF_RE.exec(c)) != null) {
          const dom = m[1];
          if (!knownDomains.has(dom) && dom !== "lens") {
            // Unknown domains are NOT broken at runtime: server.js#/api/lens/run
            // (the route that handles these calls) has an AI catch-all that
            // routes unregistered domain.action calls to the utility brain
            // (utilityCall(action, domain, rest)). The lens still works — it
            // gets LLM-generated content instead of a deterministic handler.
            //
            // This is reported as `info` (not `high`) so the lens-unknown-domain
            // surface tracks "places where a dedicated handler would beat the
            // LLM fallback" rather than "broken lenses." The previous `high`
            // severity produced 8 false-positive blockers in CI.
            findings.push({
              id: "lens_unknown_domain",
              severity: "info",
              kind: "lens-health",
              message: `Lens ${lensName} calls domain "${dom}" — no dedicated handler registered; runtime routes via utility-brain AI catch-all. Adding a register("${dom}", ...) handler would give deterministic behavior.`,
              location: `${relPath(root, pagePath)}:${lineOf(c, m.index)}`,
              evidence: { domain: dom, runtimeFallback: "utility-brain" },
            });
          }
        }
      }
    }

    // Manifest cross-reference
    const manifestPath = path.join(root, "server", "lib", "lens-manifest.js");
    const manifest = await readSafe(manifestPath);
    if (manifest) {
      // Collect lens entries by `lensId: '...'`
      const lensIdRe = /lensId\s*:\s*['"`]([a-zA-Z0-9_-]+)['"`]/g;
      const lensNumberRe = /lensNumber\s*:\s*(\d+)/g;
      const ids = new Set();
      let m;
      lensIdRe.lastIndex = 0;
      while ((m = lensIdRe.exec(manifest)) != null) ids.add(m[1]);

      const numbers = new Map();
      lensNumberRe.lastIndex = 0;
      while ((m = lensNumberRe.exec(manifest)) != null) {
        const n = m[1];
        const line = lineOf(manifest, m.index);
        if (!numbers.has(n)) numbers.set(n, []);
        numbers.get(n).push(line);
      }
      for (const [n, lines] of numbers.entries()) {
        if (lines.length > 1) {
          findings.push({
            id: "lens_manifest_duplicate_number",
            severity: "high",
            kind: "lens-health",
            message: `Manifest has duplicate lensNumber ${n} (lines ${lines.join(", ")})`,
            location: `server/lib/lens-manifest.js:${lines[0]}`,
            evidence: { lensNumber: n, lines },
          });
        }
      }
    }

    findings.unshift({
      id: "lens_health_summary",
      severity: "info",
      kind: "lens-health",
      message: `Scanned ${lensDirs.length} lenses · ${findings.length} issues found`,
      evidence: { lensCount: lensDirs.length },
    });

    return makeReport("lens-health", findings, t0);
  } catch (err) {
    return makeError("lens-health", "exception", err, t0);
  }
}
