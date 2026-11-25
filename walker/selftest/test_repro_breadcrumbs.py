#!/usr/bin/env python3
"""Breadcrumb / navigation-prose mapper (repro.expand_step) + executor on sub-steps.
Pure python (FakeDriver). Every string below is a REAL repro_step from the ticket fold
(fold.extract_from_git on 272e62f41). Run: python3 selftest/test_repro_breadcrumbs.py

Honesty properties pinned here:
  * a breadcrumb expands to ordered sub-actions, each recorded mapped/executed/result;
  * genuinely unmappable prose stays UNMAPPED and the notes name the step;
  * a crumb whose control is absent -> NEEDS_HUMAN naming the step, never FIXED;
  * nothing is run when any segment is unmapped; no guessed step ever verifies."""
import os, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from concord_walker import repro

FAILS = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (" " + str(extra)[:300] if extra and not cond else ""))
    if not cond:
        FAILS.append(name)


def acts(lens, step):
    e = repro.expand_step(step, lens)
    return e["mapped"], [(x["action"], x.get("name") or x.get("key"), x.get("count")) for x in e["substeps"]], e.get("reason")


# (lens, real step, expected [(action, name|key, count)])
MAPPED = [
    ("global", "Global > Search view > type X", [("noop", None, None), ("fill", "Search view", None)]),
    ("global", "Explorer > Scatter", [("click", "Explorer", None), ("click", "Scatter", None)]),
    ("global", "Any sub-tab > Save view", [("open_any_tab", None, None), ("click", "Save view", None)]),
    ("global", "Tab to view tabs > ArrowRight", [("focus_tab_list", None, None), ("press", "ArrowRight", 1)]),
    # mapper-vocab: a terminal Export (+ format) is the walker's own export check, not three bare clicks
    ("global", "Save view > Export > JSON", [("click", "Save view", None), ("export_check", None, None)]),
    ("council", "Council > New Proposal", [("noop", None, None), ("click", "New Proposal", None)]),
    ("council", "Open New Proposal", [("click", "New Proposal", None)]),
    ("council", "Press Esc", [("press", "Escape", None)]),
    ("code", "Try Esc then Tab, Ctrl+M, Shift+Tab", [("press", "Escape", 1), ("press", "Tab", 1), ("press", "Control+M", 1), ("press", "Shift+Tab", 1)]),
    ("fractal", "Share > Escape / Shift+Tab", [("click", "Share", None), ("press", "Escape", 1), ("press", "Shift+Tab", 1)]),
    ("lfg", "Assistant > Esc", [("click", "Assistant", None), ("press", "Escape", 1)]),
    ("linguistics", "Open Share, Tab x9; open Export, Tab; press Esc",
     [("click", "Share", None), ("press", "Tab", 9), ("click", "Export", None), ("press", "Tab", 1), ("press", "Escape", 1)]),
    ("courtship", "Open the Export menu and press Esc.", [("click", "Export", None), ("press", "Escape", 1)]),
    ("frontier", "https://concord-os.org/lenses/frontier: Export > JSON, then CSV",
     [("open", None, None), ("export_check", None, None)]),
    ("productivity", "Lens tools > Quick capture > Capture", [("click", "Lens tools", None), ("click", "Quick capture", None), ("click", "Capture", None)]),
    ("forestry", "Fire Watch > Load active fires; Show fire perimeter",
     [("click", "Fire Watch", None), ("click", "Load active fires", None), ("click", "Show fire perimeter", None)]),
    ("projects", "Open Share > press Escape", [("click", "Share", None), ("press", "Escape", 1)]),
    ("export", "Open Help and feedback, press Tab x16", [("click", "Help and feedback", None), ("press", "Tab", 16)]),
    ("global", "On /lenses/global as zuko_qa_t1 (role member), Explorer > Scatter", [("click", "Explorer", None), ("click", "Scatter", None)]),
]
for lens, step, want in MAPPED:
    ok, got, why = acts(lens, step)
    check("maps: %s | %s" % (lens, step[:60]), ok and got == want, (got, why))

