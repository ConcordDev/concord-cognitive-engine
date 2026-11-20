#!/usr/bin/env python3
"""Nothing VERIFIED without a walker replay row on a sha-gated build.
(1) static scan: no walker code path WRITES status "VERIFIED" except through the gate
(2) the gate rejects: missing run id, missing/short/mismatched sha, keyword basis, empty evidence
(3) the fold downgrades an unbacked VERIFIED to FIXED_PENDING_VERIFY
Pure python, no browser. Run: python3 selftest/test_replay_gate.py"""
import ast, json, os, sys, tempfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from concord_walker import ledger as L
from concord_walker.ledger import WalkerLedger, VerifyGateError, read_ledger
from concord_walker.fold import fold_from_texts
from concord_walker.tickets import TicketStore
from concord_walker import results as R

FAILS = []
SHA = "a" * 40


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (" " + str(extra)[:300] if extra and not cond else ""))
    if not cond:
        FAILS.append(name)


# ------------------------------------------------------------------ (1) static scan
def _is_v(node):
    return isinstance(node, ast.Constant) and node.value == "VERIFIED"


def produces_v(node):
    """Does evaluating `node` PRODUCE the literal "VERIFIED"? (a comparison / `in (...)` merely reads it)"""
    if _is_v(node):
        return True
    if isinstance(node, ast.IfExp):
        return produces_v(node.body) or produces_v(node.orelse)
    if isinstance(node, ast.BoolOp):
        return any(produces_v(v) for v in node.values)
    if isinstance(node, (ast.Tuple, ast.List)):
        return any(produces_v(e) for e in node.elts)
    return False


def write_sites(src):
    """Line numbers where the literal "VERIFIED" is WRITTEN as a status: a dict {"status": "VERIFIED"},
    a status="VERIFIED" keyword, an assignment to a name containing 'status' (incl. tuple targets),
    or an IfExp/BoolOp producing it for one of those. Comparisons and `in (...)` reads are not writes."""
    tree = ast.parse(src)
    hits = []

    has_v = produces_v

    for n in ast.walk(tree):
        if isinstance(n, ast.Dict):
            for k, v in zip(n.keys, n.values):
                if isinstance(k, ast.Constant) and k.value == "status" and has_v(v):
                    hits.append(n.lineno)
        elif isinstance(n, ast.keyword) and n.arg and "status" in n.arg and has_v(n.value):
            hits.append(n.value.lineno)
        elif isinstance(n, ast.Assign):
            names = [t.id for tgt in n.targets for t in ast.walk(tgt) if isinstance(t, ast.Name)]
            subs = [t for tgt in n.targets for t in ast.walk(tgt) if isinstance(t, ast.Subscript)]
            if any("status" in x.lower() for x in names) and has_v(n.value):
                hits.append(n.lineno)
            elif any(isinstance(s.slice, ast.Constant) and s.slice.value == "status" for s in subs) and has_v(n.value):
                hits.append(n.lineno)
    return sorted(set(hits))


def test_static_scan():
    # the scanner itself must catch every write shape (a scanner that finds nothing proves nothing)
    bad = {
        "dict": 'row = {"id": 1, "status": "VERIFIED"}',
        "kwarg": 'f(status="VERIFIED")',
        "assign": 'status = "VERIFIED"',
        "tuple": 'status, verdict = "VERIFIED", "x"',
        "subscript": 'row["status"] = "VERIFIED"',
        "ifexp": 'status = "VERIFIED" if ok else "OPEN"',
        "boolop": 'status = prior or "VERIFIED"',
    }
    for name, src in bad.items():
        check("scanner flags a %s write" % name, write_sites(src) != [], src)
    for src in ('x = res["verdict"] == "VERIFIED"', 'status = "REOPENED" if prior in ("FIXED_PENDING_VERIFY", "VERIFIED") else "OPEN"', 'if st in ("VERIFIED",): pass', 'VERIFIED = "VERIFIED"', 'f(status=VERIFIED)'):
        check("scanner ignores read/constant: %s" % src, write_sites(src) == [], src)
    # the real tree
    pkg = os.path.join(HERE, "concord_walker")
    files = [os.path.join(pkg, f) for f in sorted(os.listdir(pkg)) if f.endswith(".py")] + [os.path.join(HERE, "walker.py")]
    offenders = {}
    for p in files:
        h = write_sites(open(p).read())
        if h:
            offenders[os.path.relpath(p, HERE)] = h
    check("no walker code path writes status VERIFIED as a literal (all go through ledger.VERIFIED + the gate)", not offenders, offenders)
    # and the single constant lives in the gate module
    check("ledger.VERIFIED is the one definition", L.VERIFIED == "VERIFIED"
          and sum(1 for p in files if 'VERIFIED = "VERIFIED"' in open(p).read()) == 1)
    # every module that builds a row with the union schema goes through make_row/ledger (no hand-rolled rows)
    src = open(os.path.join(pkg, "results.py")).read()
    check("results.human_row builds its row through ledger.make_row", "make_row(" in src)


