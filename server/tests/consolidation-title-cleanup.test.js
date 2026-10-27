import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planTitleCleanup, countByReason, runTitleCleanup } from "../lib/consolidation-title-cleanup.js";

const nodes = () => [
  { id: "m1", tier: "mega", title: "MEGA — MEGA — ArXiv", createdAt: "1" },
  { id: "m2", tier: "mega", title: "MEGA: U.S. propane exports", createdAt: "2" },
  { id: "h1", tier: "hyper", title: "HYPER — HYPER — MEGA — mesh beacon", createdAt: "3" },
  { id: "r1", tier: "regular", title: "MEGA: Analogy: beacon", createdAt: "4" },
  { id: "c1", tier: "mega", title: "MEGA — Cluster", tags: ["beacon", "mesh", "presence"], createdAt: "5" },
  { id: "d1", tier: "mega", title: "MEGA — Same", tags: ["alpha"], createdAt: "6" },
  { id: "d2", tier: "mega", title: "MEGA — Same", tags: ["beta"], createdAt: "7" },
  { id: "ok", tier: "mega", title: "MEGA — Fine", createdAt: "8" },
  { id: "old", tier: "mega", title: "Chat Context [legacy]", createdAt: "9" },
];

describe("planTitleCleanup", () => {
  it("fixes nesting, colon prefixes, artifacts, generic and duplicates only", () => {
    const by = Object.fromEntries(planTitleCleanup(nodes()).map((c) => [c.id, c]));
    assert.equal(by.m1.to, "MEGA — ArXiv");
    assert.equal(by.m2.to, "MEGA — U.S. propane exports");
    assert.equal(by.h1.to, "HYPER — mesh beacon");
    assert.equal(by.r1.to, "Analogy: beacon");
    assert.equal(by.c1.to, "MEGA — beacon · mesh · presence");
    assert.equal(by.d1, undefined, "oldest duplicate keeps its title");
    assert.equal(by.d2.to, "MEGA — Same · beta");
    assert.equal(by.ok, undefined);
    assert.equal(by.old, undefined, "un-prefixed legacy megas are left alone");
    assert.equal(countByReason(Object.values(by)).total, 6);
  });
});

describe("runTitleCleanup", () => {
  it("logs before applying, applies via set(), runs once, and undoes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-"));
    const logPath = path.join(dir, "run", "log.json");
    const store = new Map(nodes().map((d) => [d.id, d]));
    const r = runTitleCleanup({ store, logPath, fs });
    assert.equal(r.applied, 6);
    assert.equal(store.get("m1").title, "MEGA — ArXiv");
    const saved = JSON.parse(fs.readFileSync(logPath, "utf8"));
    assert.equal(saved.changes.length, 6); assert.equal(saved.applied, 6);
    assert.deepEqual(runTitleCleanup({ store, logPath, fs }), { skipped: "log_exists" });
    store.set("m2", { ...store.get("m2"), title: "Edited by owner" });
    const u = runTitleCleanup({ store, logPath, fs, undo: true });
    assert.equal(u.undone, 5, "an edited title is not clobbered by undo");
    assert.equal(store.get("m1").title, "MEGA — MEGA — ArXiv");
    assert.equal(store.get("m2").title, "Edited by owner");
    assert.deepEqual(runTitleCleanup({ store, logPath, fs, undo: true }), { skipped: "already_undone" });
  });
});
