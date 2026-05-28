// Phase U3 — title equip / unequip / bulk lookup.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { equipTitle, unequipTitle, listOwnedTitles, getActiveTitle, getActiveTitlesForUsers } from "../lib/player-titles.js";

function memDb() {
  const t = {
    users: new Map(),       // id → { id, active_title_id }
    player_titles: new Map(), // id → { id, user_id, title, earned_at }
  };
  function _trim(s) { return String(s).replace(/\s+/g, " ").trim(); }
  return {
    prepare(sql) {
      const n = _trim(sql);
      return {
        run: (...args) => {
          if (n.startsWith("UPDATE users SET active_title_id = ? WHERE id = ?")) {
            const u = t.users.get(args[1]) || { id: args[1] };
            u.active_title_id = args[0];
            t.users.set(args[1], u);
            return { changes: 1 };
          }
          if (n.startsWith("UPDATE users SET active_title_id = NULL")) {
            const u = t.users.get(args[0]) || { id: args[0] };
            u.active_title_id = null;
            t.users.set(args[0], u);
            return { changes: 1 };
          }
          return { changes: 0 };
        },
        get: (...args) => {
          if (n.startsWith("SELECT id, title FROM player_titles WHERE user_id = ?")) {
            const userId = args[0], idOrTitle = args[1];
            for (const row of t.player_titles.values()) {
              if (row.user_id === userId && (row.id === idOrTitle || row.title === idOrTitle)) {
                return { id: row.id, title: row.title };
              }
            }
            return null;
          }
          if (n.startsWith("SELECT pt.id, pt.title, pt.world_id AS worldId, pt.earned_at AS earnedAt FROM users u JOIN player_titles pt")) {
            const userId = args[0];
            const u = t.users.get(userId);
            if (!u?.active_title_id) return null;
            const pt = t.player_titles.get(u.active_title_id);
            return pt ? { id: pt.id, title: pt.title, worldId: pt.world_id, earnedAt: pt.earned_at } : null;
          }
          return null;
        },
        all: (...args) => {
          if (n.startsWith("SELECT id, title, world_id AS worldId, earned_at AS earnedAt FROM player_titles WHERE user_id = ?")) {
            return [...t.player_titles.values()]
              .filter(r => r.user_id === args[0])
              .map(r => ({ id: r.id, title: r.title, worldId: r.world_id, earnedAt: r.earned_at }));
          }
          if (n.startsWith("SELECT u.id AS userId, pt.title FROM users u LEFT JOIN player_titles pt")) {
            // args are the IN-list of userIds.
            const ids = new Set(args);
            const out = [];
            for (const id of ids) {
              const u = t.users.get(id);
              if (!u?.active_title_id) continue;
              const pt = t.player_titles.get(u.active_title_id);
              if (pt) out.push({ userId: id, title: pt.title });
            }
            return out;
          }
          return [];
        },
      };
    },
    _seedTitle(userId, titleId, title) {
      t.player_titles.set(titleId, { id: titleId, user_id: userId, title, earned_at: Math.floor(Date.now() / 1000) });
      t.users.set(userId, t.users.get(userId) || { id: userId, active_title_id: null });
    },
    _t: t,
  };
}

describe("Phase U3 — titles", () => {
  let db;
  beforeEach(() => { db = memDb(); });

  it("equip rejects unowned title", () => {
    const r = equipTitle(db, "u1", "the_unowned");
    assert.equal(r.ok, false);
    assert.equal(r.error, "title_not_owned");
  });

  it("equip by title id succeeds", () => {
    db._seedTitle("u1", "title_a", "the Duelist");
    const r = equipTitle(db, "u1", "title_a");
    assert.equal(r.ok, true);
    assert.equal(getActiveTitle(db, "u1").title, "the Duelist");
  });

  it("equip by title string succeeds", () => {
    db._seedTitle("u1", "title_b", "the Healer");
    const r = equipTitle(db, "u1", "the Healer");
    assert.equal(r.ok, true);
    assert.equal(getActiveTitle(db, "u1").title, "the Healer");
  });

  it("unequip clears the active title", () => {
    db._seedTitle("u1", "title_a", "the Duelist");
    equipTitle(db, "u1", "title_a");
    unequipTitle(db, "u1");
    assert.equal(getActiveTitle(db, "u1"), null);
  });

  it("listOwnedTitles returns user's titles", () => {
    db._seedTitle("u1", "title_a", "the Duelist");
    db._seedTitle("u1", "title_b", "the Healer");
    db._seedTitle("u2", "title_c", "the Wanderer");
    const titles = listOwnedTitles(db, "u1");
    assert.equal(titles.length, 2);
  });

  it("getActiveTitlesForUsers bulk resolves active titles", () => {
    db._seedTitle("u1", "title_a", "the Duelist");
    db._seedTitle("u2", "title_b", "the Healer");
    equipTitle(db, "u1", "title_a");
    equipTitle(db, "u2", "title_b");
    const map = getActiveTitlesForUsers(db, ["u1", "u2", "u3"]);
    assert.equal(map.u1, "the Duelist");
    assert.equal(map.u2, "the Healer");
    assert.equal(map.u3, undefined);
  });
});
