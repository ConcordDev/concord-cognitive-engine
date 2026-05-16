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

  it("exposes 26 lens state keys", () => {
    assert.equal(LENS_STATE_KEYS.length, 26);
    assert.ok(LENS_STATE_KEYS.includes("chatLens"));
    assert.ok(LENS_STATE_KEYS.includes("worldLens"));
    assert.ok(LENS_STATE_KEYS.includes("accountingLens"));
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
