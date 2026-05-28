// Phase U5 — parties + LFG.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createParty, inviteToParty, acceptPartyInvite, leaveParty, kickFromParty, disbandParty, getMyParty, listIncomingInvites } from "../lib/parties.js";
import { postLfg, listOpenLfg, inviteFromLfg, cancelLfg, sweepExpiredLfg } from "../lib/lfg.js";

function memDb() {
  const t = {
    parties: new Map(),
    members: [],  // {party_id, user_id, role, joined_at}
    invites: new Map(),
    lfg: new Map(),
    shared_quests: [],
  };
  function _trim(s) { return String(s).replace(/\s+/g, " ").trim(); }
  return {
    exec(sql) {
      // CREATE TABLE statements — no-op in stub.
      return null;
    },
    prepare(sql) {
      const n = _trim(sql);
      return {
        run: (...args) => {
          if (n.startsWith("INSERT INTO parties")) {
            const [id, leader, name, maxSize, privacy, partyType] = args;
            t.parties.set(id, { id, leader_id: leader, name, max_size: maxSize, privacy, party_type: partyType, created_at: Math.floor(Date.now()/1000), disbanded_at: null });
            return { changes: 1 };
          }
          if (n.startsWith("INSERT INTO party_members")) {
            // SQL hardcodes role ('leader' or 'member') — extract from VALUES clause.
            const roleMatch = n.match(/VALUES \([^)]*'(leader|member)'/);
            const role = roleMatch ? roleMatch[1] : "member";
            const [partyId, userId] = args;
            t.members.push({ party_id: partyId, user_id: userId, role, joined_at: Math.floor(Date.now()/1000) });
            return { changes: 1 };
          }
          if (n.startsWith("INSERT INTO party_invites")) {
            const [id, partyId, fromU, toU] = args;
            t.invites.set(id, { id, party_id: partyId, from_user_id: fromU, to_user_id: toU, status: "pending", created_at: Math.floor(Date.now()/1000) });
            return { changes: 1 };
          }
          if (n.startsWith("UPDATE party_invites SET status = 'accepted'") || n.startsWith("UPDATE party_invites SET status = 'expired'")) {
            const inv = t.invites.get(args[0]);
            if (inv) {
              inv.status = n.includes("'accepted'") ? "accepted" : "expired";
              return { changes: 1 };
            }
            return { changes: 0 };
          }
          if (n.startsWith("DELETE FROM party_members WHERE party_id = ? AND user_id = ?")) {
            const [partyId, userId] = args;
            const before = t.members.length;
            t.members = t.members.filter(m => !(m.party_id === partyId && m.user_id === userId));
            return { changes: before - t.members.length };
          }
          if (n.startsWith("DELETE FROM party_members WHERE party_id = ?")) {
            const [partyId] = args;
            const before = t.members.length;
            t.members = t.members.filter(m => m.party_id !== partyId);
            return { changes: before - t.members.length };
          }
          if (n.startsWith("UPDATE parties SET disbanded_at = unixepoch()")) {
            const p = t.parties.get(args[0]);
            if (p) p.disbanded_at = Math.floor(Date.now()/1000);
            return { changes: 1 };
          }
          if (n.startsWith("UPDATE party_members SET role = 'leader'")) {
            const [partyId, userId] = args;
            const m = t.members.find(x => x.party_id === partyId && x.user_id === userId);
            if (m) { m.role = "leader"; return { changes: 1 }; }
            return { changes: 0 };
          }
          if (n.startsWith("UPDATE parties SET leader_id = ?")) {
            const [newLeader, partyId] = args;
            const p = t.parties.get(partyId);
            if (p) { p.leader_id = newLeader; return { changes: 1 }; }
            return { changes: 0 };
          }
          if (n.startsWith("INSERT INTO party_shared_quests")) {
            const [partyId, questId] = args;
            t.shared_quests.push({ party_id: partyId, quest_id: questId });
            return { changes: 1 };
          }
          if (n.startsWith("UPDATE lfg_requests SET status = 'cancelled'") && n.includes("WHERE id = ?")) {
            // cancelLfg(lfgId, userId)
            const r = t.lfg.get(args[0]);
            if (r && r.requester_user_id === args[1] && r.status === "open") {
              r.status = "cancelled";
              return { changes: 1 };
            }
            return { changes: 0 };
          }
          if (n.startsWith("UPDATE lfg_requests SET status = 'cancelled'") && n.includes("WHERE requester_user_id = ?")) {
            // postLfg's cancel-prior
            const [userId, worldId] = args;
            let changes = 0;
            for (const r of t.lfg.values()) {
              if (r.requester_user_id === userId && r.world_id === worldId && r.status === "open") {
                r.status = "cancelled";
                changes++;
              }
            }
            return { changes };
          }
          if (n.startsWith("INSERT INTO lfg_requests")) {
            const [id, userId, worldId, role, partyType, note, maxSize] = args;
            t.lfg.set(id, { id, requester_user_id: userId, world_id: worldId, role, party_type: partyType, note, party_max_size: maxSize, current_party_size: 1, status: "open", created_at: Math.floor(Date.now()/1000), expires_at: Math.floor(Date.now()/1000) + 3600 });
            return { changes: 1 };
          }
          if (n.startsWith("UPDATE lfg_requests SET status = 'matched'")) {
            const [partyId, lfgId] = args;
            const r = t.lfg.get(lfgId);
            if (r) { r.status = "matched"; r.party_id = partyId; return { changes: 1 }; }
            return { changes: 0 };
          }
          if (n.startsWith("UPDATE lfg_requests SET status = 'expired'")) {
            let changes = 0;
            const now = Math.floor(Date.now()/1000);
            for (const r of t.lfg.values()) {
              if (r.status === "open" && r.expires_at <= now) {
                r.status = "expired";
                changes++;
              }
            }
            return { changes };
          }
          return { changes: 0 };
        },
        get: (...args) => {
          if (n.startsWith("SELECT party_id FROM party_members WHERE user_id = ?")) {
            const m = t.members.find(x => x.user_id === args[0]);
            return m ? { party_id: m.party_id } : null;
          }
          if (n.startsWith("SELECT * FROM parties WHERE id = ?")) {
            const p = t.parties.get(args[0]);
            return p && !p.disbanded_at ? p : null;
          }
          if (n.startsWith("SELECT role FROM party_members WHERE party_id = ? AND user_id = ?")) {
            const m = t.members.find(x => x.party_id === args[0] && x.user_id === args[1]);
            return m ? { role: m.role } : null;
          }
          if (n.startsWith("SELECT COUNT(*) AS n FROM party_members WHERE party_id = ?")) {
            return { n: t.members.filter(m => m.party_id === args[0]).length };
          }
          if (n.startsWith("SELECT * FROM party_invites WHERE id = ?")) {
            return t.invites.get(args[0]) || null;
          }
          if (n.startsWith("SELECT user_id FROM party_members WHERE party_id = ?")) {
            const m = t.members.filter(x => x.party_id === args[0]).sort((a, b) => a.joined_at - b.joined_at)[0];
            return m ? { user_id: m.user_id } : null;
          }
          if (n.includes("FROM party_members pm JOIN parties p") && n.includes("WHERE pm.user_id = ?")) {
            const member = t.members.find(x => x.user_id === args[0]);
            if (!member) return null;
            const party = t.parties.get(member.party_id);
            if (!party || party.disbanded_at) return null;
            return { party_id: member.party_id, myRole: member.role, name: party.name, leaderId: party.leader_id, maxSize: party.max_size, privacy: party.privacy, partyType: party.party_type, createdAt: party.created_at };
          }
          if (n.startsWith("SELECT * FROM lfg_requests WHERE id = ?")) {
            return t.lfg.get(args[0]) || null;
          }
          return null;
        },
        all: (...args) => {
          if (n.startsWith("SELECT user_id AS userId, role, joined_at AS joinedAt FROM party_members WHERE party_id = ?")) {
            return t.members.filter(x => x.party_id === args[0]).sort((a,b)=>a.joined_at-b.joined_at).map(x => ({ userId: x.user_id, role: x.role, joinedAt: x.joined_at }));
          }
          if (n.includes("FROM party_invites pi JOIN parties p")) {
            const [userId] = args;
            return [...t.invites.values()]
              .filter(i => i.to_user_id === userId && i.status === "pending")
              .map(i => {
                const p = t.parties.get(i.party_id);
                return { id: i.id, partyId: i.party_id, fromUser: i.from_user_id, createdAt: i.created_at, partyName: p?.name || "?", partyType: p?.party_type || "normal" };
              });
          }
          if (n.includes("FROM lfg_requests") && n.includes("status = 'open'")) {
            // SQL builds dynamic WHERE; last bound param is always `limit`.
            // The presence of "world_id = ?" and/or "role = ?" tells us how to split args.
            const hasWorld = n.includes("world_id = ?");
            const hasRole = n.includes("role = ?");
            let i = 0;
            const worldFilter = hasWorld ? args[i++] : null;
            const roleFilter = hasRole ? args[i++] : null;
            // const limit = args[i];
            const now = Math.floor(Date.now()/1000);
            return [...t.lfg.values()]
              .filter(r => r.status === "open" && r.expires_at > now)
              .filter(r => !worldFilter || r.world_id === worldFilter)
              .filter(r => !roleFilter || r.role === roleFilter)
              .map(r => ({ id: r.id, userId: r.requester_user_id, worldId: r.world_id, role: r.role, partyType: r.party_type, note: r.note, createdAt: r.created_at, expiresAt: r.expires_at, partyMaxSize: r.party_max_size, currentSize: r.current_party_size }));
          }
          return [];
        },
      };
    },
    _t: t,
  };
}

