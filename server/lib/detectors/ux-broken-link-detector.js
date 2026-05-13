// server/lib/detectors/ux-broken-link-detector.js
//
// Catches the "ghost link" pattern — `<Link href="/X">` or
// `router.push('/X')` where the destination route doesn't exist
// under `concord-frontend/app/`. Clicking the link 404s, which
// usually shows a generic page-not-found and burns the click.
//
// Scope: app-router routes only. External URLs (http://…), hash-only
// anchors (#section), mailto:, tel:, and dynamic-segment routes
// (with `${var}` interpolations) are skipped — the destination is
// not statically verifiable.

import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { makeReport, makeError } from "./_framework.js";

const CATEGORY = "ux-broken-link";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../");

const SCAN_DIRS = ["concord-frontend/app", "concord-frontend/components", "concord-frontend/lib"];
const APP_DIR = "concord-frontend/app";
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "coverage", "dist", "build", "out", "__tests__", "stories"]);
const ANNOTATION_OK_RE = /@broken-link-ok\b/;

async function* walk(root, base = root) {
  let entries;
  try { entries = await readdir(base, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(base, entry.name);
    if (entry.isDirectory()) yield* walk(root, full);
    else if (entry.isFile()) yield path.relative(root, full);
  }
}

function shouldScan(rel) {
  if (!/\.(tsx|ts|jsx|js)$/.test(rel)) return false;
  if (!SCAN_DIRS.some(p => rel.startsWith(p + "/"))) return false;
  if (/\.(test|spec|stories)\.(tsx|ts|jsx|js)$/.test(rel)) return false;
  return true;
}

// Collect every existing app route. The app router resolves
// `app/foo/bar/page.tsx` to `/foo/bar`, `app/(group)/foo/page.tsx`
// to `/foo` (route groups are URL-invisible), and
// `app/[id]/page.tsx` to a dynamic segment matching any value.
async function collectAppRoutes(repoRoot) {
  const routes = new Set(["/"]); // root layout is always reachable
  const dynamicPatterns = []; // regex patterns for dynamic segments
  const appAbs = path.join(repoRoot, APP_DIR);
  for await (const rel of walk(appAbs)) {
    if (!/page\.(tsx|ts|jsx|js)$/.test(rel)) continue;
    const segments = path.dirname(rel).split(path.sep);
    const urlSegments = [];
    let isDynamic = false;
    for (const s of segments) {
      if (s.startsWith("(") && s.endsWith(")")) continue; // route group
      if (s.startsWith("[") && s.endsWith("]")) { urlSegments.push("__DYN__"); isDynamic = true; }
      else if (s !== "" && s !== ".") urlSegments.push(s);
    }
    const url = "/" + urlSegments.join("/");
    if (isDynamic) {
      const pat = "^" + url.replace(/\//g, "\\/").replace(/__DYN__/g, "[^\\/]+") + "(?:\\/[^?#]*)?$";
      dynamicPatterns.push(new RegExp(pat));
    } else {
      routes.add(url);
    }
  }
  return { routes, dynamicPatterns };
}

const LINK_HREF_RE = /<Link\b[^>]*?\bhref\s*=\s*['"`]([^'"`]+)['"`]/g;
const ROUTER_PUSH_RE = /\brouter\.(?:push|replace)\s*\(\s*['"`]([^'"`]+)['"`]/g;
const A_HREF_RE = /<a\b[^>]*?\bhref\s*=\s*['"`](\/[^'"`]+)['"`]/g; // only same-origin anchors

function lineNumberAt(content, idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) if (content.charCodeAt(i) === 10) n++;
  return n;
}

function routeMatches(href, routes, dynamicPatterns) {
  // Strip query / hash for matching.
  const clean = href.replace(/[?#].*$/, "");
  if (routes.has(clean)) return true;
  for (const p of dynamicPatterns) if (p.test(clean)) return true;
  return false;
}

function isExternalOrSpecial(href) {
  if (/^(https?:|mailto:|tel:|ftp:|ws:|wss:|data:|blob:)/.test(href)) return true;
  if (href.startsWith("#") || href.startsWith("?")) return true;
  if (href.includes("${")) return true; // dynamic interpolation — not statically resolvable
  if (!href.startsWith("/")) return true; // relative — context-dependent
  return false;
}

export async function runUxBrokenLinkDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  const repoRoot = root || REPO_ROOT;
  const findings = [];
  const findingCap = Number.isFinite(opts.findingCap) ? opts.findingCap : 500;
  let scanned = 0;

  let routeMap;
  try {
    routeMap = await collectAppRoutes(repoRoot);
  } catch (err) {
    return makeError(CATEGORY, "route_collection_failed", err, t0);
  }
  const { routes, dynamicPatterns } = routeMap;
  if (routes.size <= 1 && dynamicPatterns.length === 0) {
    // No app/ dir — degrade gracefully (empty fixture, etc.).
    const r = makeReport(CATEGORY, [], t0);
    r.scanned = 0;
    r.routeCount = routes.size;
    return r;
  }

  try {
    for await (const rel of walk(repoRoot)) {
      if (findings.length >= findingCap) break;
      if (!shouldScan(rel)) continue;
      scanned++;
      let content;
      try { content = await readFile(path.join(repoRoot, rel), "utf-8"); } catch { continue; }
      if (content.split("\n").slice(0, 5).some(l => ANNOTATION_OK_RE.test(l))) continue;
      const fileLines = content.split("\n");
      const matchers = [
        { re: LINK_HREF_RE.source, kind: "Link", suggestion: "Verify the route exists under concord-frontend/app/, or update the href to an existing path." },
        { re: ROUTER_PUSH_RE.source, kind: "router.push", suggestion: "Confirm the destination route exists, or replace with an existing path." },
        { re: A_HREF_RE.source, kind: "<a href>", suggestion: "Same-origin anchor pointing to a non-existent app route." },
      ];
      for (const { re, kind, suggestion } of matchers) {
        const r2 = new RegExp(re, "g");
        let m;
        while ((m = r2.exec(content)) != null) {
          const href = m[1];
          if (isExternalOrSpecial(href)) continue;
          if (routeMatches(href, routes, dynamicPatterns)) continue;
          const lineNum = lineNumberAt(content, m.index);
          const here = fileLines[lineNum - 1] || "";
          const prev = fileLines[lineNum - 2] || "";
          if (ANNOTATION_OK_RE.test(here) || ANNOTATION_OK_RE.test(prev)) continue;
          findings.push({
            id: "broken_link",
            severity: "high",
            kind: "static",
            category: CATEGORY,
            message: `${kind} href '${href}' does not match any concord-frontend/app/ route — clicking 404s.`,
            location: `${rel}:${lineNum}`,
            subject: { kind: "ux_link", file: rel, href, linkKind: kind },
            fixHint: suggestion,
          });
          if (findings.length >= findingCap) break;
        }
      }
    }
  } catch (err) {
    return makeError(CATEGORY, "detector_threw", err, t0);
  }

  const report = makeReport(CATEGORY, findings, t0);
  report.scanned = scanned;
  report.routeCount = routes.size;
  report.dynamicRouteCount = dynamicPatterns.length;
  return report;
}
