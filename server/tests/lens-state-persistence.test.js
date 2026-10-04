// Tier-2 contract test for Bucket 2 Gap A — lens state persistence.
//
// The 26 STATE.<lens>Lens stores are written to in-memory Maps by the
// domain files. Before this fix the global JSON snapshot didn't include
// them, so a server restart wiped every user's projects/prompts/saved
// searches/journal entries/etc.
//
// This test imports the standalone helpers (server.js is too heavyweight
// to load in tests; the helpers live in their own lib for testability).

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  LENS_STATE_KEYS,
  serializeLensState,
  hydrateLensState,
} from "../lib/lens-state-persistence.js";

let STATE;
function freshState() {
  STATE = {};
}

describe("lens state persistence — Bucket 2 Gap A", () => {
  beforeEach(() => { freshState(); });

  it("exposes 33 lens state keys", () => {
    // 28 -> 29: "calendarLens" so calendar.events-create survives a restart.
    // 29 -> 30: "marketplaceLens" so a paid shop order survives a restart.
    // The marketplace domain stores orders in STATE.marketplaceLens Maps.
    // Those maps were omitted from the snapshot, so a refresh of the process
    // dropped every order.
    // 30 -> 31: "projectsLens" so a project roster survives a restart.
    // 31 -> 32: "threadLens" so an unpublished draft citing a DTU survives.
    // Without these two the Projects status report's Thread draft vanished on
    // every process restart while the UI still reported it as drafted.
    // 32 -> 33: "codeLens" so a virtual Code project, its files, and its git
    // log survive a restart. Code domain stores workspaces under STATE.codeLens.
    assert.equal(LENS_STATE_KEYS.length, 33);
    assert.ok(LENS_STATE_KEYS.includes("chatLens"));
    assert.ok(LENS_STATE_KEYS.includes("worldLens"));
    assert.ok(LENS_STATE_KEYS.includes("accountingLens"));
    assert.ok(LENS_STATE_KEYS.includes("eventTimelineLens"));
    assert.ok(LENS_STATE_KEYS.includes("privacyLens"));
    assert.ok(LENS_STATE_KEYS.includes("calendarLens"));
    assert.ok(LENS_STATE_KEYS.includes("marketplaceLens"));
    assert.ok(LENS_STATE_KEYS.includes("projectsLens"));
    assert.ok(LENS_STATE_KEYS.includes("threadLens"));
    assert.ok(LENS_STATE_KEYS.includes("codeLens"));
  });

  it("roundtrips STATE.threadLens.drafts (an unpublished draft citing a DTU)", () => {
    STATE.threadLens = {
      drafts: new Map([["user_a", [{
        id: "drf_1",
        status: "draft",
        text: "Sprint 1 closed at 8 pts.",
        citations: ["dtu_1"],
      }]]]),
      seq: new Map([["user_a", { d: 1 }]]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);
    assert.ok(STATE.threadLens.drafts instanceof Map);
    assert.equal(STATE.threadLens.drafts.get("user_a")[0].id, "drf_1");
    assert.equal(STATE.threadLens.drafts.get("user_a")[0].status, "draft");
    assert.deepEqual(STATE.threadLens.drafts.get("user_a")[0].citations, ["dtu_1"]);
  });

  it("roundtrips STATE.projectsLens (the roster a status report is built from)", () => {
    STATE.projectsLens = {
      projects: new Map([["user_a", [{ id: "prj_1", key: "NSI", name: "North Star Ingest" }]]]),
      tasks: new Map([["user_a", [{ id: "tsk_1", projectId: "prj_1", status: "done", points: 3 }]]]),
      sprints: new Map(),
      risks: new Map(),
      milestones: new Map(),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);
    assert.ok(STATE.projectsLens.projects instanceof Map);
    assert.equal(STATE.projectsLens.projects.get("user_a")[0].key, "NSI");
    assert.equal(STATE.projectsLens.tasks.get("user_a")[0].points, 3);
    assert.ok(STATE.projectsLens.risks instanceof Map);
  });

  it("roundtrips STATE.codeLens (a virtual Code project and its files)", () => {
    // The Code domain stores projects/files/git under STATE.codeLens.
    // files is Map<userId, Map<projectId, Map<path, FileBlob>>> — three
    // levels of Map nesting. Without codeLens in LENS_STATE_KEYS a restart
    // wiped every project while the editor still showed it.
    STATE.codeLens = {
      projects: new Map([["user_a", [{ id: "proj_1", name: "demo", language: "javascript" }]]]),
      files: new Map([["user_a", new Map([["proj_1", new Map([["src/index.js", { content: "console.log('hi')", modifiedAt: "2026-10-04" }]])]])]]),
      gitState: new Map([["user_a", new Map([["proj_1", { branch: "main", staged: new Set(["src/index.js"]), modified: new Set() }]])]]),
      agentTasks: new Map(),
      chatThreads: new Map(),
      seq: new Map([["user_a", { proj: 2, task: 1, thread: 1 }]]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);
    assert.ok(STATE.codeLens.projects instanceof Map);
    assert.equal(STATE.codeLens.projects.get("user_a")[0].name, "demo");
    assert.ok(STATE.codeLens.files.get("user_a") instanceof Map);
    assert.ok(STATE.codeLens.files.get("user_a").get("proj_1") instanceof Map);
    assert.equal(STATE.codeLens.files.get("user_a").get("proj_1").get("src/index.js").content, "console.log('hi')");
    assert.ok(STATE.codeLens.gitState.get("user_a").get("proj_1").staged instanceof Set);
    assert.ok(STATE.codeLens.gitState.get("user_a").get("proj_1").staged.has("src/index.js"));
    assert.equal(STATE.codeLens.seq.get("user_a").proj, 2);
  });

  it("roundtrips STATE.marketplaceLens.orders (a settled shop order)", () => {
    STATE.marketplaceLens = {
      orders: new Map([["seller_1", [{
        id: "ord_1",
        buyerId: "buyer_1",
        status: "paid",
        paymentStatus: "settled",
        batchId: "batch_1",
        paidCc: 20,
        totalUsd: 20,
      }]]]),
      listings: new Map(),
      shops: new Map(),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);
    assert.ok(STATE.marketplaceLens.orders instanceof Map);
    const order = STATE.marketplaceLens.orders.get("seller_1")[0];
    assert.equal(order.id, "ord_1");
    assert.equal(order.batchId, "batch_1");
    assert.equal(order.paymentStatus, "settled");
    assert.equal(order.paidCc, 20);
  });

  it("roundtrips STATE.calendarLens.events (saved calendar events)", () => {
    STATE.calendarLens = {
      calendars: new Map([["user_a", [{ id: "cal_1", name: "Personal", isDefault: true }]]]),
      events: new Map([["user_a", [{ id: "evt_1", title: "Standup", start: "2026-10-04T17:00:00.000Z" }]]]),
      tasks: new Map(),
      seq: new Map([["user_a", { cal: 2, evt: 2, task: 1 }]]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);
    assert.ok(STATE.calendarLens.events instanceof Map);
    assert.equal(STATE.calendarLens.events.get("user_a")[0].title, "Standup");
    assert.equal(STATE.calendarLens.events.get("user_a")[0].id, "evt_1");
    assert.ok(STATE.calendarLens.calendars instanceof Map);
    assert.equal(STATE.calendarLens.seq.get("user_a").evt, 2);
  });

  it("roundtrips STATE.eventTimelineLens.views (event-timeline saved filter presets)", () => {
    // Regression pin: server/domains/event-timeline.js#savedViewsMap() used
    // to write to a flat STATE.eventTimelineViews field, which was NOT in
    // LENS_STATE_KEYS — saveView()/deleteView() called persistState() but
    // the data was silently dropped from every disk snapshot. Confirms the
    // nested STATE.eventTimelineLens.views shape survives the round trip.
    STATE.eventTimelineLens = {
      views: new Map([
        ["user_a", [
          { id: "view_1", name: "combat-only", channels: ["combat:hit"], worldId: null, query: "", createdAt: 1 },
        ]],
      ]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);

    assert.ok(STATE.eventTimelineLens.views instanceof Map);
    const aliceViews = STATE.eventTimelineLens.views.get("user_a");
    assert.ok(Array.isArray(aliceViews));
    assert.equal(aliceViews[0].name, "combat-only");
  });

  it("serializes empty STATE to empty object", () => {
    assert.deepEqual(serializeLensState(STATE), {});
  });

  it("serializes null STATE safely", () => {
    assert.deepEqual(serializeLensState(null), {});
    assert.deepEqual(serializeLensState(undefined), {});
  });

  it("roundtrips a flat Map<userId, Map<id, obj>> structure", () => {
    STATE.chatLens = {
      projects: new Map([
        ["user_a", new Map([["proj_1", { id: "proj_1", name: "Alpha" }]])],
        ["user_b", new Map([["proj_2", { id: "proj_2", name: "Beta" }]])],
      ]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);

    assert.ok(STATE.chatLens.projects instanceof Map);
    assert.ok(STATE.chatLens.projects.get("user_a") instanceof Map);
    assert.equal(STATE.chatLens.projects.get("user_a").get("proj_1").name, "Alpha");
    assert.equal(STATE.chatLens.projects.get("user_b").get("proj_2").name, "Beta");
  });

  it("roundtrips Map<userId, Map>", () => {
    STATE.bioLens = {
      sequences: new Map([
        ["user_a", new Map([["seq_1", { id: "seq_1", sequence: "ATGC" }]])],
      ]),
    };
    STATE.researchLens = {
      notes: new Map(),
      dailyByDate: new Map([
        ["user_a", new Map([["2026-05-16", "note_xyz"]])],
      ]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);

    assert.equal(STATE.bioLens.sequences.get("user_a").get("seq_1").sequence, "ATGC");
    assert.equal(STATE.researchLens.dailyByDate.get("user_a").get("2026-05-16"), "note_xyz");
  });

  it("roundtrips Map<userId, Set>", () => {
    // worldLens.pinnedQuests uses Set<questId>
    STATE.worldLens = {
      pinnedQuests: new Map([
        ["user_a", new Set(["q1", "q2", "q3"])],
      ]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);

    assert.ok(STATE.worldLens.pinnedQuests.get("user_a") instanceof Set);
    assert.ok(STATE.worldLens.pinnedQuests.get("user_a").has("q2"));
    assert.equal(STATE.worldLens.pinnedQuests.get("user_a").size, 3);
  });

  it("roundtrips Map<userId, Array<obj>> (e.g. journal entries)", () => {
    STATE.accountingLens = {
      journal: new Map([
        ["user_a", [
          { id: "je_1", number: "JE-00001", lines: [{ accountId: "acct_1000", debit: 100, credit: 0 }] },
          { id: "je_2", number: "JE-00002", lines: [] },
        ]],
      ]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);

    assert.ok(Array.isArray(STATE.accountingLens.journal.get("user_a")));
    assert.equal(STATE.accountingLens.journal.get("user_a").length, 2);
    assert.equal(STATE.accountingLens.journal.get("user_a")[0].number, "JE-00001");
  });

  it("roundtrips deeply nested Map<userId, Map<msgId, Map<emoji, count>>>", () => {
    // messageLens.reactions uses three-level nesting
    STATE.messageLens = {
      reactions: new Map([
        ["user_a", new Map([
          ["msg_1", new Map([["👍", 3], ["❤️", 1]])],
        ])],
      ]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);

    const userMap = STATE.messageLens.reactions.get("user_a");
    assert.ok(userMap instanceof Map);
    const msgMap = userMap.get("msg_1");
    assert.ok(msgMap instanceof Map);
    assert.equal(msgMap.get("👍"), 3);
    assert.equal(msgMap.get("❤️"), 1);
  });

  it("INVARIANT: per-user scoping survives the cycle (user A's data doesn't leak to user B)", () => {
    STATE.chatLens = {
      projects: new Map([
        ["user_a", new Map([["proj_secret", { name: "user A only" }]])],
      ]),
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);

    assert.equal(STATE.chatLens.projects.has("user_b"), false);
    assert.ok(STATE.chatLens.projects.get("user_a").has("proj_secret"));
  });

  it("hydrate ignores unknown lens keys (forward-compat)", () => {
    hydrateLensState(STATE, { futureLensThatDoesntExistYet: { foo: "bar" } });
    // No throw. STATE.futureLensThatDoesntExistYet is not set because
    // it's not in LENS_STATE_KEYS — that's the safety guarantee.
    assert.equal(STATE.futureLensThatDoesntExistYet, undefined);
  });

  it("hydrate handles null/undefined gracefully", () => {
    assert.doesNotThrow(() => hydrateLensState(STATE, null));
    assert.doesNotThrow(() => hydrateLensState(STATE, undefined));
    assert.doesNotThrow(() => hydrateLensState(STATE, {}));
    assert.doesNotThrow(() => hydrateLensState(null, {}));
  });

  it("serialize handles a lens with mixed field types (Map + Array + plain object)", () => {
    STATE.tradesLens = {
      jobs: new Map([["user_a", new Map([["job_1", { id: "job_1" }]])]]),
      seq: new Map([["user_a", { job: 5, invoice: 3 }]]),
      // Hypothetical plain array field
      events: [{ kind: "audit", at: "2026-05-16" }],
    };
    const persisted = serializeLensState(STATE);
    freshState();
    hydrateLensState(STATE, persisted);

    assert.equal(STATE.tradesLens.jobs.get("user_a").get("job_1").id, "job_1");
    assert.equal(STATE.tradesLens.seq.get("user_a").job, 5);
    assert.deepEqual(STATE.tradesLens.events, [{ kind: "audit", at: "2026-05-16" }]);
  });

  it("snapshot is JSON-safe (can round-trip through JSON.stringify/parse)", () => {
    STATE.chatLens = {
      projects: new Map([
        ["user_a", new Map([["proj_1", { name: "Alpha", emoji: "🚀" }]])],
      ]),
    };
    STATE.worldLens = {
      pinnedQuests: new Map([["user_a", new Set(["q1", "q2"])]]),
    };

    const persisted = serializeLensState(STATE);
    const jsonRoundtrip = JSON.parse(JSON.stringify(persisted));
    freshState();
    hydrateLensState(STATE, jsonRoundtrip);

    assert.equal(STATE.chatLens.projects.get("user_a").get("proj_1").emoji, "🚀");
    assert.ok(STATE.worldLens.pinnedQuests.get("user_a").has("q1"));
  });
});