describe("Phase U5 — parties", () => {
  let db;
  beforeEach(() => { db = memDb(); });

  it("createParty inserts leader as first member", () => {
    const r = createParty(db, "u1", { name: "Test" });
    assert.equal(r.ok, true);
    const p = getMyParty(db, "u1");
    assert.equal(p.members.length, 1);
    assert.equal(p.members[0].role, "leader");
  });

  it("createParty rejects if leader already in a party", () => {
    createParty(db, "u1", { name: "A" });
    const r2 = createParty(db, "u1", { name: "B" });
    assert.equal(r2.ok, false);
    assert.equal(r2.error, "already_in_party");
  });

  it("raid type allows max 40", () => {
    const r = createParty(db, "u1", { name: "Raid", partyType: "raid" });
    assert.equal(r.partyType, "raid");
    assert.equal(r.maxSize, 40);
  });

  it("invite + accept adds member", () => {
    const c = createParty(db, "u1", { name: "T" });
    const inv = inviteToParty(db, c.partyId, "u1", "u2");
    assert.equal(inv.ok, true);
    const acc = acceptPartyInvite(db, inv.inviteId, "u2");
    assert.equal(acc.ok, true);
    const p = getMyParty(db, "u1");
    assert.equal(p.members.length, 2);
  });

  it("only leader can invite in invite_only", () => {
    const c = createParty(db, "u1", { name: "T", privacy: "invite_only" });
    const inv1 = inviteToParty(db, c.partyId, "u1", "u2");
    acceptPartyInvite(db, inv1.inviteId, "u2");
    // u2 (member) tries to invite — must fail.
    const inv2 = inviteToParty(db, c.partyId, "u2", "u3");
    assert.equal(inv2.ok, false);
    assert.equal(inv2.error, "not_authorized");
  });

  it("leader leaves → leadership transfers", () => {
    const c = createParty(db, "u1", { name: "T" });
    const inv = inviteToParty(db, c.partyId, "u1", "u2");
    acceptPartyInvite(db, inv.inviteId, "u2");
    const r = leaveParty(db, c.partyId, "u1");
    assert.equal(r.ok, true);
    assert.equal(r.leaderTransferredTo, "u2");
    const p = getMyParty(db, "u2");
    assert.equal(p.myRole, "leader");
  });

  it("last member leaves → disband", () => {
    const c = createParty(db, "u1", { name: "T" });
    const r = leaveParty(db, c.partyId, "u1");
    assert.equal(r.ok, true);
    assert.equal(r.disbanded, true);
  });

  it("kick removes member; only leader can kick", () => {
    const c = createParty(db, "u1", { name: "T" });
    const inv = inviteToParty(db, c.partyId, "u1", "u2");
    acceptPartyInvite(db, inv.inviteId, "u2");
    // Non-leader cannot kick.
    const r1 = kickFromParty(db, c.partyId, "u2", "u1");
    assert.equal(r1.ok, false);
    // Leader can kick.
    const r2 = kickFromParty(db, c.partyId, "u1", "u2");
    assert.equal(r2.ok, true);
  });
});

