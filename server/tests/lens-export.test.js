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
  exportCallerLensState,
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

  it("poetry provider: the caller's poem text appears in the export; another user's does not (D5)", async () => {
    _clearLensExportProvidersForTests();
    globalThis._concordSTATE = {
      poetryLens: {
        poems: new Map([
          ["u1", [{ id: "pm1", title: "Door poem", body: "the hinge held", form: "free-verse", status: "draft", tags: [], createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" }]],
          ["u2", [{ id: "pm2", title: "Secret poem", body: "never shared", form: "free-verse", status: "draft", tags: [], createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z" }]],
        ]),
      },
    };
    const { default: registerPoetryActions } = await import("../domains/poetry.js");
    registerPoetryActions(() => {});
    assert.equal(hasLensExportProvider("poetry"), true);

    const out = await collectLensExport({
      runMacro: listMacro([]),
      domain: "poetry",
      ctx: { actor: { userId: "u1" } },
    });
    assert.equal(out.ok, true);
    const serialized = JSON.stringify(out.artifacts);
    assert.ok(serialized.includes("the hinge held"), "the caller's own poem text appears in the exported rows");
    assert.ok(!serialized.includes("never shared"), "another user's poem never leaks into the caller's export");
    assert.equal(out.sources.stateRecords, 1);
    delete globalThis._concordSTATE;
  });

  it("export-leak hotfix: activity-minted system mirrors are dropped unless caller-owned", async () => {
    _clearLensExportProvidersForTests();
    const runMacro = listMacro([
      { id: "mine-1", type: "note", title: "My note", ownerId: "u1", meta: { visibility: "private" }, data: {} },
      {
        id: "dtu_lens_meditation_dtu_leak1",
        type: "regular",
        title: "Lens:goals delete goal",
        ownerId: "system",
        meta: { visibility: "public", createdFrom: "dtu-auto-sync" },
        data: { summary: "delete goal \"secret\" in goals lens" },
      },
      {
        id: "public-feed",
        type: "feed_article",
        title: "External headline",
        ownerId: "system",
        meta: { visibility: "public" },
        data: { url: "https://example.com" },
      },
      {
        id: "dtu_lens_meditation_dtu_own",
        type: "regular",
        title: "Lens:meditation sessionLog session",
        ownerId: "u1",
        meta: { visibility: "private", createdFrom: "dtu-auto-sync" },
        data: {},
      },
    ]);
    const out = await collectLensExport({ runMacro, domain: "meditation", ctx: { actor: { userId: "u1" } } });
    assert.equal(out.ok, true);
    const ids = out.artifacts.map((a) => a.id);
    assert.ok(ids.includes("mine-1"), "own artifact kept");
    assert.ok(ids.includes("public-feed"), "genuine public catalog kept");
    assert.ok(ids.includes("dtu_lens_meditation_dtu_own"), "caller-owned activity mint kept");
    assert.ok(!ids.includes("dtu_lens_meditation_dtu_leak1"), "system activity mirror dropped");
    const serialized = JSON.stringify(out.artifacts);
    assert.ok(!serialized.includes("secret"), "leaked goal text must not appear");
  });

  it("meditation provider: caller's journal session exports; another user's does not", async () => {
    _clearLensExportProvidersForTests();
    globalThis._concordSTATE = {
      meditationLens: {
        sessions: new Map([
          ["u1", [{ id: "s1", title: "Morning sit", journal: "felt steady", completedAt: "2026-11-09T10:00:00Z", durationMin: 10, category: "guided", sessionId: "g-morn-7" }]],
          ["u2", [{ id: "s2", title: "Other sit", journal: "private other", completedAt: "2026-11-09T10:00:00Z", durationMin: 5, category: "guided", sessionId: "g-focus-10" }]],
        ]),
        moods: new Map(),
      },
    };
    const { default: registerMeditationActions } = await import("../domains/meditation.js");
    registerMeditationActions(() => {});
    assert.equal(hasLensExportProvider("meditation"), true);
    const out = await collectLensExport({
      runMacro: listMacro([]),
      domain: "meditation",
      ctx: { actor: { userId: "u1" } },
    });
    assert.equal(out.ok, true);
    const serialized = JSON.stringify(out.artifacts);
    assert.ok(serialized.includes("felt steady"), "caller journal appears");
    assert.ok(!serialized.includes("private other"), "other user journal never leaks");
    delete globalThis._concordSTATE;
  });

  it("panel records in STATE.<domain>Lens export for the caller only, with no provider registered", async () => {
    _clearLensExportProvidersForTests();
    globalThis._concordSTATE = {
      nonprofitLens: {
        campaigns: new Map([
          ["u1", [{ id: "cmp1", name: "QA donor drive", goal: 50, createdAt: "2026-11-01T00:00:00Z", donations: [{ id: "don1", amount: 5, donor: "Ada" }] }]],
          ["u2", [{ id: "cmp2", name: "Secret drive", goal: 10, createdAt: "2026-11-01T00:00:00Z" }]],
        ]),
        seq: new Map([["u1", { n: 1 }]]),
      },
      tradesLens: {
        jobs: new Map([
          ["u1", new Map([["job1", { id: "job1", name: "Boiler repair", createdAt: "2026-11-02T00:00:00Z" }]])],
          ["u2", new Map([["job2", { id: "job2", name: "Other job", createdAt: "2026-11-02T00:00:00Z" }]])],
        ]),
      },
      filmStudiosLens: {
        slates: new Map([
          ["u1", [{ id: "sl1", title: "Scene 12", createdAt: "2026-11-03T00:00:00Z" }]],
        ]),
      },
      whiteboardLens: {
        boards: new Map([["u1", new Map([["b1", { id: "b1", title: "My board" }]])]]),
        sharedBoards: new Map([["bX", { id: "bX", title: "Someone else's shared board", ownerId: "u9" }]]),
      },
      looseLens: {
        notes: [
          { id: "n1", title: "Mine", ownerId: "u1" },
          { id: "n2", title: "Theirs", ownerId: "u2" },
          { id: "n3", title: "Unscoped" },
        ],
      },
    };
    const runMacro = async (domain) => {
      if (domain === "lens") return { ok: true, artifacts: [] };
      if (domain === "dtu") return { ok: true, dtus: [] };
      return { ok: false, error: "unexpected" };
    };
    const nonprofit = await collectLensExport({ runMacro, domain: "nonprofit", ctx: { actor: { userId: "u1" } } });
    const np = JSON.stringify(nonprofit.artifacts);
    assert.ok(np.includes("QA donor drive"), "caller campaign is in the export");
    assert.ok(!np.includes("Secret drive"), "another user's campaign is not");
    assert.equal(nonprofit.stateBacked, true);
    assert.equal(nonprofit.sources.stateRecords, 1);

    const trades = await collectLensExport({ runMacro, domain: "trades", ctx: { actor: { userId: "u1" } } });
    const tr = JSON.stringify(trades.artifacts);
    assert.ok(tr.includes("Boiler repair"));
    assert.ok(!tr.includes("Other job"));

    const film = await collectLensExport({ runMacro, domain: "film-studios", ctx: { actor: { userId: "u1" } } });
    assert.ok(JSON.stringify(film.artifacts).includes("Scene 12"), "hyphenated domain matches filmStudiosLens");

    const board = await collectLensExport({ runMacro, domain: "whiteboard", ctx: { actor: { userId: "u1" } } });
    const wb = JSON.stringify(board.artifacts);
    assert.ok(wb.includes("My board"));
    assert.ok(!wb.includes("Someone else's shared board"));

    const loose = exportCallerLensState(globalThis._concordSTATE, "loose", { actor: { userId: "u1" } });
    assert.deepEqual(loose.map((r) => r.title), ["Mine"]);

    const anon = await collectLensExport({ runMacro, domain: "nonprofit", ctx: {} });
    assert.equal(anon.sources.stateRecords, 0, "no actor means no panel rows");
    delete globalThis._concordSTATE;
  });

});
