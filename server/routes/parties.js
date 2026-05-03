// server/routes/parties.js
// Player party / group system. Mounted at /api/parties.
//
// Endpoints:
//   POST   /api/parties           — create a new party (caller becomes leader)
//   GET    /api/parties/me        — my current party + members
//   POST   /api/parties/:id/invite — leader invites a user (5min lifetime)
//   POST   /api/parties/invites/:inviteId/accept
//   POST   /api/parties/invites/:inviteId/decline
//   POST   /api/parties/:id/leave  — caller leaves; auto-disband if last out
//   POST   /api/parties/:id/kick   — leader removes a member
//   POST   /api/parties/:id/transfer — leader hands leadership to another member
//   POST   /api/parties/:id/loot-policy — leader sets loot policy
//   POST   /api/parties/:id/chat   — emit a party chat message

import { Router } from "express";
import crypto from "crypto";

const INVITE_LIFETIME_S = 5 * 60;
const MAX_PARTY_SIZE = 8;

export default function createPartiesRouter({ requireAuth, db, emitToUser }) {
  const router = Router();
  // requireAuth is a factory — call it once to produce middleware. The
  // previous `const auth = requireAuth` pattern leaked the factory into
  // Express, which hung the request because the factory never calls next().
  const auth = typeof requireAuth === "function"
    ? (requireAuth.length === 0 ? requireAuth() : requireAuth)
    : requireAuth;
  const _userId = (req) => req.user?.id || req.headers["x-user-id"] || null;
  const _emit = (uid, event, payload) => {
    try { emitToUser?.(uid, event, payload); } catch { /* best-effort */ }
  };

  // POST /api/parties — create new party
  router.post("/", auth, (req, res) => {
    try {
      const userId = _userId(req);
      const { name, lootPolicy = "free_for_all", maxSize = MAX_PARTY_SIZE } = req.body || {};

      // Already in a party? Reject (a user belongs to ≤1 party at a time)
      const existing = db.prepare(`
        SELECT pm.party_id FROM party_members pm
        JOIN parties p ON p.id = pm.party_id
        WHERE pm.user_id = ? AND p.disbanded_at IS NULL
      `).get(userId);
      if (existing) return res.status(400).json({ ok: false, error: "already_in_party", partyId: existing.party_id });

      const id = crypto.randomUUID();
      const tx = db.transaction(() => {
        db.prepare(`
          INSERT INTO parties (id, leader_id, name, max_size, loot_policy)
          VALUES (?, ?, ?, ?, ?)
        `).run(id, userId, name || null, Math.max(2, Math.min(MAX_PARTY_SIZE, Number(maxSize) || MAX_PARTY_SIZE)), lootPolicy);
        db.prepare(`
          INSERT INTO party_members (party_id, user_id, role) VALUES (?, ?, 'leader')
        `).run(id, userId);
      });
      tx();

      res.status(201).json({ ok: true, partyId: id });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // GET /api/parties/me
  router.get("/me", auth, (req, res) => {
    try {
      const userId = _userId(req);
      const row = db.prepare(`
        SELECT p.*, pm.role
          FROM parties p
          JOIN party_members pm ON pm.party_id = p.id
         WHERE pm.user_id = ? AND p.disbanded_at IS NULL
      `).get(userId);
      if (!row) return res.json({ ok: true, party: null });

      const members = db.prepare(`
        SELECT user_id, role, joined_at FROM party_members WHERE party_id = ? ORDER BY joined_at
      `).all(row.id);

      res.json({ ok: true, party: { ...row, members } });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // POST /api/parties/:id/invite
  router.post("/:id/invite", auth, (req, res) => {
    try {
      const userId = _userId(req);
      const { invitedId } = req.body || {};
      if (!invitedId) return res.status(400).json({ ok: false, error: "invitedId required" });

      const party = db.prepare(`SELECT * FROM parties WHERE id = ? AND disbanded_at IS NULL`).get(req.params.id);
      if (!party) return res.status(404).json({ ok: false, error: "party_not_found" });
      if (party.leader_id !== userId) return res.status(403).json({ ok: false, error: "not_leader" });

      const memberCount = db.prepare(`SELECT COUNT(*) AS n FROM party_members WHERE party_id = ?`).get(party.id)?.n ?? 0;
      if (memberCount >= party.max_size) return res.status(400).json({ ok: false, error: "party_full" });

      // No duplicate pending invite
      const existing = db.prepare(`
        SELECT id FROM party_invites WHERE party_id = ? AND invited_id = ? AND status = 'pending'
      `).get(party.id, invitedId);
      if (existing) return res.status(400).json({ ok: false, error: "invite_already_pending", inviteId: existing.id });

      const id = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      db.prepare(`
        INSERT INTO party_invites (id, party_id, invited_id, invited_by, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(id, party.id, invitedId, userId, now + INVITE_LIFETIME_S);

      _emit(invitedId, "party:invite", {
        inviteId: id,
        partyId: party.id,
        invitedBy: userId,
        partyName: party.name,
        expiresAt: (now + INVITE_LIFETIME_S) * 1000,
      });

      res.status(201).json({ ok: true, inviteId: id });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // POST /api/parties/invites/:inviteId/accept
  router.post("/invites/:inviteId/accept", auth, (req, res) => {
    try {
      const userId = _userId(req);
      const invite = db.prepare(`SELECT * FROM party_invites WHERE id = ?`).get(req.params.inviteId);
      if (!invite) return res.status(404).json({ ok: false, error: "invite_not_found" });
      if (invite.invited_id !== userId) return res.status(403).json({ ok: false, error: "not_your_invite" });
      if (invite.status !== "pending") return res.status(400).json({ ok: false, error: "invite_not_pending" });

      const now = Math.floor(Date.now() / 1000);
      if (now > invite.expires_at) {
        db.prepare(`UPDATE party_invites SET status = 'expired', responded_at = ? WHERE id = ?`).run(now, invite.id);
        return res.status(400).json({ ok: false, error: "invite_expired" });
      }

      // User already in another party?
      const existingParty = db.prepare(`
        SELECT pm.party_id FROM party_members pm
        JOIN parties p ON p.id = pm.party_id
        WHERE pm.user_id = ? AND p.disbanded_at IS NULL
      `).get(userId);
      if (existingParty) return res.status(400).json({ ok: false, error: "already_in_party" });

      const party = db.prepare(`SELECT * FROM parties WHERE id = ? AND disbanded_at IS NULL`).get(invite.party_id);
      if (!party) return res.status(400).json({ ok: false, error: "party_no_longer_exists" });

      const memberCount = db.prepare(`SELECT COUNT(*) AS n FROM party_members WHERE party_id = ?`).get(party.id)?.n ?? 0;
      if (memberCount >= party.max_size) return res.status(400).json({ ok: false, error: "party_full" });

      const tx = db.transaction(() => {
        db.prepare(`INSERT INTO party_members (party_id, user_id, role) VALUES (?, ?, 'member')`).run(party.id, userId);
        db.prepare(`UPDATE party_invites SET status = 'accepted', responded_at = ? WHERE id = ?`).run(now, invite.id);
      });
      tx();

      // Notify all existing members
      const allMembers = db.prepare(`SELECT user_id FROM party_members WHERE party_id = ?`).all(party.id);
      for (const m of allMembers) {
        _emit(m.user_id, "party:member_joined", { partyId: party.id, userId });
      }

      res.json({ ok: true, partyId: party.id });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // POST /api/parties/invites/:inviteId/decline
  router.post("/invites/:inviteId/decline", auth, (req, res) => {
    try {
      const userId = _userId(req);
      const invite = db.prepare(`SELECT * FROM party_invites WHERE id = ?`).get(req.params.inviteId);
      if (!invite) return res.status(404).json({ ok: false, error: "invite_not_found" });
      if (invite.invited_id !== userId) return res.status(403).json({ ok: false, error: "not_your_invite" });
      if (invite.status !== "pending") return res.status(400).json({ ok: false, error: "invite_not_pending" });

      const now = Math.floor(Date.now() / 1000);
      db.prepare(`UPDATE party_invites SET status = 'declined', responded_at = ? WHERE id = ?`).run(now, invite.id);
      _emit(invite.invited_by, "party:invite_declined", { inviteId: invite.id, by: userId });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // POST /api/parties/:id/leave
  router.post("/:id/leave", auth, (req, res) => {
    try {
      const userId = _userId(req);
      const party = db.prepare(`SELECT * FROM parties WHERE id = ? AND disbanded_at IS NULL`).get(req.params.id);
      if (!party) return res.status(404).json({ ok: false, error: "party_not_found" });
      const me = db.prepare(`SELECT * FROM party_members WHERE party_id = ? AND user_id = ?`).get(party.id, userId);
      if (!me) return res.status(403).json({ ok: false, error: "not_a_member" });

      const tx = db.transaction(() => {
        db.prepare(`DELETE FROM party_members WHERE party_id = ? AND user_id = ?`).run(party.id, userId);
        const remaining = db.prepare(`SELECT user_id, role FROM party_members WHERE party_id = ?`).all(party.id);
        if (remaining.length === 0) {
          db.prepare(`UPDATE parties SET disbanded_at = unixepoch() WHERE id = ?`).run(party.id);
        } else if (party.leader_id === userId) {
          // Leader left — promote the longest-tenured member
          const next = db.prepare(`SELECT user_id FROM party_members WHERE party_id = ? ORDER BY joined_at LIMIT 1`).get(party.id);
          if (next) {
            db.prepare(`UPDATE party_members SET role = 'leader' WHERE party_id = ? AND user_id = ?`).run(party.id, next.user_id);
            db.prepare(`UPDATE parties SET leader_id = ? WHERE id = ?`).run(next.user_id, party.id);
            for (const m of remaining) _emit(m.user_id, "party:leader_changed", { partyId: party.id, newLeaderId: next.user_id });
          }
        }
        // Notify remaining members the user left
        for (const m of remaining) {
          if (m.user_id !== userId) _emit(m.user_id, "party:member_left", { partyId: party.id, userId });
        }
      });
      tx();
      res.json({ ok: true });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // POST /api/parties/:id/kick
  router.post("/:id/kick", auth, (req, res) => {
    try {
      const userId = _userId(req);
      const { targetId } = req.body || {};
      const party = db.prepare(`SELECT * FROM parties WHERE id = ? AND disbanded_at IS NULL`).get(req.params.id);
      if (!party) return res.status(404).json({ ok: false, error: "party_not_found" });
      if (party.leader_id !== userId) return res.status(403).json({ ok: false, error: "not_leader" });
      if (targetId === userId) return res.status(400).json({ ok: false, error: "leader_cannot_kick_self" });

      const target = db.prepare(`SELECT * FROM party_members WHERE party_id = ? AND user_id = ?`).get(party.id, targetId);
      if (!target) return res.status(404).json({ ok: false, error: "not_a_member" });

      db.prepare(`DELETE FROM party_members WHERE party_id = ? AND user_id = ?`).run(party.id, targetId);

      const remaining = db.prepare(`SELECT user_id FROM party_members WHERE party_id = ?`).all(party.id);
      _emit(targetId, "party:kicked", { partyId: party.id, by: userId });
      for (const m of remaining) {
        _emit(m.user_id, "party:member_left", { partyId: party.id, userId: targetId, kicked: true });
      }
      res.json({ ok: true });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // POST /api/parties/:id/transfer
  router.post("/:id/transfer", auth, (req, res) => {
    try {
      const userId = _userId(req);
      const { newLeaderId } = req.body || {};
      const party = db.prepare(`SELECT * FROM parties WHERE id = ? AND disbanded_at IS NULL`).get(req.params.id);
      if (!party) return res.status(404).json({ ok: false, error: "party_not_found" });
      if (party.leader_id !== userId) return res.status(403).json({ ok: false, error: "not_leader" });
      const target = db.prepare(`SELECT * FROM party_members WHERE party_id = ? AND user_id = ?`).get(party.id, newLeaderId);
      if (!target) return res.status(404).json({ ok: false, error: "not_a_member" });

      const tx = db.transaction(() => {
        db.prepare(`UPDATE party_members SET role = 'member' WHERE party_id = ? AND user_id = ?`).run(party.id, userId);
        db.prepare(`UPDATE party_members SET role = 'leader' WHERE party_id = ? AND user_id = ?`).run(party.id, newLeaderId);
        db.prepare(`UPDATE parties SET leader_id = ? WHERE id = ?`).run(newLeaderId, party.id);
      });
      tx();

      const all = db.prepare(`SELECT user_id FROM party_members WHERE party_id = ?`).all(party.id);
      for (const m of all) _emit(m.user_id, "party:leader_changed", { partyId: party.id, newLeaderId });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  // POST /api/parties/:id/chat — broadcast a message to all members
  router.post("/:id/chat", auth, (req, res) => {
    try {
      const userId = _userId(req);
      const { message } = req.body || {};
      if (!message || typeof message !== "string") return res.status(400).json({ ok: false, error: "message required" });
      const trimmed = message.trim().slice(0, 500);
      if (!trimmed) return res.status(400).json({ ok: false, error: "empty_message" });

      const me = db.prepare(`SELECT * FROM party_members WHERE party_id = ? AND user_id = ?`).get(req.params.id, userId);
      if (!me) return res.status(403).json({ ok: false, error: "not_a_member" });

      const all = db.prepare(`SELECT user_id FROM party_members WHERE party_id = ?`).all(req.params.id);
      const payload = { partyId: req.params.id, fromUserId: userId, message: trimmed };
      for (const m of all) _emit(m.user_id, "party:chat", payload);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  return router;
}
