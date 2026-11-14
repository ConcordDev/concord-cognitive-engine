// FIX-chat-001 — hydration must merge around a mid-fetch send, never
// replace it away.
//
// The thread-load effect fetches /api/chat/messages when the local
// cache is empty. Pristine, the resolution replaced the whole open
// thread with the snapshot: a send that completed while the fetch was
// in flight had already appended its user + assistant pair to the live
// thread (and updated the history preview), and the late snapshot —
// taken before the turn — dropped the pair. Preview updated, open
// transcript empty until reload: the ticket.
//
// Pins: mergeHydratedThread's race cases (behavioural) + the panel
// wiring (source). Run: node --experimental-strip-types --test
// concord-frontend/tests/chat-hydration-merge-001.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { mergeHydratedThread } from "../lib/chat/reply-reconcile.ts";

type M = { id: string; content: string };
const msg = (id: string, content = id): M => ({ id, content });

describe("mergeHydratedThread", () => {
  it("an empty live thread takes the snapshot as-is", () => {
    const snap = [msg("hyd-s-0-t1", "old question"), msg("hyd-s-1-t2", "old answer")];
    assert.deepEqual(mergeHydratedThread(snap, [], new Set()), snap);
  });

  it("a pair appended during the fetch survives the late snapshot", () => {
    const snap = [msg("hyd-s-0-t1", "old question"), msg("hyd-s-1-t2", "old answer")];
    const live = [msg("user-100", "BETA question"), msg("asst-101", "BETA")];
    const merged = mergeHydratedThread(snap, live, new Set());
    assert.deepEqual(merged.map((m) => m.content), ["old question", "old answer", "BETA question", "BETA"]);
  });

  it("the empty-snapshot variant: the pair survives a [] resolution", () => {
    const live = [msg("user-100", "q"), msg("asst-101", "BETA")];
    assert.deepEqual(mergeHydratedThread([], live, new Set()).map((m) => m.id), ["user-100", "asst-101"]);
  });

  it("the previous selection's leftovers (base ids) are never carried in", () => {
    const snap = [msg("hyd-s-0-t1", "old question")];
    const live = [msg("user-1", "previous thread"), msg("user-200", "new send")];
    const merged = mergeHydratedThread(snap, live, new Set(["user-1"]));
    assert.deepEqual(merged.map((m) => m.id), ["hyd-s-0-t1", "user-200"]);
  });

  it("nothing fresh: the snapshot stands alone", () => {
    const snap = [msg("hyd-s-0-t1"), msg("hyd-s-1-t2")];
    assert.deepEqual(mergeHydratedThread(snap, [], new Set(["user-1"])), snap);
    assert.deepEqual(mergeHydratedThread(snap, [msg("hyd-s-0-t1")], new Set()).map((m) => m.id), ["hyd-s-0-t1", "hyd-s-1-t2"]);
  });
});

describe("panel wiring", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../components/chat/ChatWorkspacePanel.tsx"), "utf8");
  it("hydration goes through the merge; the wholesale replace is gone", () => {
    assert.ok(src.includes("mergeHydratedThread(hydrated, prev, baseIds)"));
    assert.ok(!src.includes("setLocalMessages(hydrated)"));
  });
});
