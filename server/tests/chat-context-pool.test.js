import { test } from "node:test";
import assert from "node:assert/strict";
import { chatContextPool, makeChatMayUse } from "../lib/chat/context-pool.js";
import { privateDtuHiddenFrom } from "../lib/dtu-read-access.js";

// Same shape as server.js _isHiddenSystemDtu (#1543).
const isHidden = (d) => !d || d.scope === "system" || d.visibility === "internal"
  || (!(d.tier === "mega" || d.tier === "hyper") && d.source === "autogen");

const pool = [
  { id: "pub", visibility: "public", ownerId: "bob", title: "public" },
  { id: "mine", visibility: "private", ownerId: "alice", title: "mine" },
  { id: "bobs_private", visibility: "private", ownerId: "bob", title: "bob secret" },
  { id: "internal_mega", tier: "mega", visibility: "internal", title: "internal mega" },
  { id: "public_mega", tier: "mega", visibility: "public", source: "autogen", title: "public mega" },
  { id: "sys", scope: "system", title: "system row" },
];

test("no universe: fallback is viewer-visible only (internal and others' private excluded)", () => {
  const mayUse = makeChatMayUse({ viewerId: "alice", isHidden, isPrivateFrom: privateDtuHiddenFrom });
  let calledFull = false;
  const visible = () => { calledFull = true; return pool; }; // even if visible() over-returns, the filter holds
  const ids = chatContextPool({ universe: null, visible, mayUse }).map((d) => d.id).sort();
  assert.ok(calledFull);
  assert.deepEqual(ids, ["mine", "pub", "public_mega"]);
});

test("universe is filtered too; anon sees no private rows", () => {
  const anon = makeChatMayUse({ viewerId: null, isHidden, isPrivateFrom: privateDtuHiddenFrom });
  const ids = chatContextPool({ universe: pool, visible: () => [], mayUse: anon }).map((d) => d.id).sort();
  assert.deepEqual(ids, ["pub", "public_mega"]);
});

test("missing predicate fails closed", () => {
  assert.deepEqual(chatContextPool({ universe: pool, visible: () => pool }), []);
});
