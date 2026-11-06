// Close-out slice A1 — cross-lens Activity + shell event-taxonomy.
//
// Part A pins the labels blocks the slice adds for the register §2
// member domains (government · metacognition · metalearning ·
// reflection · experience · science · hvac): write rows name the
// object under the key that leg's call actually carries, and pure
// reads are quiet so a member's write rows cannot rotate out of the
// capped log under the lens's own load traffic.
//
// Part B exercises the recorder itself — extracted verbatim from
// server.js and composed with the REAL labels module — over the
// artifact-route call shape the coverage half adds: an artifact
// create records "create: <title>", a quiet read records nothing,
// an anonymous actor records nothing.
import vm from "node:vm";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isQuietLensAction,
  lensActivityLabel,
  lensActivityObject,
} from "../lib/lens-activity-labels.js";

describe("A1 labels — government (F9)", () => {
  it("foia-create names the request by its subject, not the kind alone", () => {
    assert.equal(
      lensActivityObject("government", "foia-create", {}, { request: { subject: "Bridge inspection reports" } }),
      "Bridge inspection reports",
    );
  });
  it("the write family names its objects", () => {
    assert.equal(lensActivityObject("government", "permits-apply", {}, { permit: { type: "Deck" } }), "Deck");
    assert.equal(lensActivityObject("government", "departments-add", { name: "Sanitation" }, { department: { name: "Sanitation" } }), "Sanitation");
    assert.equal(lensActivityObject("government", "assets-add", {}, { asset: { name: "Truck 12" } }), "Truck 12");
  });
  it("the read family is quiet", () => {
    for (const a of ["foia-list", "permits-list", "bills-list", "open-data-search", "fines-list"]) {
      assert.equal(isQuietLensAction("government", a), true, a);
    }
    assert.equal(isQuietLensAction("government", "foia-create"), false);
  });
});

describe("A1 labels — the member domains", () => {
  it("metacognition rows name the member's own record; reads are quiet", () => {
    assert.equal(lensActivityObject("metacognition", "journalLog", {}, { decision: { text: "Ship the smaller cut" } }), "Ship the smaller cut");
    assert.equal(lensActivityObject("metacognition", "reflectionSave", { title: "On review" }, { reflection: { title: "On review" } }), "On review");
    assert.equal(isQuietLensAction("metacognition", "journalList"), true);
    assert.equal(isQuietLensAction("metacognition", "calibrationReport"), true);
  });
  it("metalearning rows name the card / plan / goal; list reads are quiet", () => {
    assert.equal(lensActivityObject("metalearning", "srsAddCard", {}, { card: { front: "derivative of ln x" } }), "derivative of ln x");
    assert.equal(lensActivityObject("metalearning", "planCreate", {}, { plan: { title: "Fracture mechanics" } }), "Fracture mechanics");
    assert.equal(isQuietLensAction("metalearning", "srsDue"), true);
    assert.equal(isQuietLensAction("metalearning", "journalList"), true);
  });
  it("reflection rows name the entry / journal; the read sweep is quiet", () => {
    assert.equal(lensActivityObject("reflection", "entry-create", {}, { entry: { title: "River walk" } }), "River walk");
    assert.equal(lensActivityObject("reflection", "journal-create", { name: "Field notes" }, { journal: { name: "Field notes" } }), "Field notes");
    for (const a of ["entry-list", "entry-search", "journal-list", "mood-trend", "on-this-day"]) {
      assert.equal(isQuietLensAction("reflection", a), true, a);
    }
  });
  it("experience / science / hvac rows name their objects; reads are quiet", () => {
    assert.equal(lensActivityObject("experience", "createTest", {}, { test: { name: "Checkout study" } }), "Checkout study");
    assert.equal(lensActivityObject("science", "dataset-save", {}, { dataset: { name: "River samples" } }), "River samples");
    assert.equal(lensActivityObject("hvac", "tech-add", {}, { technician: { name: "Pat" } }), "Pat");
    assert.equal(isQuietLensAction("experience", "listTests"), true);
    assert.equal(isQuietLensAction("science", "stats-ttest"), true);
    assert.equal(isQuietLensAction("hvac", "tech-list"), true);
  });
  it("an authoritative spec that yields nothing stays action-only (no generic override)", () => {
    assert.equal(lensActivityObject("science", "dataset-save", {}, { dataset: {} }), "");
    assert.equal(lensActivityLabel("government", "foia-create"), "foia create");
  });
});

// ---- Part B: the recorder, extracted verbatim from server.js ----
function loadRecorder() {
  const src = readFileSync(new URL("../server.js", import.meta.url), "utf8");
  const start = src.indexOf("function _recordLensActivity(");
  assert.ok(start >= 0, "recorder present in server.js");
  const end = src.indexOf("\n}\n", start);
  assert.ok(end > start, "recorder body bounded");
  const body = src.slice(start, end + 3);
  const rows = [];
  const log = (type, message, meta, userId) => rows.push({ type, message, meta, userId });
  const factory = vm.compileFunction(`${body}; return _recordLensActivity;`, [
    "isQuietLensAction", "lensActivityLabel", "lensActivityObject", "log",
  ]);
  return { record: factory(isQuietLensAction, lensActivityLabel, lensActivityObject, log), rows };
}

describe("A1 coverage — the recorder over artifact-route calls", () => {
  it("an artifact create records 'create: <title>' for its actor", () => {
    const { record, rows } = loadRecorder();
    record("reflection", "create", { userId: "u1" }, { title: "River walk", type: "entry" }, { ok: true, artifact: { title: "River walk" } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].message, "create: River walk");
    assert.equal(rows[0].userId, "u1");
    assert.equal(rows[0].type, "reflection");
  });
  it("an artifact publish records the artifact it published", () => {
    const { record, rows } = loadRecorder();
    record("government", "publish", { actor: { userId: "u2" } }, { title: "Q3 Report" }, { artifact: { title: "Q3 Report" } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].message, "publish: Q3 Report");
  });
  it("a quiet read records nothing; an anon actor records nothing", () => {
    const { record, rows } = loadRecorder();
    record("government", "foia-list", { userId: "u1" }, {}, { requests: [] });
    record("reflection", "create", { userId: "anon" }, { title: "X" }, { artifact: { title: "X" } });
    record("reflection", "create", { actor: { userId: "u1", internal: true } }, { title: "X" }, { artifact: { title: "X" } });
    assert.equal(rows.length, 0);
  });
  it("a government foia-create through lens/run names its subject", () => {
    const { record, rows } = loadRecorder();
    record("government", "foia-create", { userId: "u1" }, { subject: "Bridge inspection reports" }, { request: { subject: "Bridge inspection reports" } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].message, "foia create: Bridge inspection reports");
  });
});
