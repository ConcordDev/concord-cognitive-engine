// GB-0506: `PRAGMA optimize` ran synchronously in initDatabase before listen and took 23,990 ms on the live
// Mac (every deploy paid ~24 s extra downtime). It was also a documented no-op (INC-100: a plain optimize only
// considers tables the connection already queried; at boot there are none). Stats freshness is the
// sqlite-stats-refresh job, which stays scheduled off the boot path with analysis_limit bounding its ANALYZE.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../server.js", import.meta.url), "utf8");
const initDb = src.slice(src.indexOf("function initDatabase()"), src.indexOf("const _DB_READY = initDatabase();"));

describe("boot path has no synchronous PRAGMA optimize", () => {
  it("initDatabase never runs PRAGMA optimize (as a pragma call, exec, or prepare)", () => {
    assert.ok(initDb.length > 1000, "found initDatabase");
    assert.doesNotMatch(initDb, /pragma\(\s*["'`]optimize/i);
    assert.doesNotMatch(initDb, /(exec|prepare)\(\s*["'`]\s*PRAGMA\s+optimize/i);
  });

  it("the stale-stats refresh stays scheduled off the boot path, behind its kill switch", () => {
    assert.match(initDb, /CONCORD_SQLITE_STATS_REFRESH !== "0"/);
    assert.match(initDb, /setTimeout\(_runStatsRefresh, 120_000\)/);
    assert.match(initDb, /setInterval\(_runStatsRefresh, 12 \* 3600_000\)/);
  });

  it("analysis_limit stays set so the refresh job's ANALYZE is bounded", () => {
    assert.match(initDb, /db\.pragma\("analysis_limit = 1000"\)/);
  });
});
