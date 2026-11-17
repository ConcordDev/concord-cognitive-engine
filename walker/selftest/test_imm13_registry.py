#!/usr/bin/env python3
"""IMM-13 selftest (offline, no browser): the recipe registry — schema,
staleness, authorship, and the Dutch-only override. Run against a walker tree:

    python3 test_imm13_registry.py [tree_root]   # default: the tree this file lives in

On the pristine walker this test fails at import (concord_walker.recipes does
not exist) — that asymmetry is the evidence the registry is new. Every case
below must PASS on the built tree.
"""
import json
import os
import sys
import tempfile
from datetime import date

ROOT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from concord_walker import recipes as R  # noqa: E402  (absent on the pristine walker)

TODAY = date(2026, 11, 17)
BUILTINS = {"FIX-007", "FIX-deities-002", "FIX-chem-003", "FIX-docs-015",
            "FIX-global-016", "FIX-metalearning-014", "FIX-repos-002", "FIX-ingest-001"}

RESULTS = []


def case(name, fn):
    try:
        ok, detail = fn()
    except Exception as e:
        ok, detail = False, "%s: %s" % (type(e).__name__, e)
    RESULTS.append((name, ok))
    print("%s %s — %s" % ("PASS" if ok else "FAIL", name, detail))


def write_registry(rows):
    d = tempfile.mkdtemp(prefix="imm13-recipes-")
    for i, row in enumerate(rows):
        with open(os.path.join(d, "r%02d.json" % i), "w", encoding="utf-8") as fh:
            json.dump(row, fh)
    return d


def base_recipe(**over):
    row = {"id": "FIX-synthetic-001", "kind": "code", "handler": "r_synthetic",
           "author": "muse-b9", "reviewer": "zuko-desk", "status": "active",
           "authored_on": "2026-11-10", "max_age_days": 90}
    row.update(over)
    return row


def refusal_text(refusals):
    return " | ".join("%s: %s" % (tid, "; ".join(rs)) for _s, tid, rs in refusals)


# ------------------------------------------------------------ builtins
def c_builtins_registered():
    registry, refusals, overrides = R.load_registry(
        os.path.join(ROOT, "recipes"), today=TODAY)
    ok = set(registry) == BUILTINS and not refusals and not overrides
    return ok, "registered=%s refusals=[%s]" % (sorted(registry), refusal_text(refusals))


def _mk(name):
    def handler(t):
        return {}
    handler.__name__ = name
    return handler


def c_builtin_dispatch():
    handlers = {"FIX-007": _mk("r_fix007"), "FIX-deities-002": _mk("r_deities_002"),
                "FIX-chem-003": _mk("_prod_scan"), "FIX-docs-015": _mk("_prod_scan"),
                "FIX-global-016": _mk("_prod_scan"), "FIX-metalearning-014": _mk("_prod_scan"),
                "FIX-repos-002": _mk("_prod_reload"), "FIX-ingest-001": _mk("_prod_compare")}
    dispatch, _reg, refusals, _ov = R.build_dispatch(
        handlers, os.path.join(ROOT, "recipes"), today=TODAY)
    return set(dispatch) == BUILTINS and not refusals, \
        "dispatch=%s refusals=[%s]" % (sorted(dispatch), refusal_text(refusals))


# ------------------------------------------------------------ refusals
def c_draft_refused():
    d = write_registry([base_recipe(status="draft")])
    registry, refusals, _ = R.load_registry(d, today=TODAY)
    return not registry and "draft" in refusal_text(refusals), refusal_text(refusals)


def c_status_stale_refused():
    d = write_registry([base_recipe(status="stale")])
    registry, refusals, _ = R.load_registry(d, today=TODAY)
    return not registry and "stale" in refusal_text(refusals), refusal_text(refusals)


def c_age_stale_refused():
    d = write_registry([base_recipe(authored_on="2020-01-01", max_age_days=30)])
    registry, refusals, _ = R.load_registry(d, today=TODAY)
    return not registry and "stale" in refusal_text(refusals), refusal_text(refusals)


