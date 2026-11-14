// FIX-game-004 (founder ruling (2)) — the leaderboard's Weekly/Monthly/All
// Time filters used to re-slice one lifetime board, so rows never changed.
// Score events now carry their timestamps into a windowed sum: the
// /api/game/leaderboard handler reads ?period and ranks windowed periods
// by gamePeriodXp, which applies refreshGameProfile's exact weights to
// DTU createdAt, council-vote timestamp, and quest-completion updatedAt
// inside the window. Source pin in the FIX-game-001 pattern (the handlers
// live in the server.js monolith, which the harness cannot import).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../server.js", import.meta.url), "utf8");

describe("FIX-game-004 leaderboard periods are real", () => {
  it("gamePeriodXp windows every score source by its timestamp", () => {
    const start = src.indexOf("function gamePeriodXp");
    assert.ok(start > 0, "gamePeriodXp exists");
    const body = src.slice(start, src.indexOf("function refreshGameProfile", start));
    assert.match(body, /inWindow\(d\.createdAt\)/, "DTUs windowed by createdAt");
    assert.match(body, /inWindow\(v\.timestamp\)/, "votes windowed by timestamp");
    assert.match(body, /inWindow\(art\.updatedAt\)/, "quest completions windowed by updatedAt");
    assert.match(body, /\(dtus\.length \* 10\) \+ \(mega \* 50\) \+ \(hyper \* 100\) \+ \(votes \* 5\) \+ questXp/,
      "same weights as the lifetime formula");
  });

  it("the leaderboard handler reads ?period and ranks windowed boards by gamePeriodXp", () => {
    const start = src.indexOf('app.get("/api/game/leaderboard"');
    assert.ok(start > 0);
    const body = src.slice(start, src.indexOf('app.post("/api/game/quests', start));
    assert.match(body, /req\.query\?\.period/, "period read from the query");
    assert.match(body, /period === "weekly" \? 7 \* 24 \* 3600 \* 1000/);
    assert.match(body, /period === "monthly" \? 30 \* 24 \* 3600 \* 1000/);
    assert.match(body, /gamePeriodXp\(p\.userId, since\)/, "windowed rows use gamePeriodXp");
    assert.match(body, /period: windowMs \? period : "alltime"/, "response names the period served");
  });
});
