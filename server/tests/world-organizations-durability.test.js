// server/tests/world-organizations-durability.test.js
//
// Guild/crew durability fix (grounding audit, V1.2 Wave D).
//
// server/lib/world-organizations.js used to store every organization + its
// roster in a module-scope `LruMap` — a real, player-formed guild vanished
// the instant the server process restarted. This is the CORE proof the fix
// needs: create an org + add members against one DB connection, then
// simulate a fresh process by (a) opening a brand-new better-sqlite3 handle
// to the SAME on-disk file, AND (b) re-importing world-organizations.js as
// a genuinely separate module instance (cache-busting query-string import,
// so its module-scope `_orgRowCache` starts completely empty — no warm
// cache to quietly paper over a would-be regression) — then confirming the
// org and its members are still there. If the fix regressed to
// cache-only/in-memory-only storage, this test would fail because the
// fresh module instance's cache is provably empty and can only answer from
// a real SELECT against the file.
//
// Also proves the exact institutional-licensing call shape
// (server/economy/creative-marketplace.js) — getOrganization/getOrgMembers/
// getOrgsForUser — still works identically for its real callers (companion
// coverage: tests/economy/creative-marketplace-org-licensing.test.js).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";

describe("world-organizations.js — org + roster survive a fresh process/connection (durability fix)", () => {
  let dbFile, dbA, orgId, leaderId, memberId;

  before(async () => {
    dbFile = path.join(
      os.tmpdir(),
      `world-orgs-durability-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    dbA = new Database(dbFile);
    await runMigrations(dbA);

    leaderId = "durable-leader-1";
    memberId = "durable-member-1";

    const orgs = await import("../lib/world-organizations.js");
    const created = orgs.createOrganization(dbA, {
      name: "The Undying Circle", type: "guild", leaderId, districtId: "district_art",
    });
    assert.equal(created.ok, true, "org creation must succeed");
    orgId = created.organization.id;

    const joined = orgs.joinOrganization(dbA, orgId, memberId, "member");
    assert.equal(joined.ok, true, "member join must succeed");

    const treasury = orgs.contributeToTreasury(dbA, orgId, 250, memberId);
    assert.equal(treasury.ok, true, "treasury contribution must succeed");
    assert.equal(treasury.treasury, 250);

    // Simulate the process ending — close this connection. Nothing about
    // world-organizations.js's in-memory cache is cleared by this (it's
    // module-scope, not connection-scope), which is exactly why part (b)
    // below re-imports the module fresh, not just the db handle.
    dbA.close();
  });

  after(() => {
    try { fs.unlinkSync(dbFile); } catch { /* best effort cleanup */ }
  });

  it("a fresh db handle to the SAME file still has the org row and its roster", () => {
    const dbB = new Database(dbFile);
    try {
      const row = dbB.prepare(`SELECT * FROM world_organizations WHERE id = ?`).get(orgId);
      assert.ok(row, "world_organizations row must survive reconnect");
      assert.equal(row.name, "The Undying Circle");
      assert.equal(row.leader_id, leaderId);
      assert.equal(row.treasury, 250);

      const members = dbB.prepare(`SELECT user_id, role FROM org_members WHERE org_id = ? ORDER BY joined_at`).all(orgId);
      assert.equal(members.length, 2, "leader + joined member must both survive reconnect");
      assert.equal(members[0].user_id, leaderId);
      assert.equal(members[0].role, "leader");
      assert.equal(members[1].user_id, memberId);
      assert.equal(members[1].role, "member");
    } finally {
      dbB.close();
    }
  });

  it("a genuinely fresh module instance (empty cache) + a fresh db handle reads the same durable state through the real API", async () => {
    // Cache-busting re-import: a distinct module specifier gets its OWN
    // top-level state, including a brand-new (empty) _orgRowCache — there
    // is no way for this instance to have inherited anything from the
    // `before()` hook's import. If getOrganization/getOrgMembers only
    // "worked" because of a warm process-wide cache, this import would
    // prove it by returning null/empty.
    const freshOrgs = await import(`../lib/world-organizations.js?durability-check=${Date.now()}-${Math.random()}`);
    const dbC = new Database(dbFile);
    try {
      const org = freshOrgs.getOrganization(dbC, orgId);
      assert.ok(org, "getOrganization must resolve the org from a cold cache + fresh connection");
      assert.equal(org.name, "The Undying Circle");
      assert.equal(org.leaderId, leaderId);
      assert.equal(org.treasury, 250);
      assert.equal(org.memberCount, 2);

      const members = freshOrgs.getOrgMembers(dbC, orgId);
      assert.equal(members.length, 2);
      const byUser = Object.fromEntries(members.map((m) => [m.userId, m.role]));
      assert.equal(byUser[leaderId], "leader");
      assert.equal(byUser[memberId], "member");

      const forLeader = freshOrgs.getOrgsForUser(dbC, leaderId);
      assert.ok(forLeader.some((o) => o.orgId === orgId && o.role === "leader"));

      const forMember = freshOrgs.getOrgsForUser(dbC, memberId);
      assert.ok(forMember.some((o) => o.orgId === orgId && o.role === "member"));

      const listed = freshOrgs.listOrganizations(dbC, { type: "guild" });
      assert.ok(listed.some((o) => o.id === orgId), "listOrganizations must surface the durable org after reconnect");
    } finally {
      dbC.close();
    }
  });

  it("a fresh instance can still join/leave/change roles against the reconnected db — writes are real, not cache-only", async () => {
    const freshOrgs = await import(`../lib/world-organizations.js?durability-check2=${Date.now()}-${Math.random()}`);
    const dbD = new Database(dbFile);
    try {
      const newMember = "durable-member-2";
      const joined = freshOrgs.joinOrganization(dbD, orgId, newMember, "apprentice");
      assert.equal(joined.ok, true);

      const promoted = freshOrgs.setMemberRole(dbD, orgId, newMember, "officer", leaderId);
      assert.equal(promoted.ok, true);
      assert.equal(promoted.role, "officer");

      const members = freshOrgs.getOrgMembers(dbD, orgId);
      assert.equal(members.length, 3);
      const newMemberRow = members.find((m) => m.userId === newMember);
      assert.equal(newMemberRow.role, "officer");

      const left = freshOrgs.leaveOrganization(dbD, orgId, newMember);
      assert.equal(left.ok, true);
      assert.equal(freshOrgs.getOrgMembers(dbD, orgId).length, 2);

      // Verify directly against SQL too — not just through the API that
      // could theoretically be lying via some other cache path.
      const rawCount = dbD.prepare(`SELECT COUNT(*) AS c FROM org_members WHERE org_id = ?`).get(orgId).c;
      assert.equal(rawCount, 2);
    } finally {
      dbD.close();
    }
  });

  it("the org row format resolves cleanly against a THIRD-party consumer's exact call shape (institutional licensing)", async () => {
    // Mirrors the exact calls server/economy/creative-marketplace.js's
    // institutional-licensing unit makes: getOrganization(db, orgId) and
    // getOrgMembers(db, orgId) used to verify purchase authority. Full
    // behavioral coverage lives in
    // tests/economy/creative-marketplace-org-licensing.test.js — this just
    // pins that the exact shape those call sites depend on survives a
    // reconnect too.
    const freshOrgs = await import(`../lib/world-organizations.js?durability-check3=${Date.now()}-${Math.random()}`);
    const dbE = new Database(dbFile);
    try {
      const org = freshOrgs.getOrganization(dbE, orgId);
      const members = freshOrgs.getOrgMembers(dbE, orgId);
      const membership = members.find((m) => m.userId === leaderId);
      assert.ok(org, "org must resolve");
      assert.ok(membership, "leader membership must resolve");
      assert.equal(membership.role, "leader");
    } finally {
      dbE.close();
    }
  });
});
