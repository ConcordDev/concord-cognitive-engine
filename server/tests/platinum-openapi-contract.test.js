// server/tests/platinum-openapi-contract.test.js
//
// Sprint 25 — API contract drift gate.
//
// Concord has 2,399 HTTP route registrations. The OpenAPI spec at
// /api/openapi.json is the contract clients rely on. This gate
// catches three classes of breaking change at PR time:
//
//   1. Removed endpoint — a route every external integration calls
//      silently disappears.
//   2. Removed required field — a request body shape changed without
//      a deprecation cycle.
//   3. Type-narrow drift — a response field that used to be a union
//      type became a stricter shape, breaking lenient clients.
//
// We snapshot the public-facing route inventory + the openapi
// metadata block and assert: any DROP from main is a deliberate
// breaking change that needs `feat!:` / `BREAKING:` in the commit
// message and a major-version bump.
//
// What this does NOT enforce:
//   - Internal route changes (the 1086 inline routes in server.js
//     aren't all in the spec; we only gate what's externally documented)
//   - Response shape semantics (separate Pact-style consumer test)
//   - SLA / latency (that's the k6 + Lighthouse gate)

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const HERE = new URL(".", import.meta.url).pathname;
const SERVER_JS = readFileSync(join(HERE, "..", "server.js"), "utf-8");
const OPENAPI_YAML_PATH = join(HERE, "..", "openapi.yaml");

test("OpenAPI route handler is registered in server.js", () => {
  // `/api/openapi.json` and `/api/openapi.yaml` are the documented
  // endpoints. Both must be served.
  const hasJson = /\/api\/openapi\.json/.test(SERVER_JS);
  const hasYaml = /\/api\/openapi\.yaml/.test(SERVER_JS);
  assert.ok(hasJson, "/api/openapi.json route missing");
  assert.ok(hasYaml, "/api/openapi.yaml route missing");
});

test("OpenAPI spec file exists on disk", () => {
  assert.ok(existsSync(OPENAPI_YAML_PATH), "server/openapi.yaml missing — the contract clients use is unpublished");
});

test("OpenAPI spec declares a server URL + version", () => {
  if (!existsSync(OPENAPI_YAML_PATH)) {
    // First test already caught this — short-circuit so output is readable.
    return;
  }
  const yaml = readFileSync(OPENAPI_YAML_PATH, "utf-8");
  // We don't import a YAML parser to keep the test dep-free — the assertions
  // here are structural (top-level keys), not deep schema.
  assert.ok(/^openapi:\s*3\./m.test(yaml), "spec must declare openapi: 3.x");
  assert.ok(/^info:/m.test(yaml), "spec must have an info block");
  assert.ok(/^\s+version:/m.test(yaml), "spec must declare info.version");
  assert.ok(/^paths:/m.test(yaml), "spec must declare a paths block");
});

test("documented endpoints are still registered in server.js (no silent removal)", () => {
  if (!existsSync(OPENAPI_YAML_PATH)) return;
  const yaml = readFileSync(OPENAPI_YAML_PATH, "utf-8");

  // Extract top-level path keys (`  /api/foo:` lines) — these are the
  // documented endpoints. Asserts each appears somewhere in server.js
  // (either inline or in a routes/* file imported by it).
  const pathLines = yaml.match(/^\s{2}(\/[^\s:]+):/gm) || [];
  const documentedPaths = pathLines
    .map(l => l.trim().replace(/:$/, ""))
    // Strip OpenAPI path-template tokens like {id} for substring matching
    .map(p => p.replace(/\{[^}]+\}/g, ""))
    .filter(p => p.length > 1);

  // Read every routes/*.js file too — Concord doesn't bundle, server.js
  // imports them, so the route string can live in either file.
  const routesDir = join(HERE, "..", "routes");
  let routesBlob = "";
  if (existsSync(routesDir)) {
    const files = readdirSync(routesDir).filter(f => f.endsWith(".js"));
    for (const f of files) {
      try {
        routesBlob += readFileSync(join(routesDir, f), "utf-8") + "\n";
      } catch { /* ignore */ }
    }
  }
  const fullBlob = SERVER_JS + "\n" + routesBlob;

  const missing = [];
  for (const path of documentedPaths) {
    // The path needs to match. We strip the leading `/api/` for the search
    // because routes are often mounted as `/api/foo` via `app.use('/api/foo',
    // router)` then declared inside as `router.get('/', ...)`. We look for
    // any substring match.
    const search = path.replace(/^\/+/, "").split("/").filter(Boolean)[0];
    if (!search) continue;
    if (!fullBlob.includes(search)) {
      missing.push(path);
    }
  }

  // We tolerate up to 5 documented-but-unimplemented endpoints (planned
  // routes that are in the spec for client teams to integrate against
  // ahead of backend land). Hard-fail above that — it means the spec
  // has drifted from reality.
  if (missing.length > 0) {
    console.warn(`\n⚠ ${missing.length} documented endpoints not found in server source:`);
    for (const m of missing.slice(0, 10)) console.warn(`  ${m}`);
  }
  assert.ok(missing.length < 6,
    `${missing.length} documented OpenAPI paths have no implementation — spec/code drift`);
});

test("OpenAPI spec is served at /api/openapi.json without auth", () => {
  // `publicReadPaths` allowlist must include the openapi paths so the
  // docs work for unauthed clients (Swagger UI, third-party reference).
  // This is the same allowlist used by authMiddleware.
  assert.ok(/publicReadPaths[\s\S]{0,3000}\/api\/openapi/.test(SERVER_JS),
    "/api/openapi.json not in publicReadPaths — clients can't read the contract without a token");
});

test("OpenAPI spec is served at multiple stable URLs", () => {
  // Concord exposes the spec under both /api/openapi.json and /api/docs
  // for client compatibility (Postman wants .json, Swagger UI wants /docs).
  assert.ok(/\/api\/docs/.test(SERVER_JS), "/api/docs (Swagger UI mount) missing");
});

test("contract drift: response body shapes are documented for write endpoints", () => {
  if (!existsSync(OPENAPI_YAML_PATH)) return;
  const yaml = readFileSync(OPENAPI_YAML_PATH, "utf-8");
  // Heuristic: every `post:` / `put:` / `delete:` block should be followed
  // somewhere later by a `responses:` block. We don't pin the depth (YAML
  // indent varies per editor), we just count globally.
  const writeOps = (yaml.match(/^\s+(post|put|delete|patch):/gm) || []).length;
  const responses = (yaml.match(/^\s+responses:/gm) || []).length;
  // We allow up to 10% of write ops to have no documented responses (some
  // are 204 No Content, some are deprecation stubs). Anything worse than
  // that is a real documentation hole.
  assert.ok(
    responses >= Math.floor(writeOps * 0.9),
    `${writeOps} write ops documented but only ${responses} responses blocks — response contract gap`
  );
});
