// server/lib/detectors/authz-coverage-detector.js
//
// Authorization-gate integrity detector.
//
// ── Why this is NOT a per-route middleware scanner ────────────────────────
// The obvious design — "walk every router.post(...) and check for a requireAuth
// arg" (what server/scripts/check-route-auth.js does) — is the WRONG model for
// this codebase, and shipping it produced 40+ false positives. Verified against
// the actual code:
//
//   • server.js mounts `authMiddleware` + `productionWriteAuthMiddleware`
//     GLOBALLY on the shared `app` (server.js:~28848) BEFORE any route is
//     registered. `productionWriteAuthMiddleware` 401s every unauthenticated
//     POST/PUT/DELETE/PATCH in production unless the path is in a small
//     bypass allowlist.
//   • All ~634 inline `app.post/put/...` routes are registered after that mount.
//   • Route modules (`routes/*.js`) receive that SAME `app` via
//     `registerXxxRoutes(app, …)` and their calls (29569…32444) ALSO run after
//     the global mount, so their `app.post` routes are gated too.
//   • Sub-routers are `app.use("/api/x", router)`-mounted after the gate.
//
// So the security boundary is ONE central gate on a shared `app`, not a
// per-route middleware. A per-route check flags routes that are, in fact,
// gated — pure noise. (It also explains check-route-auth.js's hollow "0
// findings": it only matches `router.` — not `app.` — and never scans
// server.js at all, so it isn't looking where the routes are.)
//
// ── What this detector actually asserts (the real invariant) ──────────────
//   1. The global write-auth middleware EXISTS and is wired. If a refactor
//      drops it, every inline mutating route silently un-gates → CRITICAL.
//   2. No mutating route is registered BEFORE the global gate mounts (Express
//      applies middleware in order; a route above the mount escapes it) → HIGH.
//   3. The write-auth BYPASS allowlist (WRITE_AUTH_PUBLIC_PATHS) is pinned.
//      Each non-infrastructure bypass is a finding so the baseline captures the
//      current set; a NEWLY-added unauthenticated-write path becomes a new
//      finding the PR gate surfaces for human review → HIGH.
//
// This is the gate "pointed at actual code": it tracks the mechanism that
// genuinely enforces auth here, so it can't report a hollow pass, and it can't
// cry wolf over routes the global gate already covers.

import path from "node:path";
import { readSafe, makeReport, makeError, relPath, lineOf } from "./_framework.js";

const MUTATING_APP_ROUTE = /\bapp\.(post|put|delete|patch)\s*\(/g;
const GLOBAL_WRITE_GATE_SIG = /\bproductionWriteAuthMiddleware\b|\bPROD_WRITE_AUTH\b|Authentication required for write/;

// Bypass-allowlist entries that are infrastructure / auth-bootstrap and are
// expected to be public — not security-relevant to flag.
const INFRA_BYPASS = [
  "/health", "/ready", "/metrics",
  "/api/auth/login", "/api/auth/register", "/api/auth/csrf-token",
  // Stripe webhook authenticates by request SIGNATURE, not a cookie/JWT (Stripe
  // can't send one). handleWebhook verifies the signature before any DB write,
  // so this bypass is reviewed-and-intentional, not a coverage gap.
  "/api/stripe/webhook",
];

/**
 * Line where the global write-auth middleware is WIRED (its non-definition
 * reference). Routes before this line aren't behind the gate. Infinity if not
 * locatable.
 */
export function globalWriteGateMountLine(content) {
  const lines = content.split("\n");
  let defLine = -1, mountLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/\bproductionWriteAuthMiddleware\b/.test(lines[i])) {
      if (/function\s+productionWriteAuthMiddleware/.test(lines[i])) defLine = i + 1;
      else if (mountLine < 0) mountLine = i + 1;
    }
  }
  if (mountLine > 0) return mountLine;
  if (defLine > 0) return defLine;
  return Infinity;
}

/** Parse the WRITE_AUTH_PUBLIC_PATHS = [ "...", ... ] literal. Returns string[]. */
export function parseWriteAuthBypass(content) {
  const m = /WRITE_AUTH_PUBLIC_PATHS\s*=\s*\[([^\]]*)\]/.exec(content);
  if (!m) return null; // not found → caller treats as "couldn't read"
  const out = [];
  const re = /['"]([^'"]+)['"]/g;
  let mm;
  while ((mm = re.exec(m[1])) != null) out.push(mm[1]);
  return out;
}

