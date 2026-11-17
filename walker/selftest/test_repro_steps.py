#!/usr/bin/env python3
"""repro_steps executor (repro.py): step mapping, execution, expected-outcome checks.
Pure python — a FakeDriver stands in for the browser. Run: python3 selftest/test_repro_steps.py
Every FIXED here needs: all steps mapped + executed AND `expected` machine-checked."""
import os, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from concord_walker import repro

FAILS = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (" " + str(extra)[:300] if extra and not cond else ""))
    if not cond:
        FAILS.append(name)


class FakeDriver:
    """Scriptable page: `controls` is what click()/snapshot() can see; `after_click` mutates state."""

    def __init__(self, controls=None, texts=None, dialogs=None, errors=0, after_click=None):
        self.controls = controls if controls is not None else []
        self.texts, self.dialogs, self.errors = texts or [], dialogs or [], errors
        self.after_click = after_click or {}
        self.calls = []

    def open(self, target):
        self.calls.append(("open", target))

    def reload(self):
        self.calls.append(("reload",))

    def press(self, key):
        self.calls.append(("press", key))

    def click(self, name, role=None):
        names = [c["name"] for c in self.controls if role is None or c.get("role") == role]
        from concord_walker.matching import fuzzy_match
        hit = fuzzy_match(name, names)
        self.calls.append(("click", name, hit))
        if hit and hit in self.after_click:
            self.after_click[hit](self)
        return hit

    def type_into(self, name, value):
        self.calls.append(("type", name))
        return any(c["name"] == name for c in self.controls)

    def snapshot(self):
        return {"controls": self.controls, "texts": self.texts, "dialogs": self.dialogs, "errors": self.errors, "url": "x"}

    def screenshot(self, name):
        return "ev/%s.png" % name


def btn(name, **kw):
    return dict({"name": name, "role": "button", "enabled": True, "focused": False, "props": {}}, **kw)


def T(steps, expected, **kw):
    return dict({"id": "FIX-demo-001", "lens": "demo", "repro_steps": steps, "expected": expected, "actual": "x", "title": "t"}, **kw)


def test_mapping():
    m = lambda s: repro.map_step(s, "film-studios")
    r = m("Open https://concord-os.org/lenses/film-studios")
    check("open URL step maps", r["mapped"] and r["action"] == "open" and r["target"].endswith("/lenses/film-studios"), r)
    r = m("Open the film studios lens")
    check("open <this lens> maps to the lens root", r["mapped"] and r["action"] == "open" and r["target"] is None, r)
    r = m("Attempt to select a project/row in the list")
    check("generic 'select a project/row' is NOT mapped", not r["mapped"], r)
    r = m("Click 'Filters'")
    check("click quoted control maps", r["mapped"] and r["action"] == "click" and r["name"] == "Filters", r)
    r = m("Click the New Proposal button")
    check("click unquoted capitalised control maps", r["mapped"] and r["name"] == "New Proposal", r)
    r = m("Open the Analytics tab")
    check("open tab maps", r["mapped"] and r["action"] == "open_tab" and r["name"] == "Analytics", r)
    r = m("Press Escape")
    check("press key maps", r["mapped"] and r["action"] == "press" and r["key"] == "Escape", r)
    r = m("Type 'hello' into the Search field")
    check("fill maps", r["mapped"] and r["action"] == "fill" and r["name"] == "Search", r)
    r = m("Observe selection state and whether controls enable")
    check("observe maps (no-op)", r["mapped"] and r["action"] == "observe", r)
    r = m("Reload the page")
    check("reload maps", r["mapped"] and r["action"] == "reload", r)
    r = m("Open Chat at 390x844")
    check("viewport change is not mapped", not r["mapped"], r)
    r = m("see evidence")
    check("'see evidence' is not a step", not r["mapped"], r)
    check("string repro_steps split on numbering", repro.split_steps({"repro_steps": "1. Click 'A'\n2. Press Escape"}) == ["Click 'A'", "Press Escape"])


