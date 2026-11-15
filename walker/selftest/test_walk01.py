#!/usr/bin/env python3
"""WALK-01 selftests (GB-1544): fold ingest, CI routing, the walker ledger, the sha gate.
Pure-python: no browser, no network (fetch is injected). Run: python3 selftest/test_walk01.py
Every test here FAILS against the pristine walker (which has no fold/ledger/gate at all)
and passes on the upgraded one; test_fold_sees_what_pristine_misses pins the S1 gap itself.
"""
import json, os, sys, tempfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)

from concord_walker.fold import fold_from_texts, lane_of, FoldError, norm_status
from concord_walker.tickets import TicketStore
from concord_walker.ledger import WalkerLedger, read_ledger, FIELDS
from concord_walker import sha_gate

FAILS = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (" " + extra if extra and not cond else ""))
    if not cond:
        FAILS.append(name)


MAIN = "\n".join(json.dumps(r) for r in [
    {"id": "FIX-alpha-001", "lens": "alpha", "status": "FIXED_PENDING_VERIFY", "title": "a"},
    {"id": "FIX-alpha-002", "lens": "alpha", "status": "open", "title": "b"},          # lowercase in main
    {"id": "FIX-beta-001", "lens": "beta", "status": "OPEN", "title": "c"},
    {"id": "FIX-beta-001", "type": "retest_update", "status": "FIXED_PENDING_VERIFY"},  # in-file update
]) + "\n"

RECORDS = {
    "b2.jsonl": "\n".join(json.dumps(r) for r in [
        {"id": "FIX-beta-001", "status": "FIXED_PENDING_VERIFY", "fixed_by": "muse-b2"},  # seat supersedes
        {"id": "BR-01", "status": "FIXED_PENDING_VERIFY", "fixed_by": "muse-b2"},          # records-only, non-lens
        {"id": "HV-31", "status": "fixed_pending_verify", "fixed_by": "muse-b2"},          # records-only, lowercase
    ]) + "\n",
    "b7.jsonl": json.dumps({"id": "FIX-alpha-002", "status": "FIXED_PENDING_VERIFY", "fixed_by": "muse-b7"}) + "\n",
}


def test_fold_counts_and_normalisation():
    fold = fold_from_texts(MAIN, RECORDS, sha="deadbeef")
    c = fold.counts()
    check("fold sees all ids (3 main base + 2 records-only)", c["total"] == 5, str(c))
    check("FPV count is the fold's, not the main file's", c["by_status"].get("FIXED_PENDING_VERIFY") == 5, str(c))
    check("lowercase 'open' normalised (in-file update + seat row)", fold.status("FIX-alpha-002") == "FIXED_PENDING_VERIFY")
    check("lowercase records status normalised", fold.status("HV-31") == "FIXED_PENDING_VERIFY")
    check("seat row supersedes in-file update chain", fold.status("FIX-beta-001") == "FIXED_PENDING_VERIFY")
    check("records-only ids counted", c["records_only"] == 2, str(c))
    ids = fold.ids_with_status("FIXED_PENDING_VERIFY")
    check("--from-status selection uses the fold", set(ids) == {"FIX-alpha-001", "FIX-alpha-002", "FIX-beta-001", "BR-01", "HV-31"}, str(ids))


def test_ci_routing():
    fold = fold_from_texts(MAIN, RECORDS)
    check("BR-01 routes to the CI lane", lane_of(fold.base["BR-01"]) == "ci")
    check("HV-31 routes to the CI lane", lane_of(fold.base["HV-31"]) == "ci")
    check("FIX-alpha-001 stays a lens ticket", lane_of(fold.base["FIX-alpha-001"]) == "lens")
    check("ci_ids lists exactly the non-lens set", set(fold.ci_ids()) == {"BR-01", "HV-31"}, str(fold.ci_ids()))
    store = TicketStore(tempfile.mkdtemp(), fold=fold)
    check("store.lane agrees", store.lane("BR-01") == "ci" and store.lane("FIX-alpha-001") == "lens")
    check("store.status normalised via fold", store.status("HV-31") == "FIXED_PENDING_VERIFY")


def test_fold_sees_what_pristine_misses():
    # The pristine TicketStore reads the main file alone: it cannot see records-only
    # ids and its FPV count is the main-file-only count. This is S1, pinned.
    d = tempfile.mkdtemp()
    with open(os.path.join(d, "fix_tickets.jsonl"), "w") as f:
        f.write(MAIN)
    pristine = TicketStore(d)
    fold = fold_from_texts(MAIN, RECORDS)
    p_fpv = sum(1 for i in pristine.base if pristine.status(i) == "FIXED_PENDING_VERIFY")
    check("pristine store misses records-only ids", pristine.get("BR-01") is None and pristine.get("HV-31") is None)
    check("fold FPV (5) > pristine FPV (2)", fold.counts()["by_status"]["FIXED_PENDING_VERIFY"] == 5 and p_fpv == 2,
          "fold=5 pristine=%d" % p_fpv)


