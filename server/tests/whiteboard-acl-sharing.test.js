/**
 * Whiteboard S14 follow-up — boards adopt the platform ACL (PR #1714).
 *
 * Drives the REAL whiteboard domain against the REAL artifact-acl
 * manager (server/lib/artifact-acl.js) over an in-memory SQLite db.
 * Pins the F14 done-state on whiteboard's own paths:
 *  - a stranger can neither read nor write someone else's board, and
 *    a refused save never becomes a silent same-id copy;
 *  - a view grantee can load but cannot save or comment (view-only
 *    refusals state the reason);
 *  - an edit grantee loads and saves the OWNER's board (no fork);
 *  - only the owner can grant or revoke; self-grants and bad levels
 *    are refused with sentences;
 *  - revoke ends access on both verbs immediately;
 *  - the access list and "shared with me" carry usernames + levels;
 *  - owner behaviour is unchanged.
 *
 * Run: node --test server/tests/whiteboard-acl-sharing.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";

let db;
try {
  const { default: Database } = await import("better-sqlite3");
  db = new Database(":memory:");
} catch {
  const { DatabaseSync } = await import("node:sqlite");
  db = new DatabaseSync(":memory:");
}
db.exec("CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, is_active INTEGER DEFAULT 1)");
const insUser = db.prepare("INSERT INTO users (id, username) VALUES (?, ?)");
insUser.run("u-owner", "olga");
insUser.run("u-editor", "eddie");
insUser.run("u-viewer", "vera");
insUser.run("u-stranger", "sam");

const { initArtifactAclTable } = await import("../lib/artifact-acl.js");
assert.equal(initArtifactAclTable(db), true);

globalThis._concordSTATE = {};
globalThis.STATE = globalThis._concordSTATE;
globalThis._concordDB = db;

const { default: registerWhiteboardActions } = await import("../domains/whiteboard.js");
const actions = new Map();
registerWhiteboardActions((domain, name, fn) => actions.set(name, fn));
const ctxFor = (userId) => ({ actor: { userId }, userId, db });
const call = (userId, name, params = {}) => actions.get(name)(ctxFor(userId), { data: params }, params);

const OWNER = "u-owner", EDITOR = "u-editor", VIEWER = "u-viewer", STRANGER = "u-stranger";
const scene = (label) => ({ elements: [{ id: "e1", type: "notecard", x: 0, y: 0, width: 100, height: 60, text: label }], appState: {} });

let boardId;
test("setup: the owner saves a board; owner paths behave as before", async () => {
  const saved = await call(OWNER, "board-save", { title: "Roadmap", scene: scene("v1") });
  assert.equal(saved.ok, true);
  boardId = saved.result.board.id;
  const loaded = await call(OWNER, "board-load", { id: boardId });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.result.access, undefined);
});

test("a stranger can neither read nor write the board, and no copy appears", async () => {
  assert.equal((await call(STRANGER, "board-load", { id: boardId })).error, "not found");
  assert.equal((await call(STRANGER, "board-save", { id: boardId, title: "Hijack", scene: scene("x") })).error, "not found");
  const mine = await call(STRANGER, "board-list", {});
  assert.equal(mine.result.boards.some((b) => b.id === boardId), false);
  assert.equal((await call(STRANGER, "board-access", { boardId })).ok, false);
});

test("non-owners cannot grant or revoke; self-grant and bad levels are refused with sentences", async () => {
  const g = await call(EDITOR, "board-grant", { boardId, granteeId: STRANGER, level: "view" });
  assert.match(g.error, /Only the board's owner/);
  const self = await call(OWNER, "board-grant", { boardId, granteeId: OWNER, level: "view" });
  assert.match(self.error, /already own/);
  const bad = await call(OWNER, "board-grant", { boardId, granteeId: VIEWER, level: "admin" });
  assert.match(bad.error, /'view' or 'edit'/);
});

test("view grant: loads with the level attached, cannot save or comment", async () => {
  const g = await call(OWNER, "board-grant", { boardId, granteeId: VIEWER, level: "view" });
  assert.equal(g.ok, true);
  assert.equal(g.result.grant.username, "vera");
  const loaded = await call(VIEWER, "board-load", { id: boardId });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.result.access.level, "view");
  assert.equal(loaded.result.access.ownerId, OWNER);
  const save = await call(VIEWER, "board-save", { id: boardId, title: "Vera edit", scene: scene("v2") });
  assert.match(save.error, /view-only/);
  const comment = await call(VIEWER, "comments-add", { boardId, elementId: "e1", body: "hi" });
  assert.match(comment.error, /view-only/);
  const ops = await call(VIEWER, "ops-apply", { boardId, ops: [{ type: "delete", elementId: "e1" }] });
  assert.match(ops.error, /view-only/);
  // …but reading comments is exactly what view is for:
  assert.equal((await call(VIEWER, "comments-list", { boardId })).ok, true);
});

test("edit grant: saves write the owner's board; the editor gains no copy", async () => {
  await call(OWNER, "board-grant", { boardId, granteeId: EDITOR, level: "edit" });
  const saved = await call(EDITOR, "board-save", { id: boardId, title: "Roadmap v2", scene: scene("v2") });
  assert.equal(saved.ok, true);
  assert.equal(saved.result.access.ownerId, OWNER);
  const ownersCopy = await call(OWNER, "board-load", { id: boardId });
  assert.equal(ownersCopy.result.board.title, "Roadmap v2");
  const editorsBoards = await call(EDITOR, "board-list", {});
  assert.equal(editorsBoards.result.boards.some((b) => b.id === boardId), false);
  const comment = await call(EDITOR, "comments-add", { boardId, elementId: "e1", body: "editor note" });
  assert.equal(comment.ok, true);
});

test("access list and shared-with-me carry names and levels", async () => {
  const access = await call(OWNER, "board-access", { boardId });
  assert.equal(access.result.level, "owner");
  const byGrantee = Object.fromEntries(access.result.grants.map((g) => [g.granteeId, g]));
  assert.equal(byGrantee[VIEWER].username, "vera");
  assert.equal(byGrantee[VIEWER].level, "view");
  assert.equal(byGrantee[EDITOR].level, "edit");
  const shared = await call(EDITOR, "board-shared-with-me", {});
  const entry = shared.result.boards.find((b) => b.id === boardId);
  assert.equal(entry.level, "edit");
  assert.equal(entry.ownerName, "olga");
  assert.equal(entry.title, "Roadmap v2");
});

test("re-grant upgrades a level in place", async () => {
  const g = await call(OWNER, "board-grant", { boardId, granteeId: VIEWER, level: "edit" });
  assert.equal(g.result.updated, true);
  const loaded = await call(VIEWER, "board-load", { id: boardId });
  assert.equal(loaded.result.access.level, "edit");
});

test("revoke ends access on both verbs immediately", async () => {
  const r = await call(OWNER, "board-revoke", { boardId, granteeId: VIEWER });
  assert.equal(r.ok, true);
  assert.equal((await call(VIEWER, "board-load", { id: boardId })).error, "not found");
  assert.equal((await call(VIEWER, "board-save", { id: boardId, title: "back", scene: scene("v3") })).error, "not found");
  const again = await call(OWNER, "board-revoke", { boardId, granteeId: VIEWER });
  assert.match(again.error, /no access to revoke/);
  const shared = await call(VIEWER, "board-shared-with-me", {});
  assert.equal(shared.result.boards.some((b) => b.id === boardId), false);
});
