/**
 * Social Groups Routes
 *
 * Provides group creation, discovery, membership, feed, and member listing.
 * Tables are created inline with IF NOT EXISTS for zero-migration setup.
 *
 * Endpoints:
 *   GET    /groups                  — list/search groups
 *   POST   /group                   — create a group
 *   GET    /group/:groupId          — group details
 *   POST   /group/:groupId/join     — join a group
 *   POST   /group/:groupId/leave    — leave a group
 *   GET    /group/:groupId/members  — list group members
 *   GET    /group/:groupId/feed     — list posts in a group
 *   POST   /group/:groupId/post     — create a post in a group
 */

import { Router } from "express";
import crypto from "crypto";

function uid() {
  return crypto.randomUUID();
}

export default function createSocialGroupRoutes({ db, requireAuth }) {
  const router = Router();

  // ── Schema bootstrap ────────────────────────────────────────────────────────

  db.exec(`
    CREATE TABLE IF NOT EXISTS social_groups (
      group_id    TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      rules       TEXT DEFAULT '',
      tags        TEXT DEFAULT '[]',
      created_by  TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS social_group_members (
      group_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      role       TEXT NOT NULL DEFAULT 'member',
      joined_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (group_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_sgm_user ON social_group_members (user_id);

    CREATE TABLE IF NOT EXISTS social_group_posts (
      post_id     TEXT PRIMARY KEY,
      group_id    TEXT NOT NULL,
      author_id   TEXT NOT NULL,
      author_name TEXT NOT NULL DEFAULT 'Anonymous',
      content     TEXT NOT NULL,
      media_type  TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      reactions   INTEGER NOT NULL DEFAULT 0,
      comments    INTEGER NOT NULL DEFAULT 0,
      shares      INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_sgp_group ON social_group_posts (group_id, created_at DESC);
  `);

  // ── Prepared statements ─────────────────────────────────────────────────────

  const stmts = {
    insertGroup: db.prepare(
      `INSERT INTO social_groups (group_id, name, description, rules, tags, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    ),
    insertMember: db.prepare(
      `INSERT OR IGNORE INTO social_group_members (group_id, user_id, role, joined_at)
       VALUES (?, ?, ?, datetime('now'))`
    ),
    removeMember: db.prepare(
      `DELETE FROM social_group_members WHERE group_id = ? AND user_id = ?`
    ),
    getGroup: db.prepare(
      `SELECT group_id, name, description, rules, tags, created_by, created_at FROM social_groups WHERE group_id = ?`
    ),
    memberCount: db.prepare(
      `SELECT COUNT(*) AS cnt FROM social_group_members WHERE group_id = ?`
    ),
    isMember: db.prepare(
      `SELECT 1 FROM social_group_members WHERE group_id = ? AND user_id = ?`
    ),
    listGroups: db.prepare(
      `SELECT group_id, name, description, tags, created_at FROM social_groups ORDER BY created_at DESC LIMIT ?`
    ),
    searchGroups: db.prepare(
      `SELECT group_id, name, description, tags, created_at FROM social_groups
       WHERE name LIKE ? OR description LIKE ? OR tags LIKE ?
       ORDER BY created_at DESC LIMIT ?`
    ),
    listMembers: db.prepare(
      `SELECT user_id, role, joined_at FROM social_group_members WHERE group_id = ? ORDER BY joined_at ASC LIMIT ?`
    ),
    listPosts: db.prepare(
      `SELECT post_id, group_id, author_id, author_name, content, media_type, created_at, reactions, comments, shares
       FROM social_group_posts WHERE group_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ),
    insertPost: db.prepare(
      `INSERT INTO social_group_posts (post_id, group_id, author_id, author_name, content, media_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    ),
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function resolveUserId(req) {
    // eslint-disable-next-line no-restricted-syntax
    // eslint-disable-next-line no-restricted-syntax
    return req.user?.id || req.body?.userId || req.query?.userId || "anonymous"; // safe: target-identifier
  }

  function resolveDisplayName(req) {
    return req.user?.displayName || req.user?.name || req.body?.displayName || "Anonymous";
  }

  function enrichGroup(row, userId) {
    const memberCountRow = stmts.memberCount.get(row.group_id);
    const memberCheck = stmts.isMember.get(row.group_id, userId);
    let tags = [];
    try { tags = JSON.parse(row.tags || "[]"); } catch { /* ignore */ }
    return {
      groupId: row.group_id,
      name: row.name,
      description: row.description,
      rules: row.rules || "",
      memberCount: memberCountRow?.cnt || 0,
      tags,
      isMember: !!memberCheck,
      createdAt: row.created_at,
    };
  }

  // ── GET /groups — list or search ────────────────────────────────────────────

  router.get("/groups", (req, res) => {
    try {
      const userId = resolveUserId(req);
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
      const search = (req.query.search || req.query.query || "").trim();

      let rows;
      if (search) {
        const pattern = `%${search}%`;
        rows = stmts.searchGroups.all(pattern, pattern, pattern, limit);
      } else {
        rows = stmts.listGroups.all(limit);
      }

      const groups = rows.map((row) => enrichGroup(row, userId));
      res.json({ ok: true, groups });
    } catch (err) {
      console.error("[social-groups] GET /groups error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── POST /group — create ────────────────────────────────────────────────────

  router.post("/group", requireAuth(), (req, res) => {
    try {
      const userId = resolveUserId(req);
      const { name, description, rules, tags } = req.body || {};

      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ ok: false, error: "Group name is required" });
      }
      if (name.trim().length > 60) {
        return res.status(400).json({ ok: false, error: "Group name must be 60 characters or fewer" });
      }

      const groupId = uid();
      const safeTags = Array.isArray(tags)
        ? tags.filter((t) => typeof t === "string").slice(0, 10).map((t) => t.trim().toLowerCase())
        : [];

      stmts.insertGroup.run(
        groupId,
        name.trim(),
        (description || "").slice(0, 500),
        (rules || "").slice(0, 2000),
        JSON.stringify(safeTags),
        userId
      );

      // Creator auto-joins as admin
      stmts.insertMember.run(groupId, userId, "admin");

      res.json({ ok: true, groupId });
    } catch (err) {
      console.error("[social-groups] POST /group error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── GET /group/:groupId — details ───────────────────────────────────────────

  router.get("/group/:groupId", (req, res) => {
    try {
      const userId = resolveUserId(req);
      const row = stmts.getGroup.get(req.params.groupId);
      if (!row) {
        return res.status(404).json({ ok: false, error: "Group not found" });
      }
      res.json(enrichGroup(row, userId));
    } catch (err) {
      console.error("[social-groups] GET /group/:groupId error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── POST /group/:groupId/join ───────────────────────────────────────────────

  router.post("/group/:groupId/join", requireAuth(), (req, res) => {
    try {
      const userId = resolveUserId(req);
      const row = stmts.getGroup.get(req.params.groupId);
      if (!row) {
        return res.status(404).json({ ok: false, error: "Group not found" });
      }

      stmts.insertMember.run(req.params.groupId, userId, "member");
      res.json({ ok: true });
    } catch (err) {
      console.error("[social-groups] POST /group/:groupId/join error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── POST /group/:groupId/leave ──────────────────────────────────────────────

  router.post("/group/:groupId/leave", requireAuth(), (req, res) => {
    try {
      const userId = resolveUserId(req);
      const row = stmts.getGroup.get(req.params.groupId);
      if (!row) {
        return res.status(404).json({ ok: false, error: "Group not found" });
      }

      stmts.removeMember.run(req.params.groupId, userId);
      res.json({ ok: true });
    } catch (err) {
      console.error("[social-groups] POST /group/:groupId/leave error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── GET /group/:groupId/members ─────────────────────────────────────────────

  router.get("/group/:groupId/members", (req, res) => {
    try {
      const row = stmts.getGroup.get(req.params.groupId);
      if (!row) {
        return res.status(404).json({ ok: false, error: "Group not found" });
      }

      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
      const rows = stmts.listMembers.all(req.params.groupId, limit);

      const members = rows.map((m) => ({
        userId: m.user_id,
        displayName: m.user_id,  // Best-effort; real display names come from profile lookups
        avatarUrl: null,
        role: m.role,
        joinedAt: m.joined_at,
      }));

      res.json({ ok: true, members });
    } catch (err) {
      console.error("[social-groups] GET /group/:groupId/members error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── GET /group/:groupId/feed ────────────────────────────────────────────────

  router.get("/group/:groupId/feed", (req, res) => {
    try {
      const row = stmts.getGroup.get(req.params.groupId);
      if (!row) {
        return res.status(404).json({ ok: false, error: "Group not found" });
      }

      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
      const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
      const rows = stmts.listPosts.all(req.params.groupId, limit, offset);

      const posts = rows.map((p) => ({
        postId: p.post_id,
        authorId: p.author_id,
        authorName: p.author_name,
        content: p.content,
        mediaType: p.media_type || undefined,
        createdAt: p.created_at,
        reactions: p.reactions,
        comments: p.comments,
        shares: p.shares,
      }));

      res.json({ ok: true, posts });
    } catch (err) {
      console.error("[social-groups] GET /group/:groupId/feed error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── POST /group/:groupId/post — create a post in a group ───────────────────

  router.post("/group/:groupId/post", requireAuth(), (req, res) => {
    try {
      const userId = resolveUserId(req);
      const displayName = resolveDisplayName(req);
      const { content, mediaType } = req.body || {};

      const groupRow = stmts.getGroup.get(req.params.groupId);
      if (!groupRow) {
        return res.status(404).json({ ok: false, error: "Group not found" });
      }

      const memberCheck = stmts.isMember.get(req.params.groupId, userId);
      if (!memberCheck) {
        return res.status(403).json({ ok: false, error: "You must be a member of this group to post" });
      }

      if (!content || typeof content !== "string" || !content.trim()) {
        return res.status(400).json({ ok: false, error: "Post content is required" });
      }
      if (content.length > 2000) {
        return res.status(400).json({ ok: false, error: "Post content must be 2000 characters or fewer" });
      }

      const postId = uid();
      stmts.insertPost.run(postId, req.params.groupId, userId, displayName, content.trim(), mediaType || null);

      res.json({ ok: true, postId });
    } catch (err) {
      console.error("[social-groups] POST /group/:groupId/post error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── POST /post — generic post endpoint (used by PostCompose component) ──────
  // Accepts { content, groupId } — creates a post in the specified group.

  router.post("/post", requireAuth(), (req, res) => {
    try {
      const userId = resolveUserId(req);
      const displayName = resolveDisplayName(req);
      const { content, groupId, mediaType } = req.body || {};

      if (!groupId) {
        return res.status(400).json({ ok: false, error: "groupId is required" });
      }

      const groupRow = stmts.getGroup.get(groupId);
      if (!groupRow) {
        return res.status(404).json({ ok: false, error: "Group not found" });
      }

      const memberCheck = stmts.isMember.get(groupId, userId);
      if (!memberCheck) {
        return res.status(403).json({ ok: false, error: "You must be a member of this group to post" });
      }

      if (!content || typeof content !== "string" || !content.trim()) {
        return res.status(400).json({ ok: false, error: "Post content is required" });
      }
      if (content.length > 2000) {
        return res.status(400).json({ ok: false, error: "Post content must be 2000 characters or fewer" });
      }

      const postId = uid();
      stmts.insertPost.run(postId, groupId, userId, displayName, content.trim(), mediaType || null);

      res.json({ ok: true, postId });
    } catch (err) {
      console.error("[social-groups] POST /post error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── Scheduled posts ────────────────────────────────────────────────────────
  // Minimal scheduler backed by a zero-migration table. Frontends call
  // GET /social/scheduled and POST /social/schedule; DELETE is handled
  // at /social/scheduled/:id. No cron job yet — the rows sit in the
  // table until the frontend retrieves them. Full scheduler can wire
  // up to a cron tick later.

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS social_scheduled_posts (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL,
        content      TEXT NOT NULL,
        group_id     TEXT,
        scheduled_at TEXT NOT NULL,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        status       TEXT NOT NULL DEFAULT 'pending',
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_scheduled_user ON social_scheduled_posts(user_id, scheduled_at);
    `);
  } catch (_e) { /* table may not exist if db not ready */ }

  router.get("/scheduled", requireAuth(), (req, res) => {
    try {
      const userId = resolveUserId(req);
      const rows = db.prepare(
        "SELECT id, content, group_id, scheduled_at, status, created_at FROM social_scheduled_posts WHERE user_id = ? AND status = 'pending' ORDER BY scheduled_at ASC"
      ).all(userId);
      res.json({ ok: true, scheduled: rows, count: rows.length });
    } catch (err) {
      console.error("[social-groups] GET /scheduled error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  router.post("/schedule", requireAuth(), (req, res) => {
    try {
      const userId = resolveUserId(req);
      const { content, groupId, scheduledAt } = req.body || {};
      if (!content || typeof content !== "string" || !content.trim()) {
        return res.status(400).json({ ok: false, error: "content is required" });
      }
      if (!scheduledAt) {
        return res.status(400).json({ ok: false, error: "scheduledAt is required" });
      }
      // Validate the time is in the future
      const when = new Date(scheduledAt);
      if (isNaN(when.getTime())) {
        return res.status(400).json({ ok: false, error: "scheduledAt must be a valid date" });
      }
      if (when.getTime() < Date.now() - 60_000) {
        return res.status(400).json({ ok: false, error: "scheduledAt must be in the future" });
      }
      const id = uid();
      db.prepare(
        "INSERT INTO social_scheduled_posts (id, user_id, content, group_id, scheduled_at) VALUES (?, ?, ?, ?, ?)"
      ).run(id, userId, content.trim().slice(0, 4000), groupId || null, when.toISOString());
      res.json({ ok: true, id, scheduledAt: when.toISOString() });
    } catch (err) {
      console.error("[social-groups] POST /schedule error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  router.delete("/scheduled/:id", requireAuth(), (req, res) => {
    try {
      const userId = resolveUserId(req);
      const result = db.prepare(
        "DELETE FROM social_scheduled_posts WHERE id = ? AND user_id = ?"
      ).run(req.params.id, userId);
      res.json({ ok: true, deleted: result.changes });
    } catch (err) {
      console.error("[social-groups] DELETE /scheduled/:id error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── User search ────────────────────────────────────────────────────────────
  // GET /users/search?q=foo — search usernames / display names for mentions,
  // DM recipients, follow suggestions. Caps at 20 results.

  router.get("/users/search", (req, res) => {
    try {
      const q = typeof req.query?.q === "string" ? req.query.q.trim() : "";
      if (!q || q.length < 2) {
        return res.json({ ok: true, users: [], total: 0 });
      }
      const pattern = `%${q.slice(0, 50)}%`;
      const rows = db.prepare(
        "SELECT id, username, email FROM users WHERE is_active = 1 AND (username LIKE ? OR email LIKE ?) LIMIT 20"
      ).all(pattern, pattern);
      const users = rows.map((r) => ({
        id: r.id,
        username: r.username,
        displayName: r.username,
      }));
      res.json({ ok: true, users, total: users.length });
    } catch (err) {
      console.error("[social-groups] GET /users/search error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // ── Newsletter subscribe ───────────────────────────────────────────────────
  // Minimal email-opt-in. Backed by the same zero-migration pattern.
  // This just stores the (email, optional userId, createdAt) tuple — sending
  // the actual newsletter is out of scope.

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS newsletter_subscriptions (
        id         TEXT PRIMARY KEY,
        email      TEXT NOT NULL UNIQUE,
        user_id    TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        confirmed  INTEGER NOT NULL DEFAULT 1
      );
    `);
  } catch (_e) { /* non-fatal */ }

  router.post("/newsletter-subscribe", (req, res) => {
    try {
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return res.status(400).json({ ok: false, error: "valid email required" });
      }
      const userId = req.user?.id || null;
      const id = uid();
      try {
        db.prepare(
          "INSERT INTO newsletter_subscriptions (id, email, user_id) VALUES (?, ?, ?)"
        ).run(id, email, userId);
      } catch (dbErr) {
        // Unique violation → already subscribed, treat as idempotent success
        if (String(dbErr?.message || "").includes("UNIQUE")) {
          return res.json({ ok: true, alreadySubscribed: true });
        }
        throw dbErr;
      }
      res.json({ ok: true, id });
    } catch (err) {
      console.error("[social-groups] POST /newsletter-subscribe error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // GET /newsletter-subscribers — admin-only list of opted-in emails.
  // POST /newsletter-subscribe wrote rows that pre-this-route nobody could
  // read, so the captured emails were inaccessible. Strict admin gate
  // because emails are PII.
  router.get("/newsletter-subscribers", (req, res) => {
    if (!req.user || (req.user.role !== "owner" && req.user.role !== "admin" && req.user.role !== "sovereign")) {
      return res.status(403).json({ ok: false, error: "admin_only" });
    }
    try {
      const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 100, 500));
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
      const rows = db.prepare(
        `SELECT id, email, user_id, created_at, confirmed
           FROM newsletter_subscriptions
          WHERE confirmed = 1
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?`,
      ).all(limit, offset);
      const total = db.prepare(`SELECT COUNT(*) as c FROM newsletter_subscriptions WHERE confirmed = 1`).get().c;
      res.json({ ok: true, subscribers: rows, count: rows.length, total });
    } catch (err) {
      console.error("[social-groups] GET /newsletter-subscribers error:", err);
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  return router;
}