def test_missing_records_dir_fails_clearly():
    try:
        fold_from_texts(MAIN, None)
        check("missing records dir raises", False)
    except FoldError as e:
        check("missing records dir raises FoldError, clearly", "records" in str(e), str(e))


def test_ledger_writes_union_rows_and_never_touches_main():
    d = tempfile.mkdtemp()
    main = os.path.join(d, "fix_tickets.jsonl")
    with open(main, "w") as f:
        f.write(MAIN)
    before = open(main, "rb").read()
    led = WalkerLedger(os.path.join(d, "records", "walker.jsonl"))
    res = {"id": "FIX-alpha-001", "verdict": "FIXED", "method": "export download", "evidence": ["ev/a.png", "ev/b.png"]}
    upd = {"status": "VERIFIED"}
    row = led.write_verdict(res, upd, live_sha="deadbeef", run_id="20261114-000000-reverify", account="t1")
    check("ledger row carries all union fields", all(row.get(k) not in (None, "") for k in FIELDS), str(row))
    check("evidence joined as a path list", row["evidence_path"] == "ev/a.png; ev/b.png")
    rows = read_ledger(led.path)
    check("ledger reads back 1 row", len(rows) == 1 and rows[0]["status"] == "VERIFIED")
    check("main file bytes unchanged by a verdict", open(main, "rb").read() == before)
    check("NEEDS_HUMAN (upd None) writes no row", led.write_verdict(res, None, live_sha="x", run_id="r", account="t1") is None
          and len(read_ledger(led.path)) == 1)
    dry = WalkerLedger(os.path.join(d, "records", "walker.jsonl"), dry=True)
    dry.write_verdict(res, upd, live_sha="x", run_id="r", account="t1")
    check("dry ledger suppresses writes", dry.suppressed == 1 and len(read_ledger(led.path)) == 1)


def test_ledger_survives_torn_last_line():
    d = tempfile.mkdtemp()
    p = os.path.join(d, "walker.jsonl")
    led = WalkerLedger(p)
    led.write(tid="FIX-a-001", status="VERIFIED", live_sha="s", run_id="r", recipe="m", result="FIXED",
              evidence_path="", account="t1")
    with open(p, "a") as f:
        f.write('{"id": "FIX-a-002", "status": "VER')  # crash mid-write
    rows = read_ledger(p)
    check("torn last line skipped, prior rows intact", len(rows) == 1 and rows[0]["id"] == "FIX-a-001", str(rows))


def test_sha_gate():
    check("health buildSha read", sha_gate.health_build_sha({"buildSha": "abc123"}) == "abc123")
    check("health nested checks.buildSha read", sha_gate.health_build_sha({"checks": {"buildSha": "abc123"}}) == "abc123")
    check("html buildId fallback", sha_gate.html_build_id('<script>{"buildId":"next42"}</script>') == "next42")
    check("html _next/static fallback", sha_gate.html_build_id('<link href="/_next/static/next42/_buildManifest.js">') == "next42")
    pages = {"https://x/health": json.dumps({"buildSha": "deadbeef"}),
             "https://x/": "<html></html>"}
    g = sha_gate.gate("deadbeef", "https://x", fetch=lambda u: pages[u])
    check("gate passes on a match", g["ok"] and g["source"] == "health", str(g))
    g = sha_gate.gate("cafef00d", "https://x", fetch=lambda u: pages[u])
    check("gate fails closed on mismatch (dry, 0 rows)", not g["ok"] and "dry" in g["reason"], str(g))
    pages2 = {"https://x/health": json.dumps({"ok": True}),
              "https://x/": '<script src="/_next/static/next42/chunk.js"></script>'}
    g = sha_gate.gate("next42", "https://x", fetch=lambda u: pages2[u])
    check("gate falls back to the Next build id", g["ok"] and g["source"] == "html", str(g))
    g = sha_gate.gate("next42", "https://x", fetch=lambda u: (_ for _ in ()).throw(OSError("down")))
    check("unreachable live sha fails closed", not g["ok"], str(g))


def test_no_verdict_writes_to_main_anywhere():
    src = open(os.path.join(HERE, "walker.py")).read()
    check("walker.py never calls append_update (verdicts go to the ledger)", "append_update(" not in src)


if __name__ == "__main__":
    for fn in [v for k, v in sorted(globals().items()) if k.startswith("test_")]:
        fn()
    print("\n%d failure(s)" % len(FAILS))
    sys.exit(1 if FAILS else 0)
