#!/usr/bin/env python3
"""Selftest for walker/tools/declarations_coverage.py (ULW C22).

Browser-free. Pins: the Gate section 9 baseline shape (2/146 reproduced
on a baseline-shaped fixture), the compute-domain scoping, the
correctness/drift split (two numbers, never one), the unlabelled class
entering NEITHER number, and non-compute domains staying out.
"""
import json, os, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "tools"))
import declarations_coverage as dcov  # noqa: E402

FAILS = []


def check(name, cond):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond:
        FAILS.append(name)


def snap(actions, sha="f4f1f77ff610", decls=None):
    return {"sha": sha, "actions": actions,
            "counts": {"declarations": decls}}


def act(domain, action, rc):
    return {"domain": domain, "action": action, "receipt_class": rc,
            "file": "server/domains/%s.js" % domain, "line": 1,
            "fe_callers": []}


# Baseline-shaped fixture: 146 compute actions, exactly 2 PRODUCT.
actions = [act("chem", "equilibrium", "PRODUCT"),
           act("engineering", "beamStudy", "PRODUCT")]
for i in range(144):
    actions.append(act("physics", "a%03d" % i, "NONE"))
actions.append(act("social", "post", "PRODUCT"))   # non-compute: excluded
m = dcov.coverage(snap(actions, decls=2))
d = m["declarations_coverage"]
check("baseline fixture: declared == 2", d["declared"] == 2)
check("baseline fixture: total == 146", d["total_compute_actions"] == 146)
check("baseline reproduced flag set", m["baseline_reproduced"] is True)
check("non-compute PRODUCT excluded from declared",
      d["declared_actions"] == ["chem.equilibrium", "engineering.beamStudy"])
check("undeclared == 144", d["undeclared_compute_actions"] == 144)

# Off-baseline sha: flag clears, numbers still honest.
m2 = dcov.coverage(snap(actions, sha="deadbeef0000", decls=2))
check("other sha: baseline flag clear", m2["baseline_reproduced"] is False)

# Recipe classification.
ind = {"id": "X-1", "kind": "repro-steps", "steps": [
    {"do": "run", "expected_value": 42.0, "review_source": "independent"}]}
selfr = {"id": "X-2", "kind": "repro-steps", "steps": [
    {"do": "run", "expected_value": 42.0, "review_source": "self"}]}
unl = {"id": "X-3", "kind": "repro-steps", "steps": [
    {"do": "run", "expected_value": 42.0}]}
plain = {"id": "X-4", "kind": "repro-steps", "steps": [{"do": "click"}]}
check("independent -> correctness", dcov.classify_recipe(ind) == "correctness")
check("self -> drift", dcov.classify_recipe(selfr) == "drift")
check("unlabelled -> unlabelled (neither number)",
      dcov.classify_recipe(unl) == "unlabelled")
check("no expected value -> None", dcov.classify_recipe(plain) is None)

with tempfile.TemporaryDirectory() as td:
    for i, r in enumerate((ind, selfr, unl, plain)):
        with open(os.path.join(td, "R-%d.json" % i), "w") as fh:
            json.dump(r, fh)
    m3 = dcov.coverage(snap(actions, decls=2), recipes_dir=td)
va = m3["value_asserting_recipes"]
check("corpus: correctness == 1", va["correctness"] == 1)
check("corpus: drift == 1", va["drift"] == 1)
check("corpus: unlabelled == 1", va["unlabelled"] == 1)
check("corpus: scanned == 4", va["recipes_scanned"] == 4)
md = dcov.render_md(m3)
check("roll-up block carries both numbers separately",
      "Correctness coverage" in md and "Drift coverage" in md)

print("SELFTEST %s (%d failures)" % ("PASS" if not FAILS else "FAIL", len(FAILS)))
sys.exit(1 if FAILS else 0)
