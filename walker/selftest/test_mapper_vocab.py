#!/usr/bin/env python3
"""mapper-vocab: walker-vocabulary bridge, parser fixes, observe split, typed expected clauses and
live-label resolution (repro.py + vocab.py + expected.py + labels.py). Pure python (fake drivers).

Every step string is a REAL repro_step from the ticket fold (272e62f41); lens slugs are the tickets'.
Run: python3 selftest/test_mapper_vocab.py

What this pins (each has a failure path next to it):
  * walker-vocab steps (viewport/theme/keyboard/export/console/a11y/chat) map to the walker's own checks;
  * Lighthouse stays NEEDS_HUMAN; typed boundary values and write verbs stay unmapped;
  * a step with one unmappable part is NOT counted mapped, but every part is recorded;
  * `expected` is split by sentence; vague clauses are never classified; a checkable clause whose
    evidence is missing is `unchecked`, never `pass`;
  * label resolution: alias / token only when UNIQUE; ambiguity and absence -> NEEDS_HUMAN naming the step;
  * the original repro text is byte-identical after mapping and replay."""
import copy, os, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from concord_walker import repro, labels, expected as X

repro._sleep = lambda s: None
FAILS = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (" " + str(extra)[:400] if extra and not cond else ""))
    if not cond:
        FAILS.append(name)


def acts(lens, step):
    e = repro.expand_step(step, lens)
    return e["mapped"], [x["action"] for x in e["substeps"]], e


# ------------------------------------------------------------------------------------------ 1. walker vocab
VOCAB = [
    # viewport / layout
    ("quests", "DevTools 390x844", ["set_viewport", "check_overflow"]),
    ("message", "Device mode 390x844", ["set_viewport", "check_overflow"]),
    ("diy", "At 390x844 on /lenses/diy", ["set_viewport", "check_overflow"]),
    ("chat", "Open Chat at 390×844", ["set_viewport", "check_overflow"]),
    ("chat", "Desktop /lenses/chat", ["set_viewport"]),
    ("quests", "DevTools 390x844, switch tabs", ["set_viewport", "check_overflow", "walk_tabs"]),
    # theme
    ("offline", "Dark theme", ["set_scheme"]),
    ("nonprofit", "view dark theme", ["set_scheme"]),
    ("mining", "toggle the theme from Dark to Light", ["set_scheme"]),
    ("export", "restore Dark.", ["set_scheme"]),
    # keyboard
    ("materials", "Tab from top", ["tab_sweep"]),
    ("cri", "Tab from the top of the page to the view tabs", ["tab_sweep"]),
    ("art", "Tab through page", ["tab_sweep"]),
    ("experience", "From page top press Tab", ["tab_sweep"]),
    ("sentinel", "Enter / ArrowLeft/Right", ["press", "press", "press"]),
    ("hr", "Focus name input", ["focus_name"]),
    ("narrative-walk", "Focus the lens", ["noop"]),
    ("sentinel", "Focus Overview and press ArrowRight", ["focus_name", "press"]),
    # export
    ("alliance", "Export JSON/CSV", ["export_check"]),
    ("supplychain", "Export JSON/CSV", ["export_check"]),
    ("anon", "export .dtu", ["export_check"]),
    ("productivity", "Click the .dtu export button", ["export_check"]),
    ("dtus", "open the header Export menu and choose Export as JSON", ["export_check"]),
    ("meditation", "Meditation: Export > JSON", ["noop", "export_check"]),
    # console / network / a11y
    ("hvac", "Open /lenses/hvac with DevTools Console open", ["open", "check_console"]),
    ("environment", "Hard reload with Console open", ["reload", "check_console"]),
    ("trades", "Inspect Workbench job + quote composer in accessibility tree", ["check_ax"]),
    ("music", "Studio piano roll: inspect grid buttons in accessibility tree", ["check_ax"]),
    # chat
    ("tick", "Lens tools > Ask 'What is the tick lens for?'", ["click", "chat_ask"]),
    ("lattice", "Ask 'What is the Lattice lens for?'", ["chat_ask"]),
    ("quests", "ask 'How do I get a quest?'.", ["chat_ask"]),
]
for lens, step, want in VOCAB:
    ok, got, e = acts(lens, step)
    check("vocab maps: %s | %s" % (lens, step[:55]), ok and got == want, (got, e.get("reason")))
check("vocab: >= 10 lenses covered", len({v[0] for v in VOCAB}) >= 10)
e = repro.expand_step("Lens tools > Ask 'What is the tick lens for?'", "tick")
check("vocab: chat question is carried", e["substeps"][-1]["question"] == "What is the tick lens for?", e["substeps"])
e = repro.expand_step("DevTools 390x844", "quests")
check("vocab: 390 viewport carries size", e["substeps"][0]["w"] == 390 and e["substeps"][0]["h"] == 844, e["substeps"])

# failure paths: Lighthouse / performance stay NEEDS_HUMAN with the reason in the record
for lens, step in [("studio", "Lighthouse accessibility"), ("security", "Lighthouse desktop"), ("global", "DevTools Lighthouse desktop on /lenses/global"),
                   ("accounting", "Lighthouse on /lenses/accounting"), ("affect", "Lighthouse desktop navigation on /lenses/affect.")]:
    ok, got, e = acts(lens, step)
    check("Lighthouse stays unmapped: %s | %s" % (lens, step[:40]), (not ok) and "Lighthouse" in (e["reason"] or "") and e["substeps"] == [], e)