# ------------------------------------------------------------------ (2) the gate
def good(**kw):
    row = {"id": "FIX-a-001", "status": "VERIFIED", "live_sha": SHA, "walker_run_id": "run-1", "recipe": "repro-steps",
           "result": "FIXED", "evidence_path": "ev/a.png", "account": "t1"}
    row.update(kw)
    return row


def test_gate_rejects():
    check("a complete row passes", L.assert_verifiable(good(), SHA) is True)
    check("short sha prefix of expect passes (sha_matches)", L.assert_verifiable(good(live_sha=SHA[:10]), SHA))
    cases = [
        ("missing run id", good(walker_run_id=""), SHA),
        ("None run id", good(walker_run_id=None), SHA),
        ("missing live sha", good(live_sha=None), SHA),
        ("short (<7) live sha", good(live_sha="abc12"), SHA),
        ("non-hex live sha", good(live_sha="next42"), SHA),
        ("mismatched sha", good(live_sha="b" * 40), SHA),
        ("no expect sha", good(), None),
        ("non-hex expect sha", good(), "next42"),
        ("keyword basis", good(recipe="keyword"), SHA),
        ("unknown basis", good(recipe="unknown"), SHA),
        ("method string as basis (the old behaviour)", good(recipe="export download"), SHA),
        ("empty evidence", good(evidence_path=""), SHA),
        ("whitespace evidence", good(evidence_path="  "), SHA),
    ]
    for name, row, expect in cases:
        try:
            L.assert_verifiable(row, expect)
            check("gate rejects: " + name, False)
        except VerifyGateError:
            check("gate rejects: " + name, True)
    for basis in L.REPLAY_BASES:
        check("allowed basis %s passes" % basis, L.assert_verifiable(good(recipe=basis), SHA))


def test_every_writer_goes_through_the_gate():
    d = tempfile.mkdtemp()
    led = WalkerLedger(os.path.join(d, "records", "walker.jsonl"), expect_sha=SHA)
    for name, kw in [("no run id", dict(run_id="")), ("keyword basis", dict(recipe="keyword")), ("empty evidence", dict(evidence_path="")),
                     ("mismatched sha", dict(live_sha="c" * 40))]:
        args = dict(tid="FIX-a-001", status="VERIFIED", live_sha=SHA, run_id="r", recipe="repro-steps", result="FIXED",
                    evidence_path="ev/a.png", account="t1")
        args.update(kw)
        try:
            led.write(**args)
            check("ledger.write refuses VERIFIED: " + name, False)
        except ValueError:
            check("ledger.write refuses VERIFIED: " + name, True)
    check("refused writes left 0 rows", read_ledger(led.path) == [] and led.written == 0)
    try:
        WalkerLedger(os.path.join(d, "w2.jsonl")).write(tid="X-1", status="VERIFIED", live_sha=SHA, run_id="r", recipe="repro-steps",
                                                        result="FIXED", evidence_path="e", account="t")
        check("a ledger with no expect sha refuses every VERIFIED", False)
    except VerifyGateError:
        check("a ledger with no expect sha refuses every VERIFIED", True)
    # non-VERIFIED rows are not gated on basis (REOPENED can stand on a keyword STILL_FAILING)
    led.write(tid="FIX-a-002", status="REOPENED", live_sha=SHA, run_id="r", recipe="keyword", result="STILL_FAILING", evidence_path="e", account="t1")
    check("REOPENED on a keyword basis is written (STILL_FAILING from any path stands)", len(read_ledger(led.path)) == 1)
    # results.human_row (review page)
    for name, kw in [("no evidence", dict(decision={"id": "X-1", "call": "VERIFIED"})),
                     ("wrong sha", dict(decision={"id": "X-1", "call": "VERIFIED", "evidence_path": "e"}, expect_sha="d" * 40))]:
        try:
            R.human_row(live_sha=SHA, run_id="r", **kw)
            check("human review VERIFIED refused: " + name, False)
        except VerifyGateError:
            check("human review VERIFIED refused: " + name, True)
    row = R.human_row({"id": "X-1", "call": "VERIFIED", "evidence_path": "e.png"}, live_sha=SHA, run_id="r")
    check("human review VERIFIED with evidence passes", row["status"] == "VERIFIED" and row["recipe"] == "human-review")
    check("human CANT_REPRO / REOPENED are not gated", R.human_row({"id": "X-1", "call": "REOPENED"}, live_sha=SHA, run_id="r")["status"] == "REOPENED")