describe("Phase U5 — LFG", () => {
  let db;
  beforeEach(() => { db = memDb(); });

  it("postLfg cancels prior open request from same user in same world", () => {
    const r1 = postLfg(db, "u1", { worldId: "tunya", role: "healer" });
    const r2 = postLfg(db, "u1", { worldId: "tunya", role: "dps" });
    const open = listOpenLfg(db, { worldId: "tunya" });
    assert.equal(open.length, 1);
    assert.equal(open[0].role, "dps");
  });

  it("listOpenLfg respects world + role filters", () => {
    postLfg(db, "u1", { worldId: "tunya", role: "healer" });
    postLfg(db, "u2", { worldId: "crime", role: "dps" });
    const t = listOpenLfg(db, { worldId: "tunya" });
    assert.equal(t.length, 1);
    const dps = listOpenLfg(db, { role: "dps" });
    assert.equal(dps.length, 1);
  });

  it("inviteFromLfg auto-creates party + marks matched", () => {
    const r1 = postLfg(db, "u1", { worldId: "tunya", role: "healer" });
    const r2 = inviteFromLfg(db, r1.id, "u2");
    assert.equal(r2.ok, true);
    assert.ok(r2.partyId);
    // u1's lfg row is now matched.
    const open = listOpenLfg(db);
    assert.equal(open.length, 0);
  });

  it("inviteFromLfg refuses self-invite", () => {
    const r = postLfg(db, "u1", { worldId: "tunya", role: "healer" });
    const inv = inviteFromLfg(db, r.id, "u1");
    assert.equal(inv.ok, false);
  });

  it("cancelLfg sets status cancelled", () => {
    const r = postLfg(db, "u1", { worldId: "tunya", role: "healer" });
    cancelLfg(db, r.id, "u1");
    const open = listOpenLfg(db);
    assert.equal(open.length, 0);
  });
});
