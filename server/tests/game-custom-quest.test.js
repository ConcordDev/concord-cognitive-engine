// Custom Game-lens challenges are private lens artifacts (domain game,
// type quest). The Quests tab, Dashboard, and Active Quests read that
// list. Creating one must survive a second read, accepting it must mark
// it active, and another account must not see it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { load } from "./depth/_harness.js";

test("game custom quest artifacts", async (t) => {
  const { runMacro, makeInternalCtx, refreshGameProfile } = await load();

  function ctxFor(userId) {
    const ctx = makeInternalCtx(userId);
    ctx.actor = { userId, orgId: "test", role: "member", scopes: ["read", "write"] };
    ctx.macro = {
      run: (domain, name, input) => runMacro(domain, name, input, ctx),
    };
    return ctx;
  }

  const owner = ctxFor("quest-owner-a");
  const other = ctxFor("quest-owner-b");

  await t.test("create → listed → second read → accept → active; another account cannot see it", async () => {
    const before = await runMacro("lens", "list", { domain: "game", type: "quest" }, owner);
    assert.equal(before.ok, true, JSON.stringify(before));
    const beforeTitles = (before.artifacts || []).map((a) => a.title);
    assert.equal(beforeTitles.includes("Dawn Run"), false);
    for (const demo of ["Daily Creator", "Tag Master", "Civic Duty", "Mega Merge"]) {
      assert.equal(beforeTitles.includes(demo), false, `${demo} must not be seeded into quest artifacts`);
    }

    const created = await runMacro("lens", "create", {
      domain: "game",
      type: "quest",
      title: "Dawn Run",
      data: {
        title: "Dawn Run",
        name: "Dawn Run",
        description: "Run before breakfast",
        icon: "🎯",
        xpReward: 300,
        difficulty: "medium",
        type: "challenge",
        status: "available",
      },
      meta: { status: "active", visibility: "private", tags: ["challenge", "medium"] },
    }, owner);
    assert.equal(created.ok, true, JSON.stringify(created));
    const id = created.artifact.id;
    assert.equal(created.artifact.ownerId, "quest-owner-a");
    assert.equal(created.artifact.meta.visibility, "private");

    const listed = await runMacro("lens", "list", { domain: "game", type: "quest" }, owner);
    const mine = (listed.artifacts || []).find((a) => a.id === id);
    assert.ok(mine, "author sees the challenge in the quest list");
    assert.equal(mine.title, "Dawn Run");
    assert.equal(mine.data.status, "available");

    const reloaded = await runMacro("lens", "list", { domain: "game", type: "quest" }, owner);
    assert.ok((reloaded.artifacts || []).some((a) => a.id === id), "still present on a second read");

    const accepted = await runMacro("lens", "update", { id, data: { status: "accepted" } }, owner);
    assert.equal(accepted.ok, true, JSON.stringify(accepted));
    const active = await runMacro("lens", "list", { domain: "game", type: "quest" }, owner);
    const row = (active.artifacts || []).find((a) => a.id === id);
    assert.equal(row.data.status, "accepted");

    const stranger = await runMacro("lens", "list", { domain: "game", type: "quest" }, other);
    assert.equal((stranger.artifacts || []).some((a) => a.id === id || a.title === "Dawn Run"), false);
    const hidden = await runMacro("lens", "get", { id, domain: "game" }, other);
    assert.equal(hidden.ok, false);

    const completed = await runMacro("lens", "update", { id, data: { status: "completed" } }, owner);
    assert.equal(completed.ok, true, JSON.stringify(completed));
    const profile = refreshGameProfile("quest-owner-a");
    assert.equal(profile.stats.questXp, 300);
    assert.equal(profile.questsCompleted, 1);
    assert.ok(profile.xp >= 300);
    const otherProfile = refreshGameProfile("quest-owner-b");
    assert.equal(otherProfile.stats.questXp, 0);
    assert.equal(otherProfile.questsCompleted, 0);
  });

  await t.test("a crafted xpReward above the form cap does not mint extra XP", async () => {
    const created = await runMacro("lens", "create", {
      domain: "game",
      type: "quest",
      title: "Inflated",
      data: { title: "Inflated", name: "Inflated", xpReward: 999999, type: "challenge", status: "completed" },
      meta: { status: "active", visibility: "private", tags: ["challenge"] },
    }, owner);
    assert.equal(created.ok, true, JSON.stringify(created));
    const profile = refreshGameProfile("quest-owner-a");
    // Dawn Run (300) plus this quest clamped to 2000.
    assert.equal(profile.stats.questXp, 2300);
  });
});