# genuinely unmappable real prose: stays UNMAPPED, reason names the problem
UNMAPPED = [
    ("graph", "Click the parent row", "no specific control"),
    ("studio", "Open own Studio project", "no specific control"),
    ("chat", "Focus composer and send a message", "no specific control"),
    ("calendar", "Open event detail, press Escape", "no specific control"),
    # "Set tempo to 0, then 999" now maps (pass 3 typed values; pinned in test_typed_values_pass3.py)
    # "Tab to Schedules, ArrowRight; Ctrl+K, Esc" now maps (pre-capture keyboard actions)
    ("mental-health", "Mood > check in with note 'qa-zt1-mental-health-2026-11-10'", "check in"),
    ("wellness", "Log sleep 7.5 then 30; view Trend Sleep and Overview", ""),
]
for lens, step, why_sub in UNMAPPED:
    e = repro.expand_step(step, lens)
    check("unmapped: %s | %s" % (lens, step[:60]), (not e["mapped"]) and e["substeps"] == [] and why_sub in (e["reason"] or ""), e)

# mapper-vocab: these used to be refused outright; they now map to the walker's own checks (see test_mapper_vocab.py)
for lens, step, want in [
    ("board", "Open Board at 390×844 device toolbar", ["set_viewport", "check_overflow"]),
    ("daily", "On /lenses/daily as zuko_qa_t1, resize the viewport to 390×844, open Today, and inspect the calendar", ["set_viewport", "check_overflow", "click", "observe"]),
    ("ghost-tracker", "Open the lens and click Scan for residues", ["noop", "click"]),
    ("board", "Hard reload", ["reload"]),
    ("code", "Tab through, check the accessibility tree", ["tab_sweep", "check_ax"]),
    # pre-capture: every comma piece is an explicit key / named target, so the whole step maps (was unmapped before the keyboard layer)
    ("global", "Tab to Schedules, ArrowRight; Ctrl+K, Esc", ['tab_to', 'press', 'press', 'press']),
]:
    e = repro.expand_step(step, lens)
    check("now maps to walker vocab: %s | %s" % (lens, step[:50]), e["mapped"] and [x["action"] for x in e["substeps"]] == want, e)

# the lens-name crumb is a no-op, but ONLY the current lens's name
ok, got, _ = acts("council", "Council > New Proposal")
check("own lens name = no-op 'already on lens'", got[0][0] == "noop")
ok, got, _ = acts("council", "Debate > New Proposal")
check("another lens's name is a click, not a no-op", got[0] == ("click", "Debate", None), got)
# a path crumb opens the lens path; a quoted literal types only into a search/filter field
ok, got, _ = acts("global", "Search view > type 'zzz'")
e = repro.expand_step("Search view > type 'zzz'", "global")
check("quoted literal into a search field is typed as that literal", e["substeps"][-1]["literal"] == "zzz", e)
e = repro.expand_step("Title > type 'zzz'", "demo")
check("quoted literal into a NON-search field maps to a typed test value (write mode only at run time)", e["mapped"] and e["substeps"][-1]["action"] == "type_value", e)


# ------------------------------------------------------------------ executor
class FakeDriver:
    def __init__(self, controls=None, tabs=("Overview", "Details"), texts=None, has_focus_role=True):
        self.controls = controls or []
        self.tabs, self.texts, self.calls = list(tabs), texts or [], []
        if not has_focus_role:
            self.focus_role = None

    def open(self, t): self.calls.append(("open", t))
    def reload(self): self.calls.append(("reload",))
    def press(self, k): self.calls.append(("press", k))

    def click(self, name, role=None):
        from concord_walker.matching import fuzzy_match
        pool = [c["name"] for c in self.controls if role is None or c.get("role") == role]
        hit = fuzzy_match(name, pool)
        self.calls.append(("click", name, hit))
        return hit

    def type_into(self, name, value):
        self.calls.append(("type", name, value))
        return any(c["name"] == name for c in self.controls)

    def tab_names(self): return list(self.tabs)
    def focus_role(self, role): self.calls.append(("focus_role", role)); return self.tabs[0] if self.tabs else None
    def snapshot(self): return {"controls": self.controls, "texts": self.texts, "dialogs": [], "errors": 0, "url": "x"}
    def screenshot(self, n): return "ev/%s.png" % n


def btn(name, role="button"):
    return {"name": name, "role": role, "enabled": True, "focused": False, "props": {}}


def T(steps, expected, **kw):
    return dict({"id": "FIX-global-006", "lens": "global", "repro_steps": steps, "expected": expected, "actual": "x", "title": "t"}, **kw)


d = FakeDriver([btn("Explorer"), btn("Scatter")], texts=["Scatter plot"])
r = repro.run_repro(T(["Explorer > Scatter"], "Shows 'Scatter plot'"), d, lens_slug="global")
check("breadcrumb runs each crumb in order, records per sub-step", r["verdict"] == repro.FIXED
      and [s["action"] for s in r["steps"]] == ["click", "click"] and all(s["mapped"] and s["executed"] for s in r["steps"])
      and [c[1] for c in d.calls if c[0] == "click"] == ["Explorer", "Scatter"], r)
