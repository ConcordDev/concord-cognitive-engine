#!/usr/bin/env python3
"""LC-06 selftest (offline, no browser): template instances in the registry.

    python3 test_lc06_template_instances.py [tree_root]

Proves: a kind=template entry validates (known template, params within the
template's declared list, no handler); bad template entries are refused with
their reasons; template_instances() surfaces only loaded template entries;
a DRAFT instance (what the LC-06 generator emits) never loads, so it can
never dispatch; an ACTIVE instance, once a reviewer flips it, runs through
recipe_templates.make_instance and returns the template's verdicts on the
fixture driver; the generator is deterministic and idempotent on a sample
census. On the pristine walker this fails at import (kind "template" is not
a valid recipe kind there and gen_template_instances does not exist).
The live Reverifier path (PlaywrightDriver) is exercised on the walker box,
not here — declared, as with the other browser-bound selftests.
"""
import json
import os
import sys
import tempfile

ROOT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "selftest"))

from concord_walker import recipes as R  # noqa: E402
from concord_walker import recipe_templates as T  # noqa: E402
from concord_walker import gen_template_instances as G  # noqa: E402
from fixture_app_imm14 import driver_for  # noqa: E402

RESULTS = []


def case(name, fn):
    try:
        ok, detail = fn()
    except Exception as e:
        ok, detail = False, "%s: %s" % (type(e).__name__, e)
    RESULTS.append((name, ok))
    print("%s %s — %s" % ("PASS" if ok else "FAIL", name, detail))


def _write(d, name, obj):
    with open(os.path.join(d, name), "w", encoding="utf-8") as fh:
        json.dump(obj, fh)


BASE = {"author": "muse-b2", "reviewer": "dutch", "status": "active",
        "authored_on": "2026-11-17", "verified_against": None}


def c_valid_template_loads():
    with tempfile.TemporaryDirectory() as d:
        _write(d, "x.json", dict(BASE, id="LC06-T1", kind="template",
                                 template="overflow-390", params={},
                                 tier=2, discriminator="pre-fix replay: STILL_FAILING — scrollW 720 at 390px"))
        registry, refusals, _ov = R.load_registry(d)
        inst = R.template_instances(registry)
        ok = inst.get("LC06-T1", {}).get("template") == "overflow-390" and not refusals
        return ok, "instances=%s refusals=%s" % (inst, refusals)


def c_active_without_discriminator_refused():
    raw = dict(BASE, id="LC06-T6", kind="template", template="escape", params={}, tier=2)
    _rec, reasons = R.validate_recipe(raw)
    return any("discriminator" in r for r in reasons), "reasons=%s" % reasons


def c_active_without_tier_refused():
    raw = dict(BASE, id="LC06-T7", kind="template", template="escape", params={},
               discriminator="pre-fix replay: STILL_FAILING")
    _rec, reasons = R.validate_recipe(raw)
    return any("tier" in r for r in reasons), "reasons=%s" % reasons


def c_bad_tier_refused():
    raw = dict(BASE, id="LC06-T8", kind="template", template="escape", params={},
               tier=5, discriminator="pre-fix replay: STILL_FAILING")
    _rec, reasons = R.validate_recipe(raw)
    return any("tier must be 1, 2 or 3" in r for r in reasons), "reasons=%s" % reasons


def c_unknown_template_refused():
    raw = dict(BASE, id="LC06-T2", kind="template", template="levitate", params={})
    _rec, reasons = R.validate_recipe(raw)
    return any("template must be one of" in r for r in reasons), "reasons=%s" % reasons


def c_params_outside_list_refused():
    raw = dict(BASE, id="LC06-T3", kind="template", template="contrast",
               params={"min_ratio": 4.5, "bogus": 1})
    _rec, reasons = R.validate_recipe(raw)
    return any("not contrast template parameters" in r for r in reasons), "reasons=%s" % reasons


def c_handler_on_template_refused():
    raw = dict(BASE, id="LC06-T4", kind="template", template="contrast",
               params={}, handler="r_fix007")
    _rec, reasons = R.validate_recipe(raw)
    return any("handler must be omitted" in r for r in reasons), "reasons=%s" % reasons


def c_draft_never_loads():
    with tempfile.TemporaryDirectory() as d:
        _write(d, "x.json", dict(BASE, id="LC06-T5", kind="template", status="draft",
                                 template="escape", params={}))
        registry, refusals, _ov = R.load_registry(d)
        ok = "LC06-T5" not in registry and R.template_instances(registry) == {} \
            and any("draft" in "; ".join(rs) for _s, _t, rs in refusals)
        return ok, "registry=%s refusals=%s" % (list(registry), refusals)


def c_active_instance_runs():
    inst = T.make_instance("overflow-390")
    got = {v: inst(driver_for("overflow-390", v))["verdict"] for v in ("buggy", "fixed", "missing")}
    ok = got == {"buggy": T.STILL, "fixed": T.FIXED, "missing": T.HUMAN}
    return ok, "verdicts=%s" % got


SAMPLE_CSV = ("id,lens,severity,walker_class,today_bucket,human_category,title\n"
              "zz-001,alpha,low,overflow390,x,y,t\n"
              "zz-002,beta,low,escape,x,y,t\n"
              "zz-003,gamma,low,chat,x,y,t\n"
              "zz-004,delta,low,contrast,x,y,t\n")


def c_generator_deterministic():
    with tempfile.TemporaryDirectory() as d:
        csv_path = os.path.join(d, "census.csv")
        out = os.path.join(d, "recipes")
        os.mkdir(out)
        with open(csv_path, "w", encoding="utf-8") as fh:
            fh.write(SAMPLE_CSV)
        first = G.generate(csv_path, out)
        snapshot = {n: open(os.path.join(out, n), encoding="utf-8").read()
                    for n in sorted(os.listdir(out))}
        second = G.generate(csv_path, out)
        ok = first["written"] == 3 and second["written"] == 0 and second["unchanged"] == 3 \
            and set(snapshot) == {"zz-001.json", "zz-002.json", "zz-004.json"} \
            and json.loads(snapshot["zz-001.json"])["status"] == "draft" \
            and json.loads(snapshot["zz-001.json"])["tier"] == 2 \
            and json.loads(snapshot["zz-001.json"])["discriminator"] is None
        return ok, "first=%s second=%s files=%s" % (first, second, sorted(snapshot))


case("valid template instance loads into template_instances", c_valid_template_loads)
case("active instance without a discriminator refused (CB-0810)", c_active_without_discriminator_refused)
case("active instance without a tier refused (CB-0810)", c_active_without_tier_refused)
case("tier outside 1..3 refused", c_bad_tier_refused)
case("unknown template name refused", c_unknown_template_refused)
case("params outside the template's list refused", c_params_outside_list_refused)
case("handler on a template entry refused", c_handler_on_template_refused)
case("draft instance never loads (generator output is inert)", c_draft_never_loads)
case("active instance returns the template verdicts on fixtures", c_active_instance_runs)
case("generator is deterministic + idempotent, drafts only", c_generator_deterministic)

fails = [n for n, ok in RESULTS if not ok]
print()
print("SELFTEST LC06 TEMPLATE INSTANCES: %s (%d/%d passed)" % ("PASS" if not fails else "FAIL",
                                                               len(RESULTS) - len(fails), len(RESULTS)))
sys.exit(1 if fails else 0)