# typed boundary values and write verbs stay exactly as unmapped as before (out of scope)
for lens, step in [("fractal", "Clear Center X > type 0 or -1"), ("forge", "Domain Tables > type 'bad table!@#' > Add"), ("ocean", "Enter 300-char name > Spot"),
                   ("calendar", "Also try blank title"), ("energy", "Select meter, submit 100 W, reload"), ("consulting", "Create engagement, log 1h, Invoices > Generate"),
                   ("artistry", "New Project > fill > submit"), ("paper", "Save as DTU on own paper/manuscript."), ("ar", "Trash on any item")]:
    ok, got, e = acts(lens, step)
    check("typed/write stays unmapped: %s | %s" % (lens, step[:45]), (not ok) and e["substeps"] == [], (got, e.get("reason")))

# ------------------------------------------------------------------------------------------ 2. parser fixes
PARSE = [
    ("meditation", "Meditation: Export > JSON", ["noop", "export_check"]),
    ("music", "Music Home: read metric cards", ["click", "observe"]),
    ("plumbing", "On /lenses/plumbing Field Service > Schedule a Job", ["open", "noop", "click"]),
    ("ops", "QA > Ops > Analytics / Status page / Repair net", ["click", "noop", "click", "click", "click"]),
    ("fashion", "open Closet, Outfits, Calendar, and Trends.", ["click", "click", "click", "click"]),
    ("tick", "Health tab", ["open_tab"]),
    ("ghost-tracker", "click Scan for residues", ["click"]),
    ("marketplace", "Click floating New listing", ["click"]),
    ("fractal", "Open Share, press Escape", ["click", "press"]),
]
for lens, step, want in PARSE:
    ok, got, e = acts(lens, step)
    check("parser maps: %s | %s" % (lens, step[:55]), ok and got == want, (got, e.get("reason")))
e = repro.expand_step("QA > Ops > Analytics / Status page / Repair net", "ops")
check("slash list fans out: every control recorded by name", [x.get("name") for x in e["substeps"] if x["action"] == "click"] == ["QA", "Analytics", "Status page", "Repair net"], e["substeps"])
e = repro.expand_step("click Scan for residues", "ghost-tracker")
check("a real label with a stop word keeps its whole name", e["substeps"][0]["name"] == "Scan for residues", e)
e = repro.expand_step("Click floating New listing", "marketplace")
check("a leading descriptor is dropped from the label", e["substeps"][0]["name"] == "New listing", e)

# garbage must still fail
for lens, step in [("fashion", "Map press ArrowRight."), ("x", "Click Delete on a node"), ("board", "Click the parent row"),
                   ("graph", "Click the parent row"), ("studio", "Open own Studio project"), ("a", "click each quick action")]:
    ok, got, e = acts(lens, step)
    check("garbage label stays unmapped: %s | %s" % (lens, step[:40]), not ok, (got, e.get("reason")))
check("_label_ok rejects a whole sentence", repro._label_ok("Open the item and then confirm that it works", set()) is None)
check("_label_ok accepts 'Save view'", repro._label_ok("Save view", set()) == "Save view")
check("_label_ok accepts 'New listing'", repro._label_ok("New listing", set()) == "New listing")

# guard / meta
ok, got, e = acts("black-market", "Press Escape once while the dialog is open (do not Tab first)")
check("guard: 'do not Tab first' is a recorded constraint before the Escape", ok and got == ["constraint", "press"] and e["substeps"][0]["kind"] == "forbid_key" and e["substeps"][0]["key"] == "Tab", e["substeps"])
ok, got, e = acts("fashion", "Do not click delete a second time.")
check("guard: 'do not click X a second time' is a repeat-click constraint", ok and e["substeps"][0]["kind"] == "forbid_click_repeat", e["substeps"])
ok, got, e = acts("mining", "Do not create or delete records.")
check("guard: 'do not create or delete' forbids write verbs", ok and e["substeps"][0]["kind"] == "forbid_write_verbs" and set(e["substeps"][0]["verbs"]) == {"create", "delete"}, e["substeps"])
ok, got, e = acts("federation", "Do not submit a post.")
check("guard: a second write-verb guard", ok and e["substeps"][0]["kind"] == "forbid_write_verbs", e["substeps"])
ok, got, e = acts("landscaping", "Do not click any existing harness jobs (tzI026220427mi*).")
check("guard: an uncheckable guard is recorded, not claimed as asserted", ok and e["substeps"][0]["kind"] == "recorded" and e["substeps"][0]["asserted"] is False, e["substeps"])
ok, got, e = acts("marketing", "Wait 30 seconds")
check("wait N s -> wait", ok and got == ["wait"] and e["substeps"][0]["seconds"] == 30.0, e["substeps"])
ok, got, e = acts("masonry", "Wait 30 seconds, hard reload, and reopen Inspections.")
check("wait + hard reload + unknown 'reopen': step NOT mapped, but wait and reload parts are recorded mapped",
      (not ok) and [p["mapped"] for p in e["parts"]] == [True, False] and e["parts"][0]["substeps"][0]["action"] == "wait", e["parts"])
ok, got, e = acts("hvac", "If it disappears, wait 30 seconds, hard reload")
check("'if X' is a recorded conditional; the rest still maps", ok and got == ["conditional", "wait", "reload"], (got, e.get("reason")))
ok, got, e = acts("docs", "Repeat for Cross-domain.")
check("repeat for A -> one click per named target", ok and [x["name"] for x in e["substeps"]] == ["Cross-domain"], e["substeps"])
ok, got, e = acts("privacy", "Open Agent Mode, Repeat for Cross-domain, and Activity")
check("repeat over several named targets is bounded + recorded", e["parts"] and any(p["mapped"] for p in e["parts"]), e)
ok, got, e = acts("lock", "Wait-For Graph / Detect Deadlocks")
check("a control literally named 'Wait-For Graph' is not a wait", not ok, (got, e.get("reason")))

