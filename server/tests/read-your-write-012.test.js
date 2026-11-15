// FIX-veterinary-012 — read-your-write for critical saves.
//
// The defect (B4's verdict, filed formally by B9 in CB-0617): a deleted
// veterinary record resurrects on first reload. The delete itself is
// correct in memory; the save rode _concordSaveStateDebounced's
// leading-window coalesce (up to 5 s), and any read served from the
// persisted snapshot inside that window served the pre-delete state.
//
// The cure, in two halves, both pinned here:
//   (1) saveVet routes through the platform's critical save, and
//       server.js exports that path to domains (it was lexical-only).
//   (2) The general guarantee: saveStateCritical stamps a read-your-
//       write FLOOR before its rate-window decision, snapshots carry
//       their mutation seq (saveSeq), and a snapshot reader serves a
//       pre-floor snapshot only after a bounded wait — never silently.
// The behavioural scenarios drive the real lib (server/lib/
// read-your-write.js) through the ticket's exact sequence in both
// shapes: PRISTINE (no floor exists — the pre-delete snapshot is
// servable, the resurrection) and FIXED (the floor refuses it until
// the post-delete snapshot lands). Ordinary saves write no floor, so
// the ordinary path is inert under the guard — pinned as such.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  criticalStampPathFor,
  writeCriticalStamp,
  readCriticalStamp,
  snapshotSatisfiesFloor,
} from "../lib/read-your-write.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const readSrc = (p) => fs.readFileSync(path.join(root, p), "utf8");

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "ryw-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe("critical stamp (lib)", () => {
  it("derives the sidecar path beside the state file", () => {
    assert.equal(criticalStampPathFor("/data/concord_state.json"), "/data/concord_state.json.critical.json");
  });

  it("round-trips {seq, at} and reads null when absent or corrupt", () => {
    const p = path.join(dir, "state.json.critical.json");
    assert.equal(readCriticalStamp(p), null);
    writeCriticalStamp(p, { seq: 41, at: "2026-11-14T12:00:00.000Z" });
    assert.deepEqual(readCriticalStamp(p), { seq: 41, at: "2026-11-14T12:00:00.000Z" });
    fs.writeFileSync(p, "{not json");
    assert.equal(readCriticalStamp(p), null);
  });
});

describe("snapshotSatisfiesFloor", () => {
  const stamp = { seq: 10, at: "2026-11-14T12:00:02.000Z" };
  it("no floor: everything is servable (the ordinary path, unchanged)", () => {
    assert.equal(snapshotSatisfiesFloor({ saveSeq: 1, savedAt: "2026-11-14T11:00:00.000Z" }, null), true);
    assert.equal(snapshotSatisfiesFloor(null, null), true);
  });
  it("a snapshot at or past the floor's seq and time is servable", () => {
    assert.equal(snapshotSatisfiesFloor({ saveSeq: 10, savedAt: "2026-11-14T12:00:02.500Z" }, stamp), true);
    assert.equal(snapshotSatisfiesFloor({ saveSeq: 12, savedAt: "2026-11-14T12:00:03.000Z" }, stamp), true);
  });
  it("a snapshot behind the floor's seq is refused even with a later clock", () => {
    assert.equal(snapshotSatisfiesFloor({ saveSeq: 9, savedAt: "2026-11-14T12:00:05.000Z" }, stamp), false);
  });
  it("a snapshot behind the floor's time is refused even with a higher seq (cross-process seq reset)", () => {
    assert.equal(snapshotSatisfiesFloor({ saveSeq: 9000, savedAt: "2026-11-14T11:59:59.000Z" }, stamp), false);
  });
  it("a pre-seq snapshot proves freshness by savedAt alone; one that can prove nothing is refused", () => {
    assert.equal(snapshotSatisfiesFloor({ savedAt: "2026-11-14T12:00:03.000Z" }, stamp), true);
    assert.equal(snapshotSatisfiesFloor({ savedAt: "2026-11-14T11:00:00.000Z" }, stamp), false);
    assert.equal(snapshotSatisfiesFloor({}, stamp), false);
    assert.equal(snapshotSatisfiesFloor(null, stamp), false);
  });
});

