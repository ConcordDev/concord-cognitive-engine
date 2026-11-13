// FIX-game-001 (server pin) — /api/game/leaderboard used to recompute
// XP with its own copy of the profile formula, drifted from
// refreshGameProfile: it omitted the votes x5 term, so the signed-in
// user's leaderboard row disagreed with the XP their header and
// dashboard showed (190 vs 200 in the audit). The handler now calls
// refreshGameProfile — the one computation /api/game/profile serves.
// This is a source pin: the handlers live in the server.js monolith,
// which the domain harness cannot import; CI + the desk re-walk cover
// the live behaviour.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../server.js", import.meta.url), "utf8");

describe("FIX-game-001 leaderboard shares the profile XP computation", () => {
  it("refreshGameProfile counts votes at x5 (the term that drifted)", () => {
    const start = src.indexOf("function refreshGameProfile");
    assert.ok(start > 0);
    const body = src.slice(start, start + 1200);
    assert.match(body, /\(voteCount \* 5\)/);
  });

  it("the leaderboard handler refreshes profiles instead of recomputing XP itself", () => {
    const start = src.indexOf('app.get("/api/game/leaderboard"');
    assert.ok(start > 0);
    const body = src.slice(start, src.indexOf('app.post("/api/game/quests', start));
    assert.match(body, /refreshGameProfile\(uid\)/);
    assert.doesNotMatch(body, /userDtus\.length \* 10/);
  });
});