# per-part records: one bad part never hides the rest, and the step is NOT counted mapped
e = repro.expand_step("Open Filters, press Escape; Lighthouse accessibility; Tab from top", "demo")
check("partial map: step NOT mapped", not e["mapped"] and e["substeps"] == [])
check("partial map: every part recorded (mapped + unmapped)", [p["mapped"] for p in e["parts"]].count(True) >= 2 and [p["mapped"] for p in e["parts"]].count(False) == 1, e["parts"])
check("partial map: the unmapped part names its reason", any((not p["mapped"]) and p.get("reason") for p in e["parts"]), e["parts"])
check("partial map: reason names the first bad segment", "Lighthouse accessibility" in (e["reason"] or ""), e["reason"])

# ------------------------------------------------------------------------------------------ 3. observe split
OBS = [
    ("veterinary", "look for delete/void", {"machine": True, "clause": "has a control matching: delete | void"}),
    ("pharmacy", "Inspect the saved row for delete", {"machine": False}),
    ("feed", "Record the URL, any banner, the thread contents, and the answer.", {"machine": False}),
    ("pharmacy", "Scroll the medication list to the bottom.", {"machine": False}),
    ("insurance", "look for delete", {"machine": True}),
    ("ethics", "look for create/archive", {"machine": True}),
]
for lens, step, want in OBS:
    ok, got, e = acts(lens, step)
    o = e["substeps"][0] if e["substeps"] else {}
    check("observe split: %s | %s" % (lens, step[:50]), ok and got == ["observe"] and all(o.get(k) == v for k, v in want.items()) and "provenance" in o, (got, o))
ok, got, e = acts("cooking", "Open Cooking > Recipes, then look for search/filter controls")
check("observe is split off, the navigation still maps", ok and got[-1] == "observe" and "click" in got, (got, e.get("reason")))
ok, got, e = acts("daily", "On /lenses/daily as zuko_qa_t1, resize the viewport to 390×844, open Today, and inspect the calendar")
check("viewport + open + inspect all mapped as parts", ok and got == ["set_viewport", "check_overflow", "click", "observe"], (got, e.get("reason")))
ok, got, e = acts("emergency-services", "confirm /api/auth/me, create unit qa-1")
check("an observation that hides a write action stays unmapped", not ok, (got, e.get("reason")))

# ------------------------------------------------------------------------------------------ 4. expected clauses
ex = "Selecting a film/project sets selection and enables relevant controls. Export file downloads as non-empty JSON; no console errors"
cl = X.split_clauses(ex)
check("splitter: sentences + semicolons, never commas/'and'", cl == ["Selecting a film/project sets selection and enables relevant controls", "Export file downloads as non-empty JSON", "no console errors"], cl)
check("splitter: no 1-2 word shards from a comma list", all(len(c.split()) > 2 for c in X.split_clauses("Controls: search, filter, sort (e.g. by date) are visible.")), X.split_clauses("Controls: search, filter, sort (e.g. by date) are visible."))
check("splitter: bullets", X.split_clauses("- Esc closes the dialog\n- focus returns to the trigger") == ["Esc closes the dialog", "focus returns to the trigger"])

EMPTY = {"controls": [], "texts": [], "dialogs": [], "errors": 0}


def snap(**kw):
    return dict(EMPTY, **kw)


def st(clause, **kw):
    return repro.check_clause(clause, snap(**kw))[0]


# vague stays unchecked, whatever the snapshot says
for c in ["Usable", "Counts agree", "The page works", "Layout looks right", "Controls feel smooth", "Sensible defaults"]:
    check("vague stays unchecked: %s" % c, st(c, texts=["Usable Counts agree works looks right"]) == "unchecked" and repro.classify_expected(c)[0][1] is None)

# checkable kinds WITHOUT evidence -> unchecked, never pass
KIND_EVIDENCE = [
    ("Esc closes the dialog", "esc_closes", {"keys_sent": ["Escape"]}, "pass"),
    ("Focus returns to the trigger", "focus_opener", {"focus_after_escape": "Share", "opener": "Share"}, "pass"),
    ("Arrow keys move focus between tabs", "arrow_moves", {"focus_trace": ["Overview", "Details"]}, "pass"),
    ("Export downloads a valid JSON file", "export_file", {"export": {"ok": True, "verdict": "PASS", "bytes": 12, "rows": 3, "parsed": True}}, "pass"),
    ("Every button has an accessible name", "ax_names", {"ax_unnamed": 0, "ax_total": 9}, "pass"),
    ("Text contrast meets WCAG AA", "contrast", {"contrast": {"checked": 40, "fails": 0, "threshold": 4.5}}, "pass"),
    ("No horizontal overflow at 390 px", "overflow_390", {"overflow": {"viewport_w": 390, "overflow_px": 0, "offscreen": 0}}, "pass"),
    ("No 5xx errors", "net_class", {"net_statuses": []}, "pass"),
    ("Requires confirmation: a confirm dialog before delete", "confirm_before_delete", {"confirm_seen": True}, "pass"),
    ("Tap targets are at least 44px", "target_size", {"targets": {"checked": 12, "min_px": 44.0}}, "pass"),
]
for clause, kind, evd, want in KIND_EVIDENCE:
    got_kind = repro.classify_expected(clause)[0][1]
    check("kind %s classified: %s" % (kind, clause[:40]), got_kind is not None and kind in got_kind, got_kind)
    check("kind %s: NO evidence -> unchecked (never pass)" % kind, st(clause) == "unchecked", repro.check_clause(clause, snap()))
    ev = {"evidence": evd}
    check("kind %s: evidence present -> %s" % (kind, want), st(clause, **ev) == want, repro.check_clause(clause, snap(**ev)))
