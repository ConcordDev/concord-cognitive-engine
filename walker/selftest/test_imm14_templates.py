#!/usr/bin/env python3
"""IMM-14 selftest (offline, no browser): the recipe template library.
Run against a walker tree:

    python3 test_imm14_templates.py [tree_root]   # default: the tree this file lives in

Done criteria per template (MST-W1-15): STILL_FAILING on the buggy fixture,
FIXED on the fixed fixture, NEEDS_HUMAN on the missing-element fixture.
On the pristine walker this test fails at import (concord_walker.recipe_templates
does not exist) — that asymmetry is the evidence the library is new.
"""
import os
import sys

ROOT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "selftest"))

from concord_walker import recipe_templates as T  # noqa: E402  (absent on the pristine walker)
from fixture_app_imm14 import driver_for  # noqa: E402

RESULTS = []


def case(name, fn):
    try:
        ok, detail = fn()
    except Exception as e:
        ok, detail = False, "%s: %s" % (type(e).__name__, e)
    RESULTS.append((name, ok))
    print("%s %s — %s" % ("PASS" if ok else "FAIL", name, detail))


CALLS = {
    "escape": lambda d: T.escape_closes(d, opener="Menu", surface="Menu dialog"),
    "overflow-390": lambda d: T.no_overflow_390(d),
    "contrast": lambda d: T.contrast_ok(d),
    "load-5xx": lambda d: T.loads_clean(d),
    "export-file": lambda d: T.export_produces_file(d),
    "endpoint-hit": lambda d: T.endpoint_hit(d, control="Save", method="POST",
                                             path="/api/lens/run", action="lens.run"),
    "value-assert": lambda d: T.value_assert(
        d, control="Compute", inputs={"Side A": "3", "Side B": "4"}, expected=12,
        tolerance=0.001, action="area",
        declaration={"reference": "fixture geometry reference", "validity_range": "0..10000",
                     "review_source": "independent"}),
}
EXPECT = {"buggy": T.STILL, "fixed": T.FIXED, "missing": T.HUMAN}


def make_case(template, variant):
    def run():
        res = CALLS[template](driver_for(template, variant))
        ok = res["verdict"] == EXPECT[variant] and res.get("coverage_basis") == "recipe"
        return ok, "%s/%s -> %s (%s)" % (template, variant, res["verdict"], res["notes"][:70])
    return run


for template in ("escape", "overflow-390", "contrast", "load-5xx", "export-file", "endpoint-hit", "value-assert"):
    for variant in ("buggy", "fixed", "missing"):
        case("%s on %s fixture" % (template, variant), make_case(template, variant))


def c_registry():
    ok = set(T.TEMPLATES) == {"escape", "overflow-390", "contrast", "value-assert",
                              "load-5xx", "export-file", "endpoint-hit"}
    return ok, "templates=%s" % sorted(T.TEMPLATES)


def c_value_self_referenced_is_drift_only():
    d = driver_for("value-assert", "fixed")
    res = T.value_assert(d, control="Compute", inputs={"Side A": "3", "Side B": "4"},
                         expected=12, tolerance=0.001,
                         declaration={"reference": "the lens's own docs", "validity_range": "0..10000",
                                      "review_source": "self-referenced"})
    ok = res["verdict"] == T.FIXED and "DRIFT COVERAGE ONLY" in res["notes"] \
        and "drift coverage only" in res["evidence"][0].lower()
    return ok, "notes=%s" % res["notes"][:90]


def c_value_undeclared_filed_open():
    d = driver_for("value-assert", "fixed")
    res = T.value_assert(d, control="Compute", action="area", declaration=None)
    ok = res["verdict"] == T.HUMAN and "UNDECLARED" in res["notes"] \
        and any("undeclared" in e for e in res["evidence"])
    return ok, "notes=%s" % res["notes"][:80]


def c_instance_binds():
    inst = T.make_instance("endpoint-hit", control="Save", method="POST",
                           path="/api/lens/run", action="lens.run")
    res = inst(driver_for("endpoint-hit", "fixed"))
    ok = res["verdict"] == T.FIXED and inst.template == "endpoint-hit" \
        and inst.params.get("action") == "lens.run"
    return ok, "instance -> %s" % res["verdict"]


def c_escape_no_opener_needed():
    d = driver_for("escape", "fixed")
    d.click("Menu")
    res = T.escape_closes(d)
    return res["verdict"] == T.FIXED, "already-open surface -> %s" % res["verdict"]


def c_contrast_threshold_param():
    d = driver_for("contrast", "buggy")
    res = T.contrast_ok(d, min_ratio=2.0)
    return res["verdict"] == T.FIXED, "min_ratio=2.0 -> %s (%s)" % (res["verdict"], res["notes"][:60])


def c_templates_carry_tier_and_discriminator():
    ok = all(spec.get("tier") in (1, 2, 3) and (spec.get("discriminator") or "").strip()
             for spec in T.TEMPLATES.values())
    return ok, "tiers=%s" % {k: v.get("tier") for k, v in T.TEMPLATES.items()}


case("registry holds the seven templates", c_registry)
case("value-assert: self-referenced declaration is labelled drift coverage only", c_value_self_referenced_is_drift_only)
case("value-assert: no declaration files the action UNDECLARED in the open", c_value_undeclared_filed_open)
case("every template carries a tier + fixture discriminator (CB-0810)", c_templates_carry_tier_and_discriminator)
case("make_instance binds params into a recipe callable", c_instance_binds)
case("escape works on an already-open surface", c_escape_no_opener_needed)
case("contrast honors the min_ratio parameter", c_contrast_threshold_param)

fails = [n for n, ok in RESULTS if not ok]
print()
print("SELFTEST IMM14 TEMPLATES: %s (%d/%d passed)" % ("PASS" if not fails else "FAIL",
                                                       len(RESULTS) - len(fails), len(RESULTS)))
sys.exit(1 if fails else 0)
