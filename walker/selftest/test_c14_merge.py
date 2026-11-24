#!/usr/bin/env python3
"""ULW C14 selftest (B2): ticket-ID merge machinery (merge.py).

Covers: single-instance rows pass through; identical rows dedupe (one
copy kept, deduped counted); rows that disagree on a deciding field are
a CONFLICT — the ID is excluded from the merged output entirely and the
conflict names the differing fields with both rows; a further row for a
contested ID stays out; a row without an ID is a conflict, never merged;
lens-overlap detection (empty = disjoint); merge_files writes the merged
rows + report and flags activation_blocked on overlap.

Fail-on-pristine: concord_walker.merge does not exist pre-C14 —
ImportError, so this suite cannot pass there.
"""
import json, os, sys, tempfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from concord_walker.merge import merge_rows, disjoint_lenses, merge_files

FAILS = []
def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name + ((" :: " + str(detail)) if (detail and not cond) else ""))
    if not cond:
        FAILS.append(name)

A = [{"id": "FIX-1", "status": "VERIFIED", "recipe": "r1", "live_sha": "abc", "evidence_path": "e1", "account": "t1"},
     {"id": "FIX-2", "status": "REOPENED", "recipe": "r2", "live_sha": "abc", "evidence_path": "e2", "account": "t1"},
     {"id": "FIX-3", "status": "VERIFIED", "recipe": "r3", "live_sha": "abc", "evidence_path": "e3", "account": "t1"}]
B = [{"id": "FIX-2", "status": "REOPENED", "recipe": "r2", "live_sha": "abc", "evidence_path": "e2", "account": "t1"},
     {"id": "FIX-3", "status": "REOPENED", "recipe": "r3", "live_sha": "abc", "evidence_path": "e3", "account": "t1"},
     {"id": "FIX-4", "status": "VERIFIED", "recipe": "r4", "live_sha": "abc", "evidence_path": "e4", "account": "t2"}]

merged, conflicts, stats = merge_rows(A, B)
ids = sorted(r["id"] for r in merged)
check("union of uncontested ids kept", ids == ["FIX-1", "FIX-2", "FIX-4"], ids)
check("identical row deduped, counted", stats["deduped"] == 1 and ids.count("FIX-2") == 1)
check("contested id excluded entirely", "FIX-3" not in ids)
check("conflict names the differing fields", len(conflicts) == 1 and conflicts[0]["id"] == "FIX-3" and conflicts[0]["fields"] == ["status"], conflicts)
check("stats add up", stats["input"] == 6 and stats["kept"] == 3 and stats["conflicts"] == 1, stats)

merged2, conflicts2, _ = merge_rows([{"status": "VERIFIED"}], [])
check("row without an id is a conflict, never merged", merged2 == [] and len(conflicts2) == 1)

check("disjoint lens sets: no overlap", disjoint_lenses(["a", "b"], ["c"]) == [])
check("overlapping lens sets named", disjoint_lenses(["a", "b"], ["b", "c"]) == ["b"])

d = tempfile.mkdtemp(prefix="mg-")
pa, pb = os.path.join(d, "a.jsonl"), os.path.join(d, "b.jsonl")
for p, rows in ((pa, A), (pb, B)):
    with open(p, "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")
out, rep = os.path.join(d, "merged.jsonl"), os.path.join(d, "report.json")
report = merge_files(pa, pb, out, rep, lenses_a=["lens-a"], lenses_b=["lens-b"])
check("merge_files: merged rows on disk", sorted(json.loads(l)["id"] for l in open(out)) == ["FIX-1", "FIX-2", "FIX-4"])
check("merge_files: report carries conflicts + no activation block", report["conflicts"] and report["activation_blocked"] is False)
report2 = merge_files(pa, pb, out, rep, lenses_a=["lens-a"], lenses_b=["lens-a"])
check("merge_files: lens overlap blocks activation", report2["activation_blocked"] is True and report2["lens_overlap"] == ["lens-a"])

print("\n%d failure(s)" % len(FAILS))
sys.exit(1 if FAILS else 0)
