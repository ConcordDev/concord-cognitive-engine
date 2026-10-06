// tests/aviation-keep.test.js — REAL end-to-end proof for the Aviation
// lens keep-and-draft workflow. Mirrors the established pattern:
// add a real aircraft via `aircraft-add`, log a real flight via
// `logbook-add`, read it back via `logbook-list`, save it as a private
// DTU via `dtu.create`, read that DTU back via `dtu.get`, then draft it
// in Thread via `thread.thread-draft` citing that exact DTU id.
//
// Every lensRun call below names the macro literally. Nothing is published.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./depth/_harness.js";

describe("aviation keep + thread draft", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("aviation-keep-proof"); });

  it("adds a real aircraft, logs a real flight, reads it back, saves a private DTU, reads it back, and drafts it in Thread", async () => {
    // 1. Add a real aircraft via aircraft-add.
    const acR = await lensRun("aviation", "aircraft-add", {
      params: { tail: "N12PRF", make: "Cessna", model: "172S" },
    }, ctx);
    assert.equal(acR.ok, true, "aircraft-add should succeed");
    const ac = acR.result.aircraft;
    assert.ok(ac.id, "aircraft should have an id");
    assert.equal(ac.tail, "N12PRF");

    // 2. Log a real flight via logbook-add.
    const logR = await lensRun("aviation", "logbook-add", {
      params: {
        aircraftId: ac.id,
        date: "2026-10-05",
        from: "KSEA",
        to: "KPDX",
        totalHours: 1.5,
        pic: 1.5,
        dayLandings: 1,
        conditions: "VFR",
      },
    }, ctx);
    assert.equal(logR.ok, true, "logbook-add should succeed");
    const entry = logR.result.entry;
    assert.ok(entry.id, "log entry should have an id");
    assert.equal(entry.aircraftId, ac.id);
    assert.equal(entry.from, "KSEA");
    assert.equal(entry.to, "KPDX");
    assert.equal(entry.totalHours, 1.5);
    assert.equal(entry.conditions, "VFR");

    // 3. Read the real entry back via logbook-list.
    const listR = await lensRun("aviation", "logbook-list", {}, ctx);
    assert.equal(listR.ok, true, "logbook-list should succeed");
    const entries = listR.result.entries || [];
    const found = entries.find((e) => e.id === entry.id);
    assert.ok(found, "logbook-list should include the created entry");

    // 4. Save the entry as a private DTU.
    const sentence = "2026-10-05 KSEA→KPDX: 1.5h VFR.";
    const dtuCreated = await lensRun("dtu", "create", {
      params: {
        title: sentence.slice(0, 80),
        tags: ["aviation", "logbook", "flight"],
        source: "aviation-lens:logbook-report",
        human: { summary: sentence },
        core: { definitions: [sentence], claims: [sentence.slice(0, 240)] },
        machine: {
          kind: "aviation_logbook_report",
          entryId: entry.id,
          aircraftId: entry.aircraftId,
          date: entry.date,
          from: entry.from,
          to: entry.to,
          totalHours: entry.totalHours,
          pic: entry.pic,
          night: entry.night,
          instrument: entry.instrument,
          conditions: entry.conditions,
        },
        meta: { visibility: "private", consent: { allowCitations: false }, createdFrom: "aviation" },
      },
    }, ctx);
    assert.equal(dtuCreated.ok, true, "dtu.create should succeed");
    const dtuId = dtuCreated.result.dtu.id;
    assert.ok(dtuId, "DTU should have an id");

    // 5. Read the DTU back and confirm the id matches.
    const dtuBack = await lensRun("dtu", "get", { params: { id: dtuId } }, ctx);
    assert.equal(dtuBack.ok, true, "dtu.get should succeed");
    assert.equal(dtuBack.result.dtu.id, dtuId, "read-back DTU id must match");

    // 6. Draft it in Thread, citing that exact DTU.
    const drafted = await lensRun("thread", "thread-draft", {
      params: {
        title: "Aviation logbook — KSEA-KPDX",
        content: sentence,
        platform: "x",
        citedDtuId: dtuId,
      },
    }, ctx);
    assert.equal(drafted.ok, true, "thread-draft should succeed");
    const draft = drafted.result.draft;
    assert.equal(draft.status, "draft", "draft must stay draft");
    assert.equal(draft.citedDtuId, dtuId, "draft must cite the exact DTU");
    assert.ok(draft.id, "draft should have an id");

    // 7. Read the draft back and confirm it still cites the DTU.
    const draftBack = await lensRun("thread", "draft-detail", { params: { id: draft.id } }, ctx);
    assert.equal(draftBack.ok, true, "draft-detail should succeed");
    assert.equal(draftBack.result.draft.citedDtuId, dtuId, "draft-detail must cite the same DTU");
    assert.equal(draftBack.result.draft.status, "draft", "draft-detail must still be draft");
  });

  it("refuses to log a flight with no aircraftId", async () => {
    const r = await lensRun("aviation", "logbook-add", { params: { aircraftId: "", date: "2026-10-05", from: "KSEA", to: "KPDX", totalHours: 1 } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(/aircraftId/i.test(r.result.error), "should reject missing aircraftId");
  });

  it("refuses to log a flight with non-positive hours", async () => {
    const r = await lensRun("aviation", "logbook-add", { params: { aircraftId: "ac_x", date: "2026-10-05", from: "KSEA", to: "KPDX", totalHours: 0 } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(/totalHours/i.test(r.result.error), "should reject non-positive hours");
  });
});