check("each sub-step carries original step number + sub index", [(s["step"], s["sub"]) for s in r["steps"]] == [(1, 1), (1, 2)], r["steps"])

d = FakeDriver([btn("Explorer")])
r = repro.run_repro(T(["Explorer > Scatter"], "Shows 'Scatter plot'"), d, lens_slug="global")
check("crumb whose control is absent -> NEEDS_HUMAN naming the step, not FIXED",
      r["verdict"] == repro.HUMAN and "Scatter" in r["notes"] and "step 1" in r["notes"] and r["steps"][-1]["executed"] is False, r)

d = FakeDriver([btn("Explorer")])
r = repro.run_repro(T(["Explorer > Scatter", "Reselect the thread in history"], "x"), d, lens_slug="global")
check("an unmappable step anywhere -> nothing runs, notes name that step", r["verdict"] == repro.HUMAN and d.calls == []
      and "step 2" in r["notes"] and "Reselect" in r["notes"], (r["notes"], d.calls))

d = FakeDriver([btn("Explorer"), btn("Scatter")])
r = repro.run_repro(T(["Explorer > Scatter"], "Usable"), d, lens_slug="global")
check("all steps ran but `expected` not machine-checkable -> NEEDS_HUMAN, never FIXED", r["verdict"] == repro.HUMAN and "not machine-checkable" in r["notes"], r)

d = FakeDriver([btn("Explorer"), btn("Scatter")], texts=["Other"])
r = repro.run_repro(T(["Explorer > Scatter"], "Shows 'Heatmap'"), d, lens_slug="global")
check("all steps ran + predicate violated -> STILL_FAILING", r["verdict"] == repro.STILL, r)

d = FakeDriver(tabs=("Overview", "Details"), controls=[btn("Save view"), btn("Overview", "tab"), btn("Details", "tab")])
r = repro.run_repro(T(["Any sub-tab > Save view"], "Shows 'x'"), d, lens_slug="global")
check("'any sub-tab' picks the FIRST safe tab and says so; Save view is a write step -> refused without --allow-write",
      r["steps"][0]["executed"] and "first of 2" in r["steps"][0]["result"] and "'Overview'" in r["steps"][0]["result"]
      and r["verdict"] == repro.HUMAN and "write step needs --allow-write" in r["notes"], r)

d = FakeDriver(tabs=("Delete everything", "Reset"))
r = repro.run_repro(T(["Any sub-tab > Export"], "x"), d, lens_slug="global")
check("'any sub-tab' skips tabs the click policy refuses; none left -> NEEDS_HUMAN", r["verdict"] == repro.HUMAN and "no safe sub-tab" in r["notes"], r)

d = FakeDriver(tabs=())
r = repro.run_repro(T(["Tab to view tabs > ArrowRight"], "x"), d, lens_slug="global")
check("no tab list to focus -> NEEDS_HUMAN, ArrowRight not sent", r["verdict"] == repro.HUMAN and ("press", "ArrowRight") not in d.calls, (r["notes"], d.calls))

d = FakeDriver(tabs=("Overview",))
r = repro.run_repro(T(["Tab to view tabs > ArrowRight"], "No console errors"), d, lens_slug="global")
check("focus the tab list then press ArrowRight", ("focus_role", "tab") in d.calls and ("press", "ArrowRight") in d.calls and r["verdict"] == repro.FIXED, (r["notes"], d.calls))

d = FakeDriver(tabs=("Overview",), has_focus_role=False)
r = repro.run_repro(T(["Tab to view tabs > ArrowRight"], "x"), d, lens_slug="global")
check("a driver that cannot focus a tab list -> NEEDS_HUMAN (no guessed Tab press)", r["verdict"] == repro.HUMAN, r)

d = FakeDriver([btn("Search view")])
r = repro.run_repro(T(["Global > Search view > type X"], "No console errors"), d, lens_slug="global")
check("'type X' types the own labelled qa-walker value (not X) and does not submit", r["verdict"] == repro.FIXED
      and ("type", "Search view", "qa-walker replay value") in d.calls and "not submitted" in r["steps"][-1]["result"], (r["notes"], d.calls))

