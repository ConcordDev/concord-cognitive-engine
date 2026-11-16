#!/usr/bin/env python3
"""Per-lens replay hook (replay.ReplayRun + Reverifier.adopt_walk), offline: no browser.
The sweep's finished LensWalk is a FakeWalk; repro_steps replay is a fake runner (the executor
itself is covered by test_repro_steps.py). Run: python3 selftest/test_replay_hook.py"""
import json, os, sys, tempfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from concord_walker.util import load_config
from concord_walker.records import RunRecorder
from concord_walker.fold import fold_from_texts
from concord_walker.tickets import TicketStore
from concord_walker.ledger import WalkerLedger, read_ledger
from concord_walker.reverify import Reverifier, classify
from concord_walker.replay import ReplayRun
from concord_walker.runstate import LensBudget
from concord_walker import coverage as cov

FAILS = []
SHA = "a" * 40


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (" " + str(extra)[:400] if extra and not cond else ""))
    if not cond:
        FAILS.append(name)


class FakeWalk:
    """Stands in for the sweep's finished LensWalk."""
    allow_write = False

    def __init__(self, evidence="ev/initial.png"):
        self.findings, self.result = [], {"checks": {}, "initial_evidence": evidence}


def tk(tid, lens="demo", status="FIXED_PENDING_VERIFY", title="Row selection never updates", **kw):
    d = {"id": tid, "lens": lens, "status": status, "title": title, "severity": "medium",
         "repro_steps": ["Open the demo lens", "Click 'Row'"], "expected": "Row is selected", "actual": "nothing happens"}
    d.update(kw)
    return d


def setup(tickets, runner, *, expect_sha=SHA, live_sha=SHA, budget_s=900, no_replay=False, extra_inv=()):
    tmp = tempfile.mkdtemp()
    cfg = load_config(None)
    cfg["runs_dir"], cfg["queue_dir"], cfg["audit_dir"] = [os.path.join(tmp, x) for x in ("runs", "queue", "audit")]
    rec = RunRecorder(cfg, "run-x", dry=True)
    main = "\n".join(json.dumps(t) for t in tickets) + "\n"
    fold = fold_from_texts(main, {"b2.jsonl": ""})
    store = TicketStore(cfg["audit_dir"], fold=fold)
    inv = [{"slug": "demo", "url": "https://x/lenses/demo"}] + list(extra_inv)
    rv = Reverifier(None, cfg, rec, store, lambda *a: None, inv)
    rv.repro_runner = runner
    ledger = WalkerLedger(os.path.join(tmp, "records", "walker.jsonl"), dry=live_sha is None, expect_sha=expect_sha)
    budget = LensBudget(budget_s)
    rr = ReplayRun(rv if not no_replay else None, store, ledger, live_sha=live_sha, run_id="run-x", walker_version="w" * 40,
                   run_dir=rec.run_dir, tester="t", log=lambda *a: None, budget=budget, no_replay=no_replay)
    return rr, rv, ledger, rec, tmp


def runner_for(table):
    calls = []

    def run(t):
        calls.append(t["id"])
        return table[t["id"]]
    run.calls = calls
    return run


STEPS = [{"n": 1, "raw": "Open the demo lens", "action": "open", "mapped": True, "executed": True, "result": "opened"},
         {"n": 2, "raw": "Click 'Row'", "action": "click", "mapped": True, "executed": True, "result": "clicked 'Row'"}]
FIXED_RR = {"verdict": "FIXED", "steps": STEPS, "evidence": ["ev/final.png"], "notes": "all steps ran; expected held",
            "expected": {"state": "pass", "clauses": []}}
STILL_RR = {"verdict": "STILL_FAILING", "steps": STEPS, "evidence": ["ev/final.png"], "notes": "expected violated"}
HUMAN_RR = {"verdict": "NEEDS_HUMAN", "steps": [dict(STEPS[0], executed=False, result="not run: step 2 is unmapped")],
            "evidence": [], "notes": "step 2 not mapped to an action: 'Attempt to select a row' (names no specific control)"}


def test_titles_unclassified():
    check("fixture ticket is keyword-unclassified (so only repro-steps can decide it)", classify(tk("x")) is None)


