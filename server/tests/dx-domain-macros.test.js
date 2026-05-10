/**
 * Tier-2 contract tests for the DX Platform A2 domain macros.
 *
 * Covers the registration shape + the caller-owns-codebase auth gate
 * + dx.upsert_shadow idempotency + dx.weighted_findings projection.
 *
 * Run: node --test tests/dx-domain-macros.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import * as mig030 from "../migrations/030_repair_enhanced.js";
import * as mig146 from "../migrations/146_repair_feedback.js";
import registerDxMacros from "../domains/dx.js";

let db;
let registered;
let STATE;

function makeRegister() {
  const macros = new Map();
  function register(domain, name, fn) {
    macros.set(`${domain}.${name}`, fn);
  }
  return { register, macros };
}

beforeEach(() => {
  db = new Database(":memory:");
  mig030.up(db);
  mig146.up(db);
  STATE = { shadowDtus: new Map() };
  const r = makeRegister();
  registerDxMacros(r.register, STATE);
  registered = r.macros;
});

afterEach(() => { try { db?.close(); } catch { /* intentional */ } });

function ctxFor(userId) {
  return { db, actor: { userId }, state: STATE };
}

describe("dx domain — macro registration", () => {
  it("registers all 9 macros", () => {
    const expected = [
      "dx.register_codebase", "dx.touch_codebase", "dx.list_codebases",
      "dx.record_fix_decision", "dx.list_weights", "dx.weighted_findings",
      "dx.upsert_shadow", "dx.list_shadows", "dx.get_weight",
    ];
    for (const k of expected) assert.ok(registered.has(k), `missing ${k}`);
  });
});

