/**
 * Lightweight groups (parties) — join/leave/membership-visibility contract
 * test (V1.2 Wave A — Society & Presence).
 *
 * `server/lib/parties.js` (migration 070) already exists as the canonical
 * lightweight-group model — this test does not re-litigate its own CRUD
 * contract (create/invite/accept/leave/kick already pinned by
 * `tests/parties.test.js`). What's new for this unit and pinned here:
 *
 *   - party membership composes with cityPresence.getPresenceForUsers to
 *     give every member visibility into the whole roster's live location
 *     and status REGARDLESS OF RAW PROXIMITY (unlike getNearbyUsers, which
 *     is intentionally distance-gated)
 *   - a member who leaves (or is kicked) drops out of the roster
 *     `getMyParty` returns, so a subsequent presence composition correctly
 *     stops including them
 *   - a hidden (ghost) party member's coordinates are still withheld from
 *     fellow members — party membership is not a bypass of the visibility
 *     contract, only of the proximity-radius contract
 *
 * Run: node --test tests/parties-presence-visibility.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  createParty,
  inviteToParty,
  acceptPartyInvite,
  leaveParty,
  kickFromParty,
  getMyParty,
} from "../lib/parties.js";

import {
  configurePresence,
  updateUserPosition,
  setUserVisibility,
  setUserPresenceStatus,
  getPresenceForUsers,
  removeUser,
} from "../lib/city-presence.js";

// Minimal in-memory better-sqlite3 stand-in — same shape as
// tests/parties.test.js's memDb(), trimmed to what this file exercises.
function memDb() {
  const t = { parties: new Map(), members: [], invites: new Map() };
  function _trim(s) { return String(s).replace(/\s+/g, " ").trim(); }
  return {
    exec() { return null; },
    prepare(sql) {
      const n = _trim(sql);
      return {
        run: (...args) => {
          if (n.startsWith("INSERT INTO parties")) {
            const [id, leader, name, maxSize, privacy, partyType] = args;
            t.parties.set(id, { id, leader_id: leader, name, max_size: maxSize, privacy, party_type: partyType, disbanded_at: null });
            return { changes: 1 };
          }
          if (n.startsWith("INSERT INTO party_members")) {
            const roleMatch = n.match(/VALUES \([^)]*'(leader|member)'/);
            const role = roleMatch ? roleMatch[1] : "member";
            const [partyId, userId] = args;
            t.members.push({ party_id: partyId, user_id: userId, role, joined_at: Date.now() / 1000 + t.members.length });
            return { changes: 1 };
          }
          if (n.startsWith("INSERT INTO party_invites")) {
            const [id, partyId, fromU, toU] = args;
            t.invites.set(id, { id, party_id: partyId, from_user_id: fromU, to_user_id: toU, status: "pending" });
            return { changes: 1 };
          }
          if (n.startsWith("UPDATE party_invites SET status = 'accepted'")) {
            const inv = t.invites.get(args[0]);
            if (inv) { inv.status = "accepted"; return { changes: 1 }; }
            return { changes: 0 };
          }
          if (n.startsWith("DELETE FROM party_members WHERE party_id = ? AND user_id = ?")) {
            const [partyId, userId] = args;
            const before = t.members.length;
            t.members = t.members.filter((m) => !(m.party_id === partyId && m.user_id === userId));
            return { changes: before - t.members.length };
          }
          if (n.startsWith("UPDATE parties SET disbanded_at = unixepoch()")) {
            const p = t.parties.get(args[0]);
            if (p) p.disbanded_at = Math.floor(Date.now() / 1000);
            return { changes: 1 };
          }
          if (n.startsWith("UPDATE party_members SET role = 'leader'")) {
            const [partyId, userId] = args;
            const m = t.members.find((x) => x.party_id === partyId && x.user_id === userId);
            if (m) { m.role = "leader"; return { changes: 1 }; }
            return { changes: 0 };
          }
          if (n.startsWith("UPDATE parties SET leader_id = ?")) {
            const [newLeader, partyId] = args;
            const p = t.parties.get(partyId);
            if (p) { p.leader_id = newLeader; return { changes: 1 }; }
            return { changes: 0 };
          }
          return { changes: 0 };
        },
        get: (...args) => {
          if (n.startsWith("SELECT party_id FROM party_members WHERE user_id = ?")) {
            const m = t.members.find((x) => x.user_id === args[0]);
            return m ? { party_id: m.party_id } : null;
          }
          if (n.startsWith("SELECT * FROM parties WHERE id = ?")) {
            const p = t.parties.get(args[0]);
            return p && !p.disbanded_at ? p : null;
          }
          if (n.startsWith("SELECT role FROM party_members WHERE party_id = ? AND user_id = ?")) {
            const m = t.members.find((x) => x.party_id === args[0] && x.user_id === args[1]);
            return m ? { role: m.role } : null;
          }
          if (n.startsWith("SELECT COUNT(*) AS n FROM party_members WHERE party_id = ?")) {
            return { n: t.members.filter((m) => m.party_id === args[0]).length };
          }
          if (n.startsWith("SELECT * FROM party_invites WHERE id = ?")) {
            return t.invites.get(args[0]) || null;
          }
          if (n.startsWith("SELECT user_id FROM party_members WHERE party_id = ?")) {
            const m = t.members.filter((x) => x.party_id === args[0]).sort((a, b) => a.joined_at - b.joined_at)[0];
            return m ? { user_id: m.user_id } : null;
          }
          if (n.includes("FROM party_members pm JOIN parties p") && n.includes("WHERE pm.user_id = ?")) {
            const member = t.members.find((x) => x.user_id === args[0]);
            if (!member) return null;
            const party = t.parties.get(member.party_id);
            if (!party || party.disbanded_at) return null;
            return { party_id: member.party_id, myRole: member.role, name: party.name, leaderId: party.leader_id, maxSize: party.max_size, privacy: party.privacy, partyType: party.party_type };
          }
          return null;
        },
        all: (...args) => {
          if (n.startsWith("SELECT user_id AS userId, role, joined_at AS joinedAt FROM party_members WHERE party_id = ?")) {
            return t.members.filter((x) => x.party_id === args[0]).sort((a, b) => a.joined_at - b.joined_at)
              .map((x) => ({ userId: x.user_id, role: x.role, joinedAt: x.joined_at }));
          }
          return [];
        },
      };
    },
    _t: t,
  };
}

const USERS = ["u1", "u2", "u3"];

beforeEach(() => {
  configurePresence({ db: null, fireTrigger: null });
  for (const uid of USERS) {
    try { removeUser(uid); } catch { /* not present, fine */ }
  }
});

