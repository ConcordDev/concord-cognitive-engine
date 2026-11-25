#!/usr/bin/env python3
"""Reverify coverage + recipe-only VERIFIED (Dutch, Nov 15 2026). Pure python, no browser.
Run: python3 selftest/test_coverage.py"""
import json, os, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from concord_walker import coverage as cov
from concord_walker.reverify import status_update

FAILS, PASSES = [], []


def check(name, ok, info=""):
    (PASSES if ok else FAILS).append(name)
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else "  :: " + str(info)[:400]))


def T(tid, lens="demo", status="FIXED_PENDING_VERIFY", **kw):
    d = {"id": tid, "lens": lens, "status": status, "title": "x", "repro_steps": ["x"], "actual": "x"}
    d.update(kw)
    return d


class Store:
    def get(self, tid):
        return None


RECIPES = {"FIX-007": None, "FIX-deities-002": None}


def test_cap():
    # keyword-only FIXED (title keyword 'Escape') -> NEEDS_HUMAN with Dutch's reason
    r = cov.cap_verdict("FIX-demo-003", {"verdict": "FIXED", "method": "Escape/focus on 'Settings'", "category": "escape", "notes": "opener=Settings"}, RECIPES)
    check("keyword-only FIXED is capped to NEEDS_HUMAN", r["verdict"] == "NEEDS_HUMAN", r)
    check("capped reason names the category", r["notes"].startswith("no hand-written repro recipe; keyword match only (escape)"), r["notes"])
    check("capped basis + uncapped verdict recorded", r["coverage_basis"] == "keyword" and r.get("capped") is True and r["uncapped_verdict"] == "FIXED", r)
    check("capped verdict writes no ledger row", status_update(Store(), dict(r, id="FIX-demo-003", lens="demo", prior_status="FIXED_PENDING_VERIFY"), "t") is None)
    # unclassified FIXED (e.g. vision judge, category None) is capped too
    r = cov.cap_verdict("FIX-x-001", {"verdict": "FIXED", "method": "vision", "category": None}, RECIPES)
    check("FIXED with no category is capped (unsure -> NEEDS_HUMAN)", r["verdict"] == "NEEDS_HUMAN" and "(unclassified)" in r["notes"], r)
    # chat recipe is classified by keyword, not per ticket -> capped
    r = cov.cap_verdict("FIX-chat-009", {"verdict": "FIXED", "method": "chat recipe", "category": "chat"}, RECIPES)
    check("keyword-triggered chat recipe FIXED is capped", r["verdict"] == "NEEDS_HUMAN", r)
    # a keyword path can't pose as a category recipe: category validation but wrong method
    r = cov.cap_verdict("FIX-x-002", {"verdict": "FIXED", "method": "validation", "category": "validation"}, RECIPES)
    check("validation category without the recipe method is capped", r["verdict"] == "NEEDS_HUMAN", r)


def test_recipe_verifies():
    r = cov.cap_verdict("FIX-deities-002", {"verdict": "FIXED", "method": "10 cold loads", "category": "crash"}, RECIPES)
    check("per-ticket recipe FIXED stays FIXED", r["verdict"] == "FIXED" and r["coverage_basis"] == "recipe" and r["recipe_kind"] == "per-ticket" and not r.get("capped"), r)
    upd = status_update(Store(), dict(r, id="FIX-deities-002", lens="demo", prior_status="FIXED_PENDING_VERIFY"), "t")
    check("recipe FIXED on FPV -> VERIFIED row", upd and upd["status"] == "VERIFIED", upd)
    r = cov.cap_verdict("FIX-f-001", {"verdict": "FIXED", "method": "form bad-input recipe", "category": "validation"}, RECIPES)
    check("validation recipe FIXED stays FIXED", r["verdict"] == "FIXED" and r["coverage_basis"] == "recipe" and r["recipe_kind"] == "validation", r)
    r = cov.cap_verdict("FIX-p-001", {"verdict": "FIXED", "method": "privacy:foreign-rows", "category": "privacy"}, RECIPES)
    check("privacy recipe FIXED stays FIXED", r["verdict"] == "FIXED" and r["coverage_basis"] == "recipe" and r["recipe_kind"] == "privacy", r)