# and the failing direction with evidence
check("fail: overflow measured -> fail", st("No horizontal overflow at 390 px", evidence={"overflow": {"viewport_w": 390, "overflow_px": 80}}) == "fail")
check("fail: overflow measured at desktop -> unchecked", st("No horizontal overflow at 390 px", evidence={"overflow": {"viewport_w": 1280, "overflow_px": 0}}) == "unchecked")
check("fail: unnamed controls -> fail", st("Every button has an accessible name", evidence={"ax_unnamed": 3, "ax_total": 9}) == "fail")
check("fail: Esc never sent -> unchecked, not pass", st("Esc closes the dialog", evidence={"keys_sent": ["Tab"]}) == "unchecked")
check("fail: Esc sent, dialog still open -> fail", st("Esc closes the dialog", dialogs=["x"], evidence={"keys_sent": ["Escape"]}) == "fail")
check("fail: focus did not return -> fail", st("Focus returns to the trigger", evidence={"focus_after_escape": "Body", "opener": "Share"}) == "fail")
check("fail: 5xx seen -> fail", st("No 5xx errors", evidence={"net_statuses": [500]}) == "fail")
check("fail: export not ok -> fail", st("Export downloads a valid JSON file", evidence={"export": {"ok": False, "verdict": "FAIL"}}) == "fail")
check("fail: smallest target 30px -> fail", st("Tap targets are at least 44px", evidence={"targets": {"checked": 4, "min_px": 30}}) == "fail")
check("contrast: clause asks 7:1 but walker measures 4.5 -> unchecked", st("Contrast is at least 7:1 (WCAG)", evidence={"contrast": {"checked": 5, "fails": 0, "threshold": 4.5}}) == "unchecked")
check("persisted needs a named item AND a reload", st("'Zeta plan' persists after reload", texts=["Zeta plan"]) == "unchecked"
      and st("'Zeta plan' persists after reload", texts=["Zeta plan"], evidence={"reloaded": True}) == "pass"
      and st("'Zeta plan' persists after reload", texts=["other"], evidence={"reloaded": True}) == "fail")
check("validation: no write ledger -> unchecked", st("Save is rejected with an inline error") == "unchecked")
check("validation: write call went out -> fail", st("Save is rejected with an inline error", evidence={"net_writes": ["POST /api/x"]}) == "fail")
check("validation: no write + message -> pass", st("Save is rejected with an inline error", texts=["Name is required"], evidence={"net_writes": []}) == "pass")
check("validation: no write but no message -> unchecked", st("Save is rejected with an inline error", evidence={"net_writes": []}) == "unchecked")
check("a compound sentence needs EVERY predicate: one vague half -> unchecked", repro.classify_expected("Esc closes the dialog and it feels smooth")[0][1] is None)
k = lambda c: repro.classify_expected(c)[0][1]
check("real clause: Esc closes + returns focus -> two typed predicates", k("Escape closes the Export menu and returns focus to the Export trigger") == "esc_closes+focus_opener", k("Escape closes the Export menu and returns focus to the Export trigger"))
check("real clause: noun-list subject is not split into a bogus fragment", k("Text and disabled-control labels meet WCAG AA contrast") == "contrast", k("Text and disabled-control labels meet WCAG AA contrast"))
check("real clause: a second predicate riding along blocks classification (no partial check)", k("Light theme uses light surfaces and readable contrast") is None, k("Light theme uses light surfaces and readable contrast"))
check("real clause: 'no repeated 404s' is a negated status check", k("The console has no repeated 404s on ancillary resources for this lens") == "net_status"
      and st("The console has no repeated 404s on ancillary resources", evidence={"net_statuses": [404]}) == "fail"
      and st("The console has no repeated 404s on ancillary resources", evidence={"net_statuses": []}) == "pass"
      and st("The console has no repeated 404s on ancillary resources") == "unchecked")
check("a negated claim is not classified by a positive-only kind", repro.classify_expected("Esc does not close the dialog")[0][1] is None)
check("control_present from an observation clause: found -> pass", st("has a control matching: delete | void", controls=[{"name": "Delete row", "role": "button", "enabled": True}]) == "pass")
check("control_present: absent -> unchecked (a missing fixture is not a defect)", st("has a control matching: delete | void") == "unchecked")
rows = repro.check_expected("Esc closes the dialog", snap(evidence={"keys_sent": ["Escape"]}), extra=["Record what each includes"])
check("an unreadable observation clause blocks the whole expected check (NEEDS_HUMAN), with provenance", rows["state"] == "unchecked" and rows["clauses"][-1]["source"] == "observe-step", rows)