def test_verdicts_and_rows():
    tickets = [tk("FIX-demo-001"), tk("FIX-demo-002"), tk("FIX-demo-003"), tk("FIX-demo-004", status="OPEN"),
               tk("HV-9", lens=None, status="FIXED_PENDING_VERIFY"),
               tk("FIX-ghost-001", lens="ghost"), tk("FIX-other-001", lens="other"),
               tk("FIX-demo-005", status="VERIFIED")]
    runner = runner_for({"FIX-demo-001": FIXED_RR, "FIX-demo-002": STILL_RR, "FIX-demo-003": HUMAN_RR, "FIX-demo-004": FIXED_RR,
                         "FIX-demo-005": HUMAN_RR})
    rr, rv, ledger, rec, tmp = setup(tickets, runner, extra_inv=[{"slug": "other", "url": "https://x/lenses/other"}])
    block = rr.replay_lens("demo", FakeWalk())
    rows = read_ledger(ledger.path)
    by = {r["id"]: r for r in rows}
    r1 = by["FIX-demo-001"]
    check("FIXED on FPV via repro_steps -> a VERIFIED row", r1["status"] == "VERIFIED" and r1["recipe"] == "repro-steps" and r1["result"] == "FIXED", r1)
    check("row carries build sha, run id, walker version", r1["live_sha"] == SHA and r1["walker_run_id"] == "run-x" and r1["walker_version"] == "w" * 40, r1)
    check("row carries method/basis, per-step results and evidence", r1["basis"] == "repro-steps" and r1["steps"] == STEPS and "ev/final.png" in r1["evidence_path"] and r1["method"], r1)
    check("STILL_FAILING on FPV -> REOPENED", by["FIX-demo-002"]["status"] == "REOPENED" and by["FIX-demo-002"]["result"] == "STILL_FAILING", by.get("FIX-demo-002"))
    r3 = by["FIX-demo-003"]
    check("unmappable step -> NEEDS_HUMAN: status-less attempt row, never VERIFIED", r3["status"] is None and r3["result"] == "NEEDS_HUMAN", r3)
    check("NEEDS_HUMAN names the first unmapped step on the verdict", "step 2" in rr.results["FIX-demo-003"]["notes"], rr.results["FIX-demo-003"]["notes"])
    q = [json.loads(l) for l in open(os.path.join(rec.run_dir, "needs_tester.jsonl"))]
    check("NEEDS_HUMAN lands in the needs-tester queue", any(x["ticket_id"] == "FIX-demo-003" for x in q), q)
    r4 = by["FIX-demo-004"]
    check("OPEN ticket the repro passes is NOT VERIFIED (nobody claimed it fixed) -> tester queue", r4["status"] is None and r4["result"] == "FIXED"
          and any(x["ticket_id"] == "FIX-demo-004" and x["kind"] == "fixed_not_claimed" for x in q), r4)
    check("only this lens's lens-lane tickets were replayed (ghost / ci / other-lens never)",
          sorted(runner.calls) == ["FIX-demo-001", "FIX-demo-002", "FIX-demo-003", "FIX-demo-004", "FIX-demo-005"], runner.calls)
    check("a main-file VERIFIED with no walker row is replayed as FIXED_PENDING_VERIFY (unbacked VERIFIED)",
          "FIX-demo-005" in rr.results and rr.results["FIX-demo-005"]["prior_status"] == "FIXED_PENDING_VERIFY", rr.results.get("FIX-demo-005", {}).get("prior_status"))
    check("no row is VERIFIED except the one passing ticket", [r["id"] for r in rows if r["status"] == "VERIFIED"] == ["FIX-demo-001"])
    check("the lens record's replay block has counts + ids by verdict",
          block["counts"] == {"FIXED": 2, "STILL_FAILING": 1, "NEEDS_HUMAN": 2} and block["ids"]["STILL_FAILING"] == ["FIX-demo-002"]
          and block["live_sha"] == SHA and block["dry"] is False, block)
    check("replay REUSED the sweep's LensWalk: 0 walks of its own", rv.live_walk_count == 0 and block["second_walks"] == 0, block)
    # coverage: exactly one row per in-scope ticket, reason never empty
    covrows = rr.coverage_rows({"demo", "other"}, {"demo"})
    ids = [r["id"] for r in covrows]
    check("coverage: exactly one row per in-scope (OPEN/FPV, incl. unbacked-VERIFIED) ticket", sorted(ids) == sorted(["FIX-demo-001", "FIX-demo-002", "FIX-demo-003", "FIX-demo-004", "FIX-demo-005", "HV-9", "FIX-ghost-001", "FIX-other-001"])
          and len(ids) == len(set(ids)), ids)
    cr = {r["id"]: r for r in covrows}
    check("coverage: CI-lane id -> R_CI", cr["HV-9"]["reason"] == cov.R_CI and not cr["HV-9"]["attempted"], cr["HV-9"])
    check("coverage: lens not in inventory -> R_NOT_IN_INV", cr["FIX-ghost-001"]["reason"].startswith(cov.R_NOT_IN_INV), cr["FIX-ghost-001"])
    check("coverage: lens not walked this run -> R_NOT_WALKED", cr["FIX-other-001"]["reason"].startswith(cov.R_NOT_WALKED), cr["FIX-other-001"])
    check("coverage: replayed tickets carry their verdict + a non-empty reason",
          cr["FIX-demo-001"]["verdict"] == "FIXED" and cr["FIX-demo-001"]["coverage_basis"] == "repro-steps" and "repro_steps replayed" in cr["FIX-demo-001"]["reason"]
          and cr["FIX-demo-003"]["verdict"] == "NEEDS_HUMAN" and all(r["reason"].strip() for r in covrows), cr)


