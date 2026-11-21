#!/usr/bin/env python3
"""GB-1576 W5c — DURABILITY, exercised hermetically.

Pins the pure core (concord_walker.durability): marker planting prefers the
fixture-label field, then title-ish fields, and refuses bodies with no
string field; probe candidates exclude telemetry/search paths and require
a plantable body; the verdict table — PASS only when the backend read AND
a fresh session both hold the marker after the wait, FAIL when the write
did not persist or a fresh session diverges, UNVERIFIED (never a pass)
whenever a leg could not judge. Pins the record block's counting, and the
W5c code-scan leg in dossier._code_scan: a domain holding state in a
globalThis Map with a debounced save flags both durability kinds, while a
DB-backed domain flags neither. Pins the dossier's durability section:
the record's block surfaces; its absence files NOT_RUN, never silence.

Run: python3 selftest/test_durability.py
"""
import json, os, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from concord_walker import durability as dur
from concord_walker import dossier

FAILS = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name +
          ((" " + str(extra)[:300]) if extra and not cond else ""))
    if not cond:
        FAILS.append(name)


# ---------------------------------------------------------------- planting
body, field = dur.plant_marker(
    json.dumps({"title": "old", "note": "ULW-FIXTURE-abc in here"}),
    "MARK", fixture_label="ULW-FIXTURE-abc")
check("plant prefers the fixture-label field",
      field == "note" and json.loads(body)["note"] == "MARK", (body, field))
body, field = dur.plant_marker(json.dumps({"count": 3, "name": "x"}), "MARK")
check("plant falls back to a title-ish field",
      field == "name" and json.loads(body)["name"] == "MARK", (body, field))
body, field = dur.plant_marker(json.dumps({"count": 3}), "MARK")
check("no string field -> no plant", body is None and field is None)
body, field = dur.plant_marker("not json", "MARK")
check("non-JSON body -> no plant", body is None)

# ------------------------------------------------------------- candidates
calls = [
    {"method": "POST", "path": "/api/search/query", "url": "u1",
     "post": json.dumps({"title": "q"})},
    {"method": "POST", "path": "/api/notes", "url": "u2",
     "post": json.dumps({"title": "first"})},
    {"method": "GET", "path": "/api/notes", "url": "u3"},
    {"method": "POST", "path": "/api/notes", "url": "u4",
     "post": json.dumps({"title": "latest"})},
    {"method": "POST", "path": "/api/notes", "url": "u5",
     "post": json.dumps({"n": 1})},
]
cands = dur.pick_write_calls(calls, cap=3)
check("candidates: plantable creates only, latest first, deduped",
      len(cands) == 1 and cands[0]["url"] == "u4"
      and cands[0]["collection"] == "/api/notes", cands)
check("plan runs with candidates", dur.probe_plan(cands)["run"] is True)
check("plan skips with a named reason when empty",
      dur.probe_plan([])["run"] is False and "no recorded write" in
      dur.probe_plan([])["reason"])
reads = dur.pick_read_calls(calls, cands[0])
check("read calls picked on the collection",
      [r["path"] for r in reads] == ["/api/notes"], reads)
check("object url from an id-carrying response",
      dur.object_url(cands[0], {"id": "n42"}) == "u4/n42")
check("object url absent without an id",
      dur.object_url(cands[0], {"ok": True}) is None)
check("collection strips an id segment",
      dur.collection_of("/api/notes/note42x") == "/api/notes"
      and dur.collection_of("/api/notes") == "/api/notes")

# --------------------------------------------------------------- verdicts
V = dur.probe_verdict
check("pass: backend + fresh hold the marker",
      V(201, True, True, 200)[0] == "DURABLE_PASS")
check("fail: neither holds it after the wait",
      V(201, False, False, 200)[0] == "DURABLE_FAIL")
check("fail: persisted but a fresh session diverges",
      V(201, False, True, 200)[0] == "DURABLE_FAIL")
check("unverified: fresh shows it, backend read does not",
      V(201, True, False, 200)[0] == "DURABLE_UNVERIFIED")
check("unverified: no backend read exists",
      V(201, True, None, None)[0] == "DURABLE_UNVERIFIED")
check("unverified: backend read failed",
      V(201, False, False, 500)[0] == "DURABLE_UNVERIFIED")
check("unverified: probe write did not land",
      V(500, None, None, None)[0] == "DURABLE_UNVERIFIED")
check("unverified: probe write never completed",
      V(None, None, None, None)[0] == "DURABLE_UNVERIFIED")

# ------------------------------------------------------------------ block
blk = dur.durability_block([
    {"verdict": "DURABLE_PASS"}, {"verdict": "DURABLE_FAIL"},
    {"verdict": "DURABLE_UNVERIFIED"}])