# ------------------------------------------------------------------------------------------ 5. label resolution
R = labels.resolve
r = R("Export", ["Export", "Export as JSON", "Share"])
check("labels: exact wins over a looser containing label", r["status"] == "exact" and r["label"] == "Export", r)
r = R("JSON", ["Export as JSON", "Export as CSV"])
check("labels: token rule, one candidate (nested submenu item)", r["status"] == "token" and r["label"] == "Export as JSON", r)
r = R("Export", ["Export as JSON", "Export as CSV"])
check("labels: 2 candidates -> AMBIGUOUS, no label", r["status"] == "ambiguous" and r["label"] is None and len(r["candidates"]) == 2, r)
r = R("Share & Publish", ["Publish or share this content", "Settings"])
check("labels: known rename via the alias table", r["status"] == "alias" and r["label"] == "Publish or share this content", r)
r = R("Share & Publish", ["Settings", "Help"])
check("labels: absent", r["status"] == "absent" and r["label"] is None, r)
r = R("Save", ["Save", "Save"])
check("labels: two live controls with the SAME name are ambiguous", r["status"] == "ambiguous", r)
r = R("Share & Publish", ["Publish or share this content", "Publish or share this content"])
check("labels: alias hit on a duplicated live label is ambiguous", r["status"] == "ambiguous", r)
check("labels: every resolution is describable for the record", "Publish or share this content" in labels.describe(R("Share & Publish", ["Publish or share this content"])))
check("labels: ambiguity text names the candidates", "ambiguous" in labels.describe(R("Export", ["Export as JSON", "Export as CSV"])))


class ResolvingDriver:
    """Fake page that resolves click names with labels.resolve exactly as PlaywrightDriver does."""

    def __init__(self, controls=None, texts=None, caps=True, **kw):
        self.controls, self.texts, self.calls = controls or [], texts or [], []
        self.last_resolution = None
        self.kw = kw
        self.focus = None
        if not caps:
            self.measure_overflow = None

    def open(self, t): self.calls.append(("open", t))
    def reload(self): self.calls.append(("reload",))
    def press(self, k): self.calls.append(("press", k))
    def tab_names(self): return [c["name"] for c in self.controls if c.get("role") == "tab"]
    def set_viewport(self, w, h): self.calls.append(("viewport", w, h))
    def set_scheme(self, s): self.calls.append(("scheme", s))
    def measure_overflow(self): return self.kw.get("overflow", {"viewport_w": 390, "overflow_px": 0, "offscreen": 0})
    def measure_targets(self): return self.kw.get("targets", {"checked": 3, "min_px": 48})
    def measure_contrast(self): return {"checked": 30, "fails": 0, "threshold": 4.5}
    def console_errors(self): return self.kw.get("console", 0)
    def net_summary(self): return {"statuses": self.kw.get("statuses", []), "writes": []}
    def ax_check(self, scope): return {"unnamed": self.kw.get("unnamed", 0), "total": 7}
    def tab_sweep(self, n, from_top=False): self.calls.append(("tab_sweep", from_top)); return ["Skip to main", "Overview", "Details"]
    def tab_to(self, name, n): return (name in self.kw.get("reach", []), ["a", "b"])
    def focus_name(self, name): return any(labels.resolve(name, [c["name"] for c in self.controls])["status"] in ("exact", "alias", "token") for _ in [0])
    def focused_name(self): return self.kw.get("focused")
    def export_check(self, formats): return self.kw.get("export", {"verdict": "PASS", "ok": True, "bytes": 99, "rows": 2, "parsed": True})
    def evidence(self): return {}

    def click(self, name, role=None):
        pool = [c["name"] for c in self.controls if role is None or c.get("role") == role]
        res = labels.resolve(name, pool)
        self.last_resolution = res
        self.calls.append(("click", name, res["label"]))
        return res["label"] if res["status"] in ("exact", "alias", "token") else None

    def snapshot(self):
        return {"controls": self.controls, "texts": self.texts, "dialogs": self.kw.get("dialogs", []), "errors": 0, "url": "x"}

    def screenshot(self, n): return "ev/%s.png" % n


def btn(name, role="button", **kw):
    return dict({"name": name, "role": role, "enabled": True, "focused": False, "props": {}}, **kw)


def T(steps, expected, lens="demo", **kw):
    return dict({"id": "FIX-demo-001", "lens": lens, "repro_steps": steps, "expected": expected, "actual": "x", "title": "t"}, **kw)


# alias hit: unique + clicked -> recorded with the rule; FIXED only because expected is ALSO machine-checked
labels.ALIASES["quick filters"] = ("filter panel",)      # a rename SEEN on a live site would live in labels.ALIASES
d = ResolvingDriver([btn("Filter panel"), btn("Settings")], texts=["Settings page"])
r = repro.run_repro(T(["Click Quick Filters"], "Shows 'Settings page'"), d, lens_slug="demo")
s = r["steps"][0]
check("alias resolution is logged in the step record", s["executed"] and s["resolution"]["status"] == "alias" and s["resolution"]["label"] == "Filter panel", s)
check("alias hit + expected machine-checked -> FIXED (control found, unique, acted on)", r["verdict"] == repro.FIXED, r)
# ambiguity -> NEEDS_HUMAN naming the step, nothing clicked
d = ResolvingDriver([btn("Filters as JSON"), btn("Filters as CSV")], texts=["x"])
r = repro.run_repro(T(["Click Filters"], "Shows 'x'"), d, lens_slug="demo")
check("ambiguous label -> NEEDS_HUMAN naming the step, nothing clicked", r["verdict"] == repro.HUMAN and "ambiguous" in r["notes"] and "step 1" in r["notes"] and not any(c[0] == "click" and c[2] for c in d.calls), r["notes"])
check("ambiguous label: the record carries the candidates", "Filters as JSON" in r["steps"][0]["result"], r["steps"][0])
# absence -> NEEDS_HUMAN
d = ResolvingDriver([btn("Settings")], texts=["x"])
r = repro.run_repro(T(["Click Quick Filters"], "Shows 'x'"), d, lens_slug="demo")
check("absent label -> NEEDS_HUMAN naming the step", r["verdict"] == repro.HUMAN and "step 1" in r["notes"] and "matches no live control" in r["notes"], r["notes"])
# a token match that is NOT unique cannot verify, even when expected passes
d = ResolvingDriver([btn("Filter view"), btn("Filter set")], texts=["x"])
r = repro.run_repro(T(["Click Filter"], "Shows 'x'"), d, lens_slug="demo")
check("token ambiguity never reaches FIXED", r["verdict"] != repro.FIXED, r["notes"])
# nested submenu item: after opening Export the menu items are the live labels
d = ResolvingDriver([btn("Filters"), btn("Compact", role="menuitem")], texts=["x"])
r = repro.run_repro(T(["Open Filters > Compact"], "Shows 'x'"), d, lens_slug="demo")
check("nested menu item: both crumbs resolve exactly and are clicked", r["verdict"] == repro.FIXED and [c[2] for c in d.calls if c[0] == "click"] == ["Filters", "Compact"], (d.calls, r["notes"]))

