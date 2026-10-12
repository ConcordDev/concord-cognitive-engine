// INC-62: OEE / work-order / SPC boards read per-user maps that nothing wrote.
// machine-register, work-order-create, work-order-update, and spc-sample-log
// are the writes those notes named. Two accounts must not see each other's rows.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import registerManufacturingActions from "../domains/manufacturing.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`manufacturing.${name}`);
  if (!fn) throw new Error(`manufacturing.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

const domainSrc = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../domains/manufacturing.js"),
  "utf8",
);

// Every manufacturing.<action> that appears inside a notes string must be a
// real registered action. An empty match set fails the test — a scanner that
// finds nothing would otherwise make `every` vacuously true.
function actionsNamedInNoteStrings(source) {
  const found = new Set();
  const re = /(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let m;
  while ((m = re.exec(source))) {
    const body = m[2];
    if (!body.includes("manufacturing.")) continue;
    const before = source.slice(Math.max(0, m.index - 200), m.index);
    if (!/\bnotes\b/.test(before)) continue;
    for (const a of body.matchAll(/manufacturing\.([a-z0-9-]+)/g)) found.add(a[1]);
  }
  return [...found];
}

before(() => { registerManufacturingActions(register); });

let saves = 0;
beforeEach(() => {
  saves = 0;
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => { saves += 1; };
});

const acct1 = { actor: { userId: "acct1" }, userId: "acct1" };
const acct2 = { actor: { userId: "acct2" }, userId: "acct2" };

/** Responses must not echo actor user ids (bucket keys stay server-side). */
function assertNoUserIdLeak(payload, ...forbidden) {
  const blob = JSON.stringify(payload);
  for (const id of forbidden) {
    assert.equal(blob.includes(JSON.stringify(id)) || blob.includes(`:${id}`) || blob.includes(`"${id}"`), false,
      `payload leaked user id ${id}: ${blob.slice(0, 400)}`);
  }
  assert.equal(/userId|user_id|ownerId|actorId/i.test(blob), false,
    `payload exposed an identity field: ${blob.slice(0, 400)}`);
}

describe("manufacturing floor writes (INC-62)", () => {
  it("acct1 machine-register shows on oee-status; acct2 does not see it", () => {
    const created = call("machine-register", acct1, {
      machineId: "CNC-01", name: "Haas VF-2", line: "Cell A", idealCycleTime: 1.5,
    });
    assert.equal(created.ok, true);
    assert.equal(created.result.machine.id, "CNC-01");
    assert.equal(created.result.machine.name, "Haas VF-2");
    assert.equal(created.result.machine.line, "Cell A");
    assert.equal(created.result.machine.idealCycleTime, 1.5);
    assert.equal(created.result.machine.status, "idle");
    assert.equal(saves, 1);
    assertNoUserIdLeak(created, "acct1", "acct2");

    const mine = call("oee-status", acct1, {});
    assert.equal(mine.ok, true);
    assert.equal(mine.result.source, "wired-feed");
    assert.equal(mine.result.machines.length, 1);
    assert.equal(mine.result.machines[0].id, "CNC-01");
    assert.equal(mine.result.notes, null);
    assertNoUserIdLeak(mine, "acct1", "acct2");

    const theirs = call("oee-status", acct2, {});
    assert.equal(theirs.result.source, "empty");
    assert.deepEqual(theirs.result.machines, []);
    assertNoUserIdLeak(theirs, "acct1", "acct2");

    // Same machine id on the other account is a different row.
    call("machine-register", acct2, { machineId: "CNC-01", name: "Other mill" });
    assert.equal(call("oee-status", acct1, {}).result.machines.length, 1);
    assert.equal(call("oee-status", acct1, {}).result.machines[0].name, "Haas VF-2");
    assert.equal(call("oee-status", acct2, {}).result.machines[0].name, "Other mill");
  });

  it("machine-register upserts the same id and rejects a bad cycle time without saving", () => {
    call("machine-register", acct1, { machineId: "CNC-01", name: "Haas", idealCycleTime: 2 });
    const again = call("machine-register", acct1, { machineId: "CNC-01", name: "Haas VF-2", line: "Cell B", idealCycleTime: "1.25" });
    assert.equal(again.ok, true);
    assert.equal(again.result.machine.name, "Haas VF-2");
    assert.equal(again.result.machine.idealCycleTime, 1.25);
    assert.equal(call("oee-status", acct1, {}).result.machines.length, 1);

    const before = saves;
    const bad = call("machine-register", acct1, { machineId: "CNC-02", name: "Bad", idealCycleTime: "fast" });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /idealCycleTime/);
    assert.equal(saves, before);
    assert.equal(call("machine-register", acct1, { name: "No id" }).ok, false);
    assert.equal(call("machine-register", acct1, { machineId: "X" }).ok, false);
  });

  it("iot-reading-ingest updates availability and performance on a registered machine only", () => {
    const t0 = "2026-10-11T12:00:00.000Z";
    const t1 = "2026-10-11T12:10:00.000Z";
    // Readings before registration are stored, but the board stays empty.
    call("iot-reading-ingest", acct1, { machineId: "CNC-01", machineState: "running", cycleCount: 0, at: t0 });
    assert.equal(saves, 0);
    assert.deepEqual(call("oee-status", acct1, {}).result.machines, []);

    call("machine-register", acct1, { machineId: "CNC-01", name: "Haas", idealCycleTime: 1 });
    call("iot-reading-ingest", acct1, { machineId: "CNC-01", machineState: "running", cycleCount: 10, at: t1 });
    const row = call("oee-status", acct1, {}).result.machines[0];
    // 10 cycles in 10 running minutes at 1 min/cycle → performance 100, availability 100.
    assert.equal(row.availability, 100);
    assert.equal(row.performance, 100);
    assert.equal(row.status, "running");
    // No good/bad count on a reading, so quality and OEE stay unknown.
    assert.equal(row.quality, null);
    assert.equal(row.oee, null);
    assert.deepEqual(call("oee-status", acct2, {}).result.machines, []);
  });

  it("acct1 work-order-create lists on work-orders; acct2 update of that id is not found", () => {
    const created = call("work-order-create", acct1, {
      product: "Bracket-12", quantity: "25", dueDate: "2026-12-01", priority: "High",
    });
    assert.equal(created.ok, true);
    assert.equal(created.result.order.product, "Bracket-12");
    assert.equal(created.result.order.quantity, 25);
    assert.equal(created.result.order.priority, "high");
    assert.equal(created.result.order.status, "queued");
    assert.equal(created.result.order.dueDate, "2026-12-01");
    assert.equal(created.result.order.quantityProduced, 0);
    const id = created.result.order.id;
    assert.equal(saves, 1);

    const mine = call("work-orders", acct1, {});
    assert.equal(mine.result.source, "wired-feed");
    assert.equal(mine.result.orders.length, 1);
    assert.equal(mine.result.orders[0].id, id);

    const foreign = call("work-order-update", acct2, { id, status: "complete" });
    assert.equal(foreign.ok, false);
    assert.equal(foreign.error, "not found");
    assertNoUserIdLeak(foreign, "acct1", "acct2");
    assert.equal(call("work-orders", acct1, {}).result.orders[0].status, "queued");
    assert.deepEqual(call("work-orders", acct2, {}).result.orders, []);
    assertNoUserIdLeak(mine, "acct1", "acct2");
    assertNoUserIdLeak(created, "acct1", "acct2");

    const updated = call("work-order-update", acct1, { id, status: "in_progress" });
    assert.equal(updated.ok, true);
    assert.equal(updated.result.order.status, "in_progress");
    assert.equal(call("work-orders", acct1, {}).result.orders[0].status, "in_progress");
    assertNoUserIdLeak(updated, "acct1", "acct2");
  });

  it("work-order-create rejects a missing product, a bad quantity, and a bad date without saving", () => {
    const before = saves;
    assert.equal(call("work-order-create", acct1, { quantity: 5 }).ok, false);
    assert.match(call("work-order-create", acct1, { quantity: 5 }).error, /product required/);
    const qty = call("work-order-create", acct1, { product: "X", quantity: "many" });
    assert.equal(qty.ok, false);
    assert.match(qty.error, /quantity/);
    const date = call("work-order-create", acct1, { product: "X", quantity: 1, dueDate: "next tuesday" });
    assert.equal(date.ok, false);
    assert.match(date.error, /dueDate/);
    const pri = call("work-order-create", acct1, { product: "X", quantity: 1, priority: "asap" });
    assert.equal(pri.ok, false);
    assert.match(pri.error, /priority/);
    assert.equal(call("work-order-update", acct1, { id: "missing", status: "complete" }).error, "not found");
    assert.equal(saves, before);
    assert.deepEqual(call("work-orders", acct1, {}).result.orders, []);
  });

  it("acct1 spc-sample-log x5 returns 5 samples with control limits; acct2's chart is empty", () => {
    const values = [10, 11, 9, 10.5, 9.5];
    for (let i = 0; i < values.length; i++) {
      const logged = call("spc-sample-log", acct1, {
        product: "Bracket-12",
        value: i === 0 ? String(values[i]) : values[i],
        subgroup: i === 0 ? "A" : undefined,
      });
      assert.equal(logged.ok, true);
      assert.equal(logged.result.count, i + 1);
      assert.equal(logged.result.sample.value, values[i]);
    }
    assert.equal(saves, 5);

    const chart = call("spc-chart", acct1, { product: "Bracket-12" });
    assert.equal(chart.ok, true);
    assert.equal(chart.result.source, "wired-feed");
    assert.equal(chart.result.samples.length, 5);
    assert.equal(chart.result.samples[0].subgroup, "A");
    assert.equal(chart.result.centerLine, 10);
    assert.ok(chart.result.upperControl > chart.result.centerLine);
    assert.ok(chart.result.lowerControl < chart.result.centerLine);
    assert.equal(typeof chart.result.upperSpec, "number");
    assert.equal(typeof chart.result.lowerSpec, "number");
    assert.equal(typeof chart.result.cpk, "number");

    const other = call("spc-chart", acct2, { product: "Bracket-12" });
    assert.equal(other.ok, true);
    assert.equal(other.result.source, "empty");
    assert.deepEqual(other.result.samples, []);
    assertNoUserIdLeak(chart, "acct1", "acct2");
    assertNoUserIdLeak(other, "acct1", "acct2");
  });

  it("spc-sample-log rejects a non-numeric sample and a missing product without saving", () => {
    const before = saves;
    for (const value of ["lots", "", null, true, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = call("spc-sample-log", acct1, { product: "Bracket-12", value });
      assert.equal(r.ok, false, `expected rejection for ${String(value)}`);
      assert.match(r.error, /finite number/);
    }
    const missing = call("spc-sample-log", acct1, { value: 10 });
    assert.equal(missing.ok, false);
    assert.match(missing.error, /product required/);
    assert.equal(call("spc-sample-log", acct1, { product: "   ", value: 10 }).ok, false);
    assert.equal(saves, before);
    assert.equal(call("spc-chart", acct1, { product: "Bracket-12" }).result.source, "empty");
  });

  it("every manufacturing.<action> named in a notes string is registered", () => {
    const named = actionsNamedInNoteStrings(domainSrc);
    assert.ok(named.length >= 4, `notes scanner found ${named.join(", ") || "nothing"}`);
    for (const action of named) {
      assert.ok(ACTIONS.has(`manufacturing.${action}`), `notes name manufacturing.${action}, which is not registered`);
    }
    assert.ok(named.includes("machine-register"));
    assert.ok(named.includes("work-order-create"));
    assert.ok(named.includes("spc-sample-log"));
    assert.ok(named.includes("iot-reading-ingest"));

    const liveNotes = [
      call("oee-status", acct1, {}).result.notes,
      call("work-orders", acct1, {}).result.notes,
      call("spc-chart", acct1, { product: "Unset" }).result.notes,
      call("iot-machine-state", acct1, { machineId: "none" }).result.notes,
    ];
    const live = new Set();
    for (const note of liveNotes) {
      assert.equal(typeof note, "string");
      for (const a of String(note).matchAll(/manufacturing\.([a-z0-9-]+)/g)) live.add(a[1]);
    }
    assert.ok(live.size >= 3);
    for (const action of live) {
      assert.ok(ACTIONS.has(`manufacturing.${action}`), `live notes name manufacturing.${action}, which is not registered`);
    }
  });
});
