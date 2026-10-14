// INC-SWEEP lab F5 — lab.list_mine / recent_mine surface caller DTUs (type
// filter no longer drops knowledge rows). Restart pin via DTU row + list.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { load } from "./depth/_harness.js";

describe("lab F5 list_mine / recent_mine", () => {
  let runMacro, STATE, makeInternalCtx;

  before(async () => {
    const t = await load();
    ({ runMacro, STATE, makeInternalCtx } = t);
  });

  function ctxFor(userId) {
    const ctx = makeInternalCtx(userId);
    ctx.actor = { userId, role: "member", scope: "local", scopes: ["*"] };
    ctx.userId = userId;
    ctx.internal = false;
    return ctx;
  }

  function ensureUser(db, userId) {
    try {
      db.prepare(
        "INSERT OR IGNORE INTO users (id, username, email, password_hash, role, created_at) VALUES (?,?,?,?,?,datetime('now'))",
      ).run(userId, userId, `${userId}@test.local`, "x", "member");
    } catch {
      try {
        db.prepare("INSERT OR IGNORE INTO users (id, username) VALUES (?, ?)").run(userId, userId);
      } catch { /* best-effort */ }
    }
  }

  it("includes a knowledge-type lab notebook DTU (type filter no longer drops it)", async () => {
    const userId = "u-lab-f5-" + Date.now().toString(36);
    const ctx = ctxFor(userId);
    const db = ctx.db || STATE.db;
    assert.ok(db, "test db required");
    ensureUser(db, userId);
    const dtuId = "dtu_lab_f5_" + Date.now().toString(36);
    db.prepare(`
      INSERT INTO dtus (id, owner_user_id, creator_id, title, body_json, tags_json, visibility, tier, type, created_at, updated_at)
      VALUES (?, ?, ?, ?, '{}', ?, 'private', 'regular', ?, datetime('now'), datetime('now'))
    `).run(
      dtuId,
      userId,
      userId,
      "Lab notebook lab-f5 alpha",
      JSON.stringify(["lab", "lab-notebook", "lab-f5"]),
      "knowledge",
    );

    for (const name of ["list_mine", "recent_mine"]) {
      const listed = await runMacro("lab", name, { limit: 50 }, ctx);
      assert.equal(listed.ok, true, `${name}: ${JSON.stringify(listed)}`);
      const items = listed.items || listed.rows || [];
      assert.ok(
        items.some((x) => x.id === dtuId),
        `${name} missing ${dtuId}; total=${listed.total} items=${JSON.stringify(items.slice(0, 5))}`,
      );
      assert.ok(listed.total >= 1, name);
    }

    // Fresh query (restart-shaped read): same row still listed for the caller.
    const again = await runMacro("lab", "list_mine", { limit: 50 }, ctxFor(userId));
    assert.ok((again.items || []).some((x) => x.id === dtuId));
  });
});