def c_sha_stale_refused():
    d = write_registry([base_recipe(verified_against="aaaa1111")])
    registry, refusals, _ = R.load_registry(d, today=TODAY, expect_sha="bbbb2222")
    ok_stale = not registry and "verified against" in refusal_text(refusals)
    registry2, refusals2, _ = R.load_registry(d, today=TODAY, expect_sha="aaaa1111")
    ok_match = set(registry2) == {"FIX-synthetic-001"} and not refusals2
    return ok_stale and ok_match, "mismatch=[%s] match=%s" % (refusal_text(refusals), sorted(registry2))


def c_reviewer_outside_set_refused():
    d = write_registry([base_recipe(reviewer="muse-b9")])
    registry, refusals, _ = R.load_registry(d, today=TODAY)
    return not registry and "not a reviewer of record" in refusal_text(refusals), refusal_text(refusals)


def c_fixer_authored_refused():
    d = write_registry([base_recipe(author="muse-b5")])
    registry, refusals, _ = R.load_registry(d, today=TODAY, fixer_of=lambda tid: "muse-b5")
    direct = R.check_authorship(base_recipe(author="muse-b5"), "muse-b5")
    return not registry and "fixer-authored" in refusal_text(refusals) and direct, \
        "load=[%s] direct=%s" % (refusal_text(refusals), direct)


def c_fixer_reviewed_refused():
    d = write_registry([base_recipe(reviewer="dutch")])
    registry, refusals, _ = R.load_registry(d, today=TODAY, fixer_of=lambda tid: "dutch")
    direct = R.check_authorship(base_recipe(reviewer="dutch"), "dutch")
    return not registry and "fixer-reviewed" in refusal_text(refusals) and direct, \
        "load=[%s] direct=%s" % (refusal_text(refusals), direct)


def c_other_fixer_loads():
    d = write_registry([base_recipe(author="muse-b9", reviewer="zuko-desk")])
    registry, refusals, _ = R.load_registry(d, today=TODAY, fixer_of=lambda tid: "muse-b5")
    return set(registry) == {"FIX-synthetic-001"} and not refusals, refusal_text(refusals)


# ------------------------------------------------------------ override
def c_non_dutch_override_refused():
    d = write_registry([base_recipe(status="draft", override_reason="ship it",
                                    override_by="zuko-desk")])
    registry, refusals, overrides = R.load_registry(d, today=TODAY)
    return not registry and not overrides and "Dutch only" in refusal_text(refusals), \
        refusal_text(refusals)


def c_dutch_override_loads_and_reports():
    d = write_registry([base_recipe(status="draft", override_reason="founder call, 2026-11-17",
                                    override_by="dutch")])
    registry, refusals, overrides = R.load_registry(d, today=TODAY)
    ok = set(registry) == {"FIX-synthetic-001"} and len(overrides) == 1 \
        and overrides[0][1] == "dutch"
    return ok, "registry=%s overrides=%s" % (sorted(registry), overrides)


# ------------------------------------------------------------ schema
def c_schema_violations_refused():
    rows = [base_recipe(id="FIX-synthetic-002", author=None),
            base_recipe(id="FIX-synthetic-003", status="pending"),
            base_recipe(id="FIX-synthetic-004",
                        expect_endpoints=[{"method": "POST"}])]
    d = write_registry(rows)
    registry, refusals, _ = R.load_registry(d, today=TODAY)
    text = refusal_text(refusals)
    ok = not registry and len(refusals) == 3 and "author is required" in text \
        and "status must be one of" in text and "path is required" in text
    return ok, text


def c_expect_fields_load():
    d = write_registry([base_recipe(
        expect_endpoints=[{"method": "POST", "path": "/api/lens/run", "expect_status": 200}],
        expect_action="lens.run")])
    registry, refusals, _ = R.load_registry(d, today=TODAY)
    rec = registry.get("FIX-synthetic-001") or {}
    ok = not refusals and rec.get("expect_action") == "lens.run" \
        and rec.get("expect_endpoints", [{}])[0].get("path") == "/api/lens/run"
    return ok, "refusals=[%s] rec_keys=%s" % (refusal_text(refusals), sorted(rec))


def c_duplicate_id_refused():
    d = write_registry([base_recipe(), base_recipe(author="zuko-2")])
    registry, refusals, _ = R.load_registry(d, today=TODAY)
    return set(registry) == {"FIX-synthetic-001"} and "duplicate" in refusal_text(refusals), \
        refusal_text(refusals)