def test_keyword_still_reopens():
    r = cov.cap_verdict("FIX-demo-002", {"verdict": "STILL_FAILING", "method": "Escape/focus", "category": "escape", "notes": "n"}, RECIPES)
    check("keyword STILL_FAILING is not capped", r["verdict"] == "STILL_FAILING" and r["coverage_basis"] == "keyword", r)
    upd = status_update(Store(), dict(r, id="FIX-demo-002", lens="demo", prior_status="FIXED_PENDING_VERIFY"), "t")
    check("keyword STILL on FPV -> REOPENED row", upd and upd["status"] == "REOPENED", upd)
    upd = status_update(Store(), dict(r, id="FIX-demo-002", lens="demo", prior_status="OPEN"), "t")
    check("keyword STILL on OPEN -> stays OPEN", upd and upd["status"] == "OPEN", upd)
    r = cov.cap_verdict("FIX-x-003", {"verdict": "NEEDS_HUMAN", "method": "openers", "category": "escape", "notes": "n"}, RECIPES)
    check("NEEDS_HUMAN passes through unchanged", r["verdict"] == "NEEDS_HUMAN" and r["notes"] == "n", r)


def test_rows():
    scope = [("A", T("A")), ("B", T("B", lens="ghost")), ("C", T("C", lens="nope", status="open")),
             ("D", T("D", status="VERIFIED")), ("E", T("E")), ("F", T("F")), ("G", T("G")), ("H", T("H")),
             ("A", T("A")), ("Z", None), ("I", T("I", status="REOPENED"))]
    results = {"A": cov.cap_verdict("A", {"verdict": "FIXED", "method": "m", "category": "escape"}, {}),
               "E": {"verdict": "NEEDS_HUMAN", "method": "needs-write", "notes": "repro needs a create/delete"},
               "F": {"verdict": "NEEDS_HUMAN", "method": "smoke-only", "notes": ""},
               "G": {"verdict": "NEEDS_HUMAN", "method": "x", "notes": ""},
               "H": {"verdict": "CI_LANE", "method": "ci-evidence"}}
    skipped = {"B": cov.R_NOT_WALKED + " (ghost)", "C": cov.R_NOT_IN_INV + " (nope)", "H": cov.R_CI}
    rows = cov.build_rows(scope, results, skipped)
    by = {r["id"]: r for r in rows}
    check("one row per in-scope FPV/OPEN ticket (dupes, out-of-scope, unknown dropped)",
          [r["id"] for r in rows] == ["A", "B", "C", "E", "F", "G", "H"], [r["id"] for r in rows])
    check("every row has a non-empty reason", all(r["reason"] for r in rows), rows)
    check("every row has the required keys", all(set(("id", "lens", "prior_status", "attempted", "verdict", "reason")) <= set(r) for r in rows))
    check("verdicts are from the allowed set", all(r["verdict"] in cov.VERDICTS for r in rows))
    check("unwalked lens -> NOT_ATTEMPTED with reason", by["B"]["verdict"] == "NOT_ATTEMPTED" and not by["B"]["attempted"]
          and by["B"]["reason"] == "lens not walked this run (ghost)", by["B"])
    check("lens not in inventory -> NOT_ATTEMPTED, lowercase 'open' normalised",
          by["C"]["verdict"] == "NOT_ATTEMPTED" and by["C"]["reason"].startswith("lens not in inventory") and by["C"]["prior_status"] == "OPEN", by["C"])
    check("capped row is attempted NEEDS_HUMAN with keyword reason", by["A"]["attempted"] and by["A"]["verdict"] == "NEEDS_HUMAN"
          and by["A"]["reason"].startswith("no hand-written repro recipe") and by["A"]["coverage_basis"] == "keyword", by["A"])
    check("needs-write reason", by["E"]["reason"].startswith("needs --allow-write"), by["E"])
    check("smoke-only reason", by["F"]["reason"].startswith("repro not automatable"), by["F"])
    check("empty-notes NEEDS_HUMAN still gets a reason", by["G"]["reason"] == "needs human: check gave no reason", by["G"])
    check("NOT_ATTEMPTED rows have basis 'none'", all(r["coverage_basis"] == "none" for r in rows if r["verdict"] == "NOT_ATTEMPTED"), rows)
    check("basis is one of recipe/keyword/none", all(r["coverage_basis"] in ("recipe", "keyword", "none") for r in rows), rows)
    check("CI lane -> NOT_ATTEMPTED with CI reason", by["H"]["verdict"] == "NOT_ATTEMPTED" and by["H"]["reason"] == cov.R_CI, by["H"])
    # a ticket in scope that the run never reached (crash/abort) still gets a row
    rows2 = cov.build_rows([("Q", T("Q"))], {}, {})
    check("never-reached ticket gets NOT_ATTEMPTED + reason", rows2[0]["verdict"] == "NOT_ATTEMPTED" and rows2[0]["reason"] == cov.R_NOT_REACHED, rows2)
    # files
    d = tempfile.mkdtemp(prefix="cov-")
    paths = cov.write([d], rows, {"run_id": "r1", "live_sha": "a" * 40, "dry": False, "ts": "now"})
    doc = json.load(open(os.path.join(d, "reverify_coverage.json")))
    md = open(os.path.join(d, "reverify_coverage.md")).read()
    head = md.split("## Rows")[0]
    check("json + md written", len(paths) == 2 and len(doc["rows"]) == len(rows), paths)
    check("md opens with the first-run note", cov.NOTE_FIRST_RUN in md.split("## Summary")[0], md[:300])
    check("md summary counts per verdict", "| NOT_ATTEMPTED | 3 |" in head and "| NEEDS_HUMAN | 4 |" in head and "| FIXED | 0 |" in head, head)
    check("md lists top reasons", "### Top reasons" in head and "lens not walked this run" in head, head)
    check("json summary matches", doc["summary"]["by_verdict"]["NOT_ATTEMPTED"] == 3 and doc["summary"]["total"] == 7, doc["summary"])


