// server/lib/verify-admins.js
//
// Sanctioned, in-process way to give a dedicated verification account the
// `admin` role (founder ruling GB-0310). There was no route or CLI that changes
// users.role, so admin-only live checks could not be run by the verify lane.
//
// Two entry points, both narrow by construction:
//   applyVerifyAdmins()   — boot-time: for each entry of the committed allowlist
//                           (server/config/verify-admins.json) whose username AND
//                           user id BOTH match an existing user, set role="admin"
//                           (and is_test_account=1 where the column exists).
//   setUserRole()/route   — owner/founder-only POST /api/admin/users/:id/role to
//                           grant or revoke without a deploy.
//
// Hard limits: the only role this ever writes is "admin" (or "member" when the
// route demotes); an allowlist entry with any other role is rejected; owner /
// founder / sovereign accounts are never touched or downgraded; it never creates
// users and never touches passwords or scopes. Usernames and ids are not secrets.
//
// Removing an allowlist entry does NOT demote anyone: boot only ever grants.
// Demote with POST /api/admin/users/<id>/role {"role":"member"}.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const VERIFY_ADMINS_PATH = path.join(here, "..", "config", "verify-admins.json");

const PROTECTED_ROLES = new Set(["owner", "founder", "sovereign"]);
const ASSIGNABLE_ROLES = new Set(["admin", "member"]);

export function loadVerifyAdminEntries(file = VERIFY_ADMINS_PATH) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Validate one allowlist entry. Returns { ok:true, entry } or { ok:false, reason }. */
export function validateEntry(e) {
  if (!e || typeof e !== "object") return { ok: false, reason: "not_an_object" };
  const username = typeof e.username === "string" ? e.username.trim() : "";
  const userId = typeof e.userId === "string" ? e.userId.trim() : "";
  if (!username || !userId) return { ok: false, reason: "username_and_userId_required" };
  if (e.role !== "admin") return { ok: false, reason: "role_must_be_admin" };
  return { ok: true, entry: { username, userId, role: "admin" } };
}

function hasColumn(db, col) {
  try { return db.prepare("PRAGMA table_info(users)").all().some((c) => c.name === col); } catch { return false; }
}

/**
 * Apply the allowlist. Idempotent; logs only when something changed.
 * @returns {{granted:string[], unchanged:string[], skipped:{username:string,reason:string}[]}}
 */
export function applyVerifyAdmins({ db, entries = loadVerifyAdminEntries(), log = () => {} } = {}) {
  const out = { granted: [], unchanged: [], skipped: [] };
  if (!db) return out;
  const testFlag = hasColumn(db, "is_test_account");
  const find = db.prepare("SELECT id, username, role" + (testFlag ? ", is_test_account" : "") + " FROM users WHERE username = ?");
  const setRole = db.prepare("UPDATE users SET role = 'admin' WHERE id = ? AND username = ?");
  const setFlag = testFlag ? db.prepare("UPDATE users SET is_test_account = 1 WHERE id = ? AND username = ?") : null;

  for (const raw of entries) {
    const v = validateEntry(raw);
    const label = String(raw?.username ?? "?");
    if (!v.ok) { out.skipped.push({ username: label, reason: v.reason }); log("warn", "verify_admin_skipped", { username: label, reason: v.reason }); continue; }
    const { username, userId } = v.entry;
    const row = find.get(username);
    if (!row) { out.skipped.push({ username, reason: "unknown_user" }); log("info", "verify_admin_skipped", { username, reason: "unknown_user" }); continue; }
    if (row.id !== userId) { out.skipped.push({ username, reason: "id_mismatch" }); log("warn", "verify_admin_skipped", { username, reason: "id_mismatch" }); continue; }
    if (PROTECTED_ROLES.has(row.role)) { out.unchanged.push(username); continue; } // never touch or downgrade
    let changed = false;
    if (row.role !== "admin") { changed = setRole.run(userId, username).changes > 0 || changed; }
    if (testFlag && Number(row.is_test_account) !== 1) { changed = setFlag.run(userId, username).changes > 0 || changed; }
    if (changed) { out.granted.push(username); log("info", "verify_admin_granted", { username }); }
    else out.unchanged.push(username);
  }
  return out;
}

/**
 * Grant/revoke a role (admin|member). Protected accounts are refused. When promoting
 * an account that is on the verify allowlist (username AND id match) the test flag
 * is set too, mirroring the boot grant.
 */
export function setUserRole({ db, userId, role, entries = loadVerifyAdminEntries() }) {
  if (!db) return { ok: false, status: 503, error: "db_unavailable" };
  if (typeof role !== "string" || !ASSIGNABLE_ROLES.has(role)) {
    return { ok: false, status: 400, error: "role_must_be_admin_or_member" };
  }
  const id = typeof userId === "string" ? userId.trim() : "";
  if (!id) return { ok: false, status: 400, error: "user_id_required" };
  const row = db.prepare("SELECT id, username, role FROM users WHERE id = ?").get(id);
  if (!row) return { ok: false, status: 404, error: "user_not_found" };
  if (PROTECTED_ROLES.has(row.role)) return { ok: false, status: 403, error: "protected_account" };
  const from = row.role;
  if (from !== role) db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
  let testFlagSet = false;
  if (role === "admin" && hasColumn(db, "is_test_account")) {
    const listed = entries.some((e) => { const v = validateEntry(e); return v.ok && v.entry.userId === id && v.entry.username === row.username; });
    if (listed) { db.prepare("UPDATE users SET is_test_account = 1 WHERE id = ?").run(id); testFlagSet = true; }
  }
  return { ok: true, status: 200, userId: id, username: row.username, from, to: role, changed: from !== role, testFlagSet };
}

/**
 * POST /api/admin/users/:id/role  — behind requireRole("owner","founder") (sovereign passes
 * inside requireRole). Audit-logged (actor, target, from -> to). `bustUserCache` makes the
 * change effective on the next request instead of after the 5 s user-cache TTL.
 */
export function mountUserRoleRoute(app, { requireRole, getDb, bustUserCache = () => {}, log = () => {} }) {
  app.post("/api/admin/users/:id/role", requireRole("owner", "founder"), (req, res) => {
    try {
      const r = setUserRole({ db: getDb(), userId: req.params.id, role: req.body?.role });
      if (!r.ok) return res.status(r.status).json({ ok: false, error: r.error });
      bustUserCache(r.userId);
      log("info", "user_role_changed", { actor: req.user?.id || null, actorRole: req.user?.role || null, target: r.userId, username: r.username, from: r.from, to: r.to, changed: r.changed });
      return res.json({ ok: true, userId: r.userId, username: r.username, role: r.to, changed: r.changed, testFlagSet: r.testFlagSet });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
