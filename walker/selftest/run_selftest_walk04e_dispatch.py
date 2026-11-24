#!/usr/bin/env python3
"""WALK-04e dispatch-wiring self-test (seat B10): reverify routing for the
clickpersist recipes.

No browser, no tier 2: the wiring is a routing layer, so the pins are
routing pins —
  * classify() sends representative ticket texts to dead_click / computed /
    upload, and the new word sets do NOT steal neighbouring classes
    (validation, export, chat, tab_error, http, persistence, crud_missing);
  * ORDER / CATEGORY_WORDS / WRITE_CATS integrity;
  * the driver hands the recipes the right arguments (recipes stubbed,
    LensWalk stubbed) and returns their verdict dicts untouched;
  * run_persistence_check returns None when the ticket names no label, so
    the smoke path keeps its standing decision for unlabelled tickets.
Live exercise of the recipes themselves is the walker desk's run
(GB-1542), not this seat's; the recipes' own behaviour is pinned by
run_selftest_walk04e.py.
"""
import os, sys, types

HERE = os.path.dirname(os.path.abspath(__file__))
WALKER = os.path.dirname(HERE)
sys.path.insert(0, WALKER)
sys.path.insert(0, HERE)

from concord_walker import reverify as rv_mod
from concord_walker import clickpersist as cp
from concord_walker.tickets import CATEGORY_WORDS
import concord_walker.checks as checks_mod

results = {}


def check(name, cond):
    results[name] = bool(cond)
    print(("PASS " if cond else "FAIL ") + name, flush=True)


def T(title, actual="", expected="", steps=None):
    return {"lens": "testlens", "title": title, "actual": actual,
            "expected": expected, "repro_steps": steps or []}


# ------------------------------------------------------------- classify
check("classify: 'Save' button does nothing when clicked -> dead_click",
      rv_mod.classify(T("'Save' button does nothing when clicked")) == "dead_click")
check("classify: clicking 'Submit' sends no request -> dead_click",
      rv_mod.classify(T("Clicking 'Submit' sends no request")) == "dead_click")
check("classify: cart total shows the wrong amount -> computed",
      rv_mod.classify(T("Cart total shows the wrong amount")) == "computed")
check("classify: invoice total is wrong -> computed",
      rv_mod.classify(T("Invoice total is wrong")) == "computed")
check("classify: cannot upload an avatar image -> upload",
      rv_mod.classify(T("Cannot upload an avatar image")) == "upload")
check("classify: uploading a photo does nothing -> upload (not dead_click)",
      rv_mod.classify(T("Uploading a photo does nothing")) == "upload")

# Neighbouring classes keep their tickets.
check("classify neighbour: blank form accepted -> validation",
      rv_mod.classify(T("Form accepts a blank title with no error message")) == "validation")
check("classify neighbour: export produces no file -> export",
      rv_mod.classify(T("Export produces no file")) == "export")
check("classify neighbour: assistant reply never arrives -> chat",
      rv_mod.classify(T("Assistant reply never arrives in chat")) == "chat")
check("classify neighbour: save returns 500 -> http",
      rv_mod.classify(T("Save returns 500")) == "http")
check("classify neighbour: 'Q3 Plan' disappears after reload -> persistence",
      rv_mod.classify(T("'Q3 Plan' disappears after reload")) == "persistence")
check("classify neighbour: no way to delete -> crud_missing",
      rv_mod.classify(T("No way to delete a stale entry")) == "crud_missing")
check("classify neighbour: something went wrong -> tab_error",
      rv_mod.classify(T("Tab shows something went wrong")) == "tab_error")
check("classify precedence: dead click beats computed in one title",
      rv_mod.classify(T("Total is wrong and the save button does nothing when clicked")) == "dead_click")

# ------------------------------------------------------------- integrity
check("integrity: ORDER and CATEGORY_WORDS name the same categories",
      set(rv_mod.ORDER) == set(CATEGORY_WORDS))
check("integrity: WRITE_CATS is a subset of ORDER",
      rv_mod.WRITE_CATS <= set(rv_mod.ORDER))
