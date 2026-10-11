// INC-56: GET /api/world/orgs used to return listOrganizations() verbatim
// (leaderId, treasury, revenueSplit). The world lens still needs to know
// which guild is the caller's, and open guild join stays as it was.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";

import createWorldRoutes from "../routes/world.js";
import { up as upWorldOrgs } from "../migrations/383_world_organizations.js";
import * as orgs from "../lib/world-organizations.js";

const PUBLIC_KEYS = ["createdAt", "description", "id", "memberCount", "name", "type"];

function assertNoPrivateFields(org, forbiddenIds) {
  for (const key of ["leaderId", "leader_id", "treasury", "revenueSplit", "revenue_split_json", "stats"]) {
    assert.equal(Object.hasOwn(org, key), false, `public org must not include ${key}`);
  }
  const blob = JSON.stringify(org);
  for (const id of forbiddenIds) assert.equal(blob.includes(id), false, `public org leaked ${id}`);
}

describe("world org list projects safe fields", () => {
  let db;
  let server;
  let url;
  let guildId;

  before(async () => {
    db = new Database(":memory:");
    upWorldOrgs(db);
    const created = orgs.createOrganization(db, {
      name: "Quiet Guild",
      type: "guild",
      leaderId: "leader-user",
      description: "a hall",
      revenueSplit: { leader: 10, treasury: 20, members: 70 },
    });
    assert.equal(created.ok, true);
    guildId = created.organization.id;
    orgs.contributeToTreasury(db, guildId, 250, "leader-user");

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const id = req.headers["x-user-id"];
      if (id) req.user = { id: String(id) };
      next();
    });
    app.use("/api/world", createWorldRoutes({
      requireAuth: (_req, _res, next) => next(),
      db,
    }));
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        url = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  async function getJson(path, userId) {
    const headers = userId ? { "x-user-id": userId } : {};
    const res = await fetch(`${url}${path}`, { headers });
    return { status: res.status, body: await res.json() };
  }

  it("a stranger's list and detail omit user ids, treasury, and revenueSplit", async () => {
    const list = await getJson("/api/world/orgs");
    assert.equal(list.status, 200);
    const guild = list.body.organizations.find((o) => o.id === guildId);
    assert.ok(guild);
    assert.equal(guild.name, "Quiet Guild");
    assert.equal(guild.description, "a hall");
    assert.equal(guild.memberCount, 1);
    assert.deepEqual(Object.keys(guild).sort(), PUBLIC_KEYS);
    assertNoPrivateFields(guild, ["leader-user"]);
    assert.equal(JSON.stringify(list.body).includes("leader-user"), false);
    assert.equal(JSON.stringify(list.body).includes("\"treasury\""), false);

    const detail = await getJson(`/api/world/orgs/${guildId}`, "someone-else");
    assert.equal(detail.status, 200);
    assert.deepEqual(Object.keys(detail.body.organization).sort(), PUBLIC_KEYS);
    assertNoPrivateFields(detail.body.organization, ["leader-user"]);
  });

  it("creating a guild keeps the authenticated user as leader without publishing that id", async () => {
    const create = await fetch(`${url}/api/world/orgs`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": "session-leader" },
      body: JSON.stringify({ name: "Session Guild", type: "guild", description: "ours", leaderId: "spoofed-leader" }),
    });
    assert.equal(create.status, 201);
    const list = await getJson("/api/world/orgs", "session-leader");
    const guild = list.body.organizations.find((o) => o.name === "Session Guild");
    assert.ok(guild);
    assert.equal(guild.viewerIsLeader, true);
    assert.equal(guild.myRole, "leader");
    assertNoPrivateFields(guild, ["session-leader", "spoofed-leader"]);
    const stranger = await getJson("/api/world/orgs", "spoofed-leader");
    const seen = stranger.body.organizations.find((o) => o.id === guild.id);
    assert.equal(seen.viewerIsLeader, undefined);
    assert.equal(seen.myRole, undefined);
    assertNoPrivateFields(seen, ["session-leader", "spoofed-leader"]);
  });

  it("the leader still recognizes their guild, and another player can still join it", async () => {
    const list = await getJson("/api/world/orgs", "leader-user");
    const guild = list.body.organizations.find((o) => o.id === guildId);
    assert.equal(guild.viewerIsLeader, true);
    assert.equal(guild.myRole, "leader");
    assert.equal(guild.leaderId, undefined);
    assertNoPrivateFields(guild, ["leader-user"]);

    const join = await fetch(`${url}/api/world/orgs/${guildId}/join`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": "joiner-user" },
      body: JSON.stringify({ userId: "joiner-user" }),
    });
    const joined = await join.json();
    assert.equal(join.status, 200);
    assert.equal(joined.ok, true);
    assert.equal(joined.role, "member");

    const after = await getJson("/api/world/orgs", "joiner-user");
    const seen = after.body.organizations.find((o) => o.id === guildId);
    assert.equal(seen.viewerIsLeader, undefined);
    assert.equal(seen.myRole, "member");
    assert.equal(seen.memberCount, 2);
    assertNoPrivateFields(seen, ["leader-user", "joiner-user"]);
  });
});
