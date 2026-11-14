// GB-1539 §16 — the shared-exporter five (FIX-message-003 · FIX-physics-005 ·
// FIX-suffering-003 · FIX-bio-006 · FIX-urban-planning-005), head-check pins.
//
// The founder's ruling: one shared exporter all lenses use; it exports
// exactly the user's lens content; empty = an honest "nothing to export
// yet", never an empty file. The first block pins the shared exporter's
// reach over the five lenses' REAL bag shapes (seeded as their own
// create handlers shape them) — the head-check evidence that four of the
// five were already cured at head and the fifth's header leg was too.
// The non-happy paths (another user's rows, a share record for someone
// else's scene) are held shut. The route block exercises the download
// surface: data columns ride the CSV, JSON carries rows whole, and an
// empty lens downloads nothing (404).

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { collectLensExport } from "../lib/lens-export.js";
import createUniversalExportRouter from "../routes/universal-export.js";

const UID = "u-export5";
const OTHER = "u-someone-else";
const ctx = { actor: { userId: UID }, userId: UID };
const M = (v) => new Map([[UID, v]]);
const MO = (v) => new Map([[OTHER, v]]);

const runMacro = async (domain, action) => {
  if (domain === "lens" && action === "list") return { ok: true, artifacts: [] };
  if (domain === "dtu" && action === "list") return { ok: true, dtus: [] };
  return { ok: false, error: "unexpected macro" };
};

afterEach(() => { globalThis._concordSTATE = undefined; });

async function collect(domain) {
  const out = await collectLensExport({ runMacro, domain, ctx, limit: 1000 });
  assert.equal(out.ok, true);
  return out;
}

const TS = "2026-11-12T00:00:00Z";
const CASES = [
  ["message", { messageLens: {
      saved: M(new Map([["m1", { id: "sav_1", messageId: "m1", threadId: "t1", sender: "kayli", body: "Saved body QA", note: "", savedAt: TS }]])),
      labels: M(new Map([["l1", { id: "l1", name: "Label QA", color: "red" }]])),
    } }, ["sav_1", "l1"]],
  ["physics", { physicsLens: {
      scenes: M(new Map([["sc1", { id: "sc1", name: "Scene QA", bodies: [], constraints: [], fluids: [], settings: {}, createdAt: TS, updatedAt: TS }]])),
    } }, ["sc1"]],
  ["suffering", { sufferingLens: {
      pains: M([{ id: "pain_1", title: "Pain QA", description: "knee pain on stairs", severity: 5, frequency: 5, impact: 5, effort: 2, status: "open", createdAt: TS, updatedAt: TS }]),
      themes: M([{ id: "th_1", title: "Theme QA", createdAt: TS }]),
      interventions: M([{ id: "in_1", title: "Intervention QA", createdAt: TS }]),
    } }, ["pain_1", "th_1", "in_1"]],
  ["bio", { bioLens: {
      sequences: M(new Map([["seq_1", { id: "seq_1", name: "Seq QA", sequence: "GAATTC", kind: "dna", description: "", length: 6, createdAt: TS, updatedAt: TS }]])),
    } }, ["seq_1"]],
  ["urban-planning", { urbanPlanningLens: {
      parcels: M([{ id: "parcel_1", apn: "APN-QA", address: "1 Main St", zoneType: "residential", lotSizeSqFt: 5000, createdAt: TS }]),
      scenarios: M([{ id: "scn_1", name: "Scenario QA", createdAt: TS }]),
      projects: M([{ id: "prj_1", name: "Project QA", createdAt: TS }]),
    } }, ["parcel_1", "scn_1", "prj_1"]],
];

describe("the shared exporter reaches the five lenses' real bag shapes", () => {
  for (const [domain, state, wantIds] of CASES) {
    test(`${domain}: the caller's panel records ride, stateBacked`, async () => {
      globalThis._concordSTATE = state;
      const out = await collect(domain);
      const got = out.artifacts.map((r) => r.id);
      for (const id of wantIds) assert.ok(got.includes(id), `${domain} export missing ${id}: [${got}]`);
      assert.equal(out.stateBacked, true, `${domain} should report stateBacked`);
    });
  }

  test("message: the saved entry's body rides in data", async () => {
    globalThis._concordSTATE = CASES[0][1];
    const out = await collect("message");
    const row = out.artifacts.find((r) => r.id === "sav_1");
    assert.equal(row.data.body, "Saved body QA");
  });

  test("bio: the sequence string rides in data", async () => {
    globalThis._concordSTATE = CASES[3][1];
    const out = await collect("bio");
    const row = out.artifacts.find((r) => r.id === "seq_1");
    assert.equal(row.data.sequence, "GAATTC");
  });
});