d = FakeDriver([btn("Search view")])
r = repro.run_repro(T(["Global > Search view > type X"], "No console errors"), d, lens_slug="global", allow_fill=False)
check("read-only lens: fill refused -> NEEDS_HUMAN", r["verdict"] == repro.HUMAN and "read-only" in r["notes"], r)

d = FakeDriver([btn("Help and feedback")])
r = repro.run_repro(T(["Open Help and feedback, press Tab x16"], "No console errors"), d, lens_slug="export")
check("key repeat count is honoured (x16)", [c for c in d.calls if c[0] == "press"] == [("press", "Tab")] * 16 and r["verdict"] == repro.FIXED, r)

d = FakeDriver([btn("Help and feedback tips")])
r = repro.run_repro(T(["Open Help and feedback"], "No console errors"), d, lens_slug="export")
check("multi-word label must match exactly (a loose fuzzy hit is not accepted)", r["verdict"] == repro.HUMAN and "matched only loosely" in r["notes"], r)

# payment/billing/admin/destructive crumbs are refused with and without a write context
d = FakeDriver([btn("Upgrade plan"), btn("Delete account")])
r = repro.run_repro(T(["Upgrade plan"], "x"), d, lens_slug="global")
check("click on a payment control is refused (read-only mode)", r["verdict"] == repro.HUMAN and r["steps"][-1]["executed"] is False, r)

# ---- GB-1581 item 4: generic verb forms, first-of-role, attempts, overlays ----
class RoleDriver(FakeDriver):
    def names_of_role(self, role):
        return [c["name"] for c in self.controls if c.get("role") == role]


def acts(step, lens="global"):
    r = repro.expand_step(step, lens)
    return r["mapped"], [(x.get("action"), x.get("name"), x.get("first_of_role"), bool(x.get("attempt"))) for x in r["substeps"]]

check("GB1581: 'Type into a field' maps to a first-of-role fill", acts("Type into a field") == (True, [("fill", None, "textbox", False)]), acts("Type into a field"))
check("GB1581: 'Attempt to tap the button' maps to an attempt first-of-role click", acts("Attempt to tap the button") == (True, [("click", None, "button", True)]), acts("Attempt to tap the button"))
check("GB1581: 'Open each overlay' maps to the overlay loop", acts("Open each overlay") == (True, [("open_each_overlay", None, None, False)]), acts("Open each overlay"))
check("GB1581: 'Click the button' maps to a first-of-role click", acts("Click the button") == (True, [("click", None, "button", False)]), acts("Click the button"))
check("GB1581: 'Click the first link' maps to a first-of-role click", acts("Click the first link") == (True, [("click", None, "link", False)]), acts("Click the first link"))

d = RoleDriver([btn("Alpha"), btn("Beta")])
r = repro.run_repro(T(["Click the button"], "No console errors"), d, lens_slug="global")
check("GB1581: first-of-role click targets the first button on the page", r["verdict"] == repro.FIXED and ("click", "Alpha", "Alpha") in d.calls, (r["notes"], d.calls))

d = RoleDriver([])
r = repro.run_repro(T(["Click the button"], "No console errors"), d, lens_slug="global")
check("GB1581: first-of-role with no such control -> NEEDS_HUMAN", r["verdict"] == repro.HUMAN, r)

d = RoleDriver([btn("Title", role="textbox")])
r = repro.run_repro(T(["Type into a field"], "No console errors"), d, lens_slug="global")
check("GB1581: 'type into a field' fills the first field on the page", r["verdict"] == repro.FIXED and any(c[0] == "type" and c[1] == "Title" for c in d.calls), (r["notes"], d.calls))

d = RoleDriver([btn("Other")])
r = repro.run_repro(T(["Attempt to tap Help"], "No console errors"), d, lens_slug="demo")
check("GB1581: an attempt whose target is absent is recorded, not failed", r["verdict"] == repro.FIXED and "attempt recorded" in r["steps"][-1]["result"], (r["notes"], r["steps"]))

d = RoleDriver([btn("Share"), btn("Export"), btn("Delete account")])
r = repro.run_repro(T(["Open each overlay"], "No console errors"), d, lens_slug="global")
check("GB1581: open-each-overlay opens only safe openers and Escapes each", r["verdict"] == repro.FIXED
      and [c[1] for c in d.calls if c[0] == "click"] == ["Share", "Export"] and d.calls.count(("press", "Escape")) == 2, (r["notes"], d.calls))

print("\n%d failure(s)" % len(FAILS))
sys.exit(1 if FAILS else 0)