def c_missing_dir_refused():
    registry, refusals, _ = R.load_registry(os.path.join(tempfile.gettempdir(),
                                                         "imm13-no-such-dir"), today=TODAY)
    return not registry and "missing" in refusal_text(refusals), refusal_text(refusals)


def c_malformed_file_refused():
    d = tempfile.mkdtemp(prefix="imm13-recipes-")
    with open(os.path.join(d, "broken.json"), "w", encoding="utf-8") as fh:
        fh.write("{not json")
    with open(os.path.join(d, "good.json"), "w", encoding="utf-8") as fh:
        json.dump(base_recipe(), fh)
    registry, refusals, _ = R.load_registry(d, today=TODAY)
    ok = set(registry) == {"FIX-synthetic-001"} and "unreadable" in refusal_text(refusals)
    return ok, "registry=%s refusals=[%s]" % (sorted(registry), refusal_text(refusals))


# ------------------------------------------------------------ dispatch composition
def c_unregistered_handler_not_dispatched():
    handlers = {"FIX-synthetic-001": _mk("r_synthetic"), "FIX-ghost-001": _mk("r_ghost")}
    d = write_registry([base_recipe()])
    dispatch, _reg, refusals, _ov = R.build_dispatch(handlers, d, today=TODAY)
    ok = set(dispatch) == {"FIX-synthetic-001"} and "no registered recipe" in refusal_text(refusals)
    return ok, "dispatch=%s refusals=[%s]" % (sorted(dispatch), refusal_text(refusals))


def c_handler_name_mismatch_refused():
    handlers = {"FIX-synthetic-001": _mk("r_other_name")}
    d = write_registry([base_recipe()])
    dispatch, _reg, refusals, _ov = R.build_dispatch(handlers, d, today=TODAY)
    return not dispatch and "does not match" in refusal_text(refusals), refusal_text(refusals)


def c_registered_without_handler_reported():
    d = write_registry([base_recipe()])
    dispatch, _reg, refusals, _ov = R.build_dispatch({}, d, today=TODAY)
    return not dispatch and "no code handler" in refusal_text(refusals), refusal_text(refusals)


# ------------------------------------------------------------ wiring pin (source-level)
def c_reverify_consults_registry():
    with open(os.path.join(ROOT, "concord_walker", "reverify.py"), encoding="utf-8") as fh:
        src = fh.read()
    ok = "build_dispatch" in src and "check_authorship" in src \
        and "cap_verdict(tid, res, dispatch)" in src
    return ok, "reverify.py builds its dispatch from the registry and re-checks authorship per ticket"


case("builtins: 8 registered, no refusals", c_builtins_registered)
case("builtins: dispatch composes all 8 handlers", c_builtin_dispatch)
case("draft refused", c_draft_refused)
case("status-stale refused", c_status_stale_refused)
case("age-stale refused", c_age_stale_refused)
case("verified_against mismatch refused, match loads", c_sha_stale_refused)
case("reviewer outside the record set refused", c_reviewer_outside_set_refused)
case("fixer-authored refused (load + dispatch check)", c_fixer_authored_refused)
case("fixer-reviewed refused (load + dispatch check)", c_fixer_reviewed_refused)
case("a different fixer does not block the recipe", c_other_fixer_loads)
case("non-Dutch override refused", c_non_dutch_override_refused)
case("Dutch override loads and is reported", c_dutch_override_loads_and_reports)
case("schema violations refused with field reasons", c_schema_violations_refused)
case("expect_endpoints / expect_action load", c_expect_fields_load)
case("duplicate id refused, first wins", c_duplicate_id_refused)
case("missing registry dir -> empty + refusal", c_missing_dir_refused)
case("malformed recipe file refused, good file still loads", c_malformed_file_refused)
case("unregistered handler not dispatched", c_unregistered_handler_not_dispatched)
case("handler name mismatch refused", c_handler_name_mismatch_refused)
case("registered recipe without handler reported", c_registered_without_handler_reported)
case("wiring pin: reverify consults the registry", c_reverify_consults_registry)

fails = [n for n, ok in RESULTS if not ok]
print()
print("SELFTEST IMM13 REGISTRY: %s (%d/%d passed)" % ("PASS" if not fails else "FAIL",
                                                     len(RESULTS) - len(fails), len(RESULTS)))
sys.exit(1 if fails else 0)