def test_walked_lenses():
    d = tempfile.mkdtemp(prefix="run-")
    json.dump({"slug": "world-creator/anomalies"}, open(os.path.join(d, "lens-world-creator__anomalies.json"), "w"))
    json.dump({"slug": "demo"}, open(os.path.join(d, "lens-demo.json"), "w"))
    open(os.path.join(d, "findings.jsonl"), "w").close()
    w = cov.walked_lenses([d])
    check("walked lenses read from lens-*.json slugs (nested slug kept)", w == {"demo", "world-creator/anomalies"}, w)
    try:
        cov.walked_lenses([os.path.join(d, "nope")])
        check("missing --walked-run dir refuses", False)
    except SystemExit:
        check("missing --walked-run dir refuses", True)


def test_strict_failure_paths():
    # exact capped reason text, with the category in parentheses
    r = cov.cap_verdict("FIX-k-001", {"verdict": "FIXED", "method": "tab click", "category": "tab_error"}, RECIPES)
    check("capped reason is exactly Dutch's string when the check gave no notes",
          r.get("notes") == "no hand-written repro recipe; keyword match only (tab_error)", r)
    # a recipe id list that does not contain the ticket must not grant recipe status
    r = cov.cap_verdict("FIX-deities-0020", {"verdict": "FIXED", "method": "10 cold loads", "category": "crash"}, RECIPES)
    check("near-miss id is not a recipe (capped)", r["verdict"] == "NEEDS_HUMAN" and r["coverage_basis"] == "keyword", r)
    # privacy category with a keyword method can't pose as the privacy recipe
    r = cov.cap_verdict("FIX-p-002", {"verdict": "FIXED", "method": "console/network", "category": "privacy"}, RECIPES)
    check("privacy category, non-recipe method -> capped", r["verdict"] == "NEEDS_HUMAN", r)
    # cap is idempotent: running it twice doesn't uncap or double-prefix
    r2 = cov.cap_verdict("FIX-p-002", r, RECIPES)
    check("cap is idempotent", r2["verdict"] == "NEEDS_HUMAN" and r2["notes"].count("no hand-written repro recipe") == 1, r2)
    # a recipe STILL_FAILING reopens and is recorded as recipe
    r = cov.cap_verdict("FIX-007", {"verdict": "STILL_FAILING", "method": "390 composer fill"}, RECIPES)
    upd = status_update(Store(), dict(r, id="FIX-007", lens="chat", prior_status="FIXED_PENDING_VERIFY"), "t")
    check("recipe STILL -> REOPENED, basis recipe", r["coverage_basis"] == "recipe" and upd and upd["status"] == "REOPENED", (r, upd))
    # recipe FIXED on an OPEN ticket: no VERIFIED row (not claimed fixed), row says why
    r = cov.cap_verdict("FIX-deities-002", {"verdict": "FIXED", "method": "10 cold loads", "category": "crash"}, RECIPES)
    check("recipe FIXED on OPEN writes no VERIFIED", status_update(Store(), dict(r, id="FIX-deities-002", lens="demo", prior_status="OPEN"), "t") is None)
    row = cov.row_for("FIX-deities-002", T("FIX-deities-002", status="OPEN"), r)
    check("recipe FIXED on OPEN row says tester closes", row["verdict"] == "FIXED" and "not claimed fixed" in row["reason"], row)
    # defensive: an uncapped keyword FIXED that bypassed cap_verdict is never a FIXED row
    row = cov.row_for("X", T("X"), {"verdict": "FIXED", "method": "m", "category": "escape"})
    check("FIXED without recipe basis -> NEEDS_HUMAN row", row["verdict"] == "NEEDS_HUMAN"
          and row["reason"] == "no hand-written repro recipe; keyword match only (escape)", row)
    # reason normalisation
    row = cov.row_for("P", T("P"), {"verdict": "NEEDS_HUMAN", "method": "privacy:foreign-rows", "coverage_basis": "recipe",
                                     "notes": "no live labelled fixture for this lens in this run"})
    check("missing fixture -> 'no fixture' reason", row["reason"].startswith("no fixture:"), row)
    row = cov.row_for("P2", T("P2"), {"verdict": "NEEDS_HUMAN", "method": "privacy:foreign-rows", "coverage_basis": "recipe",
                                      "notes": "privacy probe needs --allow-write (t1 creates the labelled fixture first)"})
    check("privacy needs-write -> 'needs --allow-write' reason", row["reason"].startswith("needs --allow-write"), row)
    row = cov.row_for("T1", T("T1"), {"verdict": "NEEDS_HUMAN", "method": "timing", "coverage_basis": "keyword",
                                      "notes": "interaction timing not reproducible by standard checks"})
    check("timing -> 'repro not automatable' reason", row["reason"].startswith("repro not automatable"), row)
    # build_rows refuses a row with an empty reason (bookkeeping must never be blank)
    try:
        cov.build_rows([("E1", T("E1"))], {}, {"E1": "   "})
        check("whitespace-only skip reason falls back (never blank)", True)
    except AssertionError as e:
        check("whitespace-only skip reason falls back (never blank)", False, e)
    rows = cov.build_rows([("E1", T("E1"))], {}, {"E1": "   "})
    check("blank skip reason replaced", rows[0]["reason"].strip() != "", rows)
    # exactly one row per in-scope ticket over a big mixed scope
    scope = [("T%d" % i, T("T%d" % i, status=("FIXED_PENDING_VERIFY", "OPEN", "VERIFIED", "REOPENED", "open")[i % 5])) for i in range(50)]
    scope += scope[:10]
    rows = cov.build_rows(scope, {}, {"T%d" % i: cov.R_NOT_WALKED for i in range(0, 50, 2)})
    want = sorted("T%d" % i for i in range(50) if i % 5 in (0, 1, 4))
    check("exactly one row per in-scope ticket (50 mixed + 10 dupes)", sorted(r["id"] for r in rows) == want and len(rows) == len(want),
          (len(rows), len(want)))
    check("no empty reason in the big scope", all(r["reason"].strip() for r in rows))
    # first-run note is the exact approved line
    check("first-run note text is exact", cov.NOTE_FIRST_RUN ==
          "First-run numbers reflect the old matching; judge re-verify by the next run's NEEDS_HUMAN queue length.", cov.NOTE_FIRST_RUN)