check("block counts and fails on any DURABLE_FAIL",
      blk["status"] == "RAN" and blk["probes"] == 3 and blk["failed"] == 1
      and blk["unverified"] == 1 and blk["verdict"] == "FAIL", blk)
blk = dur.durability_block([{"verdict": "DURABLE_PASS"},
                            {"verdict": "DURABLE_UNVERIFIED"}])
# SUPERSEDED (Walk 3 honesty fix, CB-1053/CB-1058): this pin used to read
# "block passes with unverified counted, not hidden" (verdict PASS) — that
# composition is the defect CB-1053 filed: Walk 3's all-unverified probes
# read 220 PASS. Unverified is a verdict of its own now.
check("block with an unverified probe is UNVERIFIED, never PASS",
      blk["verdict"] == "UNVERIFIED" and blk["unverified"] == 1
      and blk["passed"] == 1, blk)
blk = dur.durability_block([{"verdict": "DURABLE_UNVERIFIED"},
                            {"verdict": "DURABLE_UNVERIFIED"}])
check("all-unverified block is UNVERIFIED",
      blk["verdict"] == "UNVERIFIED" and blk["passed"] == 0, blk)
blk = dur.durability_block([])
check("empty block is UNVERIFIED, not PASS",
      blk["verdict"] == "UNVERIFIED" and blk["probes"] == 0, blk)
blk = dur.durability_block([{"verdict": "DURABLE_PASS"},
                            {"verdict": "DURABLE_PASS"}])
check("all-pass block is PASS",
      blk["verdict"] == "PASS" and blk["passed"] == 2, blk)
check("all_passed truth table (the poll loop's exit decision)",
      dur.all_passed([{"verdict": "DURABLE_PASS"}]) is True
      and dur.all_passed([{"verdict": "DURABLE_PASS"},
                          {"verdict": "DURABLE_UNVERIFIED"}]) is False
      and dur.all_passed([{"verdict": "DURABLE_FAIL"}]) is False
      and dur.all_passed([]) is False)
blk = dur.durability_block(None, "no recorded write")
check("skipped block carries its reason",
      blk["status"] == "SKIPPED" and blk["reason"] == "no recorded write",
      blk)

# -------------------------------------------------------------- code scan
class StubTree:
    def __init__(self, files):
        self.files = files

    def read(self, path):
        return self.files.get(path, "")

    def ls(self, _d):
        return []


RISK_JS = """
const store = globalThis.notesStore = new Map();
const saveSoon = debounce(() => persistNotes(), 800);
function persistNotes() { return true; }
"""
CLEAN_JS = """
const { db } = require("../db");
function listNotes(ctx) { return db.prepare("SELECT * FROM notes").all(); }
"""
tree = StubTree({"server/domains/notes.js": RISK_JS,
                 "server/domains/clean.js": CLEAN_JS})
scan = dossier._code_scan(tree, "notes", ["notes"], None)
kinds = sorted(f["kind"] for f in scan["flags"])
check("globalThis Map + debounced save both flag",
      kinds == ["debounced_save", "globalthis_state"], kinds)
check("durability flags carry the durability class",
      all(f["class"] == "durability" for f in scan["flags"]))
scan = dossier._code_scan(tree, "clean", ["clean"], None)
check("DB-backed domain flags no durability risk",
      [f for f in scan["flags"] if f["class"] == "durability"] == [],
      scan["flags"])

# ------------------------------------------------------- dossier section
class FakeRun:
    def __init__(self, rec):
        self.records = {"notes": rec}
        self.wiring = {}
        self.labels = {}
        self.manifest = {"run_id": "fixture"}
        self.manifest_by_slug = {"notes": {}}
        self.reverify = []


rec = {"deploy": {"backend_sha": "a" * 40}, "findings": [], "controls": [],
       "actions": [], "durability": {"status": "RAN", "verdict": "FAIL",
                                      "probes": 2, "failed": 1,
                                      "unverified": 0,
                                      "rows": [{"write": "POST /api/notes",
                                                "verdict": "DURABLE_FAIL",
                                                "reason": "did not persist"}]}}
d = dossier.build_dossier(FakeRun(rec), "notes")
check("dossier surfaces the record's durability block",
      d["durability"]["verdict"] == "FAIL" and d["durability"]["failed"] == 1,
      d["durability"])
check("index row carries the durability verdict",
      dossier._index_row(d)["durability"] == "FAIL")
rec2 = {"deploy": {"backend_sha": "a" * 40}, "findings": [], "controls": [],
        "actions": []}
d2 = dossier.build_dossier(FakeRun(rec2), "notes")
check("no block on the record -> NOT_RUN, named",
      d2["durability"]["status"] == "NOT_RUN", d2["durability"])
md = dossier.render_md(d)
check("md renders the durability section",
      "## Durability (GB-1576 W5c)" in md and "DURABLE_FAIL" in md)

print("FAILURES: %d" % len(FAILS))
sys.exit(1 if FAILS else 0)
