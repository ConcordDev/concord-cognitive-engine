// server/tests/concordia-server-authority.test.js
//
// Pins FULL Concordia server-authority for combat hit + quest interact.
// Unit/integration against routers + kernels — no live kitchen required.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";

import createCombatRouter from "../routes/combat.js";
import createQuestAuthorityRouter from "../routes/quest-authority.js";
import {
  applyAuthoritativeHit,
  resetCombatHpAuthorityForTest,
  getActor,
} from "../lib/combat-hp-authority.js";
import { interactQuest, resolveQuestId } from "../lib/concordia/quest-authority.js";

function requireAuth() {
  return (req, res, next) => {
    const h = String(req.headers.authorization || "");
    if (h.startsWith("Bearer ") && h.slice(7)) {
      const token = h.slice(7);
      req.user = { id: token === "unity-local-guest" ? "unity-local-guest" : "test-user-1", role: "member" };
      return next();
    }
    return res.status(401).json({ ok: false, error: "Unauthorized", code: "AUTH_REQUIRED" });
  };
}

async function listenApp(app) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

describe("Concordia server-authority — combat HP kernel", () => {
  before(() => resetCombatHpAuthorityForTest());
  after(() => resetCombatHpAuthorityForTest());

  it("applyAuthoritativeHit mutates HP and returns hpBefore/hpAfter", () => {
    const r1 = applyAuthoritativeHit({
      attackerId: "p1",
      targetId: "TrainingDummy",
      weapon: "sword",
      baseDamage: 18,
      worldId: "concordia-hub",
    });
    assert.equal(r1.ok, true);
    assert.ok(r1.damage > 0);
    assert.equal(typeof r1.hpBefore, "number");
    assert.equal(r1.hpAfter, r1.targetHealth);
    assert.ok(r1.hpAfter < r1.hpBefore);
    const actor = getActor("TrainingDummy");
    assert.equal(actor.hp, r1.hpAfter);

    const r2 = applyAuthoritativeHit({
      attackerId: "p1",
      targetId: "TrainingDummy",
      weapon: "sword",
      baseDamage: 18,
      worldId: "concordia-hub",
    });
    assert.equal(r2.hpBefore, r1.hpAfter);
    assert.ok(r2.hpAfter < r2.hpBefore);
  });
});

describe("Concordia server-authority — quest interact store", () => {
  it("resolves sealed_04_choice aliases and returns authored Three Paths text", () => {
    assert.equal(resolveQuestId("The Sealed Record — Three Paths"), "sealed_04_choice");
    const r = interactQuest({ questId: "sealed_04_choice" });
    assert.equal(r.ok, true);
    assert.equal(r.authority, "server");
    assert.match(r.title, /Sealed Record/);
    assert.match(r.text, /Iyatte|Asbir|Vessine/i);
    assert.ok(Array.isArray(r.options) && r.options.length >= 3);
  });

  it("returns consequence text for a chosen branch", () => {
    const r = interactQuest({ questId: "sealed_04_choice", optionId: "deliver_to_iyatte" });
    assert.equal(r.ok, true);
    assert.equal(r.optionId, "deliver_to_iyatte");
    assert.match(r.consequence, /Iyatte/);
    assert.match(r.text, /Iyatte/);
  });
});

describe("Concordia server-authority — HTTP routers", () => {
  let server, base;
  before(async () => {
    resetCombatHpAuthorityForTest();
    process.env.NODE_ENV = process.env.NODE_ENV || "test";
    const app = express();
    app.use(express.json());
    app.use("/api/combat", createCombatRouter({
      requireAuth,
      REALTIME: { emit: () => {} },
      getUserPosition: () => null,
      getNearbyUserIds: () => [],
      db: null,
    }));
    app.use("/api/quests", createQuestAuthorityRouter({ requireAuth }));
    ({ server, base } = await listenApp(app));
  });
  after(async () => {
    resetCombatHpAuthorityForTest();
    await new Promise((r) => server.close(r));
  });

  it("GET /api/combat/probe unauth → 401", async () => {
    const res = await fetch(`${base}/api/combat/probe`);
    assert.equal(res.status, 401);
  });

  it("GET /api/combat/probe auth → authority server + questsInteract advert", async () => {
    const res = await fetch(`${base}/api/combat/probe`, {
      headers: { Authorization: "Bearer test-token" },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.authority, "server");
    assert.match(body.http.hit, /combat\/hit/);
    assert.match(body.http.questsInteract, /quests\/interact/);
  });

  it("POST /api/combat/hit unauth → 401", async () => {
    const res = await fetch(`${base}/api/combat/hit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ victimId: "dummy", damage: 18 }),
    });
    assert.equal(res.status, 401);
  });

  it("POST /api/combat/hit on hub refuses (Great Refusal)", async () => {
    const res = await fetch(`${base}/api/combat/hit`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        victimId: "ArenaDummy",
        damage: 18,
        weapon: "sword",
        worldId: "concordia-hub",
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.refused, true);
    assert.match(String(body.reason || ""), /neutral_zone/);
    assert.equal(body.damage, 0);
  });

  it("POST /api/combat/hit auth mutates and returns hpBefore/hpAfter", async () => {
    const res = await fetch(`${base}/api/combat/hit`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        victimId: "ArenaDummy",
        damage: 18,
        weapon: "sword",
        worldId: "fantasy",
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(!body.refused);
    assert.ok(body.damage > 0);
    assert.equal(typeof body.hpBefore, "number");
    assert.equal(typeof body.hpAfter, "number");
    assert.ok(body.hpAfter < body.hpBefore);
    assert.ok(body.authority);
  });

  it("POST /api/quests/interact unauth → 401", async () => {
    const res = await fetch(`${base}/api/quests/interact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questId: "sealed_04_choice" }),
    });
    assert.equal(res.status, 401);
  });

  it("POST /api/quests/interact auth returns server authored text", async () => {
    const res = await fetch(`${base}/api/quests/interact`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ questId: "The Sealed Record — Three Paths" }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.authority, "server");
    assert.match(body.text, /Iyatte|Asbir|Vessine/i);
    assert.ok(body.options?.length >= 3);
  });
});