describe("dx.register_codebase + touch + list", () => {
  it("registers a codebase and lists it back", async () => {
    const r1 = await registered.get("dx.register_codebase")(ctxFor("alice"), { repoRoot: "/r" });
    assert.equal(r1.ok, true);
    const r2 = await registered.get("dx.list_codebases")(ctxFor("alice"));
    assert.equal(r2.ok, true);
    assert.equal(r2.codebases.length, 1);
    assert.equal(r2.codebases[0].id, r1.codebaseId);
  });

  it("rejects missing repoRoot", async () => {
    const r = await registered.get("dx.register_codebase")(ctxFor("alice"), {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_repo_root");
  });

  it("rejects calls with no user", async () => {
    const r = await registered.get("dx.register_codebase")({ db, actor: {} }, { repoRoot: "/r" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_user");
  });
});

describe("ownership gate — touch / record / list_weights", () => {
  let aliceCb;
  beforeEach(async () => {
    aliceCb = (await registered.get("dx.register_codebase")(ctxFor("alice"), { repoRoot: "/r" })).codebaseId;
  });

  it("alice can touch her own codebase", async () => {
    const r = await registered.get("dx.touch_codebase")(ctxFor("alice"), { codebaseId: aliceCb });
    assert.equal(r.ok, true);
  });

  it("bob cannot touch alice's codebase", async () => {
    const r = await registered.get("dx.touch_codebase")(ctxFor("bob"), { codebaseId: aliceCb });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_owner");
  });

  it("bob cannot record_fix_decision on alice's codebase", async () => {
    const r = await registered.get("dx.record_fix_decision")(ctxFor("bob"), {
      codebaseId: aliceCb, detectorId: "d", ruleId: "r", decision: "rejected",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_owner");
  });

  it("alice can record_fix_decision on her codebase", async () => {
    const r = await registered.get("dx.record_fix_decision")(ctxFor("alice"), {
      codebaseId: aliceCb, detectorId: "d", ruleId: "r", decision: "accepted",
    });
    assert.equal(r.ok, true);
  });
});

describe("dx.upsert_shadow", () => {
  let cb;
  beforeEach(async () => {
    cb = (await registered.get("dx.register_codebase")(ctxFor("alice"), { repoRoot: "/r" })).codebaseId;
  });

  it("creates a shadow DTU keyed by (codebase, path)", async () => {
    const r = await registered.get("dx.upsert_shadow")(ctxFor("alice"), {
      codebaseId: cb, path: "src/foo.js", content: "export const x = 1;\n",
    });
    assert.equal(r.ok, true);
    assert.equal(r.deduped, false);
    assert.ok(STATE.shadowDtus.has(r.id));
    const dtu = STATE.shadowDtus.get(r.id);
    assert.equal(dtu.tier, "shadow");
    assert.equal(dtu.kind, "code_shadow");
    assert.equal(dtu.meta.codebase_id, cb);
    assert.equal(dtu.meta.path, "src/foo.js");
  });

  it("dedupes when content hash unchanged", async () => {
    await registered.get("dx.upsert_shadow")(ctxFor("alice"), {
      codebaseId: cb, path: "src/foo.js", content: "x",
    });
    const r2 = await registered.get("dx.upsert_shadow")(ctxFor("alice"), {
      codebaseId: cb, path: "src/foo.js", content: "x",
    });
    assert.equal(r2.ok, true);
    assert.equal(r2.deduped, true);
    assert.equal(STATE.shadowDtus.size, 1);
  });

  it("updates when content changes (same id, new contentHash)", async () => {
    const r1 = await registered.get("dx.upsert_shadow")(ctxFor("alice"), {
      codebaseId: cb, path: "src/foo.js", content: "v1",
    });
    const r2 = await registered.get("dx.upsert_shadow")(ctxFor("alice"), {
      codebaseId: cb, path: "src/foo.js", content: "v2",
    });
    assert.equal(r2.id, r1.id);
    assert.notEqual(r2.contentHash, r1.contentHash);
    assert.equal(STATE.shadowDtus.size, 1);
    const dtu = STATE.shadowDtus.get(r2.id);
    assert.equal(dtu.content, "v2");
  });

  it("attaches first shadow id to the codebase row", async () => {
    const r = await registered.get("dx.upsert_shadow")(ctxFor("alice"), {
      codebaseId: cb, path: "src/foo.js", content: "x",
    });
    const row = db.prepare(`SELECT shadow_dtu_id FROM codebases WHERE id = ?`).get(cb);
    assert.equal(row.shadow_dtu_id, r.id);
  });

  it("rejects bob writing to alice's codebase", async () => {
    const r = await registered.get("dx.upsert_shadow")(ctxFor("bob"), {
      codebaseId: cb, path: "src/foo.js", content: "x",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_owner");
  });
});

describe("dx.weighted_findings", () => {
  it("projects weight onto severity rank for caller's codebase", async () => {
    const cb = (await registered.get("dx.register_codebase")(ctxFor("alice"), { repoRoot: "/r" })).codebaseId;
    db.prepare(`INSERT INTO codebase_severity_weights (codebase_id, detector_id, rule_id, weight) VALUES (?, ?, ?, ?)`)
      .run(cb, "stale-code", "stale_const", 0.6);
    const r = await registered.get("dx.weighted_findings")(ctxFor("alice"), {
      codebaseId: cb,
      findings: [{ id: "stale_const", severity: "medium", category: "stale-code" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.findings[0].severity, "low");
    assert.equal(r.findings[0]._baseSeverity, "medium");
  });
});

describe("dx.list_shadows", () => {
  it("returns shadows scoped to the calling user's codebase", async () => {
    const aliceCb = (await registered.get("dx.register_codebase")(ctxFor("alice"), { repoRoot: "/r" })).codebaseId;
    await registered.get("dx.upsert_shadow")(ctxFor("alice"), {
      codebaseId: aliceCb, path: "src/a.js", content: "1",
    });
    await registered.get("dx.upsert_shadow")(ctxFor("alice"), {
      codebaseId: aliceCb, path: "src/b.js", content: "2",
    });
    const r = await registered.get("dx.list_shadows")(ctxFor("alice"), { codebaseId: aliceCb });
    assert.equal(r.ok, true);
    assert.equal(r.count, 2);
  });
});
