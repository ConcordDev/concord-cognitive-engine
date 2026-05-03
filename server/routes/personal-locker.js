// server/routes/personal-locker.js
// Personal DTU Locker routes — all require authentication.
// Uploads are analyzed via LLaVA/Whisper, then AES-256-GCM encrypted with the
// user's session-derived locker key before storage.

import express from "express";
import crypto from "node:crypto";
import { encryptBlob, decryptBlob, SAFE_REVIVER } from "../lib/personal-locker/crypto.js";
import { analyzeContent, buildPersonalDTUPayload, classifyMime } from "../lib/personal-locker/pipeline.js";
import { loadUserContext, saveUserContext, updateContextOnUpload } from "../lib/personal-locker/user-context.js";
import { assertSovereignty } from "../grc/sovereignty-invariants.js";
import { createDTU } from "../economy/dtu-pipeline.js";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

export default function createPersonalLockerRouter({ db, getLockerKey, requireAuth }) {
  const router = express.Router();

  // All locker routes require authentication
  router.use(requireAuth());

  // ── Helper ────────────────────────────────────────────────────────────────

  function checkLockerKey(req, res) {
    const key = getLockerKey(req.user.id);
    if (!key) {
      res.status(403).json({ ok: false, error: "locker_locked", message: "Re-login to unlock your personal locker." });
      return null;
    }
    return key;
  }

  // ── POST /api/personal-locker/upload ──────────────────────────────────────
  // Body (JSON): { data: "<base64>", mimeType, originalname, title?, context? }

  router.post("/upload", async (req, res) => {
    try {
      const key = checkLockerKey(req, res);
      if (!key) return;

      const { data, mimeType, originalname, title, context } = req.body || {};
      if (!data || !mimeType) {
        return res.status(400).json({ ok: false, error: "data (base64) and mimeType required" });
      }

      if (typeof data !== "string" || data.length > MAX_UPLOAD_BYTES * 1.4) {
        return res.status(413).json({ ok: false, error: "Payload too large" });
      }

      const buffer = Buffer.from(data, "base64");
      if (buffer.length > MAX_UPLOAD_BYTES) {
        return res.status(413).json({ ok: false, error: "File too large (max 100 MB)" });
      }

      const file = { buffer, mimeType, originalname: originalname || "upload", title, size: buffer.length };
      const analysis = await analyzeContent(buffer, mimeType);
      const payload = buildPersonalDTUPayload(req.user.id, file, analysis);
      if (context) payload.userContext = context;

      const plaintext = Buffer.from(JSON.stringify(payload));
      const { iv, ciphertext, authTag } = encryptBlob(plaintext, key);

      const id = `pdtu_${crypto.randomBytes(10).toString("hex")}`;
      db.prepare(`
        INSERT INTO personal_dtus (id, user_id, lens_domain, content_type, title, encrypted_content, iv, auth_tag)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, req.user.id, analysis.lensHint, classifyMime(mimeType), payload.title, ciphertext, iv, authTag);

      // Update user context model in background
      updateContextOnUpload(req.user.id, { id, lensHint: analysis.lensHint, title: payload.title, contentType: classifyMime(mimeType), createdAt: payload.createdAt }, key, db);

      return res.json({
        ok: true,
        dtu: { id, lensHint: analysis.lensHint, contentType: classifyMime(mimeType), title: payload.title, createdAt: payload.createdAt },
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err?.message || "Upload failed" });
    }
  });

  // ── GET /api/personal-locker/dtus ─────────────────────────────────────────
  // Returns metadata only (no encrypted content). Optional ?lens= filter.

  router.get("/dtus", (req, res) => {
    try {
      const { lens, avatarId } = req.query;
      // Multi-avatar (Workstream 6a): when an avatarId is supplied, return
      // only rows that match it OR are unscoped (avatar_id IS NULL —
      // legacy rows belong to the user's primary avatar). Without an
      // avatarId we return everything for backwards compatibility with
      // single-avatar callers.
      const wantsAvatar = typeof avatarId === "string" && avatarId.length > 0;
      let sql = "SELECT id, user_id, created_at, lens_domain, content_type, title";
      // The avatar_id column was added in migration 093 — use a try block
      // so if migrations haven't applied the SELECT still succeeds.
      let hasAvatarCol = false;
      try {
        const cols = db.prepare("PRAGMA table_info(personal_dtus)").all().map((r) => r.name);
        hasAvatarCol = cols.includes("avatar_id");
      } catch { /* fallback below */ }
      if (hasAvatarCol) sql += ", avatar_id";
      sql += " FROM personal_dtus WHERE user_id = ?";
      const params = [req.user.id];
      if (lens) { sql += " AND lens_domain = ?"; params.push(lens); }
      if (wantsAvatar && hasAvatarCol) {
        sql += " AND (avatar_id IS NULL OR avatar_id = ?)";
        params.push(avatarId);
      }
      sql += " ORDER BY created_at DESC";
      const rows = db.prepare(sql).all(...params);
      return res.json({ ok: true, dtus: rows });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // ── GET /api/personal-locker/dtus/:id ────────────────────────────────────

  router.get("/dtus/:id", (req, res) => {
    try {
      const key = checkLockerKey(req, res);
      if (!key) return;

      const row = db.prepare("SELECT * FROM personal_dtus WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
      if (!row) return res.status(404).json({ ok: false, error: "Not found" });

      assertSovereignty({ type: "dtu_read", dtu: { scope: "personal", ownerId: row.user_id }, requestingUser: req.user.id });

      const plaintext = decryptBlob({ iv: row.iv, ciphertext: row.encrypted_content, authTag: row.auth_tag }, key);
      const payload = JSON.parse(plaintext.toString("utf-8"), SAFE_REVIVER);

      return res.json({ ok: true, dtu: { ...payload, id: row.id, lensHint: row.lens_domain, createdAt: row.created_at } });
    } catch (err) {
      if (err?.message?.includes("SOVEREIGNTY")) return res.status(403).json({ ok: false, error: "Access denied" });
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // ── DELETE /api/personal-locker/dtus/:id ─────────────────────────────────

  router.delete("/dtus/:id", (req, res) => {
    try {
      const row = db.prepare("SELECT user_id FROM personal_dtus WHERE id = ?").get(req.params.id);
      if (!row) return res.status(404).json({ ok: false, error: "Not found" });
      if (row.user_id !== req.user.id) return res.status(403).json({ ok: false, error: "Access denied" });

      db.prepare("DELETE FROM personal_dtus WHERE id = ?").run(req.params.id);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // ── PUT /api/personal-locker/dtus/:id/publish ─────────────────────────────
  // Promote personal DTU to public substrate via createDTU().

  router.put("/dtus/:id/publish", async (req, res) => {
    try {
      const key = checkLockerKey(req, res);
      if (!key) return;

      const row = db.prepare("SELECT * FROM personal_dtus WHERE id = ? AND user_id = ?").get(req.params.id, req.user.id);
      if (!row) return res.status(404).json({ ok: false, error: "Not found" });

      assertSovereignty({ type: "dtu_read", dtu: { scope: "personal", ownerId: row.user_id }, requestingUser: req.user.id });

      const plaintext = decryptBlob({ iv: row.iv, ciphertext: row.encrypted_content, authTag: row.auth_tag }, key);
      const payload = JSON.parse(plaintext.toString("utf-8"), SAFE_REVIVER);

      const publicDTU = createDTU(db, {
        creatorId: req.user.id,
        title: payload.title || "Personal DTU",
        content: payload.analysis?.summary || "",
        contentType: row.content_type,
        tags: payload.analysis?.tags || [],
        tier: "REGULAR",
      });

      if (req.body.deletePersonal) {
        db.prepare("DELETE FROM personal_dtus WHERE id = ?").run(req.params.id);
      }

      return res.json({ ok: true, publicDTU });
    } catch (err) {
      if (err?.message?.includes("SOVEREIGNTY")) return res.status(403).json({ ok: false, error: "Access denied" });
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  // ── POST /api/personal-locker/dtus/:id/list-on-marketplace ──────────────
  // v2.0: promote a personal recipe DTU (fighting_style_recipe / spell_recipe /
  // blueprint) to the creative marketplace with tier pricing. Composes the
  // existing `personal_dtus_never_leak` sovereignty check + publishArtifact()
  // — no parallel royalty logic.
  //
  // Body: { type, price?, tierPrices?, description? }.
  //   `type` should be one of the recipe artifact types in ARTIFACT_TYPES
  //   (fighting_style_recipe, spell_recipe, blueprint). The route auto-detects
  //   from the DTU's meta.type if not provided.
  router.post("/dtus/:id/list-on-marketplace", async (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });

      // Recipe DTUs live in the main `dtus` table (created via /api/dtus,
      // scope='personal'/visibility='private' by default). Read with strict
      // ownership check.
      const row = db.prepare("SELECT * FROM dtus WHERE id = ? AND owner_user_id = ?")
        .get(req.params.id, userId);
      if (!row) return res.status(404).json({ ok: false, error: "not_found_or_not_owned" });

      // assertSovereignty enforces: a personal DTU cannot be read by anyone
      // but the owner. Reusing the existing invariant rather than reimplementing.
      assertSovereignty({
        type: "dtu_read",
        dtu: { scope: "personal", ownerId: row.owner_user_id },
        requestingUser: userId,
      });

      let body = {};
      try { body = JSON.parse(row.body_json || "{}"); } catch { /* malformed body, treat as empty */ }
      const metaType = body?.meta?.type || req.body?.type;
      const RECIPE_TYPES = new Set(["fighting_style_recipe", "spell_recipe", "blueprint"]);
      if (!RECIPE_TYPES.has(metaType)) {
        return res.status(400).json({ ok: false, error: "not_a_recipe_dtu", got: metaType });
      }

      const { price, tierPrices, description } = req.body || {};
      if (!price && !tierPrices) {
        return res.status(400).json({ ok: false, error: "price_or_tierPrices_required" });
      }

      // Synthesize the file fields for a virtual artifact: the recipe data
      // is the artifact. The dtu:// path lets the rest of the marketplace
      // pipeline (citations, royalty cascade, transactions) treat it
      // identically to a file artifact.
      const serialized = JSON.stringify(body);
      const fileSize = Buffer.byteLength(serialized, "utf-8");
      const fileHash = crypto.createHash("sha256").update(serialized).digest("hex");
      const filePath = `dtu://${row.id}`;

      const { publishArtifact } = await import("../economy/creative-marketplace.js");
      const result = publishArtifact(db, {
        creatorId: userId,
        type: metaType,
        title: row.title || "Untitled Recipe",
        description: description || "",
        filePath, fileSize, fileHash,
        price: price || 0,
        tierPrices,
      });

      if (!result.ok) return res.status(400).json(result);

      // Update the DTU's visibility so other surfaces (creator dashboard,
      // marketplace listings) reflect that it's been published. The DTU
      // itself stays scope='personal' by ownership — buyers receive a
      // license, not the DTU row.
      db.prepare("UPDATE dtus SET visibility = 'marketplace', updated_at = datetime('now') WHERE id = ?")
        .run(row.id);

      return res.json({ ok: true, listing: result });
    } catch (err) {
      if (err?.message?.includes("SOVEREIGNTY")) return res.status(403).json({ ok: false, error: "access_denied" });
      return res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // ── GET /api/personal-locker/context ─────────────────────────────────────

  router.get("/context", (req, res) => {
    const key = checkLockerKey(req, res);
    if (!key) return;
    const ctx = loadUserContext(req.user.id, key, db);
    return res.json({ ok: true, context: ctx });
  });

  // ── PUT /api/personal-locker/context/focus ────────────────────────────────

  router.put("/context/focus", (req, res) => {
    const key = checkLockerKey(req, res);
    if (!key) return;
    const { domains, intensity } = req.body || {};
    const ctx = loadUserContext(req.user.id, key, db);
    if (Array.isArray(domains)) ctx.currentFocus.domains = domains.slice(0, 10);
    if (intensity && typeof intensity === "object" && !Array.isArray(intensity)) {
      const safe = Object.create(null);
      for (const [k, v] of Object.entries(intensity)) {
        if (typeof k === "string" && k.length < 64 && typeof v === "number") safe[k] = v;
      }
      ctx.currentFocus.intensity = safe;
    }
    saveUserContext(req.user.id, ctx, key, db);
    return res.json({ ok: true, context: ctx });
  });

  // ── DELETE /api/personal-locker/context ───────────────────────────────────

  router.delete("/context", (req, res) => {
    try {
      db.prepare("DELETE FROM personal_dtus WHERE user_id = ? AND content_type = 'user_context'").run(req.user.id);
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err?.message });
    }
  });

  return router;
}