describe("non-happy paths stay shut", () => {
  for (const [domain, , wantIds] of CASES) {
    test(`${domain}: another user's records never ride`, async () => {
      // Rebuild the case state keyed to OTHER instead of UID.
      const mine = CASES.find((c) => c[0] === domain)[1];
      const otherState = {};
      for (const [bagName, bag] of Object.entries(mine)) {
        const nb = {};
        for (const [k, v] of Object.entries(bag)) nb[k] = MO(v instanceof Map ? v.get(UID) : v);
        otherState[bagName] = nb;
      }
      globalThis._concordSTATE = otherState;
      const out = await collect(domain);
      assert.equal(out.artifacts.length, 0, `${domain} leaked another user's records`);
      for (const id of wantIds) assert.ok(!out.artifacts.some((r) => r.id === id));
    });
  }

  test("physics: a share record is not an export row — the scene rides once, via scenes", async () => {
    globalThis._concordSTATE = { physicsLens: {
      scenes: M(new Map([["sc1", { id: "sc1", name: "Scene QA", createdAt: TS }]])),
      shares: new Map([["code1", { ownerId: UID, scene: { id: "sc1", name: "Scene QA" }, createdAt: TS }]]),
    } };
    const out = await collect("physics");
    assert.deepEqual(out.artifacts.map((r) => r.id), ["sc1"]);
  });

  test("physics: someone else's shared scene does not ride", async () => {
    globalThis._concordSTATE = { physicsLens: {
      scenes: new Map(),
      shares: new Map([["code9", { ownerId: OTHER, scene: { id: "sc9", name: "Theirs" }, createdAt: TS }]]),
    } };
    const out = await collect("physics");
    assert.equal(out.artifacts.length, 0);
  });
});

describe("download route on the five's rows", () => {
  async function withServer(state, fn) {
    globalThis._concordSTATE = state;
    const app = express();
    app.use(createUniversalExportRouter(globalThis._concordSTATE, runMacro, () => ctx));
    const server = app.listen(0);
    try {
      await fn(`http://127.0.0.1:${server.address().port}`);
    } finally {
      server.close();
    }
  }

  test("suffering CSV carries the pain fields past the envelope columns", async () => {
    await withServer(CASES[2][1], async (base) => {
      const res = await fetch(`${base}/api/lens/suffering/export/download?format=csv`);
      assert.equal(res.status, 200);
      const body = await res.text();
      assert.ok(body.split("\n")[0].includes("description"), `CSV header lacks description: ${body.split("\n")[0]}`);
      assert.ok(body.includes("knee pain on stairs"), "CSV body lacks the pain description");
    });
  });

  test("suffering JSON carries the pain row whole", async () => {
    await withServer(CASES[2][1], async (base) => {
      const res = await fetch(`${base}/api/lens/suffering/export/download?format=json`);
      assert.equal(res.status, 200);
      const rows = await res.json();
      const pain = rows.find((r) => r.id === "pain_1");
      assert.ok(pain, "pain row missing from JSON export");
      assert.equal(pain.data.severity, 5);
    });
  });

  test("urban-planning JSON carries the parcel row", async () => {
    await withServer(CASES[4][1], async (base) => {
      const res = await fetch(`${base}/api/lens/urban-planning/export/download?format=json`);
      assert.equal(res.status, 200);
      const rows = await res.json();
      const parcel = rows.find((r) => r.id === "parcel_1");
      assert.ok(parcel, "parcel row missing from JSON export");
      assert.equal(parcel.data.apn, "APN-QA");
    });
  });

  test("an empty lens downloads nothing (404, never an empty file)", async () => {
    await withServer({ sufferingLens: { pains: new Map(), themes: new Map(), interventions: new Map() } }, async (base) => {
      const res = await fetch(`${base}/api/lens/suffering/export/download?format=csv`);
      assert.equal(res.status, 404);
    });
  });
});
