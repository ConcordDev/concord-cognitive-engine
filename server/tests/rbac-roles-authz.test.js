// server/tests/rbac-roles-authz.test.js
//
// Pins the authorization fix on the RBAC block in routes/helpers-extended.js
// (2026-07-27 Aikido triage, SEC-3).
//
// BEFORE: every mutating endpoint under /api/rbac/ carried `requireAuth()` and
// nothing else, so ANY authenticated account could POST/PUT/DELETE custom role
// definitions and call assign/revoke. `PUT /api/rbac/roles/:id` additionally
// did `Object.assign(role, req.body, { id: role.id })` — a blanket merge that
// let a caller both set `permissions: ["*"]` and graft arbitrary extra keys
// onto a STATE object that gets serialized into the persisted snapshot.
//
// Honest scope note (deliberately recorded here so a future reader does not
// over-read the fix): the escalation was NOT live. `globalThis._assignRole` /
// `_revokeRole` / `_getUserRole` / `_checkPermission` do not exist anywhere in
// the tree, so those handlers optional-chain into no-ops; and
// `STATE.rbacCustomRoles` is write-only — grep confirms no authorization path
// reads it. A self-authored `permissions:["*"]` role therefore granted nothing
// at the time of the fix. What is being closed is the LATENT version: wiring
// either helper, or making rbacCustomRoles load-bearing for a permission
// check, would turn this into real privilege escalation with no other change.
//
// This test is a source-shape assertion rather than a live HTTP test because
// the handlers register through `registerHelpersExtendedRoutes(app, {...})`
// against the real server's `app`, and booting a server per-role to exercise
// a 403 would cost minutes for what is structurally a middleware-presence
// claim. The shape it pins is exact: no mutating /api/rbac/ route may be
// registered with `requireAuth()` as its only gate.
//
// Run: node --test server/tests/rbac-roles-authz.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SRC = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../routes/helpers-extended.js"),
  "utf8"
);

// Matches: app.<method>("/api/rbac/...", <rest of line>
//
// The capture deliberately takes the WHOLE remainder of the line rather than
// an identifier. An earlier version required the second argument to start with
// an identifier, which meant it silently skipped every route whose handler is
// an inline arrow — i.e. exactly the ungated shape these tests exist to catch.
// A check that cannot observe the failure case is not a check.
const RBAC_ROUTE_RE = /app\.(get|post|put|delete|patch)\(\s*"(\/api\/rbac\/[^"]*)"\s*,\s*(.+)$/gm;

/** Classify what stands between the route and its handler. */
function gateOf(rest) {
  const s = rest.trim();
  if (s.startsWith("requireRbacAdmin")) return "admin";
  if (s.startsWith("requireRole(")) return "role-inline";
  if (s.startsWith("requireAuth")) return "auth-only";
  return "none"; // inline `(req, res) =>`, `async (…) =>`, `asyncHandler(…)`
}

function rbacRoutes() {
  const out = [];
  let m;
  RBAC_ROUTE_RE.lastIndex = 0;
  while ((m = RBAC_ROUTE_RE.exec(SRC))) {
    out.push({ method: m[1], routePath: m[2], gate: gateOf(m[3]) });
  }
  return out;
}

describe("RBAC routes — mutating endpoints are admin-gated", () => {
  it("finds the RBAC route block (guards against the regex silently matching nothing)", () => {
    const routes = rbacRoutes();
    assert.ok(routes.length >= 8, `expected the RBAC block, found ${routes.length} routes`);
  });

  // `check` is a read-shaped permission probe that happens to be a POST
  // (it takes a body); it reveals nothing the caller could not already ask
  // for, and is intentionally left ungated.
  const mutations = () =>
    rbacRoutes().filter((r) => r.method !== "get" && !r.routePath.endsWith("/check"));

  it("no mutating /api/rbac/ route is left open to any authenticated account", () => {
    const offenders = mutations().filter((r) => r.gate === "auth-only" || r.gate === "none");
    assert.deepEqual(
      offenders.map((o) => `${o.method.toUpperCase()} ${o.routePath} [${o.gate}]`), [],
      "these RBAC mutations are reachable without an admin role"
    );
  });

  it("every mutating /api/rbac/ route uses the shared admin gate", () => {
    const muts = mutations();
    assert.ok(muts.length >= 5, `expected several mutations, saw ${muts.length}`);
    for (const r of muts) {
      assert.equal(
        r.gate, "admin",
        `${r.method.toUpperCase()} ${r.routePath} must use requireRbacAdmin`
      );
    }
  });

  it("the classifier can actually see an ungated route (the check can fail)", () => {
    // Without this, a regex that quietly matches nothing — or one that cannot
    // parse inline-handler routes — would make the two assertions above pass
    // vacuously. The ungated GETs in this same block are the live proof that
    // `gate: "none"` is reachable.
    const ungatedReads = rbacRoutes().filter((r) => r.method === "get" && r.gate === "none");
    assert.ok(
      ungatedReads.length > 0,
      "classifier never produced gate:'none' — it cannot detect an unguarded route"
    );
  });

  it("the admin gate is built from requireRole, not a permissive stand-in", () => {
    assert.match(
      SRC,
      /const requireRbacAdmin = requireRole\((?=[^)]*"admin")(?=[^)]*"sovereign")[^)]*\)/,
      "requireRbacAdmin must be a requireRole(...) middleware naming real admin roles"
    );
  });
});