describe("lightweight groups — presence visibility regardless of raw proximity", () => {
  it("both members' live presence is readable together, even though they are far apart", () => {
    const db = memDb();
    const c = createParty(db, "u1", { name: "Scouting Party" });
    const inv = inviteToParty(db, c.partyId, "u1", "u2");
    acceptPartyInvite(db, inv.inviteId, "u2");

    // Deliberately place them far apart — well outside any proximity radius,
    // but each axis still inside the ±1000m world-bounds envelope (a larger
    // value would get silently clamped back to the origin by
    // math-safety.js's clampToWorldBounds, which would defeat the test).
    updateUserPosition("u1", { cityId: "c1", x: 0, y: 0, z: 0 });
    updateUserPosition("u2", { cityId: "c1", x: 900, y: 0, z: 900 });
    setUserPresenceStatus("u2", "busy");

    const party = getMyParty(db, "u1");
    assert.equal(party.members.length, 2);
    const memberIds = party.members.map((m) => m.userId);

    const presence = getPresenceForUsers(memberIds);
    assert.equal(presence.length, 2);
    const p1 = presence.find((p) => p.userId === "u1");
    const p2 = presence.find((p) => p.userId === "u2");
    assert.equal(p1.online, true);
    assert.equal(p2.online, true);
    assert.equal(p2.presenceStatus, "busy");
    assert.equal(p2.x, 900, "the far member's real coordinates must still be visible to the group");

    removeUser("u1");
    removeUser("u2");
  });

  it("a party member who has never moved reports online:false, not a thrown error", () => {
    const db = memDb();
    const c = createParty(db, "u1", { name: "T" });
    const inv = inviteToParty(db, c.partyId, "u1", "u3");
    acceptPartyInvite(db, inv.inviteId, "u3");
    // u3 never calls updateUserPosition.
    const party = getMyParty(db, "u1");
    const presence = getPresenceForUsers(party.members.map((m) => m.userId));
    const p3 = presence.find((p) => p.userId === "u3");
    assert.equal(p3.online, false);
    removeUser("u1");
  });
});

