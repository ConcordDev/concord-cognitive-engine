// server/tests/backup-durability-and-cost.test.js
//
// Pins three backup defects found 2026-07-28, all of the same family: a backup
// that reported success while doing less than it claimed.
//
// 1. 🔴 THE DATABASE WAS NEVER BACKED UP. `runBackup` gzipped a hardcoded
//    "/data/db/concord.db" — a Docker-shaped path that does not exist on the
//    bare-metal deploy, where the database is at DB_PATH
//    (`process.env.DB_PATH || <DATA_DIR>/concord.db`). `existsSync` returned
//    false on every run, the block was skipped, and the surrounding catch
//    logged at DEBUG and never even fired because nothing threw. The daily
//    backup returned `{ok:true}` while the ledger of record for money, DTUs
//    and auth went uncaptured. Same silently-disarmed shape as the Trivy gate
//    that scanned nothing for months.
//
// 2. Backups were written PRETTY-PRINTED (`JSON.stringify(backup, null, 2)`),
//    inflating every file 1.30x — measured on the real corpus, 8.7MB -> 11.4MB
//    — for indentation nothing reads. These are machine-restored via the
//    `backup.data?.dtus` path, never opened by hand. The main state saver
//    already documents "always use compact JSON to halve string memory"; this
//    path simply never got the same treatment.
//
// 3. Two overlapping backup systems ran on separate clocks. `createBackup`
//    fired every 2h (12x/day, each a synchronous multi-MB stringify +
//    writeFileSync on the main thread) on top of `runBackup`'s daily pass and
//    the debounced snapshot's 5s window. The interval default is now 24h.
//
// The retention assertion is the subtle one and is the reason this file
// exists rather than a comment: the old count was a bare `24`, written against
// the 2h cadence ("~48 hours"). Moving the interval to 24h without touching it
// would have silently turned 24 files into 24 DAYS of retention — a 12x disk
// INCREASE arriving as a side effect of a perf fix. Retention is now derived
// from the interval, and that derivation is pinned here.
//
// Run: node --test server/tests/backup-durability-and-cost.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "../lib/detectors/command-injection-detector.js";

const RAW = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../server.js"),
  "utf8",
);

// Assert against CODE, not comments.
//
// The first version of this file failed on two assertions for a reason worth
// recording: the fix's own explanatory comments quote the removed constructs
// verbatim (`"/data/db/concord.db"` and the pretty-print call) in order to
// explain what was wrong — so a plain substring search found the comment and
// reported the bug as still present. That is the self-inflicted grep
// false-positive CLAUDE.md documents for the UX grader, where a doc comment
// naming a retired component re-triggered the very flag describing it.
//
// The tempting fix is to reword the comments so the literals never appear.
// That is backwards: it degrades the explanation to satisfy a test. Strip
// comments instead, using the repo's own string-aware stripper (it tracks
// quote state, so a "//" inside a string literal is not mistaken for a
// comment) so the prose can stay as precise as it needs to be.
//
// Scoped per-function, NOT whole-file, and that distinction is load-bearing:
// running the stripper over all ~80k lines of server.js leaves this file's
// own comment intact, because somewhere earlier the stripper desyncs (an
// unbalanced quote or backtick puts it into string mode and it stops
// recognising comments). Verified directly — the same comment strips
// correctly in isolation and survives in full-file context. Small,
// self-contained slices keep the stripper honest.
const SRC = RAW;
const fnBody = (needle, endMarker) => {
  const start = RAW.indexOf(needle);
  assert.ok(start > 0, `${needle} not found — was it renamed?`);
  const endAt = RAW.indexOf(endMarker, start);
  return stripComments(RAW.slice(start, endAt > start ? endAt : start + 6000));
};

// Isolate each function's body so assertions can't accidentally match
// elsewhere, and so comment-stripping stays reliable (see note above).
const RUN_BACKUP = fnBody("async function runBackup()", "backup_complete");
const CREATE_BACKUP = fnBody("function createBackup(", "backup_created");

