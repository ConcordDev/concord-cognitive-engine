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
    // GB-1538 genus: the fixture inserts into whichever dtus shape the
    // harness DB actually carries — the migrated shape (owner_user_id,
    // type, tags_json, ...) or the runtime shape (creator_id,
    // content_type, ...). The fixed column list died with "table dtus
    // has no column named owner_user_id" on runtime-shaped DBs, which
    // is the same schema drift the factory fix cures.
    const cols = new Set(db.prepare("PRAGMA table_info(dtus)").all().map(r => r.name));
    const values = {
      id: dtuId, creator_id: userId, owner_user_id: userId,
      title: "Lab notebook lab-f5 alpha", body_json: "{}", content: "{}",
      content_type: "knowledge", type: "knowledge",
      tags_json: JSON.stringify(["lab", "lab-notebook", "lab-f5"]),
      visibility: "private", tier: "regular",
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    const present = Object.keys(values).filter(k => cols.has(k));
    db.prepare(`INSERT INTO dtus (${present.join(", ")}) VALUES (${present.map(() => "?").join(", ")})`)
      .run(...present.map(k => values[k]));

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
