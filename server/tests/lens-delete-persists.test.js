// Delete candidates from the Phase 4 plan: create -> persist -> delete ->
// persist -> reload. Each delete must remove the record from the persisted
// map AND call the save hook, and a STATE rebuilt from the serialized
// snapshot (the same helpers the process snapshot uses) must not have it.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serializeLensState, hydrateLensState } from "../lib/lens-state-persistence.js";

const DOMAINS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "domains");
const USER = "delete_test_user";

const prev = {
  state: globalThis._concordSTATE,
  save: globalThis._concordSaveStateDebounced,
};
afterEach(() => {
  globalThis._concordSTATE = prev.state;
  globalThis._concordSaveStateDebounced = prev.save;
});

async function boot(file) {
  const STATE = {};
  const box = { saves: 0, STATE };
  globalThis._concordSTATE = STATE;
  globalThis._concordSaveStateDebounced = () => { box.saves++; };
  const handlers = new Map();
  const mod = await import(pathToFileURL(path.join(DOMAINS_DIR, file)).href);
  await mod.default((domain, action, fn) => handlers.set(`${domain}.${action}`, fn));
  const ctx = { actor: { userId: USER }, userId: USER, STATE };
  box.run = async (key, params = {}) => {
    const fn = handlers.get(key);
    assert.ok(fn, `action ${key} is not registered`);
    return fn(ctx, { data: {} }, params);
  };
  return box;
}

// Reload: serialize through JSON (as the snapshot does) into a fresh STATE.
function reload(STATE) {
  const blob = JSON.parse(JSON.stringify(serializeLensState(STATE)));
  const fresh = {};
  hydrateLensState(fresh, blob);
  return fresh;
}
const deep = (v) => JSON.stringify(v, (_k, x) => (x instanceof Map ? [...x.entries()] : x instanceof Set ? [...x] : x));

async function createDeleteReload({ file, create, createParams, del, delParams, getId, stateKey }) {
  const box = await boot(file);
  const made = await box.run(create, createParams);
  assert.equal(made.ok, true, `${create} failed: ${JSON.stringify(made)}`);
  const id = getId(made.result);
  assert.ok(id, `${create} returned no id`);

  const withRecord = reload(box.STATE);
  assert.ok(deep(withRecord[stateKey]).includes(id), `${id} should survive a snapshot reload before delete`);

  const savesBefore = box.saves;
  const gone = await box.run(del, delParams(id));
  assert.equal(gone.ok, true, `${del} failed: ${JSON.stringify(gone)}`);
  assert.ok(box.saves > savesBefore, `${del} must call the save hook`);
  assert.ok(!deep(box.STATE[stateKey]).includes(id), `${id} still in live STATE after ${del}`);

  const afterReload = reload(box.STATE);
  assert.ok(!deep(afterReload[stateKey] ?? null).includes(id), `${id} reappeared after reload`);
}

describe("lens deletes remove from the persisted map and save", () => {
  it("diy project-delete", async () => {
    await createDeleteReload({
      file: "diy.js", stateKey: "diyLens",
      create: "diy.project-create", createParams: { name: "Bookshelf" },
      getId: (r) => r.project.id,
      del: "diy.project-delete", delParams: (id) => ({ projectId: id }),
    });
  });

  for (const [kind, create, del, paramKey] of [
    ["panel", "panelCreate", "panelDelete", "panelId"],
    ["estimate", "estimateCreate", "estimateDelete", "estimateId"],
    ["diagram", "diagramCreate", "diagramDelete", "diagramId"],
  ]) {
    it(`electrical ${del}`, async () => {
      await createDeleteReload({
        file: "electrical.js", stateKey: "electricalLens",
        create: `electrical.${create}`, createParams: { name: `${kind} A`, title: `${kind} A` },
        getId: (r) => r.id,
        del: `electrical.${del}`, delParams: (id) => ({ [paramKey]: id }),
      });
    });
  }

  it("app-maker projectDelete", async () => {
    await createDeleteReload({
      file: "appmaker.js", stateKey: "appMakerLens",
      create: "app-maker.projectCreate", createParams: { name: "Tracker" },
      getId: (r) => r.project.id,
      del: "app-maker.projectDelete", delParams: (id) => ({ projectId: id }),
    });
  });

  it("accounting recurring-bills-delete", async () => {
    const box = await boot("accounting.js");
    const vendor = await box.run("accounting.vendors-create", { name: "Acme Power" });
    assert.equal(vendor.ok, true, JSON.stringify(vendor));
    const vendorId = (vendor.result.vendor || vendor.result).id;
    const rb = await box.run("accounting.recurring-bills-create", {
      vendorId, expenseAccountId: "acct_6200", total: 120, cadence: "monthly", startAt: "2026-11-01",
    });
    assert.equal(rb.ok, true, JSON.stringify(rb));
    const id = rb.result.recurringBill.id;
    assert.ok(deep(reload(box.STATE).accountingLens).includes(id));
    const before = box.saves;
    const del = await box.run("accounting.recurring-bills-delete", { id });
    assert.equal(del.ok, true);
    assert.ok(box.saves > before, "recurring-bills-delete must save");
    assert.ok(!deep(reload(box.STATE).accountingLens).includes(id), "recurring bill reappeared after reload");
  });

  it("ml experiment-delete", async () => {
    const box = await boot("ml.js");
    const start = await box.run("ml.experiment-start", { name: "run 1" });
    assert.equal(start.ok, true, JSON.stringify(start));
    const id = (start.result.experiment || start.result).id;
    assert.ok(deep(reload(box.STATE).mlLens).includes(id));
    const before = box.saves;
    const del = await box.run("ml.experiment-delete", { experimentId: id });
    assert.equal(del.ok, true);
    assert.ok(box.saves > before, "experiment-delete must save");
    assert.ok(!deep(reload(box.STATE).mlLens).includes(id), "experiment reappeared after reload");
  });

  it("timeline post-delete", async () => {
    await createDeleteReload({
      file: "timeline.js", stateKey: "timelineLens",
      create: "timeline.post-create", createParams: { content: "hello timeline", privacy: "public" },
      getId: (r) => (r.post || r).id,
      del: "timeline.post-delete", delParams: (id) => ({ postId: id }),
    });
  });

  it("whiteboard board-delete", async () => {
    const box = await boot("whiteboard.js");
    const saved = await box.run("whiteboard.board-save", { name: "Sprint board", elements: [] });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const id = (saved.result.board || saved.result).id;
    assert.ok(id);
    assert.ok(deep(reload(box.STATE).whiteboardLens).includes(id));
    const before = box.saves;
    const del = await box.run("whiteboard.board-delete", { id });
    assert.equal(del.ok, true);
    assert.ok(box.saves > before, "board-delete must save");
    assert.ok(!deep(reload(box.STATE).whiteboardLens ?? null).includes(id), "board reappeared after reload");
  });
});