def test_fixed_needs_everything():
    d = FakeDriver(controls=[btn("Filters")], after_click={"Filters": lambda s: s.dialogs.append("Filters")})
    t = T(["Open the demo lens", "Click 'Filters'", "Press Escape"], "The Filters dialog closes")
    # Escape does not close it -> expected violated -> STILL_FAILING
    r = repro.run_repro(t, d, lens_slug="demo")
    check("all steps run, expected violated -> STILL_FAILING", r["verdict"] == "STILL_FAILING" and all(s["executed"] for s in r["steps"]), r)
    check("per-step mapped/executed/result recorded", [s["n"] for s in r["steps"]] == [1, 2, 3] and all(s["mapped"] and s["result"] for s in r["steps"]), r["steps"])
    d2 = FakeDriver(controls=[btn("Filters")], after_click={"Filters": lambda s: s.dialogs.append("Filters")})
    d2.press = lambda k: (d2.calls.append(("press", k)), d2.dialogs.clear())
    r = repro.run_repro(t, d2, lens_slug="demo")
    check("all mapped + executed + expected machine-checked -> FIXED", r["verdict"] == "FIXED" and r["basis"] == "repro-steps", r)
    check("FIXED carries evidence + the checked clause", r["evidence"] and r["expected"]["state"] == "pass" and r["expected"]["clauses"][0]["clause"], r)
    d3 = FakeDriver(controls=[btn("Filters")], texts=["Filters"])
    repro.run_repro(T(["Click 'Filters'"], "Filters is visible"), d3, lens_slug="demo")
    check("starts at the lens root when no step opens", d3.calls[0] == ("open", None), d3.calls)
    check("the click really happened on the driver", ("click", "Filters", "Filters") in d2.calls, d2.calls)


def test_unmapped_runs_nothing():
    d = FakeDriver(controls=[btn("Filters")])
    t = T(["Open the demo lens", "Attempt to select a project/row in the list", "Click 'Filters'"], "Filters is visible")
    r = repro.run_repro(t, d, lens_slug="demo")
    check("unmapped step -> NEEDS_HUMAN naming that step", r["verdict"] == "NEEDS_HUMAN" and "step 2" in r["notes"] and "select a project/row" in r["notes"], r["notes"])
    check("NOTHING was executed (no half-run repro)", d.calls == [] and not any(s["executed"] for s in r["steps"]), d.calls)
    check("unmapped step is flagged mapped=False", [s["mapped"] for s in r["steps"]] == [True, False, True], r["steps"])


def test_not_executed_is_human():
    d = FakeDriver(controls=[btn("Other")])
    r = repro.run_repro(T(["Click 'Filters'"], "Filters is visible"), d, lens_slug="demo")
    check("named control missing -> NEEDS_HUMAN (not STILL_FAILING, not FIXED)", r["verdict"] == "NEEDS_HUMAN" and "step 1" in r["notes"] and not r["steps"][0]["executed"], r)
    d = FakeDriver(controls=[btn("Save")])
    r = repro.run_repro(T(["Click 'Save'"], "Save is visible"), d, lens_slug="demo")
    check("write/destructive control refused by the click policy, never clicked", r["verdict"] == "NEEDS_HUMAN" and not any(c[0] == "click" for c in d.calls), (r["notes"], d.calls))
    d = FakeDriver(controls=[{"name": "Search", "role": "textbox", "enabled": True}])
    r = repro.run_repro(T(["Type 'abc' into the Search field"], "Search is visible"), d, lens_slug="demo", allow_fill=False)
    check("fill refused on a read-only (write-skip/admin) lens", r["verdict"] == "NEEDS_HUMAN" and not any(c[0] == "type" for c in d.calls), r["notes"])
    d = FakeDriver(controls=[{"name": "Search", "role": "textbox", "enabled": True}], texts=["Search"])
    r = repro.run_repro(T(["Type 'abc' into the Search field"], "Search is visible"), d, lens_slug="demo", allow_fill=True)
    check("fill allowed on a normal lens (own labelled value, no submit)", r["verdict"] == "FIXED" and ("type", "Search") in d.calls, r)


def test_expected_must_be_checkable():
    d = FakeDriver(controls=[btn("Filters")])
    r = repro.run_repro(T(["Click 'Filters'"], "Everything feels responsive and looks right"), d, lens_slug="demo")
    check("expected with no predicate -> NEEDS_HUMAN naming the clause", r["verdict"] == "NEEDS_HUMAN" and "not machine-checkable" in r["notes"], r["notes"])
    r = repro.run_repro(T(["Click 'Filters'"], ""), d, lens_slug="demo")
    check("blank expected -> NEEDS_HUMAN", r["verdict"] == "NEEDS_HUMAN", r["notes"])
    r = repro.run_repro(T(["Click 'Filters'"], "Filters is visible and the page looks right"), d, lens_slug="demo")
    check("ONE unchecked clause blocks FIXED even if the other passes", r["verdict"] == "NEEDS_HUMAN", r["notes"])
    r = repro.run_repro(T([], "Filters is visible"), d, lens_slug="demo")
    check("no repro_steps -> NEEDS_HUMAN", r["verdict"] == "NEEDS_HUMAN" and "no repro_steps" in r["notes"], r)