def test_walked_lenses_nested_dir():
    # pre-slug-fix walkers wrote nested slugs as a subdirectory
    d = tempfile.mkdtemp(prefix="run-")
    os.makedirs(os.path.join(d, "lens-world-creator"))
    json.dump({"slug": "world-creator/anomalies"}, open(os.path.join(d, "lens-world-creator", "anomalies.json"), "w"))
    os.makedirs(os.path.join(d, "evidence"))
    json.dump({"slug": "bogus"}, open(os.path.join(d, "evidence", "lens-bogus.json"), "w"))
    w = cov.walked_lenses([d])
    check("nested pre-fix lens file counts; evidence/ lens-*.json does not", w == {"world-creator/anomalies"}, w)


def test_append_text_creates_parent():
    # regression: RunRecorder.judgment -> append_text(audit/reports/NEEDS_TESTER_QUEUE.md)
    # crashed the live sweep when audit/reports did not exist yet
    from concord_walker.util import append_text
    from concord_walker.records import RunRecorder
    d = tempfile.mkdtemp(prefix="aud-")
    p = os.path.join(d, "reports", "X.md")
    try:
        append_text(p, "a\n"); append_text(p, "b\n")
        check("append_text creates a missing parent dir", open(p).read() == "a\nb\n")
    except Exception as e:
        check("append_text creates a missing parent dir", False, e)
    cfg = {"audit_dir": os.path.join(d, "audit"), "runs_dir": os.path.join(d, "runs"), "queue_dir": os.path.join(d, "q"),
           "accounts": {"t1": {"username": "u"}}, "_walker_dir": d}
    try:
        RunRecorder(cfg, "r1").judgment("ethics", "timing", "q?", ["e.png"])
        check("judgment on a fresh audit dir writes the queue md", os.path.exists(os.path.join(cfg["audit_dir"], "reports", "NEEDS_TESTER_QUEUE.md")))
    except Exception as e:
        check("judgment on a fresh audit dir writes the queue md", False, e)