# ------------------------------------------------------------------ (3) fold downgrade
def jl(*rows):
    return "\n".join(json.dumps(r) for r in rows) + "\n"


def wrow(tid, status, **kw):
    r = {"id": tid, "status": status, "live_sha": SHA, "walker_run_id": "run-1", "recipe": "repro-steps", "result": "FIXED",
         "evidence_path": "ev/%s.png" % tid, "account": "t1"}
    r.update(kw)
    return r


def test_fold_downgrades_unbacked():
    main = jl({"id": "FIX-a-001", "lens": "a", "status": "VERIFIED", "title": "x"},          # VERIFIED in the main file, no walker row
              {"id": "FIX-a-002", "lens": "a", "status": "FIXED_PENDING_VERIFY", "title": "x"},
              {"id": "FIX-a-002", "type": "retest_update", "status": "VERIFIED"},            # VERIFIED via an in-file update
              {"id": "FIX-a-003", "lens": "a", "status": "FIXED_PENDING_VERIFY", "title": "x"},
              {"id": "FIX-a-004", "lens": "a", "status": "FIXED_PENDING_VERIFY", "title": "x"},
              {"id": "FIX-a-005", "lens": "a", "status": "FIXED_PENDING_VERIFY", "title": "x"},
              {"id": "FIX-a-006", "lens": "a", "status": "FIXED_PENDING_VERIFY", "title": "x"},
              {"id": "FIX-a-007", "lens": "a", "status": "OPEN", "title": "x"})
    records = {
        "b3.jsonl": jl({"id": "FIX-a-003", "status": "VERIFIED", "fixed_by": "muse-b3"},    # seat claims VERIFIED, nothing backs it
                       {"id": "FIX-a-004", "status": "verified", "fixed_by": "muse-b3"},    # ...but a walker row does back this one
                       {"id": "FIX-new-001", "status": "VERIFIED"}),                          # records-only id, unbacked
        "walker.jsonl": jl(wrow("FIX-a-004", "VERIFIED"),                                     # backs the seat's claim
                           wrow("FIX-a-005", "VERIFIED", recipe="keyword"),                   # walker row itself fails the gate shape
                           wrow("FIX-a-006", "VERIFIED", evidence_path=""),                   # empty evidence
                           wrow("FIX-a-007", "VERIFIED", live_sha="nothex")),                 # bad sha
        "human.jsonl": jl({"id": "FIX-a-003", "status": "VERIFIED", "live_sha": SHA, "walker_run_id": "h", "recipe": "human-review",
                           "evidence_path": "ev/h.png", "result": "human_confirmed", "account": "human"}),
    }
    fold = fold_from_texts(main, records)
    st = fold.status
    check("VERIFIED in the main file with no walker row -> FPV", st("FIX-a-001") == "FIXED_PENDING_VERIFY", st("FIX-a-001"))
    check("VERIFIED via in-file update with no walker row -> FPV", st("FIX-a-002") == "FIXED_PENDING_VERIFY", st("FIX-a-002"))
    check("seat VERIFIED (+ a human row) with no walker replay row -> FPV (a seat can at most set FPV)",
          fold.status("FIX-a-003") == "FIXED_PENDING_VERIFY", fold.status("FIX-a-003"))
    check("records-only VERIFIED with no walker row -> FPV", st("FIX-new-001") == "FIXED_PENDING_VERIFY")
    check("seat VERIFIED BACKED by a gate-shaped walker VERIFIED row stays VERIFIED", st("FIX-a-004") == "VERIFIED", st("FIX-a-004"))
    check("walker VERIFIED row with keyword basis -> FPV", st("FIX-a-005") == "FIXED_PENDING_VERIFY", st("FIX-a-005"))
    check("walker VERIFIED row with empty evidence -> FPV", st("FIX-a-006") == "FIXED_PENDING_VERIFY", st("FIX-a-006"))
    check("walker VERIFIED row with a non-hex sha -> FPV (even from OPEN)", st("FIX-a-007") == "FIXED_PENDING_VERIFY", st("FIX-a-007"))
    check("unbacked VERIFIEDs are listed ('unbacked VERIFIED')", {"FIX-a-001", "FIX-a-002", "FIX-a-005", "FIX-a-006", "FIX-a-007", "FIX-new-001"} <= fold.unbacked
          and "FIX-a-004" not in fold.unbacked, sorted(fold.unbacked))
    check("counts report unbacked_verified", fold.counts()["unbacked_verified"] >= 6 and fold.counts()["by_status"].get("VERIFIED") == 1, fold.counts())
    check("ids_with_status('VERIFIED') is only the backed ones", fold.ids_with_status("VERIFIED") == ["FIX-a-004"], fold.ids_with_status("VERIFIED"))
    # TicketStore reads through the fold
    s = TicketStore(tempfile.mkdtemp(), fold=fold)
    check("TicketStore.status goes through the fold downgrade", s.status("FIX-a-001") == "FIXED_PENDING_VERIFY" and s.status("FIX-a-004") == "VERIFIED")


