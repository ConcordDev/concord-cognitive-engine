import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planTitleCleanup, countByReason, runTitleCleanup, runNarrowRepair, isSystemMadeForCleanup } from "../lib/consolidation-title-cleanup.js";

const sys = { meta: { clusterKey: "k" } };
const nodes = () => [
  { id: "m1", ...sys, tier: "mega", title: "MEGA — MEGA — ArXiv", createdAt: "1" },
  { id: "m2", ...sys, tier: "mega", title: "MEGA: U.S. propane exports", createdAt: "2" },
  { id: "h1", ...sys, tier: "hyper", title: "HYPER — HYPER — MEGA — mesh beacon", createdAt: "3" },
  { id: "r1", ...sys, tier: "regular", title: "MEGA: Analogy: beacon", createdAt: "4" },
  { id: "c1", ...sys, tier: "mega", title: "MEGA — Cluster", tags: ["beacon", "mesh", "presence"], createdAt: "5" },
  { id: "d1", ...sys, tier: "mega", title: "MEGA — Same", tags: ["alpha"], createdAt: "6" },
  { id: "d2", ...sys, tier: "mega", title: "MEGA — Same", tags: ["beta"], createdAt: "7" },
  { id: "ok", ...sys, tier: "mega", title: "MEGA — Fine", createdAt: "8" },
  // ordinary user DTUs: never touched, whatever the title says
  { id: "u1", tier: "regular", title: "MEGA: my notes", ownerId: "user_42", createdAt: "10" },
  { id: "u2", tier: "regular", title: "MEGA — chat thing", source: "user:abc", meta: { clusterKey: "x" }, createdAt: "11" },
  { id: "u3", tier: "mega", title: "MEGA — MEGA — hand made", ownerId: "user_42", createdAt: "12" },
  { id: "u4", tier: "regular", title: "MEGA: lineage but user", ownerId: "user_9", lineage: { kind: "gap_promotion" }, createdAt: "13" },
  { id: "old", ...sys, tier: "mega", title: "Chat Context [legacy]", createdAt: "9" },
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
    for (const id of ["u1", "u2", "u3", "u4"]) assert.equal(by[id], undefined, `${id} is a user DTU`);
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

describe("system-made only", () => {
  it("classifies rows", () => {
    assert.equal(isSystemMadeForCleanup({ tier: "mega", lineage: { kind: "gap_promotion" }, ownerId: "user_1" }), true, "a cycle-built mega may carry its members' owner");
    assert.equal(isSystemMadeForCleanup({ tier: "regular", title: "MEGA: x" }), false, "no consolidation stamp");
    assert.equal(isSystemMadeForCleanup({ tier: "regular", meta: { promotionAt: "t" }, ownerId: "system" }), true);
    assert.equal(isSystemMadeForCleanup({ tier: "regular", meta: { promotionAt: "t" }, ownerId: "u_1" }), false);
  });
  it("repair restores only rows the narrowed rule would skip, once", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tcr-"));
    const logPath = path.join(dir, "log.json"), repairPath = path.join(dir, "log-narrow-repair.json");
    const store = new Map([
      ["s", { id: "s", tier: "mega", title: "MEGA — ArXiv", ...sys }],
      ["u", { id: "u", tier: "regular", title: "my notes", ownerId: "user_42" }],
      ["e", { id: "e", tier: "regular", title: "edited since", ownerId: "user_42" }],
    ]);
    fs.writeFileSync(logPath, JSON.stringify({ changes: [
      { id: "s", from: "MEGA — MEGA — ArXiv", to: "MEGA — ArXiv" },
      { id: "u", from: "MEGA: my notes", to: "my notes" },
      { id: "e", from: "MEGA: e", to: "e" },
    ] }));
    assert.deepEqual(runNarrowRepair({ store, logPath, repairPath, fs }), { planned: 1, applied: 1 });
    assert.equal(store.get("u").title, "MEGA: my notes");
    assert.equal(store.get("s").title, "MEGA — ArXiv");
    assert.equal(store.get("e").title, "edited since");
    assert.deepEqual(runNarrowRepair({ store, logPath, repairPath, fs }), { skipped: "repair_log_exists" });
    assert.deepEqual(runTitleCleanup({ store, logPath, fs }), { skipped: "log_exists" });
  });
});
