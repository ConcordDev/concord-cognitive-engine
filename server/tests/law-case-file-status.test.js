// INC-SWEEP law F1 — case-file form statuses must match the law artifact
// enum (draft/review/filed/active/closed/archived). Creating with each
// valid status must pass validation, read back by id via lens.list/get,
// and survive a fresh LensArtifactStore rehydrate (restart persistence).
// The old form default 'open' must be rejected with the valid list named.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { DOMAIN_RULES, validateArtifact } from "../lib/domain-logic.js";
import { LensArtifactStore } from "../lib/lens-artifact-store.js";
import { up as createTable } from "../migrations/398_lens_artifact_store.js";
import { load } from "./depth/_harness.js";

const VALID_STATUSES = ["draft", "review", "filed", "active", "closed", "archived"];
const OWNER = "law-f1-owner-" + Date.now().toString(36);

describe("law case-file status enum (F1)", () => {
  it("rejects the old form default 'open' that caused the 422", () => {
    const r = validateArtifact("law", "case", { title: "x" }, { status: "open" });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /Invalid status "open"/.test(e)));
    assert.ok(r.errors.some((e) => /Valid statuses: draft, review, filed, active, closed, archived/.test(e)));
  });

  it("accepts every valid law status for type case", () => {
    const rule = DOMAIN_RULES.get("law");
    assert.deepEqual(rule.validStatuses, VALID_STATUSES);
    for (const status of VALID_STATUSES) {
      const r = validateArtifact("law", "case", { title: "x" }, { status });
      assert.equal(r.ok, true, `case/${status} should validate, got: ${JSON.stringify(r.errors)}`);
    }
  });
});

describe("law case-file create + read-back + restart (F1)", () => {
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

  it("creates a case with each valid status and reads it back by id", async () => {
    const ids = [];
    for (const status of VALID_STATUSES) {
      const created = await runMacro(
        "lens",
        "create",
        {
          domain: "law",
          type: "case",
          title: `Case F1 ${status}`,
          data: {
            jurisdiction: "US",
            caseType: "litigation",
            deadline: null,
            outcome: "pending",
            judge: null,
            closedAt: null,
            timeline: [],
          },
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
        { domain: "law", type: "case" },
        ctxFor(OWNER),
      );
      assert.equal(listed.ok, true);
      const row = (listed.artifacts || []).find((a) => a.id === created.artifact.id);
      assert.ok(row, `list missing ${created.artifact.id}`);
      assert.equal(row.meta?.status, status);
      assert.equal(row.title, `Case F1 ${status}`);

      const got = await runMacro(
        "lens",
        "get",
        { id: created.artifact.id, domain: "law" },
        ctxFor(OWNER),
      );
      assert.equal(got.ok, true, JSON.stringify(got));
      assert.equal(got.artifact?.id, created.artifact.id);
      assert.equal(got.artifact?.meta?.status, status);
    }
    assert.equal(ids.length, VALID_STATUSES.length);
  });

  it("stored case-file rows survive a fresh store rehydrate (restart persistence)", async () => {
    const created = await runMacro(
      "lens",
      "create",
      {
        domain: "law",
        type: "case",
        title: "Case F1 restart pin",
        data: { jurisdiction: "US", caseType: "litigation", outcome: "pending" },
        meta: { status: "filed" },
      },
      ctxFor(OWNER),
    );
    assert.equal(created.ok, true, JSON.stringify(created));
    const id = created.artifact.id;
    const stored = STATE.lensArtifacts.get(id);
    assert.ok(stored, "artifact must be in STATE.lensArtifacts");
    assert.equal(stored.meta?.status, "filed");

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
    assert.equal(back.title, "Case F1 restart pin");
    assert.equal(back.domain, "law");
    assert.equal(back.type, "case");
    assert.equal(back.meta?.status, "filed");
  });
});
