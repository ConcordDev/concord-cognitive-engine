#!/usr/bin/env python3
"""WALK-05 selftests (GB-1544): journal + resume, heartbeat, run lock, lens budget,
RESULTS artefacts, and the review-page decision rows. Pure python, no browser.
Run: python3 selftest/test_walk05.py — fails on the pristine walker (no such modules).
"""
import csv, json, os, sys, tempfile, time

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)

from concord_walker.runstate import Journal, Heartbeat, LensBudget, RunLock, read_journal
from concord_walker import results as R
from concord_walker.ledger import read_ledger, FIELDS

FAILS = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (" " + extra if extra and not cond else ""))
    if not cond:
        FAILS.append(name)


def test_journal_and_resume():
    d = tempfile.mkdtemp()
    j = Journal(d)
    j.record("reverify", "FIX-a-001", "done", "FIXED")
    j.record("reverify", "FIX-a-002", "failed", "boom")
    j.record("reverify", "FIX-a-003", "skipped", "ci-lane")
    j2 = Journal(d)  # a fresh process reads the same journal back
    check("journal round-trips across processes", len(j2.rows) == 3)
    check("finished = done|skipped only", j2.finished_ids() == {"FIX-a-001", "FIX-a-003"}, str(j2.finished_ids()))
    check("resume set = unfinished (failed retries)", j2.remaining(["FIX-a-001", "FIX-a-002", "FIX-a-003", "FIX-a-004"]) == ["FIX-a-002", "FIX-a-004"])
    j2.record("reverify", "FIX-a-002", "done", "FIXED on retry")
    check("a later done supersedes the earlier failed", Journal(d).finished_ids() == {"FIX-a-001", "FIX-a-002", "FIX-a-003"})


def test_journal_torn_line():
    d = tempfile.mkdtemp()
    j = Journal(d)
    j.record("reverify", "FIX-a-001", "done", "")
    with open(j.path, "a") as f:
        f.write('{"step": "reverify", "id": "FIX-a-0')  # killed mid-write
    rows = read_journal(j.path)
    check("torn final journal line skipped, finished lines kept", len(rows) == 1 and rows[0]["id"] == "FIX-a-001", str(rows))


def test_heartbeat():
    d = tempfile.mkdtemp()
    h = Heartbeat(d)
    h.beat("working")
    check("heartbeat age ~0 after a beat", h.age_s() is not None and h.age_s() < 5)
    check("heartbeat names the pid", json.load(open(h.path))["pid"] == os.getpid())


def test_run_lock_stale_vs_live():
    d = tempfile.mkdtemp()
    p = os.path.join(d, "run.lock")
    # live lock: held by this very process
    with RunLock(p):
        try:
            with RunLock(p):
                check("a live lock is respected", False)
        except SystemExit as e:
            check("a live lock is respected (holder named)", "live pid %d" % os.getpid() in str(e), str(e))
    check("lock removed on exit", not os.path.exists(p))
    # stale lock: a dead pid
    import subprocess
    dead = subprocess.Popen([sys.executable, "-c", "pass"])
    dead.wait()
    with open(p, "w") as f:
        f.write(json.dumps({"pid": dead.pid, "host": "oldhost", "started": "earlier", "epoch": time.time() - 100}))
    logs = []
    with RunLock(p, log=lambda *a: logs.append(" ".join(str(x) for x in a))) as lk:
        check("a stale lock is taken over, loudly", lk.took_over_stale is not None and any("STALE" in x for x in logs), str(logs))
        check("the new lock names the new holder", json.load(open(p))["pid"] == os.getpid())


def test_lens_budget():
    b = LensBudget(0.05)
    b.start("alpha")
    check("within budget at start", not b.over("alpha"))
    time.sleep(0.07)
    check("over budget after the bound", b.over("alpha"))
    check("an unstarted lens is never over", not b.over("beta"))


def test_results_artefacts():
    d = tempfile.mkdtemp()
    with open(os.path.join(d, "reverify.jsonl"), "w") as f:
        f.write(json.dumps({"id": "FIX-a-001", "verdict": "FIXED", "method": "export download", "evidence": ["ev/1.png"]}) + "\n")
        f.write(json.dumps({"id": "FIX-a-002", "verdict": "NEEDS_HUMAN", "method": "contrast", "evidence": []}) + "\n")
    rows = R.build_rows(d, live_sha="deadbeef")
    check("results rows built from the run", len(rows) == 2 and rows[0]["live_sha"] == "deadbeef", str(rows))
    R.write_results(d, rows, "run-x")
    md = open(os.path.join(d, "RESULTS.md")).read()
    check("RESULTS.md carries id, verdict, sha", "FIX-a-001" in md and "deadbeef" in md)
    with open(os.path.join(d, "results.csv")) as f:
        got = list(csv.DictReader(f))
    check("results.csv has one row per result with all columns", len(got) == 2 and got[1]["verdict"] == "NEEDS_HUMAN"
          and set(got[0]) == set(R.COLUMNS), str(got))


def test_review_decisions():
    for call, status, result in [("VERIFIED", "VERIFIED", "human_confirmed"),
                                 ("REOPENED", "REOPENED", "human_confirmed"),
                                 ("CANT_REPRO", "NEEDS_HUMAN", "cant_repro")]:
        row = R.human_row({"id": "FIX-a-001", "call": call}, live_sha="deadbeef", run_id="run-x")
        check("decision %s -> %s/%s in the union schema" % (call, status, result),
              row["status"] == status and row["result"] == result and all(k in row for k in FIELDS)
              and all(row[k] for k in ("id", "status", "ts", "live_sha", "walker_run_id", "recipe", "result", "account")), str(row))
    try:
        R.human_row({"id": "X", "call": "MAYBE"}, live_sha="s", run_id="r")
        check("an unknown call is refused", False)
    except ValueError:
        check("an unknown call is refused", True)
    # the server's append path: a decision lands as a valid human.jsonl row
    from concord_walker.runstate import _append_line
    d = tempfile.mkdtemp()
    out = os.path.join(d, "records", "human.jsonl")
    _append_line(out, R.human_row({"id": "FIX-a-009", "call": "VERIFIED"}, live_sha="s", run_id="r"))
    rows = read_ledger(out)
    check("human.jsonl row appends + reads back", len(rows) == 1 and rows[0]["account"] == "human", str(rows))


def test_review_page_shape():
    page = R.review_page("visual", [{"id": "FIX-a-001", "expected": "no overlap at 390", "draft": "Partial",
                                     "evidence": ["/ev/before.png", "/ev/after.png"]}])
    check("page carries the ticket, its expected, the draft, and both shots",
          "FIX-a-001" in page and "no overlap at 390" in page and "Partial" in page
          and "before.png" in page and "after.png" in page)
    check("page wires all three keypress paths", all(k in page for k in ("VERIFIED", "REOPENED", "CANT_REPRO")))


if __name__ == "__main__":
    for fn in [v for k, v in sorted(globals().items()) if k.startswith("test_")]:
        fn()
    print("\n%d failure(s)" % len(FAILS))
    sys.exit(1 if FAILS else 0)