check("integrity: dead_click and upload are write cats; computed is not",
      "dead_click" in rv_mod.WRITE_CATS and "upload" in rv_mod.WRITE_CATS
      and "computed" not in rv_mod.WRITE_CATS)

# ------------------------------------------------------------- driver
class FakeCtx:
    pass


class FakeWalk:
    url = "https://example.invalid/lenses/testlens"

    def __init__(self, *a, **k):
        self.closed = False

    def open(self):
        return FakeCtx(), object(), object()

    def nav(self, page, cdp):
        pass

    def _close(self, ctx):
        self.closed = True

    def shot(self, page, name):
        return "shot:%s" % name


checks_mod.LensWalk = FakeWalk
stub_rv = types.SimpleNamespace(
    b=object(), cfg={"fixture_prefix": "qa",
                     "viewport_desktop": {"width": 1280, "height": 900}},
    rec=types.SimpleNamespace(rid="run1"),
    inv={"testlens": {"slug": "testlens"}}, log=lambda *a: None,
    account_for=lambda lens: (None, False))

calls = {}
SENTINEL = {"verdict": "FIXED", "method": "stub", "category": "stub",
            "evidence": [], "notes": "stub"}


def stub_click(walk, page, cdp, **kw):
    calls["click"] = kw
    return dict(SENTINEL)


def stub_computed(walk, page, cdp, **kw):
    calls["computed"] = kw
    return dict(SENTINEL)


def stub_upload(walk, page, cdp, **kw):
    calls["upload"] = kw
    calls["upload_file_existed"] = os.path.exists(kw["fixture_path"])
    return dict(SENTINEL)


def stub_persistence(walk, page, cdp, **kw):
    calls["persistence"] = kw
    return dict(SENTINEL)


cp.click_recipe, cp.computed_recipe = stub_click, stub_computed
cp.upload_recipe, cp.persistence_recipe = stub_upload, stub_persistence

r = cp.run_clickpersist_check(stub_rv, T("Clicking 'Save' creates 'Q3 Plan'"), "dead_click")
check("driver: dead_click hands element + label to click_recipe",
      calls["click"].get("element_name") == "Save" and calls["click"].get("label") == "Q3 Plan")
check("driver: dead_click returns the recipe verdict untouched", r == SENTINEL)

calls.pop("click", None)
r = cp.run_clickpersist_check(stub_rv, T("button does nothing when clicked"), "dead_click")
check("driver: dead_click with no named control -> NEEDS_HUMAN, recipe untouched",
      r["verdict"] == "NEEDS_HUMAN" and "click" not in calls)

r = cp.run_clickpersist_check(stub_rv, T("Invoice total is wrong", expected="Total should read $42.00"), "computed")
check("driver: computed hands the ticket text to computed_recipe",
      "42.00" in calls["computed"].get("ticket_text_value", ""))
check("driver: computed returns the recipe verdict untouched", r == SENTINEL)

r = cp.run_clickpersist_check(stub_rv, T("Cannot upload an avatar image"), "upload")
check("driver: upload fixture is this run's named file, present at call time",
      calls["upload"].get("fixture_name") == "qa-upload-run1.png"
      and calls["upload_file_existed"] is True)
check("driver: upload fixture is cleaned up after the run",
      not os.path.exists(calls["upload"]["fixture_path"]))

r = cp.run_persistence_check(stub_rv, T("Items vanish after reload"))
check("driver: persistence with no named label -> None (smoke keeps the decision)",
      r is None and "persistence" not in calls)
r = cp.run_persistence_check(stub_rv, T("'Q3 Plan' disappears after reload"))
check("driver: persistence hands the named label to persistence_recipe",
      calls["persistence"].get("label") == "Q3 Plan" and r == SENTINEL)

failed = [k for k, v in results.items() if not v]
print("\n%d/%d PASS" % (len(results) - len(failed), len(results)))
if failed:
    print("FAILED:", ", ".join(failed))
sys.exit(1 if failed else 0)
