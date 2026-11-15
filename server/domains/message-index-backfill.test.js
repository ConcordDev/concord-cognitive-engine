// message-index-backfill.test.js
// FIX-message-008 (GB-1521 slice B6) — the Message workbench search
// reported "0 messages indexed" with no way to index: creation paths
// index new messages, but existing channel history never entered the
// corpus. index-backfill walks the caller's channels (and shared
// channels they belong to) and indexes what is missing. Idempotent.
//
// Run: node --test server/domains/message-index-backfill.test.js

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMessageActions from "./message.js";

const actions = new Map();
registerMessageActions((domain, action, fn) => actions.set(`${domain}:${action}`, fn));
const ctx = { actor: { userId: "test" }, userId: "test" };

beforeEach(() => { globalThis._concordSTATE = {}; });

function seedChannelWithMessages() {
  const STATE = globalThis._concordSTATE;
  const s = (() => { actions.get("message:channels-list")(ctx, null, {}); return STATE.messageLens; })();
  const userId = "test";
  if (!s.messages.has(userId)) s.messages.set(userId, new Map());
  const chans = s.channels.get(userId);
  const ch = chans[0];
  s.messages.get(userId).set(ch.id, [
    { id: "m1", body: "the quarterly budget draft", sender: "amy", ts: "2026-11-01T10:00:00Z" },
    { id: "m2", body: "lunch on friday?", sender: "bob", ts: "2026-11-01T11:00:00Z" },
  ]);
  return ch;
}

describe("message-008 — index-backfill", () => {
  it("indexes existing channel history and search finds it", () => {
    seedChannelWithMessages();
    const backfill = actions.get("message:index-backfill");
    const r = backfill(ctx, null, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.added, 2);
    assert.equal(r.result.total, 2);
    const search = actions.get("message:search-messages");
    const hits = search(ctx, null, { query: "quarterly budget" });
    assert.equal(hits.result.totalIndexed, 2);
    assert.ok(hits.result.hits.length >= 1);
  });

  it("is idempotent", () => {
    seedChannelWithMessages();
    const backfill = actions.get("message:index-backfill");
    backfill(ctx, null, {});
    const again = backfill(ctx, null, {});
    assert.equal(again.result.added, 0);
    assert.equal(again.result.total, 2);
  });
});