function scanServerMonolith(content, rel, findings) {
  const hasGate = GLOBAL_WRITE_GATE_SIG.test(content);

  // Count inline mutating app routes.
  let appRouteCount = 0;
  { let mm; MUTATING_APP_ROUTE.lastIndex = 0; while ((mm = MUTATING_APP_ROUTE.exec(content)) != null) appRouteCount++; }

  // (1) Gate-present invariant.
  if (!hasGate) {
    findings.push({
      id: "authz_global_write_gate_missing",
      severity: "critical",
      kind: "static",
      category: "security",
      subject: { kind: "file", path: rel },
      message: `${rel} registers ${appRouteCount} inline mutating routes but the global write-auth middleware (productionWriteAuthMiddleware) is gone — every one of them is un-gated`,
      location: `${rel}:1`,
      evidence: { appRouteCount },
      fixHint: "restore_global_write_auth_middleware",
    });
    return; // nothing else meaningful to assert without the gate
  }

  const mountLine = globalWriteGateMountLine(content);

  // (2) No mutating route before the mount.
  let gated = 0;
  let mm;
  MUTATING_APP_ROUTE.lastIndex = 0;
  while ((mm = MUTATING_APP_ROUTE.exec(content)) != null) {
    const lineNo = lineOf(content, mm.index);
    if (lineNo >= mountLine) { gated++; continue; }
    findings.push({
      id: "authz_route_before_global_gate",
      severity: "high",
      kind: "static",
      category: "security",
      subject: { kind: "route", path: rel, method: mm[1].toUpperCase() },
      message: `${mm[1].toUpperCase()} route at line ${lineNo} is registered BEFORE the global write-auth middleware mounts (line ${mountLine}) — it escapes the gate`,
      location: `${rel}:${lineNo}`,
      evidence: { mountLine, method: mm[1].toUpperCase() },
      fixHint: "move_route_after_global_auth_mount",
    });
  }

  // (3) Write-auth bypass allowlist — pin the current set.
  const bypass = parseWriteAuthBypass(content);
  if (bypass) {
    for (const p of bypass) {
      if (INFRA_BYPASS.includes(p)) continue;
      findings.push({
        id: "authz_write_auth_bypass",
        severity: "high",
        kind: "static",
        category: "security",
        subject: { kind: "path", path: p },
        message: `"${p}" is in WRITE_AUTH_PUBLIC_PATHS — unauthenticated writes to this prefix bypass the global gate (intentional bypasses are baselined; a NEW one needs review)`,
        location: `${rel}:${lineOf(content, content.indexOf("WRITE_AUTH_PUBLIC_PATHS"))}`,
        evidence: { bypassPath: p },
        fixHint: "confirm_public_write_bypass_is_intended",
      });
    }
  }

  findings.push({
    id: "authz_central_gate_ok",
    severity: "info",
    kind: "static",
    category: "security",
    message: `${rel}: global write-auth gate present (mount line ${mountLine}); ${gated} mutating route(s) behind it; ${bypass ? bypass.length : "?"} bypass path(s)`,
    evidence: { gated, mountLine, bypassCount: bypass ? bypass.length : null },
  });
}

export async function runAuthzCoverageDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  if (!root) return makeError("authz-coverage", "no_root", null, t0);

  try {
    const findings = [];
    const serverFile = path.join(root, "server", "server.js");
    const content = await readSafe(serverFile);
    if (!content) {
      return makeError("authz-coverage", "server_js_unreadable", null, t0);
    }
    scanServerMonolith(content, relPath(root, serverFile), findings);

    findings.unshift({
      id: "authz_coverage_summary",
      severity: "info",
      kind: "static",
      category: "security",
      message: `Authz-gate integrity check on the server.js global write-auth middleware`,
      evidence: { findings: findings.length },
    });

    return makeReport("authz-coverage", findings, t0);
  } catch (err) {
    return makeError("authz-coverage", "exception", err, t0);
  }
}
