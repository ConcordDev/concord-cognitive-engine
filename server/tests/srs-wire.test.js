/**
 * Tier-2 contract test for Phase 4.1: SRS (Spaced Repetition System).
 *
 * Confirms the SRS triad is wired end-to-end:
 *   - server.js Express routes /api/srs/due, /api/srs/:dtuId/add,
 *     /api/srs/:dtuId/review
 *   - apiHelpers.srs.due() / .add() / .review() match the route shapes
 *   - frontend lens exists at concord-frontend/app/lenses/srs/page.tsx
 *
 * SRS was marked `partial` by the cartographer because keywords (anki,
 * sm-2, fsrs) didn't surface via macro-domain search — the impl uses
 * Express routes directly. This test pins the contract so any drift
 * (route signature change, apiHelpers shape change, lens removal)
 * trips CI.
 *
 * Run: node --test tests/srs-wire.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

describe("Phase 4.1 SRS wire — server routes", () => {
  it("registers /api/srs/due, /add, /review on app.get/post", async () => {
    const serverJs = await readFile(path.join(REPO_ROOT, "server", "server.js"), "utf-8");
    assert.ok(/app\.get\("\/api\/srs\/due"/.test(serverJs), "GET /api/srs/due route");
    assert.ok(/app\.post\("\/api\/srs\/:dtuId\/add"/.test(serverJs), "POST /api/srs/:dtuId/add route");
    assert.ok(/app\.post\("\/api\/srs\/:dtuId\/review"/.test(serverJs), "POST /api/srs/:dtuId/review route");
  });

  it("review endpoint reads quality from body", async () => {
    const serverJs = await readFile(path.join(REPO_ROOT, "server", "server.js"), "utf-8");
    assert.ok(/reviewSRSCard\(req\.params\.dtuId, Number\(req\.body\.quality\)\)/.test(serverJs),
      "POST /api/srs/:dtuId/review must call reviewSRSCard(dtuId, Number(body.quality))");
  });
});

describe("Phase 4.1 SRS wire — apiHelpers contract", () => {
  it("apiHelpers.srs has due/add/review with matching paths", async () => {
    const client = await readFile(path.join(REPO_ROOT, "concord-frontend", "lib", "api", "client.ts"), "utf-8");
    assert.ok(/srs:\s*\{[^}]*due:/.test(client), "apiHelpers.srs.due defined");
    assert.ok(/api\.get\(['"]\/api\/srs\/due['"]\)/.test(client), "due → GET /api/srs/due");
    assert.ok(/api\.post\(`?\/api\/srs\/\$\{?dtuId\}?\/add`?,/.test(client), "add → POST /api/srs/:dtuId/add");
    assert.ok(/api\.post\(`?\/api\/srs\/\$\{?dtuId\}?\/review`?,/.test(client), "review → POST /api/srs/:dtuId/review");
  });
});

describe("Phase 4.1 SRS wire — frontend lens", () => {
  it("concord-frontend/app/lenses/srs/page.tsx exists and is substantial", async () => {
    const lensPath = path.join(REPO_ROOT, "concord-frontend", "app", "lenses", "srs", "page.tsx");
    const st = await stat(lensPath);
    assert.ok(st.size >= 1000, `srs/page.tsx must be >1KB, got ${st.size}`);
  });

  it("srs lens calls apiHelpers.srs at least 3 places (due/add/review)", async () => {
    const lens = await readFile(path.join(REPO_ROOT, "concord-frontend", "app", "lenses", "srs", "page.tsx"), "utf-8");
    assert.ok(/apiHelpers\.srs\.due/.test(lens), "lens calls apiHelpers.srs.due");
    assert.ok(/apiHelpers\.srs\.add/.test(lens), "lens calls apiHelpers.srs.add");
    assert.ok(/apiHelpers\.srs\.review/.test(lens), "lens calls apiHelpers.srs.review");
  });
});