def test_sha_mismatch_writes_nothing():
    tickets = [tk("FIX-demo-001"), tk("FIX-demo-002")]
    runner = runner_for({"FIX-demo-001": FIXED_RR, "FIX-demo-002": STILL_RR})
    rr, rv, ledger, rec, tmp = setup(tickets, runner, live_sha=None)  # the sha gate failed -> dry ledger
    block = rr.replay_lens("demo", FakeWalk())
    check("sha gate failed: replay still ran (results kept)", set(rr.results) == {"FIX-demo-001", "FIX-demo-002"} and block["dry"] is True)
    check("sha gate failed: 0 ledger rows written", ledger.written == 0 and not os.path.exists(ledger.path) and ledger.suppressed == 2, (ledger.written, ledger.suppressed))
    check("sha gate failed: verdicts still in the run dir's reverify.jsonl", len(open(os.path.join(rec.run_dir, "reverify.jsonl")).readlines()) == 2)


def test_gate_refusal_demotes_never_stamps():
    runner = runner_for({"FIX-demo-001": dict(FIXED_RR, evidence=[])})  # FIXED with NO evidence
    rr, rv, ledger, rec, tmp = setup([tk("FIX-demo-001")], runner)
    rr.replay_lens("demo", FakeWalk(evidence=None))
    rows = read_ledger(ledger.path)
    check("VERIFIED refused (no evidence): demoted to NEEDS_HUMAN, no VERIFIED row", rr.results["FIX-demo-001"]["verdict"] == "NEEDS_HUMAN"
          and all(r["status"] != "VERIFIED" for r in rows) and "refused by the gate" in rr.results["FIX-demo-001"]["notes"], (rows, rr.results["FIX-demo-001"]))