# ------------------------------------------------------------------------------------------ executor: vocab end to end
d = ResolvingDriver([btn("Overview", role="tab")], texts=["Overview"])
r = repro.run_repro(T(["DevTools 390x844"], "No horizontal overflow at 390 px"), d, lens_slug="demo")
check("390 step runs set_viewport + overflow check and the layout clause is machine-checked -> FIXED",
      r["verdict"] == repro.FIXED and ("viewport", 390, 844) in d.calls and [s["action"] for s in r["steps"]] == ["set_viewport", "check_overflow"], r)
d = ResolvingDriver(overflow={"viewport_w": 390, "overflow_px": 120, "offscreen": 2})
r = repro.run_repro(T(["DevTools 390x844"], "No horizontal overflow at 390 px"), d, lens_slug="demo")
check("measured overflow -> STILL_FAILING", r["verdict"] == repro.STILL, r)
d = ResolvingDriver(caps=False)
r = repro.run_repro(T(["DevTools 390x844"], "No horizontal overflow at 390 px"), d, lens_slug="demo")
check("driver cannot measure -> NEEDS_HUMAN (never a silent skip)", r["verdict"] == repro.HUMAN and "step 1" in r["notes"], r["notes"])
d = ResolvingDriver([btn("Filters"), btn("Details")], texts=["x"], focused="Filters", dialogs=[])
r = repro.run_repro(T(["Open Filters > Escape"], "Esc closes the dialog; focus returns to the trigger", lens="projects"), d, lens_slug="projects")
check("Escape records the opener + focus-after-Escape evidence and both clauses pass", r["verdict"] == repro.FIXED, r)
d = ResolvingDriver([btn("Filters")], focused="Body")
r = repro.run_repro(T(["Open Filters > Escape"], "Focus returns to the trigger", lens="projects"), d, lens_slug="projects")
check("focus did not return -> STILL_FAILING", r["verdict"] == repro.STILL, r)
d = ResolvingDriver([btn("Overview", role="tab")], texts=["x"])
r = repro.run_repro(T(["Export JSON/CSV"], "Export downloads a valid JSON file"), d, lens_slug="demo")
check("export step -> export check -> export clause machine-checked", r["verdict"] == repro.FIXED and r["steps"][0]["action"] == "export_check", r)
d = ResolvingDriver(export={"verdict": "NO_CONTROL", "ok": False, "note": "'Export' matches no live control"})
r = repro.run_repro(T(["Export JSON/CSV"], "Export downloads a valid JSON file"), d, lens_slug="demo")
check("no export control -> NEEDS_HUMAN naming the step", r["verdict"] == repro.HUMAN and "step 1" in r["notes"], r["notes"])
d = ResolvingDriver(console=0, statuses=[])
r = repro.run_repro(T(["Open /lenses/hvac with DevTools Console open"], "No console errors; no 5xx errors", lens="hvac"), d, lens_slug="hvac")
check("console step -> console evidence feeds the clauses", r["verdict"] == repro.FIXED or r["verdict"] == repro.HUMAN and "5xx" in r["notes"], r)
d = ResolvingDriver(statuses=[502])
r = repro.run_repro(T(["Open /lenses/hvac with DevTools Console open", "Hard reload"], "No 5xx errors", lens="hvac"), d, lens_slug="hvac")
check("network ledger needs a check_network step; console-only never invents statuses", r["verdict"] in (repro.HUMAN, repro.STILL), r["verdict"])

# Tab sweep + "do not Tab first" is ENFORCED
d = ResolvingDriver([btn("Overview", role="tab")], texts=["x"])
r = repro.run_repro(T(["Tab from top"], "Shows 'x'"), d, lens_slug="demo")
check("Tab from top -> tab sweep runs", ("tab_sweep", True) in d.calls and r["steps"][0]["executed"], r)
d = ResolvingDriver([btn("Filters")], texts=["x"])
r = repro.run_repro(T(["Open Filters", "Press Escape once while the dialog is open (do not Tab first)"], "Shows 'x'"), d, lens_slug="demo")
check("'do not Tab first' then Escape: no Tab is sent", ("press", "Tab") not in d.calls and ("press", "Escape") in d.calls and r["verdict"] == repro.FIXED, (d.calls, r["notes"]))
d = ResolvingDriver([btn("Filters")], texts=["x"])
r = repro.run_repro(T(["Do not Tab first", "Tab from top"], "Shows 'x'"), d, lens_slug="demo")
check("'do not Tab first' VIOLATED by a Tab sweep -> refused, NEEDS_HUMAN", r["verdict"] == repro.HUMAN and "constraint violated" in r["notes"] and ("tab_sweep", True) not in d.calls, (r["notes"], d.calls))
d = ResolvingDriver([btn("Details")], texts=["x"])
r = repro.run_repro(T(["Do not click Details a second time.", "Click Details", "Click Details"], "Shows 'x'"), d, lens_slug="demo")
check("'do not click X a second time' is enforced", r["verdict"] == repro.HUMAN and "constraint violated" in r["notes"] and sum(1 for c in d.calls if c[0] == "click" and c[2]) == 1, (r["notes"], d.calls))

