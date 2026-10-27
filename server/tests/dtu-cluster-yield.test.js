// server/tests/dtu-cluster-yield.test.js
//
// INC-150: dtu.cluster must stay cooperative under load, honor a wall-clock
// budget, and keep small-fixture parity with the naive greedy jaccard pass.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { macroRuntime } from "./depth/_harness.js";

let runMacro, STATE, ctx;
before(async () => { ({ runMacro, STATE, ctx } = await macroRuntime("dtu-cluster-yield")); });

function seed(id, title, tags, world, opts = {}) {
  STATE.dtus.set(id, {
    id,
    title,
    tags,
    tier: opts.tier || "regular",
    scope: opts.scope || "global",
    world_id: world,
    human: { summary: title },
    createdAt: opts.createdAt || new Date().toISOString(),
    updatedAt: opts.updatedAt || new Date().toISOString(),
    ...opts,
  });
}

function _scopeKey(d) {
  const scope = String(d?.scope || d?.meta?.scope || d?.visibility || "global").toLowerCase();
  const world = String(d?.world_id || d?.worldId || d?.meta?.world_id || d?.meta?.worldId || "_none");
  const isPrivate = scope === "personal" || scope === "private" || scope === "local";
  if (isPrivate) {
    const creator = String(d?.creator_id || d?.creatorId || d?.createdBy || d?.userId || d?.meta?.creatorId || "anon");
    return `private|${creator}|${world}`;
  }
  return `${scope}|${world}`;
}

function _tokenSet(d) {
  const text = (d.title || "") + " " + (d.tags || []).join(" ");
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/g).filter(Boolean).slice(0, 256));
}

function naiveReference(items, threshold) {
  const partitions = new Map();
  for (const d of items) {
    const k = _scopeKey(d);
    if (!partitions.has(k)) partitions.set(k, []);
    partitions.get(k).push(d);
  }
  const clusters = [];
  const used = new Set();
  for (const partItems of partitions.values()) {
    const toks = partItems.map(_tokenSet);
    for (let i = 0; i < partItems.length; i++) {
      if (used.has(partItems[i].id)) continue;
      const A = toks[i];
      const cluster = [partItems[i]];
      used.add(partItems[i].id);
      for (let j = i + 1; j < partItems.length; j++) {
        if (used.has(partItems[j].id)) continue;
        const B = toks[j];
        let inter = 0;
        for (const t of A) if (B.has(t)) inter++;
        const union = A.size + B.size - inter;
        const sim = (A.size === 0 && B.size === 0) ? 1 : (union ? inter / union : 0);
        if (sim >= threshold) {
          cluster.push(partItems[j]);
          used.add(partItems[j].id);
        }
      }
      clusters.push(cluster);
    }
  }
  clusters.sort((a, b) => b.length - a.length);
  return clusters.map((c) => ({
    ids: c.map((x) => x.id).sort(),
    scope: _scopeKey(c[0]),
  }));
}

function macroClusters(r, idPrefix) {
  assert.equal(r.ok, true);
  return r.clusters
    .filter((c) => c.ids.some((id) => id.startsWith(idPrefix)))
    .map((c) => ({
      ids: c.ids.filter((id) => id.startsWith(idPrefix)).sort(),
      scope: c.scope,
    }));
}

test("small fixture matches naive greedy reference", async () => {
  const W = "yield-test-world";
  seed("y_a1", "beam deflection steel", ["beam", "steel"], W);
  seed("y_a2", "steel beam deflection limits", ["beam", "steel"], W);
  seed("y_a3", "beam steel deflection calculation", ["beam", "steel"], W);
  seed("y_b1", "sourdough bread starter", ["bread"], W);
  seed("y_b2", "bread starter sourdough feeding", ["bread"], W);
  seed("y_c1", "quantum entanglement", ["physics"], W);
  seed("y_x1", "beam deflection steel", ["beam", "steel"], "other-world");
  const r = await runMacro("dtu", "cluster", {}, ctx);
  const expected = naiveReference([...STATE.dtus.values()].filter((d) => d.id.startsWith("y_")), 0.38);
  assert.deepEqual(macroClusters(r, "y_"), expected);
});

