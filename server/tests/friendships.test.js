// Friendship graph contract.
//
// Pins: (1) request → accept moves to accepted, (2) self-friend is
// rejected, (3) two requests collapse into one row by sorted pair,
// (4) addressee re-sending becomes auto-accept, (5) unfriend removes,
// (6) block stays blocked.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  sendFriendRequest, acceptFriendRequest, declineFriendRequest,
  unfriend, blockUser, listFriends, listIncomingRequests, listOutgoingRequests,
  areFriends,
} from "../lib/friendships.js";

function memDb() {
  const rows = new Map();
  return {
    prepare(sql) {
      const norm = sql.replace(/\s+/g, " ").trim();
      return {
        run(...args) { return _execute(norm, args); },
        get(...args) { return _execute(norm, args, "get"); },
        all(...args) { return _execute(norm, args, "all"); },
      };
    },
    _rows: rows,
  };
  function _execute(sql, args, mode = "run") {
    if (sql.startsWith("SELECT * FROM friendships WHERE id =")) {
      return rows.get(args[0]) || null;
    }
    if (sql.startsWith("SELECT * FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)")) {
      const [a, b, c, d] = args;
      for (const r of rows.values()) {
        if ((r.requester_id === a && r.addressee_id === b) || (r.requester_id === c && r.addressee_id === d)) {
          return r;
        }
      }
      return null;
    }
    if (sql.startsWith("INSERT INTO friendships")) {
      const [id, requesterId, addresseeId] = args;
      // pending or blocked depending on which insert
      const status = sql.includes("'blocked'") ? "blocked" : "pending";
      rows.set(id, {
        id, requester_id: requesterId, addressee_id: addresseeId, status,
        created_at: Math.floor(Date.now() / 1000),
        responded_at: status === "blocked" ? Math.floor(Date.now() / 1000) : null,
      });
      return { changes: 1 };
    }
    if (sql.startsWith("UPDATE friendships SET status = 'accepted'")) {
      const row = rows.get(args[0]);
      if (row) { row.status = "accepted"; row.responded_at = Math.floor(Date.now() / 1000); }
      return { changes: row ? 1 : 0 };
    }
    if (sql.startsWith("UPDATE friendships SET status = 'declined'")) {
      const row = rows.get(args[0]);
      if (row) { row.status = "declined"; row.responded_at = Math.floor(Date.now() / 1000); }
      return { changes: row ? 1 : 0 };
    }
    if (sql.startsWith("UPDATE friendships SET status = 'blocked'")) {
      const row = rows.get(args[0]);
      if (row) { row.status = "blocked"; row.responded_at = Math.floor(Date.now() / 1000); }
      return { changes: row ? 1 : 0 };
    }
    if (sql.startsWith("DELETE FROM friendships")) {
      const ok = rows.delete(args[0]);
      return { changes: ok ? 1 : 0 };
    }
    if (sql.startsWith("SELECT id, requester_id, addressee_id, created_at, responded_at FROM friendships WHERE status = 'accepted'")) {
      const [u, _u2] = args;
      return [...rows.values()].filter(r => r.status === "accepted" && (r.requester_id === u || r.addressee_id === u));
    }
    if (sql.startsWith("SELECT id, requester_id AS fromUser") && sql.includes("addressee_id = ?")) {
      const [u] = args;
      return [...rows.values()]
        .filter(r => r.status === "pending" && r.addressee_id === u)
        .map(r => ({ id: r.id, fromUser: r.requester_id, created_at: r.created_at }));
    }
    if (sql.startsWith("SELECT id, addressee_id AS toUser") && sql.includes("requester_id = ?")) {
      const [u] = args;
      return [...rows.values()]
        .filter(r => r.status === "pending" && r.requester_id === u)
        .map(r => ({ id: r.id, toUser: r.addressee_id, created_at: r.created_at }));
    }
    return mode === "all" ? [] : null;
  }
}

describe("friendships", () => {
  let db;
  beforeEach(() => { db = memDb(); });

  it("rejects self-friend", () => {
    const r = sendFriendRequest(db, "u1", "u1");
    assert.equal(r.ok, false);
    assert.equal(r.error, "cannot_friend_self");
  });

  it("request → accept moves to accepted", () => {
    const r = sendFriendRequest(db, "u1", "u2");
    assert.equal(r.ok, true);
    assert.equal(r.status, "pending");
    const a = acceptFriendRequest(db, r.id, "u2");
    assert.equal(a.ok, true);
    assert.equal(areFriends(db, "u1", "u2"), true);
    assert.equal(areFriends(db, "u2", "u1"), true);
  });

  it("addressee cannot accept their own outgoing request", () => {
    const r = sendFriendRequest(db, "u1", "u2");
    // u1 sent it; u1 tries to accept their own request — must fail.
    const a = acceptFriendRequest(db, r.id, "u1");
    assert.equal(a.ok, false);
    assert.equal(a.error, "not_authorized");
  });

  it("duplicate request returns existing row, not new", () => {
    const r1 = sendFriendRequest(db, "u1", "u2");
    const r2 = sendFriendRequest(db, "u1", "u2");
    assert.equal(r1.id, r2.id);
  });

  it("addressee re-sending auto-accepts (handshake)", () => {
    const r = sendFriendRequest(db, "u1", "u2");
    const back = sendFriendRequest(db, "u2", "u1");
    assert.equal(back.status, "accepted");
    assert.equal(areFriends(db, "u1", "u2"), true);
  });

  it("decline removes from pending but keeps row at 'declined'", () => {
    const r = sendFriendRequest(db, "u1", "u2");
    const d = declineFriendRequest(db, r.id, "u2");
    assert.equal(d.ok, true);
    assert.equal(areFriends(db, "u1", "u2"), false);
  });

  it("unfriend removes the row", () => {
    const r = sendFriendRequest(db, "u1", "u2");
    acceptFriendRequest(db, r.id, "u2");
    const u = unfriend(db, "u1", "u2");
    assert.equal(u.ok, true);
    assert.equal(areFriends(db, "u1", "u2"), false);
  });

  it("block prevents future requests", () => {
    blockUser(db, "u1", "u2");
    const r = sendFriendRequest(db, "u2", "u1");
    assert.equal(r.ok, false);
    assert.equal(r.error, "blocked");
  });

  it("listFriends returns the OTHER party for both sides", () => {
    const r = sendFriendRequest(db, "u1", "u2");
    acceptFriendRequest(db, r.id, "u2");
    const u1Friends = listFriends(db, "u1");
    const u2Friends = listFriends(db, "u2");
    assert.equal(u1Friends.length, 1);
    assert.equal(u1Friends[0].friendUserId, "u2");
    assert.equal(u2Friends[0].friendUserId, "u1");
  });

  it("incoming + outgoing lists are role-correct", () => {
    sendFriendRequest(db, "u1", "u2");
    sendFriendRequest(db, "u3", "u1");
    const incoming = listIncomingRequests(db, "u1");
    const outgoing = listOutgoingRequests(db, "u1");
    assert.equal(incoming.length, 1);
    assert.equal(incoming[0].fromUser, "u3");
    assert.equal(outgoing.length, 1);
    assert.equal(outgoing[0].toUser, "u2");
  });
});