describe("RBAC role update — field allowlist replaces the blanket merge", () => {
  it("the blanket Object.assign(role, req.body, ...) is gone", () => {
    assert.doesNotMatch(
      SRC, /Object\.assign\(\s*role\s*,\s*req\.body/,
      "PUT /api/rbac/roles/:id must not merge the raw request body onto the role"
    );
  });

  it("the update path routes through the sanitizer", () => {
    assert.match(SRC, /Object\.assign\(\s*role\s*,\s*sanitizeRoleFields\(req\.body\)\s*\)/);
  });

  it("the allowlist covers exactly the three caller-owned fields", () => {
    const m = SRC.match(/const ROLE_ASSIGNABLE_FIELDS = \[([^\]]*)\]/);
    assert.ok(m, "ROLE_ASSIGNABLE_FIELDS must exist");
    const fields = m[1].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
    assert.deepEqual(fields.sort(), ["description", "name", "permissions"]);
    // id / createdAt are server-owned and must never be in the allowlist.
    assert.ok(!fields.includes("id"));
    assert.ok(!fields.includes("createdAt"));
  });
});

// The sanitizer's own behavior, reimplemented from the source under test so a
// silent semantic change in the route file is caught by the shape assertions
// above rather than by a stale copy here. These cases pin INTENT.
describe("sanitizeRoleFields — intended semantics", () => {
  // Extract and evaluate the real function body so this tests the shipped code,
  // not a paraphrase of it.
  const fnSrc = SRC.match(/function sanitizeRoleFields\(body\) \{[\s\S]*?\n  \}/)?.[0];
  const allowSrc = SRC.match(/const ROLE_ASSIGNABLE_FIELDS = \[[^\]]*\];/)?.[0];
  assert.ok(fnSrc && allowSrc, "could not extract sanitizeRoleFields from source");
  // eslint-disable-next-line no-new-func
  const sanitizeRoleFields = new Function(`${allowSrc}\n${fnSrc}\nreturn sanitizeRoleFields;`)();

  it("drops unknown keys", () => {
    const out = sanitizeRoleFields({ name: "x", id: "hijack", isAdmin: true, __proto__: {} });
    assert.deepEqual(Object.keys(out), ["name"]);
  });

  it("keeps a string permissions array and drops non-strings inside it", () => {
    const out = sanitizeRoleFields({ permissions: ["read", 42, null, "write"] });
    assert.deepEqual(out.permissions, ["read", "write"]);
  });

  it("rejects a non-array permissions value outright", () => {
    assert.equal(sanitizeRoleFields({ permissions: "*" }).permissions, undefined);
    assert.equal(sanitizeRoleFields({ permissions: { all: true } }).permissions, undefined);
  });

  it("caps permission list length and string length", () => {
    const out = sanitizeRoleFields({
      name: "a".repeat(500),
      permissions: Array.from({ length: 500 }, (_, i) => `p${i}`),
    });
    assert.equal(out.name.length, 200);
    assert.equal(out.permissions.length, 100);
  });

  it("tolerates a missing or non-object body", () => {
    assert.deepEqual(sanitizeRoleFields(undefined), {});
    assert.deepEqual(sanitizeRoleFields(null), {});
    assert.deepEqual(sanitizeRoleFields("nope"), {});
  });
});
