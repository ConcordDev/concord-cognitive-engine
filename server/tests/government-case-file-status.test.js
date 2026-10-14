// INC-SWEEP government F2 — case-file form statuses must match the
// government artifact enum (draft/proposed/public-comment/enacted/repealed/
// archived). Creating with each form-selectable status must pass validation,
// read back by id via lens.list/get (the GET /api/lens/government path), and
// survive a fresh LensArtifactStore rehydrate (restart persistence).

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { EXTENDED_DOMAIN_RULES } from "../lib/domain-logic-extended.js";
import { DOMAIN_RULES, validateArtifact } from "../lib/domain-logic.js";
import { reconcileArtifactTypes } from "../lib/lens-artifact-types.js";
import { LensArtifactStore } from "../lib/lens-artifact-store.js";
import { up as createTable } from "../migrations/398_lens_artifact_store.js";
import { load } from "./depth/_harness.js";

const FORM_STATUSES = [
  "draft",
  "proposed",
  "public-comment",
  "enacted",
  "repealed",
  "archived",
];

const CASE_TYPES = [
  "Permit",
  "Project",
  "Violation",
  "EmergencyPlan",
  "Record",
  "CourtCase",
];

const OWNER = "gov-f2-owner-" + Date.now().toString(36);

// Merge extended rules the same way server.js does at boot.
for (const [k, v] of EXTENDED_DOMAIN_RULES) {
  if (!DOMAIN_RULES.has(k)) DOMAIN_RULES.set(k, v);
}
reconcileArtifactTypes(DOMAIN_RULES);

describe("government case-file status enum (F2)", () => {
  it("rejects the old form default 'submitted' that caused the 422", () => {
    const r = validateArtifact("government", "Permit", { title: "x" }, { status: "submitted" });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /Invalid status "submitted"/.test(e)));
  });

  it("accepts every form-selectable status for every case-file type", () => {
    for (const type of CASE_TYPES) {
      for (const status of FORM_STATUSES) {
        const r = validateArtifact("government", type, { title: "x" }, { status });
        assert.equal(
          r.ok,
          true,
          `${type}/${status} should validate, got: ${JSON.stringify(r.errors)}`,
        );
      }
    }
  });
});

describe("government case-file create + read-back + restart (F2)", () => {
  let runMacro;
  let STATE;
  let makeInternalCtx;
  let Database;

  before(async () => {
    ({ runMacro, STATE, makeInternalCtx } = await load());
    Database = (await import("better-sqlite3")).default;
  });

  function ctxFor(userId) {
    const ctx = makeInternalCtx(userId);
    ctx.actor = { userId, role: "member", scope: "local", scopes: ["*"] };
    ctx.userId = userId;
    ctx.internal = false;
    return ctx;
  }

  it("creates a Permit with each form status and reads it back by id", async () => {
    const ids = [];
    for (const status of FORM_STATUSES) {
      const created = await runMacro(
        "lens",
        "create",
        {
          domain: "government",
          type: "Permit",
          title: `Permit F2 ${status}`,
          data: { applicant: "QA", type: "Building", address: "1 QA Ln" },
          meta: { status },
        },
        ctxFor(OWNER),
      );
      assert.equal(created.ok, true, `create ${status}: ${JSON.stringify(created)}`);
      assert.ok(created.artifact?.id, "must return id");
      assert.equal(created.artifact.meta?.status, status);
      ids.push(created.artifact.id);

      const listed = await runMacro(
        "lens",
        "list",
        { domain: "government", type: "Permit" },
        ctxFor(OWNER),
      );
      assert.equal(listed.ok, true);
      const row = (listed.artifacts || []).find((a) => a.id === created.artifact.id);
      assert.ok(row, `list missing ${created.artifact.id}`);
      assert.equal(row.meta?.status, status);
      assert.equal(row.title, `Permit F2 ${status}`);

      const got = await runMacro(
        "lens",
        "get",
        { id: created.artifact.id, domain: "government" },
        ctxFor(OWNER),
      );
      assert.equal(got.ok, true, JSON.stringify(got));
      assert.equal(got.artifact?.id, created.artifact.id);
      assert.equal(got.artifact?.meta?.status, status);
    }
    assert.equal(ids.length, FORM_STATUSES.length);
  });

  it("stored case-file rows survive a fresh store rehydrate (restart persistence)", async () => {
    const created = await runMacro(
      "lens",
      "create",
      {
        domain: "government",
        type: "Project",
        title: "Project F2 restart pin",
        data: { name: "Restart Pin", department: "PW", budget: 1 },
        meta: { status: "proposed" },
      },
      ctxFor(OWNER),
    );
    assert.equal(created.ok, true, JSON.stringify(created));
    const id = created.artifact.id;
    const stored = STATE.lensArtifacts.get(id);
    assert.ok(stored, "artifact must be in STATE.lensArtifacts");
    assert.equal(stored.meta?.status, "proposed");

    // Same pattern as lens-artifact-store durability: write-through to SQLite,
    // then a NEW store over the same db must recover the row.
    const db = new Database(":memory:");
    createTable(db);
    const first = new LensArtifactStore(db);
    first.set(id, stored);

    const second = new LensArtifactStore(db);
    assert.equal(second.size, 0, "fresh store starts empty");
    const r = second.rehydrateFromSQLite();
    assert.equal(r.loaded, 1);
    assert.equal(r.errors, 0);
    const back = second.get(id);
    assert.ok(back, "row missing after rehydrate");
    assert.equal(back.title, "Project F2 restart pin");
    assert.equal(back.domain, "government");
    assert.equal(back.type, "Project");
    assert.equal(back.meta?.status, "proposed");
  });
});