def test_predicates():
    snap = {"controls": [btn("Export", enabled=False), btn("Save draft", props={"selected": True}),
                         btn("Composer", focused=True)], "texts": ["Welcome back", "Reports"], "dialogs": [], "errors": 0}
    c = lambda s: repro.check_clause(s, snap)
    check("enabled: violated", c("The Export button is enabled")[0] == "fail")
    check("disabled: holds", c("The Export button is disabled")[0] == "pass")
    check("selected prop", c("'Save draft' is selected")[0] == "pass")
    check("focus returns", c("Focus returns to the Composer")[0] == "pass")
    check("text shown", c("Shows 'Reports'")[0] == "pass" and c("Shows 'Missing thing'")[0] == "fail")
    check("'The dialog closes' with no close action recorded is unchecked (nothing proves it was ever open)", c("The dialog closes")[0] == "unchecked")
    ev_c = dict(snap, evidence={"popups_before": 1, "closer": "Escape"})
    check("'The dialog closes' passes only with a recorded close of an open popup", repro.check_clause("The dialog closes", ev_c)[0] == "pass")
    check("no errors", c("No console errors")[0] == "pass")
    check("vague clause is unchecked", c("It should feel fast")[0] == "unchecked")
    bad = dict(snap, errors=2)
    check("page errors violate 'no errors'", repro.check_clause("No console errors", bad)[0] == "fail")
    bad = dict(snap, texts=["Application error: a client-side exception"])
    check("error text violates 'no errors'", repro.check_clause("Renders without errors", bad)[0] == "fail")


def test_playwright_driver_adapter():
    """PlaywrightDriver against fake page/CDP objects (no browser): path rebasing, AX-name clicks, snapshot shape."""
    from concord_walker.cdp import AXTree

    def node(i, role, name, backend, **props):
        return {"nodeId": str(i), "role": {"value": role}, "name": {"value": name}, "backendDOMNodeId": backend,
                "properties": [{"name": k, "value": {"value": v}} for k, v in props.items()]}

    class FakeCdp:
        def __init__(self):
            self.clicked, self.focused = [], []

        def ax(self):
            return AXTree([node(1, "button", "Filters", 11), node(2, "tab", "Analytics", 12),
                           node(3, "textbox", "Search", 13), node(4, "button", "Export", 14, disabled=True),
                           node(5, "StaticText", "Welcome", 15), node(6, "dialog", "Filters panel", 16)])

        def click(self, b):
            self.clicked.append(b)
            return True

        def focus(self, b):
            self.focused.append(b)
            return True

    class FakePage:
        url = "http://fixture/lenses/demo"

        def __init__(self):
            self.typed, self.keys = [], []
            self.keyboard = self

        def press(self, k):
            self.keys.append(k)

        def type(self, v):
            self.typed.append(v)

    class FakeLw:
        cfg = {"base_url": "http://fixture"}
        th = {"nav_timeout_ms": 1, "settle_ms_judgment": 1}
        page_errors, console_errors = ["boom"], []
        url = "http://fixture/lenses/demo"

        def __init__(self):
            self.navs = []

        def nav(self, page, cdp):
            self.navs.append(self.url)

        def shot(self, page, name):
            return "ev/%s.png" % name

        def _close(self, ctx):
            pass

    lw, cdp, page = FakeLw(), FakeCdp(), FakePage()
    d = repro.PlaywrightDriver(lw, None, page, cdp, "http://fixture/lenses/demo")
    d.open("https://concord-os.org/lenses/demo")
    d.open("https://concord-os.org/lenses/other/sub")
    check("ticket URLs are rebased onto this run's base_url (a fixture run never reaches prod)",
          lw.navs == ["http://fixture/lenses/demo", "http://fixture/lenses/other/sub"], lw.navs)
    check("click resolves the AX name by fuzzy match and clicks its backend node", d.click("Filters") == "Filters" and cdp.clicked == [11])
    check("tab click is restricted to role=tab", d.click("Analytics", role="tab") == "Analytics" and d.click("Filters", role="tab") is None)
    check("click of an absent control returns None, never clicks", d.click("Nope") is None and cdp.clicked == [11, 12])
    check("type_into focuses the field and types without submitting", d.type_into("Search", "v") and cdp.focused == [13] and page.typed == ["v"] and "Enter" not in page.keys)
    snap = d.snapshot()
    check("snapshot: controls with enabled flag, texts, dialogs, error count",
          any(c["name"] == "Export" and c["enabled"] is False for c in snap["controls"]) and "Welcome" in snap["texts"]
          and snap["dialogs"] == ["Filters panel"] and snap["errors"] == 1, snap)


if __name__ == "__main__":
    for fn in (test_playwright_driver_adapter, test_mapping, test_fixed_needs_everything, test_unmapped_runs_nothing, test_not_executed_is_human,
               test_expected_must_be_checkable, test_predicates):
        fn()
    print("\n%d failure(s)" % len(FAILS))
    sys.exit(1 if FAILS else 0)