describe("lightweight groups — leave/kick drop out of the presence roster in real time", () => {
  it("a member who leaves no longer appears in getMyParty's membership, so presence composition excludes them", () => {
    const db = memDb();
    const c = createParty(db, "u1", { name: "T" });
    const inv = inviteToParty(db, c.partyId, "u1", "u2");
    acceptPartyInvite(db, inv.inviteId, "u2");
    updateUserPosition("u1", { cityId: "c1", x: 0, y: 0, z: 0 });
    updateUserPosition("u2", { cityId: "c1", x: 1, y: 0, z: 1 });

    assert.equal(getMyParty(db, "u1").members.length, 2);

    const left = leaveParty(db, c.partyId, "u2");
    assert.equal(left.ok, true);

    const afterParty = getMyParty(db, "u1");
    assert.equal(afterParty.members.length, 1);
    assert.equal(afterParty.members[0].userId, "u1");

    const presence = getPresenceForUsers(afterParty.members.map((m) => m.userId));
    assert.equal(presence.some((p) => p.userId === "u2"), false, "a departed member must not be in the presence composition anymore");

    removeUser("u1");
    removeUser("u2");
  });

  it("a kicked member no longer appears in the roster either", () => {
    const db = memDb();
    const c = createParty(db, "u1", { name: "T" });
    const inv = inviteToParty(db, c.partyId, "u1", "u2");
    acceptPartyInvite(db, inv.inviteId, "u2");

    const kicked = kickFromParty(db, c.partyId, "u1", "u2");
    assert.equal(kicked.ok, true);

    const afterParty = getMyParty(db, "u1");
    assert.equal(afterParty.members.length, 1);
    const presence = getPresenceForUsers(afterParty.members.map((m) => m.userId));
    assert.equal(presence.some((p) => p.userId === "u2"), false);

    removeUser("u1");
    removeUser("u2");
  });
});

describe("lightweight groups — ghost mode is not bypassed by party membership", () => {
  it("a hidden party member's coordinates stay withheld from the rest of the party", () => {
    const db = memDb();
    const c = createParty(db, "u1", { name: "T" });
    const inv = inviteToParty(db, c.partyId, "u1", "u2");
    acceptPartyInvite(db, inv.inviteId, "u2");

    updateUserPosition("u1", { cityId: "c1", x: 0, y: 0, z: 0 });
    updateUserPosition("u2", { cityId: "c1", x: 3, y: 0, z: 4 });
    setUserVisibility("u2", "hidden");

    const party = getMyParty(db, "u1");
    const presence = getPresenceForUsers(party.members.map((m) => m.userId));
    const p2 = presence.find((p) => p.userId === "u2");
    assert.equal(p2.online, true, "hidden is not the same as offline");
    assert.equal(p2.hidden, true);
    assert.equal(p2.x, null, "party membership must not bypass ghost-mode location redaction");

    removeUser("u1");
    removeUser("u2");
  });
});
