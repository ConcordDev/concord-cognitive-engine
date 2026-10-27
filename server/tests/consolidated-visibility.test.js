import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  consolidatedVisibility, memberVisibilityClass, applyConsolidatedVisibility,
  absorbVisibility, backfillConsolidatedVisibility,
} from "../lib/consolidated-visibility.js";
import { applyOwnerlessNormalization } from "../lib/dtu-ownership.js";

const pub = (id, extra = {}) => ({ id, tier: "regular", visibility: "public", scope: "global", ...extra });
const priv = (id, owner = "user_a", extra = {}) => ({ id, tier: "regular", visibility: "private", scope: "local", ownerId: owner, ...extra });
const internal = (id) => ({ id, tier: "regular", visibility: "internal", ownerId: "system" });

test("all-public members make a public mega with a global scope", () => {
  const r = consolidatedVisibility([pub("a"), pub("b", { visibility: "published" }), pub("c", { visibility: "marketplace" })], { scope: "local" });
  assert.equal(r.visibility, "public");
  assert.equal(r.scope, "global");
  assert.equal(r.ownerId, null);
  assert.equal(r.reason, "all_public");
});

test("a public mega keeps a non-private inherited scope (world)", () => {
  const r = consolidatedVisibility([pub("a"), pub("b")], { scope: "world:w1" });
  assert.equal(r.scope, "world:w1");
});

test("mixed public and private members give private, owned by the private members' owner", () => {
  const r = consolidatedVisibility([pub("a"), priv("b", "user_a"), pub("c")], { scope: "local" });
  assert.equal(r.visibility, "private");
  assert.equal(r.ownerId, "user_a");
  assert.equal(r.reason, "private_member");
});

test("one private member is enough to close the mega", () => {
  const members = [pub("a"), pub("b"), pub("c"), priv("d", "user_b")];
  assert.equal(consolidatedVisibility(members).visibility, "private");
});

test("an internal member makes the mega internal, even next to private ones", () => {
  assert.equal(consolidatedVisibility([pub("a"), internal("b")]).visibility, "internal");
  assert.equal(consolidatedVisibility([priv("a"), internal("b")]).visibility, "internal");
});

test("private members from two owners make the mega internal (no cross-user leak)", () => {
  const r = consolidatedVisibility([priv("a", "user_a"), priv("b", "user_b")]);
  assert.equal(r.visibility, "internal");
  assert.equal(r.ownerId, null);
});

test("a member counts as public only when provably public", () => {
  assert.equal(memberVisibilityClass({ id: "x" }), "private", "unset visibility is not public");
  assert.equal(memberVisibilityClass(pub("x", { privacy: "private" })), "private");
  assert.equal(memberVisibilityClass(pub("x", { privacy: "followers-only" })), "private");
  assert.equal(memberVisibilityClass(pub("x", { scope: "user" })), "private");
  assert.equal(memberVisibilityClass(pub("x", { scope: "system" })), "internal");
  assert.equal(memberVisibilityClass(null), "internal");
  assert.equal(consolidatedVisibility([]).visibility, "internal");
});

test("a hyper counts its member megas", () => {
  const publicMegas = [pub("m1", { tier: "mega" }), pub("m2", { tier: "mega" })];
  assert.equal(consolidatedVisibility(publicMegas).visibility, "public");
  assert.equal(consolidatedVisibility([...publicMegas, { id: "m3", tier: "mega", visibility: "internal", ownerId: "system" }]).visibility, "internal");
  assert.equal(consolidatedVisibility([...publicMegas, priv("m4", "user_a", { tier: "mega" })]).visibility, "private");
});

test("absorbing only tightens a node", () => {
  const node = pub("mega1", { tier: "mega" });
  assert.equal(absorbVisibility(node, [pub("x")]).visibility, "public");
  assert.equal(absorbVisibility(node, [priv("y", "user_a")]).visibility, "private");
  const closed = { id: "mega2", tier: "mega", visibility: "internal", ownerId: "system" };
  assert.equal(absorbVisibility(closed, [pub("x"), pub("z")]).visibility, "internal");
});