def test_still_failing_and_recipe_stand():
    # a repro_steps FIXED must never override a STILL_FAILING from another path
    rr, rv, ledger, rec, tmp = setup([tk("FIX-demo-001")], runner_for({"FIX-demo-001": FIXED_RR}))
    res = {"verdict": "STILL_FAILING", "notes": "keyword check still fails", "evidence": ["ev/k.png"], "category": "crash"}
    out = rv._apply_repro_steps(tk("FIX-demo-001"), dict(res))
    check("STILL_FAILING from another path stands (repro never overrides it)", out["verdict"] == "STILL_FAILING" and "coverage_basis" not in out, out)
    res = {"verdict": "FIXED", "coverage_basis": "recipe", "recipe_kind": "per-ticket", "evidence": []}
    out = rv._apply_repro_steps(tk("FIX-demo-001"), dict(res))
    check("a hand-written recipe verdict is final (repro not consulted)", out["verdict"] == "FIXED" and out["coverage_basis"] == "recipe", out)
    # a keyword-capped FIXED may be upgraded ONLY by a fully-executed, machine-checked repro
    capped = {"verdict": "NEEDS_HUMAN", "capped": True, "uncapped_verdict": "FIXED", "coverage_basis": "keyword", "notes": "no hand-written repro recipe", "evidence": []}
    up = rv._apply_repro_steps(tk("FIX-demo-001"), dict(capped))
    check("keyword-capped FIXED + passing repro_steps -> FIXED on basis repro-steps", up["verdict"] == "FIXED" and up["coverage_basis"] == "repro-steps" and up["recipe_kind"] == "repro-steps" and "capped" not in up, up)
    rv.repro_runner = runner_for({"FIX-demo-001": HUMAN_RR})
    still = rv._apply_repro_steps(tk("FIX-demo-001"), dict(capped))
    check("keyword-capped FIXED + unmappable repro stays NEEDS_HUMAN, names the step", still["verdict"] == "NEEDS_HUMAN" and "step 2" in still["notes"] and still["coverage_basis"] == "keyword", still)
    rv.repro_runner = lambda t: (_ for _ in ()).throw(RuntimeError("boom"))
    err = rv._apply_repro_steps(tk("FIX-demo-001"), dict(capped))
    check("a crashing repro runner is NEEDS_HUMAN, never FIXED", err["verdict"] == "NEEDS_HUMAN" and "errored" in err["notes"], err)


def test_budget_admin_noreplay_and_new_tickets():
    tickets = [tk("FIX-demo-001"), tk("FIX-demo-002")]
    runner = runner_for({"FIX-demo-001": FIXED_RR, "FIX-demo-002": FIXED_RR})
    rr, rv, ledger, rec, tmp = setup(tickets, runner, budget_s=-1)  # over budget before the first ticket
    rr.replay_lens("demo", FakeWalk())
    rows = rr.coverage_rows({"demo"}, {"demo"})
    check("over budget: nothing replayed, every ticket gets an R_BUDGET row", runner.calls == [] and all(r["reason"].startswith(cov.R_BUDGET) for r in rows) and len(rows) == 2, rows)
    rr, rv, ledger, rec, tmp = setup(tickets, runner_for({}))
    rr.replay_lens("demo", FakeWalk(), admin_gate=True)
    rows = rr.coverage_rows({"demo"}, {"demo"})
    check("admin lens without an admin session: R_ADMIN rows, nothing replayed", all(r["reason"] == cov.R_ADMIN for r in rows) and len(rows) == 2, rows)
    rr, rv, ledger, rec, tmp = setup(tickets, runner_for({}), no_replay=True)
    blk = rr.replay_lens("demo", FakeWalk())
    rows = rr.coverage_rows({"demo"}, {"demo"})
    check("--no-replay: every ticket gets a 'replay disabled' row", all(r["reason"] == cov.R_NO_REPLAY for r in rows) and len(rows) == 2 and blk["counts"] == {}, rows)
    # a ticket the sweep itself files during this run is never replayed
    rr, rv, ledger, rec, tmp = setup(tickets, runner_for({"FIX-demo-001": FIXED_RR, "FIX-demo-002": FIXED_RR}))
    rr.store.base["FIX-demo-900"] = tk("FIX-demo-900", status="OPEN")
    check("a ticket filed by this run is not in the replay scope", "FIX-demo-900" not in rr.lens_tids("demo"))


if __name__ == "__main__":
    for fn in (test_titles_unclassified, test_verdicts_and_rows, test_sha_mismatch_writes_nothing, test_gate_refusal_demotes_never_stamps,
               test_still_failing_and_recipe_stand, test_budget_admin_noreplay_and_new_tickets):
        fn()
    print("\n%d failure(s)" % len(FAILS))
    sys.exit(1 if FAILS else 0)