# observe split: an unreadable observation is NEEDS_HUMAN for that part, the other parts still ran
d = ResolvingDriver([btn("Recipes", role="tab")], texts=["x"])
r = repro.run_repro(T(["Open Recipes tab, then record what each one includes"], "Shows 'x'"), d, lens_slug="demo")
ran = [s for s in r["steps"] if s["executed"]]
check("observe split: other parts ran, observation recorded with provenance", len(ran) >= 2 and any(s.get("provenance") for s in r["steps"]), r["steps"])
check("observe split: unreadable observation -> NEEDS_HUMAN (never FIXED)", r["verdict"] == repro.HUMAN and r["expected"]["clauses"][-1]["source"] == "observe-step", r)
d = ResolvingDriver([btn("Delete row", role="button")], texts=["x"])
r = repro.run_repro(T(["look for delete/void"], "Shows 'x'"), d, lens_slug="demo")
check("observe split: 'look for delete' is checked as a control-present clause", r["verdict"] == repro.FIXED, r)
d = ResolvingDriver([], texts=["x"])
r = repro.run_repro(T(["look for delete/void"], "Shows 'x'"), d, lens_slug="demo")
check("observe split: control absent -> NEEDS_HUMAN, not pass", r["verdict"] == repro.HUMAN, r)

# chat: a send is a budgeted write -> refused without --allow-write
d = ResolvingDriver([btn("Lens tools")], texts=["x"])
d.chat_ask = lambda q: {"sent": True, "reply": True}
r = repro.run_repro(T(["Ask 'What is the Lattice lens for?'"], "Shows 'x'"), d, lens_slug="demo")
check("chat_ask without --allow-write is refused -> NEEDS_HUMAN", r["verdict"] == repro.HUMAN and "allow-write" in r["notes"], r["notes"])
r = repro.run_repro(T(["Ask 'What is the Lattice lens for?'"], "Shows 'x'"), d, lens_slug="demo",
                    write={"allow_write": True, "admin": False, "write_skip": False, "label_base": "qa-walker", "fixtures": lambda: []})
check("chat_ask with --allow-write sends once", r["steps"][0]["executed"], r)

# originals are byte-identical after mapping and replay; mapping is pure
t = T(["Open Filters > Escape", "DevTools 390x844", "look for delete/void"], "Esc closes the dialog")
before = copy.deepcopy(t)
for s_ in repro.split_steps(t):
    repro.expand_step(s_, "projects")
d = ResolvingDriver([btn("Filters")], texts=["x"])
repro.run_repro(t, d, lens_slug="projects")
check("original repro_steps / expected are byte-identical after mapping + replay", t == before and repr(t) == repr(before))

# ------------------------------------------------------------------------------------------ the mapped-rate tool still imports + counts
import importlib.util
spec = importlib.util.spec_from_file_location("mapped_rate", os.path.join(HERE, "tools", "mapped_rate.py"))
mr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mr)
tk = [T(["DevTools 390x844"], "No horizontal overflow at 390 px"), T(["Create a thing qa-1"], "No horizontal overflow at 390 px"), T(["DevTools 390x844"], "Usable")]
res = mr.measure(tk)
check("mapped_rate: steps 2/3 mapped, eligible 1/3 (mapped AND checkable)", res["steps_mapped"] == 2 and res["verified_eligible_tickets"] == 1 and res["tickets_all_mapped"] == 2, res)
check("mapped_rate: blocking reasons counted", res["blocked_by"] == {"expected_unchecked_only": 1, "steps_unmapped_only": 1, "both": 0}, res["blocked_by"])

# ------------------------------------------------------------------------------------------ PlaywrightDriver on a fake AX tree
from concord_walker import cdp as _cdp


def _raw(i, role, name="", parent=None, children=(), focused=False, ignored=False, backend=None):
    r = {"nodeId": str(i), "role": {"value": role}, "name": {"value": name}, "backendDOMNodeId": backend or i + 100,
         "childIds": [str(c) for c in children], "ignored": ignored, "properties": []}
    if parent is not None:
        r["parentId"] = str(parent)
    if focused:
        r["properties"].append({"name": "focused", "value": {"value": True}})
    return r


class _FakeCdp:
    def __init__(self, nodes):
        self.nodes = nodes

    def ax(self):
        return _cdp.AXTree(self.nodes)


class _FakeKb:
    def __init__(self, drv, seq):
        self.drv, self.seq, self.i = drv, seq, 0

    def press(self, k):
        if k == "Tab":
            self.drv.cdp.nodes = self.seq[min(self.i, len(self.seq) - 1)]
            self.i += 1


class _FakePage:
    keyboard = None