test("boot ownership normalization keeps a public mega public and a private mega's owner", () => {
  const mega = applyConsolidatedVisibility({ id: "m", tier: "mega", scope: "local" }, consolidatedVisibility([pub("a"), pub("b")], { scope: "local" }));
  const n = applyOwnerlessNormalization(mega);
  assert.equal(n.dtu.visibility, "public");
  const pm = applyConsolidatedVisibility({ id: "p", tier: "mega" }, consolidatedVisibility([priv("a", "user_a"), priv("b", "user_a")]));
  assert.equal(pm.ownerId, "user_a");
  assert.equal(applyOwnerlessNormalization(pm).changed, false);
  assert.equal(pm.visibility, "private");
});

test("backfill opens only closed, ownerless nodes whose members all load and are all public", () => {
  const store = new Map();
  const put = (d) => store.set(d.id, d);
  [pub("r1"), pub("r2"), priv("r3", "user_a"), pub("r4")].forEach(put);
  const today = "2026-10-27T15:00:00.000Z";
  const nodes = [
    { id: "openme", tier: "mega", visibility: "internal", ownerId: "system", scope: "local", createdAt: today, lineage: { parents: ["r1", "r2"] } },
    { id: "mixed", tier: "mega", visibility: "internal", ownerId: "system", createdAt: today, lineage: { parents: ["r1", "r3"] } },
    { id: "missing", tier: "mega", visibility: "internal", ownerId: "system", createdAt: today, lineage: { parents: ["r1", "gone"] } },
    { id: "old", tier: "mega", visibility: "internal", ownerId: "system", createdAt: "2026-10-20T00:00:00.000Z", lineage: { parents: ["r1", "r4"] } },
    { id: "userowned", tier: "mega", visibility: "private", ownerId: "user_a", createdAt: today, lineage: { parents: ["r1", "r4"] } },
    { id: "hyper1", tier: "hyper", visibility: "internal", ownerId: "system", createdAt: today, lineage: { parents: ["openme"] } },
  ];
  nodes.forEach(put);
  const dry = backfillConsolidatedVisibility({ nodes, loadMember: (id) => store.get(id) || null, since: "2026-10-27T04:00:00.000Z" });
  assert.equal(dry.dryRun, true);
  assert.deepEqual(dry.openedIds, ["openme"], "a dry run changes nothing, so the hyper still sees an internal mega");
  assert.equal(store.get("openme").visibility, "internal");

  const saved = [];
  const r = backfillConsolidatedVisibility({ nodes, loadMember: (id) => store.get(id) || null, since: "2026-10-27T04:00:00.000Z", persist: (n) => saved.push(n.id) });
  assert.deepEqual(r.openedIds, ["openme", "hyper1"], "megas run first so the hyper sees the opened mega");
  assert.deepEqual(saved, ["openme", "hyper1"]);
  assert.equal(store.get("openme").visibility, "public");
  assert.equal(store.get("openme").scope, "global");
  assert.equal(store.get("openme").meta.visibilityBackfill.from, "internal");
  assert.equal(store.get("mixed").visibility, "internal");
  assert.equal(store.get("missing").visibility, "internal");
  assert.equal(store.get("old").visibility, "internal");
  assert.equal(store.get("userowned").visibility, "private");
  assert.equal(r.notAllPublic, 1);
  assert.equal(r.unresolved, 1);
  const again = backfillConsolidatedVisibility({ nodes, loadMember: (id) => store.get(id) || null, since: "2026-10-27T04:00:00.000Z", persist: () => {} });
  assert.equal(again.opened, 0, "idempotent");
});

test("gapPromote uses the member rule, not the first member's visibility", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(here, "..", "server.js"), "utf8");
  assert.ok(src.includes("const _vis = consolidatedVisibility(members, { scope: _megaScope });"));
  assert.ok(src.includes("visibility: _vis.visibility,"));
  assert.ok(!src.includes("visibility: _seed.visibility ||"), "the first-member copy is gone");
  assert.ok(src.includes("applyConsolidatedVisibility(node, absorbVisibility(node, tgt.members));"));
});
