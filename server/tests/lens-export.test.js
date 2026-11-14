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
  dtuBelongsInLensExport,
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

  it("owner-scoped export contract (2026-11-14 ruling): system and other-owner rows never ride a personal export", async () => {
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
        // FIX-research-001's shape: a system-owned public feed article.
        // The pre-ruling contract kept it as "genuine public catalog";
        // the owner-scoped ruling retires that keep — a personal export
        // carries the caller's own rows, never the system feed.
        id: "public-feed",
        type: "feed_article",
        title: "External headline",
        ownerId: "system",
        meta: { visibility: "public" },
        data: { url: "https://example.com" },
      },
      {
        id: "other-public",
        type: "note",
        title: "Someone else's public note",
        ownerId: "u2",
        meta: { visibility: "public" },
        data: {},
      },
      {
        id: "other-published",
        type: "note",
        title: "Someone else's published note",
        ownerId: "u2",
        meta: { visibility: "published" },
        data: {},
      },
      { id: "ownerless-1", type: "note", title: "Legacy ownerless note", data: {} },
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
    assert.ok(!ids.includes("public-feed"), "system feed article dropped under the owner-scoped contract");
    assert.ok(!ids.includes("other-public"), "another user's public artifact dropped");
    assert.ok(!ids.includes("other-published"), "another user's published artifact dropped");
    assert.ok(ids.includes("ownerless-1"), "ownerless legacy artifact kept (the Leg-A treatment)");
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

  it("finance export drops other domains, other owners, and Chat Context", async () => {
    const runMacro = async (domain, action) => {
      if (domain === "lens") return { ok: true, artifacts: [] };
      if (domain === "dtu" && action === "list") {
        return {
          ok: true,
          dtus: [
            { id: "fin", title: "Cash", domain: "finance", ownerId: "u1" },
            { id: "chat", title: "Chat Context: someone else", domain: "chat", ownerId: "u2" },
            { id: "other", title: "Analogy pack", domain: "analogy", ownerId: "u1" },
            { id: "exhaust", title: "Lens:goals delete goal", ownerId: "u1" },
            { id: "mine", title: "Untagged note", ownerId: "u1" },
          ],
        };
      }
      return { ok: false, error: "unexpected" };
    };
    const out = await collectLensExport({ runMacro, domain: "finance", ctx: { actor: { userId: "u1" } } });
    const ids = out.artifacts.map((a) => a.id);
    assert.deepEqual(ids.sort(), ["fin", "mine"]);
    assert.equal(dtuBelongsInLensExport({ id: "x", title: "Chat Context", ownerId: "u1" }, "finance", "u1"), false);
  });

  it("exports caller records stored outside a <domain>Lens bag", async () => {
    const runMacro = async () => ({ ok: true, artifacts: [], dtus: [] });
    globalThis._concordSTATE = {
      sentinelCases: new Map([
        ["u1", [{ id: "case_1", title: "My sentinel case" }]],
        ["u2", [{ id: "case_2", title: "Other sentinel case" }]],
      ]),
      writingLens: {
        projects: new Map([
          ["u1", [{ id: "page_1", title: "My page" }]],
          ["u2", [{ id: "page_2", title: "Other page" }]],
        ]),
      },
      conLens: {
        rfis: new Map([["u1", [{ id: "rfi_1", title: "My RFI" }]]]),
      },
      insLens: {
        policies: new Map([["u1", [{ id: "pol_1", title: "My policy" }]]]),
      },
      cognitiveReplay: {
        moments: new Map([
          ["u1", [{ id: "mom_1", title: "My moment" }]],
          ["u2", [{ id: "mom_2", title: "Other moment" }]],
        ]),
      },
      artifacts: new Map([["u1", [{ id: "art_1", title: "Not an art-lens row" }]]]),
    };
    const sentinel = await collectLensExport({ runMacro, domain: "sentinel", ctx: { actor: { userId: "u1" } } });
    const sent = JSON.stringify(sentinel.artifacts);
    assert.ok(sent.includes("My sentinel case"));
    assert.ok(!sent.includes("Other sentinel case"));

    const writing = await collectLensExport({ runMacro, domain: "creative-writing", ctx: { actor: { userId: "u1" } } });
    const pages = JSON.stringify(writing.artifacts);
    assert.ok(pages.includes("My page"));
    assert.ok(!pages.includes("Other page"));

    const construction = await collectLensExport({ runMacro, domain: "construction", ctx: { actor: { userId: "u1" } } });
    assert.ok(JSON.stringify(construction.artifacts).includes("My RFI"));

    const insurance = await collectLensExport({ runMacro, domain: "insurance", ctx: { actor: { userId: "u1" } } });
    assert.ok(JSON.stringify(insurance.artifacts).includes("My policy"));

    const replay = await collectLensExport({ runMacro, domain: "cognitive-replay", ctx: { actor: { userId: "u1" } } });
    const moments = JSON.stringify(replay.artifacts);
    assert.ok(moments.includes("My moment"));
    assert.ok(!moments.includes("Other moment"));

    const art = await collectLensExport({ runMacro, domain: "art", ctx: { actor: { userId: "u1" } } });
    assert.ok(!JSON.stringify(art.artifacts).includes("Not an art-lens row"));
    delete globalThis._concordSTATE;
  });

  it("exports estate, earned achievements, catches, fleet, and vault submissions for the caller", async () => {
    _clearLensExportProvidersForTests();
    const runMacro = async (domain) => {
      if (domain === "lens") return { ok: true, artifacts: [] };
      if (domain === "dtu") return { ok: true, dtus: [] };
      return { ok: false, error: "unexpected" };
    };
    const rowsDb = (rows) => ({ prepare: () => ({ all: () => rows }) });

    globalThis._concordSTATE = {
      inheritanceEstates: new Map([
        ["u1", { userId: "u1", beneficiaries: [{ id: "b1", name: "Mira" }], assets: [], wills: [{ version: 1, title: "Will of u1" }], executors: [], locks: [], createdAt: 1, updatedAt: 2 }],
        ["u2", { userId: "u2", beneficiaries: [{ id: "b2", name: "Secret heir" }], assets: [], wills: [], executors: [], locks: [] }],
      ]),
      logisticsLens: {
        shipments: new Map([
          ["u1", [{ id: "shp1", origin: "Dock", destination: "Yard", consignee: "QA LT4", reference: "SHP-1" }]],
          ["u2", [{ id: "shp2", origin: "Hidden", destination: "Other", consignee: "Secret consignee" }]],
        ]),
      },
      petsLens: {
        pets: new Map([
          ["u1", [{ id: "pet1", name: "QA pet", species: "dog" }]],
          ["u2", [{ id: "pet2", name: "Secret pet", species: "cat" }]],
        ]),
      },
      schemaLens: {
        registry: new Map([
          ["u1", [{ id: "sch1", name: "qa5", versions: [{ version: 1 }] }]],
          ["u2", [{ id: "sch2", name: "Secret schema" }]],
        ]),
      },
    };

    const { default: registerInheritance } = await import("../domains/inheritance.js");
    registerInheritance(() => {});
    const estate = await collectLensExport({ runMacro, domain: "inheritance", ctx: { actor: { userId: "u1" } } });
    const estateText = JSON.stringify(estate.artifacts);
    assert.ok(estateText.includes("Mira"), "caller estate is in the file");
    assert.ok(estateText.includes("Will of u1"));
    assert.ok(!estateText.includes("Secret heir"));

    const { default: registerAchievements } = await import("../domains/achievements.js");
    registerAchievements(() => {});
    const earned = await collectLensExport({
      runMacro,
      domain: "achievements",
      ctx: {
        actor: { userId: "u1" },
        db: rowsDb([{ achievement_id: "first_catch", title: "First catch", earned_at: 10, category: "exploration" }]),
      },
    });
    assert.ok(JSON.stringify(earned.artifacts).includes("First catch"));

    const { default: registerFishing } = await import("../domains/fishing.js");
    registerFishing(() => {});
    const catches = await collectLensExport({
      runMacro,
      domain: "fishing",
      ctx: {
        actor: { userId: "u1" },
        db: rowsDb([{ id: "fish1", item_id: "trout", item_name: "River Trout", quantity: 1, world_id: "concordia-hub", acquired_at: 10 }]),
      },
    });
    assert.ok(JSON.stringify(catches.artifacts).includes("River Trout"));

    const { default: registerGarage } = await import("../domains/garage.js");
    registerGarage(() => {});
    const fleet = await collectLensExport({
      runMacro,
      domain: "garage",
      ctx: {
        actor: { userId: "u1" },
        db: rowsDb([{ id: "veh1", world_id: "sere", kind: "cart", capacity: 2, fare_cc: 0, condition_pct: 100, created_at: 10 }]),
      },
    });
    const fleetText = JSON.stringify(fleet.artifacts);
    assert.ok(fleetText.includes("cart"));
    assert.ok(fleetText.includes("sere"), "a vehicle outside the hub world is included");

    const { default: registerVault } = await import("../domains/vault.js");
    registerVault(() => {});
    const vault = await collectLensExport({
      runMacro,
      domain: "vault",
      ctx: {
        actor: { userId: "u1" },
        db: rowsDb([{
          id: "sub1", title: "QA vault work", work_kind: "text", description: "notes",
          status: "submitted", submitted_at: 10, admitted_at: null, decline_reason: null,
          declined_at: null, curator_statement: null, admitted_by: null, admitted_by_role: null,
          record_dtu_id: null, body: "",
        }]),
      },
    });
    assert.ok(JSON.stringify(vault.artifacts).includes("QA vault work"));

    const logistics = await collectLensExport({ runMacro, domain: "logistics", ctx: { actor: { userId: "u1" } } });
    const ship = JSON.stringify(logistics.artifacts);
    assert.ok(ship.includes("QA LT4"));
    assert.ok(ship.includes("Dock"));
    assert.ok(!ship.includes("Secret consignee"));

    const pets = await collectLensExport({ runMacro, domain: "pets", ctx: { actor: { userId: "u1" } } });
    const petText = JSON.stringify(pets.artifacts);
    assert.ok(petText.includes("QA pet"));
    assert.ok(!petText.includes("Secret pet"));

    const schema = await collectLensExport({ runMacro, domain: "schema", ctx: { actor: { userId: "u1" } } });
    const schemaText = JSON.stringify(schema.artifacts);
    assert.ok(schemaText.includes("qa5"));
    assert.ok(!schemaText.includes("Secret schema"));

    delete globalThis._concordSTATE;
  });

});