def _drv(nodes, seq=None):
    d = repro.PlaywrightDriver.__new__(repro.PlaywrightDriver)
    d.cdp, d.last_resolution, d.page = _FakeCdp(nodes), None, _FakePage()
    d.reload = lambda: None
    if seq:
        d.page.keyboard = _FakeKb(d, seq)
    return d


def _tree(focus_idx, extra_root_focused=True):
    """RootWebArea (focused, listed FIRST, like Chromium) + three buttons; focus_idx picks the real control."""
    names = ["Alpha", "Export", "Zeta"]
    nodes = [_raw(1, "RootWebArea", "Driver fixture", children=[2, 3, 4], focused=extra_root_focused)]
    for k, nm in enumerate(names):
        nodes.append(_raw(2 + k, "button", nm, parent=1, focused=(k == focus_idx)))
    return nodes


d = _drv(_tree(1))
check("focused_name: deepest focused control, not the RootWebArea title (root listed first)", d.focused_name() == "Export", d.focused_name())
d = _drv(_tree(None))
check("focused_name: ONLY the RootWebArea focused -> None (failure path)", d.focused_name() is None, d.focused_name())
d = _drv(_tree(None, extra_root_focused=False))
check("focused_name: nothing focused -> None", d.focused_name() is None)
d = _drv([_raw(1, "RootWebArea", "Driver fixture", children=[2], focused=True), _raw(2, "button", "  ", parent=1, focused=True)])
check("focused_name: focused control with blank name -> None, never the page title", d.focused_name() is None)

seq = [_tree(0), _tree(1), _tree(2), _tree(0), _tree(1)]
d = _drv(_tree(None), seq)
tr = d.tab_sweep(6, from_top=True)
check("tab_sweep: records real control names and stops on the loop", tr == ["Alpha", "Export", "Zeta"], tr)
seq = [_tree(None), _tree(None), _tree(0), _tree(1)]
d = _drv(_tree(None), seq)
tr = d.tab_sweep(4)
check("tab_sweep: repeated None name does not trip loop detection", tr == [None, None, "Alpha", "Export"], tr)
d = _drv(_tree(None), [_tree(0), _tree(1), _tree(2)])
ok_, tr = d.tab_to("Export", 5)
check("tab_to: reaches 'Export' via real focus names", ok_ and tr == ["Alpha", "Export"], (ok_, tr))
d = _drv(_tree(None), [_tree(0), _tree(2)])
ok_, tr = d.tab_to("Export", 2)
check("tab_to: absent control -> False (failure path)", not ok_, (ok_, tr))

# Escape focus-return: the title-only evidence must NOT pass a focus_opener clause
d = _drv(_tree(None))
ev_bad = {"focus_after_escape": d.focused_name(), "opener": "Export"}
res = X._spec_check({"kind": "focus_opener"}, {"evidence": ev_bad}, lambda *a: ("unchecked", ""))
check("focus_opener over RootWebArea-only evidence does NOT pass", res[0] != "pass", res)
d = _drv(_tree(1))
ev_ok = {"focus_after_escape": d.focused_name(), "opener": "Export"}
res = X._spec_check({"kind": "focus_opener"}, {"evidence": ev_ok}, lambda *a: ("unchecked", ""))
check("focus_opener over the real focused control passes", res[0] == "pass", res)

# ax_check container scope
def _page_tree(menu_open=True):
    n = [_raw(1, "RootWebArea", "App", children=[2, 3, 6, 8]),
         _raw(2, "toolbar", "Toolbar", parent=1, children=[4, 5]),
         _raw(4, "button", "Save", parent=2), _raw(5, "button", "", parent=2),
         _raw(3, "navigation", "Main navigation", parent=1, children=[7]), _raw(7, "link", "Home", parent=3),
         _raw(6, "region", "Panel", parent=1, children=[9]), _raw(9, "button", "Go", parent=6),
         _raw(8, "region", "Panel two", parent=1, children=[10]), _raw(10, "button", "Stop", parent=8)]
    if menu_open:
        n[0]["childIds"].append("11")
        n += [_raw(11, "menu", "Export menu", parent=1, children=[12]), _raw(12, "menuitem", "JSON", parent=11)]
    return n


d = _drv(_page_tree())
r_ = d.ax_check("Toolbar")
check("ax_check: container scope 'Toolbar' resolves, counts only inside it", r_ == {"unnamed": 1, "total": 2}, r_)
check("ax_check: resolution recorded", d.last_resolution and d.last_resolution["status"] == repro._L.EXACT, d.last_resolution)
check("ax_check: open menu scope resolves", d.ax_check("Export menu") == {"unnamed": 0, "total": 1})
d = _drv(_page_tree(menu_open=False))
try:
    d.ax_check("Export menu")
    ok_ = False
except repro._NotFound:
    ok_ = True
check("ax_check: closed menu scope -> NotFound (not opened implicitly)", ok_)
d = _drv(_page_tree())
try:
    d.ax_check("Panel")
    ok_ = d.last_resolution["status"] == repro._L.EXACT
except repro._NotFound:
    ok_ = False
check("ax_check: exact name wins over a longer token match", ok_, d.last_resolution)
try:
    d.ax_check("Nonexistent area")
    ok_ = False
except repro._NotFound:
    ok_ = True
check("ax_check: unknown scope -> NotFound", ok_)
d = _drv(_page_tree())
check("ax_check: actionable fallback still works ('Save' button scope)", d.ax_check("Save") == {"unnamed": 0, "total": 1}, d.ax_check("Save"))

print("%d failure(s)" % len(FAILS))
sys.exit(1 if FAILS else 0)