def test_human_confirm_needs_a_walker_replay():
    main = jl({"id": "H-1", "lens": "a", "status": "FIXED_PENDING_VERIFY", "title": "x"},
              {"id": "H-2", "lens": "a", "status": "FIXED_PENDING_VERIFY", "title": "x"},
              {"id": "H-3", "lens": "a", "status": "FIXED_PENDING_VERIFY", "title": "x"})
    hrow = lambda tid, **kw: dict({"id": tid, "status": "VERIFIED", "live_sha": SHA, "walker_run_id": "h", "recipe": "human-review",
                                   "evidence_path": "ev/h.png", "result": "human_confirmed", "account": "human"}, **kw)
    records = {
        "walker.jsonl": jl(wrow("H-1", None, result="NEEDS_HUMAN"),       # walker replayed, handed to a human
                           wrow("H-3", None, result="STILL_FAILING")),    # walker saw it STILL failing
        "human.jsonl": jl(hrow("H-1"), hrow("H-2"), hrow("H-3")),
    }
    fold = fold_from_texts(main, records)
    check("human VERIFIED after a walker NEEDS_HUMAN replay is backed", fold.status("H-1") == "VERIFIED", fold.status("H-1"))
    check("human VERIFIED with NO walker replay row -> FPV", fold.status("H-2") == "FIXED_PENDING_VERIFY", fold.status("H-2"))
    check("human VERIFIED over a walker STILL_FAILING replay -> FPV", fold.status("H-3") == "FIXED_PENDING_VERIFY", fold.status("H-3"))
    fold3 = fold_from_texts(main, {"walker.jsonl": jl(wrow("H-1", None, result="NEEDS_HUMAN"))})
    check("a status-less replay-attempt row never moves the status", fold3.status("H-1") == "FIXED_PENDING_VERIFY")
    fold2 = fold_from_texts(main, {"human.jsonl": jl(hrow("H-1", evidence_path=""))})
    check("a human row failing its own gate shape is not backed", fold2.status("H-1") == "FIXED_PENDING_VERIFY")


if __name__ == "__main__":
    for fn in (test_static_scan, test_gate_rejects, test_every_writer_goes_through_the_gate, test_fold_downgrades_unbacked,
               test_human_confirm_needs_a_walker_replay):
        fn()
    print("\n%d failure(s)" % len(FAILS))
    sys.exit(1 if FAILS else 0)