describe("runBackup — the database is actually captured", () => {
  it("no longer hardcodes the Docker-only /data/db path", () => {
    assert.ok(
      !RUN_BACKUP.includes('"/data/db/concord.db"'),
      "runBackup still points at the hardcoded path that does not exist on bare metal",
    );
  });

  it("uses the real DB_PATH constant", () => {
    assert.match(RUN_BACKUP, /fs\.existsSync\(DB_PATH\)/);
    assert.match(RUN_BACKUP, /fs\.promises\.readFile\(DB_PATH\)/);
  });

  it("DB_PATH is the same constant the rest of the server opens", () => {
    // If this drifts, the backup silently diverges from the live database
    // again — which is exactly how the original bug persisted.
    assert.match(
      SRC,
      /const DB_PATH = process\.env\.DB_PATH \|\| path\.join\(DATA_DIR, "concord\.db"\)/,
    );
  });

  it("a MISSING database is reported, not swallowed", () => {
    // The original failure was invisible precisely because the miss produced
    // no output at any level anyone reads.
    assert.match(RUN_BACKUP, /backup_db_missing/);
    assert.match(RUN_BACKUP, /structuredLog\("warn", "backup_db_missing"/);
    assert.match(RUN_BACKUP, /backup_db_captured/, "a successful capture must be observable too");
  });

  it("compresses off the event loop", () => {
    // gzipSync on a 33MB+ database blocked the loop for the whole compression.
    assert.ok(!RUN_BACKUP.includes("gzipSync"), "still compressing synchronously");
    assert.match(RUN_BACKUP, /zlib\.gzip\(/);
  });
});

describe("runBackup — the state serialize no longer blocks", () => {
  it("uses the chunked serializer, not one atomic stringify", () => {
    // Measured: as a single stringify this was 185-317ms and, after the
    // debounced saver was chunked, the worst blocking site in the process.
    assert.match(RUN_BACKUP, /await stringifyChunked\(_serializeState\(\)\)/);
    assert.ok(
      !/JSON\.stringify\(_serializeState\(\)\)/.test(RUN_BACKUP),
      "runBackup still does an atomic stringify of the full snapshot",
    );
  });

  it("writes without blocking", () => {
    assert.match(RUN_BACKUP, /await fs\.promises\.writeFile\(`\$\{backupDir\}\/state\.json`/);
  });

  it("is async and its timer callers handle the promise", () => {
    // A sync try/catch around an async call does NOT catch a rejection; it
    // would surface as an unhandled rejection instead.
    assert.match(SRC, /async function runBackup\(\)/);
    assert.match(SRC, /Promise\.resolve\(runBackup\(\)\)\.catch\(/);
  });
});

describe("createBackup — size and cadence", () => {
  it("writes compact JSON, not pretty-printed", () => {
    assert.ok(
      !CREATE_BACKUP.includes("JSON.stringify(backup, null, 2)"),
      "createBackup still pretty-prints (measured 1.30x inflation)",
    );
    assert.match(CREATE_BACKUP, /fs\.writeFileSync\(backupPath, JSON\.stringify\(backup\)\)/);
  });

  it("defaults to a daily interval", () => {
    assert.match(
      SRC,
      /_STATE_BACKUP_INTERVAL_HOURS = Math\.max\(1, Number\(process\.env\.BACKUP_INTERVAL_HOURS \|\| 24\)\)/,
    );
    // Still operator-tunable — this is a default change, not a removal.
    assert.match(SRC, /startAutoBackup\(_STATE_BACKUP_INTERVAL_HOURS\)/);
  });
});

describe("createBackup — retention is a span of TIME, not a raw count", () => {
  // Reproduce the shipped derivation so the property is tested, not the text.
  function retentionCount(intervalHours, days) {
    const perDay = Math.max(1, Math.round(24 / Math.max(1, intervalHours)));
    return Math.min(24, Math.max(3, perDay * days));
  }

  it("daily interval + 7-day policy keeps 7 files, not 24", () => {
    // The regression this guards: leaving the old bare `24` in place would
    // have meant 24 DAYS of retention once the interval became 24h.
    assert.equal(retentionCount(24, 7), 7);
  });

  it("a tightened interval does not balloon retention past the old ceiling", () => {
    // BACKUP_INTERVAL_HOURS=2 would otherwise want 12*7 = 84 files.
    assert.equal(retentionCount(2, 7), 24);
  });

  it("never drops below a floor of 3", () => {
    assert.equal(retentionCount(24, 1), 3);
  });

  it("the shipped helper matches this derivation", () => {
    assert.match(SRC, /function _stateBackupRetentionCount\(\)/);
    assert.match(SRC, /Math\.min\(24, Math\.max\(3, perDay \* _STATE_BACKUP_RETENTION_DAYS\)\)/);
    assert.match(SRC, /const MAX_STATE_BACKUPS = _stateBackupRetentionCount\(\)/);
  });
});
