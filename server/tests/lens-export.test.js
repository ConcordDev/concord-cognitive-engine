// server/tests/lens-export.test.js
//
// Q79: the shared Export downloads the lens's real data. Pins:
//   - dispatcher scaffolding rows (type "domain_action") never export;
//   - real artifacts still export, through the canonical lens.list path;
//   - a domain's registered provider contributes its state-resident
//     records (Calendar: the caller's own events from STATE.calendarLens
//     — a seeded event's title appears in the exported rows);
//   - providers are caller-scoped (another user's records never leak);
//   - a failing provider degrades honestly (providerError) instead of
//     taking the artifact export down or failing silently.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

const {
  collectLensExport,
  registerLensExportProvider,
  hasLensExportProvider,
  _clearLensExportProvidersForTests,
} = await import("../lib/lens-export.js");

const listMacro = (artifacts) => async (domain, action, input, ctx) => {
  assert.equal(domain, "lens");
  assert.equal(action, "list");
  return { ok: true, artifacts, total: artifacts.length };
};

describe("lens-export (Q79)", () => {
  before(() => _clearLensExportProvidersForTests());

  it("excludes domain_action scaffolding and keeps real artifacts", async () => {
    const runMacro = listMacro([
      { id: "a1", type: "note", title: "Real note", data: {} },
      { id: "v1", type: "domain_action", title: undefined, data: { prompt: "x" } },
      { id: "v2", type: "domain_action", data: {} },
    ]);
    const out = await collectLensExport({ runMacro, domain: "notes", ctx: { actor: { userId: "u1" } } });
    assert.equal(out.ok, true);
    assert.deepEqual(out.artifacts.map((a) => a.id), ["a1"]);
    assert.equal(out.sources.artifacts, 1);
    assert.equal(out.stateBacked, false);
  });

  it("merges a registered provider's rows with provenance", async () => {
    registerLensExportProvider("widgets", () => [
      { id: "w1", type: "widget", title: "State widget", createdAt: "2026-01-01T00:00:00Z", data: { size: 3 } },
    ]);
    assert.equal(hasLensExportProvider("widgets"), true);
    const out = await collectLensExport({ runMacro: listMacro([]), domain: "widgets", ctx: { actor: { userId: "u1" } } });
    assert.equal(out.stateBacked, true);
    assert.equal(out.sources.stateRecords, 1);
    assert.equal(out.artifacts[0].title, "State widget");
    assert.equal(out.artifacts[0].domain, "widgets");
  });

  it("a failing provider surfaces providerError and artifacts still export", async () => {
    registerLensExportProvider("broken", () => { throw new Error("state_exploded"); });
    const out = await collectLensExport({
      runMacro: listMacro([{ id: "a9", type: "note", title: "Still here", data: {} }]),
      domain: "broken",
      ctx: { actor: { userId: "u1" } },
    });
    assert.equal(out.ok, true);
    assert.equal(out.providerError, "state_exploded");
    assert.deepEqual(out.artifacts.map((a) => a.id), ["a9"]);
  });

  it("a lens.list failure propagates as ok:false", async () => {
    const runMacro = async () => ({ ok: false, error: "domain required" });
    const out = await collectLensExport({ runMacro, domain: "nope", ctx: {} });
    assert.equal(out.ok, false);
    assert.equal(out.error, "domain required");
  });

  it("calendar provider: the caller's seeded event title appears in the export; another user's does not", async () => {
    _clearLensExportProvidersForTests();
    globalThis._concordSTATE = {
      calendarLens: {
        calendars: new Map([["u1", [{ id: "cal1", name: "Personal", createdAt: "2026-01-01T00:00:00Z" }]]]),
        events: new Map([
          ["u1", [{ id: "evt1", title: "Dentist appointment", start: "2026-11-01T15:00:00Z", createdAt: "2026-10-01T00:00:00Z" }]],
          ["u2", [{ id: "evt2", title: "Secret plans", start: "2026-11-02T15:00:00Z" }]],
        ]),
        tasks: new Map(),
        seq: new Map(),
        appointmentSchedules: new Map(),
      },
    };
    const { default: registerCalendarActions } = await import("../domains/calendar.js");
    registerCalendarActions(() => {});
    assert.equal(hasLensExportProvider("calendar"), true);

    const out = await collectLensExport({
      runMacro: listMacro([]),
      domain: "calendar",
      ctx: { actor: { userId: "u1" } },
    });
    assert.equal(out.ok, true);
    const serialized = JSON.stringify(out.artifacts);
    assert.ok(serialized.includes("Dentist appointment"), "the seeded record's title appears in the exported rows (the audit's done-state)");
    assert.ok(!serialized.includes("Secret plans"), "another user's events never leak into the caller's export");
    assert.ok(serialized.includes("Personal"), "the caller's calendar itself is exported too");
    assert.equal(out.sources.stateRecords, 2);
    delete globalThis._concordSTATE;
  });
});