def test_resume_merge():
    """GB-1581 item 1: earlier-attempt verdicts merge into coverage on
    --resume; a resumed lens with no reverify row is NOT done."""
    from concord_walker.replay import ReplayRun

    class FakeStore:
        def __init__(self, base):
            self.base = base

        def get(self, tid):
            return self.base.get(tid)

        def lane(self, tid):
            return "lens"

        def status(self, tid):
            return (self.base.get(tid) or {}).get("status")

    d = tempfile.mkdtemp()
    rows = [
        {"id": "FIX-mus-001", "lens": "music", "verdict": "FIXED", "coverage_basis": "recipe",
         "recipe_kind": "per-ticket", "method": "recipe", "prior_status": "FIXED_PENDING_VERIFY"},
        {"id": "FIX-mus-002", "lens": "music", "verdict": "NEEDS_HUMAN", "coverage_basis": "keyword",
         "method": "vision", "notes": "judge unsure", "prior_status": "OPEN"},
        {"id": "FIX-mus-004", "lens": "music", "verdict": "FIXED", "coverage_basis": "recipe",
         "recipe_kind": "per-ticket", "method": "recipe", "prior_status": "FIXED_PENDING_VERIFY"},
        "not json",
        {"id": "FIX-mus-002", "lens": "music", "verdict": "STILL_FAILING", "coverage_basis": "keyword",
         "method": "check", "prior_status": "OPEN"},
    ]
    with open(os.path.join(d, "reverify.jsonl"), "w") as f:
        for r in rows:
            f.write((r if isinstance(r, str) else json.dumps(r)) + "\n")
    prior = cov.load_prior_results(d)
    check("prior results load, junk skipped, last row wins",
          prior.get("FIX-mus-002", {}).get("verdict") == "STILL_FAILING" and "FIX-mus-001" in prior, list(prior))
    check("missing run dir -> no prior results", cov.load_prior_results(os.path.join(d, "nope")) == {})

    base = {t["id"]: t for t in (T("FIX-mus-001", lens="music"), T("FIX-mus-002", lens="music", status="OPEN"),
                                 T("FIX-mus-003", lens="music"), T("FIX-mus-004", lens="music"))}
    rr = ReplayRun(None, FakeStore(base), None, live_sha=None, run_id="r", walker_version="v",
                   run_dir=d, tester="t", log=lambda *a: None)
    rr.results["FIX-mus-004"] = {"id": "FIX-mus-004", "lens": "music", "verdict": "STILL_FAILING",
                                  "coverage_basis": "keyword", "method": "check", "prior_status": "FIXED_PENDING_VERIFY"}
    out = {r["id"]: r for r in rr.coverage_rows({"music"}, set(), resumed={"music"})}
    check("resumed FIXED verdict reaches coverage", out["FIX-mus-001"]["verdict"] == "FIXED"
          and out["FIX-mus-001"]["attempted"] is True, out.get("FIX-mus-001"))
    check("resumed later-row verdict reaches coverage", out["FIX-mus-002"]["verdict"] == "STILL_FAILING",
          out.get("FIX-mus-002"))
    check("this attempt's result beats the prior row", out["FIX-mus-004"]["verdict"] == "STILL_FAILING"
          and out["FIX-mus-004"]["coverage_basis"] == "keyword", out.get("FIX-mus-004"))
    check("resumed ticket with no row is NOT done", out["FIX-mus-003"]["verdict"] == "NOT_ATTEMPTED"
          and out["FIX-mus-003"]["reason"] == cov.R_RESUMED_NO_ROWS, out.get("FIX-mus-003"))
    check("no coverage row hides behind bare R_RESUMED",
          all(r["reason"] != cov.R_RESUMED for r in out.values()), [r["reason"] for r in out.values()])


for fn in (test_append_text_creates_parent, test_strict_failure_paths, test_walked_lenses_nested_dir, test_cap, test_recipe_verifies, test_keyword_still_reopens, test_rows, test_walked_lenses, test_resume_merge):
    fn()
print("\n%d passed, %d failed" % (len(PASSES), len(FAILS)))
print("TEST_COVERAGE", "PASS" if not FAILS else "FAIL")
sys.exit(1 if FAILS else 0)
