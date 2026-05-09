// server/lib/personal-locker/user-context.js
// Per-user context model: tracks focus, working projects, recent references.
// Stored as an encrypted personal DTU with content_type = "user_context".

import crypto from "node:crypto";
import { encryptBlob, decryptBlob, SAFE_REVIVER } from "./crypto.js";

const CONTEXT_CONTENT_TYPE = "user_context";

const EMPTY_CONTEXT = () => ({
  currentFocus: { domains: [], intensity: {} },
  workingProjects: [],
  recentReferences: [],
  updatedAt: new Date().toISOString(),
});

/**
 * Load user context from the personal_dtus table (decrypted).
 * Returns EMPTY_CONTEXT if none exists or locker is locked.
 */
export function loadUserContext(userId, lockerKey, db) {
  if (!userId || !lockerKey || !db) return EMPTY_CONTEXT();
  try {
    const row = db.prepare(
      "SELECT * FROM personal_dtus WHERE user_id = ? AND content_type = ? ORDER BY created_at DESC LIMIT 1"
    ).get(userId, CONTEXT_CONTENT_TYPE);
    if (!row) return EMPTY_CONTEXT();
    const plain = decryptBlob({ iv: row.iv, ciphertext: row.encrypted_content, authTag: row.auth_tag }, lockerKey);
    return JSON.parse(plain.toString("utf-8"), SAFE_REVIVER);
  } catch { return EMPTY_CONTEXT(); }
}

/**
 * Save user context (upserts the single user_context row).
 */
export function saveUserContext(userId, model, lockerKey, db) {
  if (!userId || !lockerKey || !db) return;
  try {
    const plain = Buffer.from(JSON.stringify({ ...model, updatedAt: new Date().toISOString() }));
    const { iv, ciphertext, authTag } = encryptBlob(plain, lockerKey);

    // Delete existing context row, then insert fresh one
    db.prepare("DELETE FROM personal_dtus WHERE user_id = ? AND content_type = ?").run(userId, CONTEXT_CONTENT_TYPE);
    const id = `ctx_${crypto.randomBytes(10).toString("hex")}`;
    db.prepare(
      "INSERT INTO personal_dtus (id, user_id, lens_domain, content_type, title, encrypted_content, iv, auth_tag) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, userId, "context", CONTEXT_CONTENT_TYPE, "User Context Model", ciphertext, iv, authTag);
  } catch { /* non-fatal */ }
}

/**
 * Update context model when a new personal DTU is uploaded.
 */
export function updateContextOnUpload(userId, newDTU, lockerKey, db) {
  const ctx = loadUserContext(userId, lockerKey, db);

  // Update domain focus
  const domain = newDTU.lensHint || newDTU.lens_domain;
  if (domain) {
    if (!ctx.currentFocus.domains.includes(domain)) ctx.currentFocus.domains.unshift(domain);
    ctx.currentFocus.domains = ctx.currentFocus.domains.slice(0, 10);
    ctx.currentFocus.intensity[domain] = (ctx.currentFocus.intensity[domain] || 0) + 1;
  }

  // Add to recent references
  ctx.recentReferences.unshift({
    id: newDTU.id,
    title: newDTU.title,
    contentType: newDTU.contentType,
    domain,
    uploadedAt: newDTU.createdAt || new Date().toISOString(),
  });
  ctx.recentReferences = ctx.recentReferences.slice(0, 50);

  saveUserContext(userId, ctx, lockerKey, db);
}

/**
 * Re-encrypt context model with a new locker key (called on password change).
 */
export function reEncryptUserContext(userId, oldKey, newKey, db) {
  if (!oldKey || !newKey || !db) return;
  try {
    const rows = db.prepare(
      "SELECT * FROM personal_dtus WHERE user_id = ? AND content_type = ?"
    ).all(userId, CONTEXT_CONTENT_TYPE);
    for (const row of rows) {
      const plain = decryptBlob({ iv: row.iv, ciphertext: row.encrypted_content, authTag: row.auth_tag }, oldKey);
      const { iv, ciphertext, authTag } = encryptBlob(plain, newKey);
      db.prepare("UPDATE personal_dtus SET encrypted_content = ?, iv = ?, auth_tag = ? WHERE id = ?")
        .run(ciphertext, iv, authTag, row.id);
    }
  } catch { /* non-fatal */ }
}