describe("the veterinary-012 sequence, both shapes", () => {
  // A "disk" is a snapshot object standing in for concord_state.json;
  // a "reload" is a snapshot reader deciding what it may serve.
  const preDelete = { saveSeq: 7, savedAt: "2026-11-14T12:00:00.000Z", records: ["pet_a", "pet_b"] };
  const postDelete = { saveSeq: 8, savedAt: "2026-11-14T12:00:02.100Z", records: ["pet_a"] };

  it("PRISTINE shape: with no floor, the pre-delete snapshot is servable — the record resurrects", () => {
    const stamp = readCriticalStamp(path.join(dir, "absent.critical.json"));
    assert.equal(stamp, null);
    assert.equal(snapshotSatisfiesFloor(preDelete, stamp), true, "nothing refuses the stale snapshot");
    assert.ok(preDelete.records.includes("pet_b"), "the deleted record is served again");
  });

  it("FIXED shape: the critical floor refuses the pre-delete snapshot until the post-delete save lands", () => {
    const stampPath = criticalStampPathFor(path.join(dir, "concord_state.json"));
    // The delete's critical save stamps the floor first (seq 8).
    writeCriticalStamp(stampPath, { seq: 8, at: "2026-11-14T12:00:02.000Z" });
    const stamp = readCriticalStamp(stampPath);
    assert.equal(snapshotSatisfiesFloor(preDelete, stamp), false, "pre-write snapshot refused inside the window");
    // The writer's save lands; the same reader now serves post-delete state.
    assert.equal(snapshotSatisfiesFloor(postDelete, stamp), true);
    assert.ok(!postDelete.records.includes("pet_b"), "the deleted record stays deleted on first reload");
  });

  it("ordinary (debounced) saves write no floor, so their readers are never held", () => {
    const stamp = readCriticalStamp(criticalStampPathFor(path.join(dir, "concord_state.json")));
    assert.equal(stamp, null, "no critical save happened, so no stamp exists");
    assert.equal(snapshotSatisfiesFloor(preDelete, stamp), true);
  });
});

describe("wiring (source pins)", () => {
  it("server.js exports the critical save, stamps the floor before the rate decision, stamps saveSeq, and guards the load", () => {
    const src = readSrc("server.js");
    assert.ok(src.includes("globalThis._concordSaveStateCritical = saveStateCritical;"), "critical save exported to domains");
    const crit = src.slice(src.indexOf("function saveStateCritical()"), src.indexOf("function saveStateCritical()") + 1600);
    assert.ok(crit.includes("writeCriticalStamp(CRITICAL_STAMP_PATH"), "floor stamped inside saveStateCritical");
    assert.ok(crit.indexOf("writeCriticalStamp") < crit.indexOf("CRITICAL_SAVE_MIN_INTERVAL_MS)"), "floor stamped before the rate-window branch");
    assert.ok(src.includes("saveSeq: _stateMutationSeq,"), "snapshots carry their mutation seq");
    assert.ok(src.includes("snapshotSatisfiesFloor("), "the load path consults the floor");
    assert.ok(src.includes("state_ryw_floor_unsatisfied"), "an unsatisfied floor degrades loudly, never silently");
  });

  it("saveVet routes through the critical save with the debounced fallback intact", () => {
    const src = readSrc("domains/veterinary.js");
    const fn = src.slice(src.indexOf("function saveVet()"), src.indexOf("function saveVet()") + 1200);
    assert.ok(fn.includes("globalThis._concordSaveStateCritical"), "critical path first");
    assert.ok(fn.indexOf("_concordSaveStateCritical") < fn.indexOf("_concordSaveStateDebounced"), "debounced is the fallback, not the route");
  });
});