test("tiny budget returns truncated:true", async () => {
  const W = "budget-test-world";
  for (let i = 0; i < 50; i++) {
    seed(`budget_${i}`, `topic${i} alpha beta gamma`, [`tag${i}`], W);
  }
  const r = await runMacro("dtu", "cluster", { budgetMs: 1 }, ctx);
  assert.equal(r.ok, true);
  assert.equal(r.truncated, true, "1ms budget must truncate");
});

test("large pass yields to the event loop before resolving", async () => {
  const W = "yield-large-world";
  for (let i = 0; i < 1200; i++) {
    seed(`bigyield_${i}`, `topic${i} alpha beta gamma shared${i % 5}`, [`tag${i}`], W);
  }
  let yielded = false;
  const flag = setInterval(() => { yielded = true; }, 5);
  const r = await runMacro("dtu", "cluster", {}, ctx);
  clearInterval(flag);
  assert.equal(r.ok, true);
  assert.ok(r.clusters.length > 0);
  assert.ok(yielded, "setImmediate yield must let the 5ms ticker fire before clustering resolves");
});

test("maxItems caps the input set without changing small-fixture output", async () => {
  const W = "maxitems-test-world";
  // Own tier so the 1k+ DTUs seeded by earlier tests don't crowd these out of the result.
  seed("m_a", "a topic", ["a"], W, { tier: "maxitems" });
  seed("m_b", "a topic b", ["a"], W, { tier: "maxitems" });
  const r = await runMacro("dtu", "cluster", { fromTier: "maxitems", maxItems: 2000 }, ctx);
  assert.equal(r.ok, true);
  assert.equal(r.truncated, false);
  const ids = r.clusters.flatMap((c) => c.ids).filter((id) => id.startsWith("m_")).sort();
  assert.deepEqual(ids, ["m_a", "m_b"]);
});

test("bounded calls rotate oldest-first so older DTUs are not starved", async () => {
  const tier = "rotfair";
  const base = Date.parse("2020-01-01T00:00:00Z");
  for (let i = 0; i < 9; i++) {
    seed(`rot_${i}`, `unique${i} words${i}`, [`t${i}`], "rot-world", {
      tier, createdAt: new Date(base + i * 1000).toISOString(),
    });
  }
  const seen = [];
  for (let k = 0; k < 3; k++) {
    const r = await runMacro("dtu", "cluster", { fromTier: tier, maxItems: 3 }, ctx);
    assert.equal(r.ok, true);
    seen.push(r.clusters.flatMap((c) => c.ids).sort());
  }
  assert.deepEqual(seen[0], ["rot_0", "rot_1", "rot_2"], "first window is the oldest");
  assert.deepEqual(seen[1], ["rot_3", "rot_4", "rot_5"]);
  assert.deepEqual(seen[2], ["rot_6", "rot_7", "rot_8"]);
  const wrap = await runMacro("dtu", "cluster", { fromTier: tier, maxItems: 3 }, ctx);
  assert.deepEqual(wrap.clusters.flatMap((c) => c.ids).sort(), ["rot_0", "rot_1", "rot_2"], "wraps to oldest");
});

test("missing / non-string timestamps never throw in bounded mode", async () => {
  const tier = "badts";
  seed("bts_a", "alpha one", ["x"], "bts-world", { tier, createdAt: undefined, updatedAt: undefined });
  seed("bts_b", "alpha two", ["x"], "bts-world", { tier, createdAt: 12345, updatedAt: null });
  seed("bts_c", "alpha three", ["x"], "bts-world", { tier, createdAt: { bogus: true } });
  const r = await runMacro("dtu", "cluster", { fromTier: tier, maxItems: 2 }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.clusters.flatMap((c) => c.ids).length, 2);
});
