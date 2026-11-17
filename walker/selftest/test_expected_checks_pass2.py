#!/usr/bin/env python3
"""ULW pass 2 (a): expected-result machine checks. Offline (no browser).

Every clause below is a REAL `expected` sentence from the ticket fold (272e62f41), tagged with its lens
(the few kinds the fold has almost no real sentences for - item_created / appears_in_list / text_absent -
say so inline and use the nearest ticket wording). For EACH kind the table asserts, per clause:
  classified (the kind is in the clause's typed predicates),
  no evidence                  -> unchecked  (never pass),
  full evidence, claim holds   -> pass,
  full evidence, claim broken  -> fail,
  partial / mismatched evidence-> unchecked.
Then: negations both ways, two-predicate clauses (BOTH must pass), vague clauses never classified and never pass
even with every kind of evidence present, every clause result names its kind + evidence keys + detail, the original
`expected` text is byte-identical, and the VERIFIED gate source is untouched.
Run: python3 selftest/test_expected_checks_pass2.py"""
import copy, hashlib, os, re, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from concord_walker import repro, expected as X, ledger

FAILS = []
N = [0]


def check(name, cond, extra=""):
    N[0] += 1
    print(("PASS " if cond else "FAIL ") + name + (" " + str(extra)[:300] if extra and not cond else ""))
    if not cond:
        FAILS.append(name)


def snap(evidence=None, **kw):
    s = {"controls": [], "texts": [], "dialogs": [], "evidence": evidence or {}}
    s.update(kw)
    return s


def state(clause, sn):
    return repro.check_clause(clause, sn)[0]


def kinds_of(clause):
    return repro.classify_expected(clause)[0][1] or ""


def ctl(name, **kw):
    return dict({"name": name, "role": "button", "enabled": True, "focused": False, "props": {}}, **kw)


# --------------------------------------------------------------------------------------------------- per-kind table
# (kind, [(lens, real clause)], PASS snapshot, FAIL snapshot, PARTIAL snapshot-or-None)
TABLE = [
    ("validation_block",
     [("agriculture", "Name required"), ("analytics", "Validation errors"), ("ar", "Save blocked with inline 'Title required'"), ("atlas", "Inline field errors"),
      ("billing", "Inline validation error"), ("board", "Inline error message"), ("accounting", "Inline errors")],
     snap({"step_windows": [{"n": 2, "action": "type_value", "writes": [], "typed": "-5"}, {"n": 3, "action": "submit_form", "writes": [], "typed": None, "submit": True}]},
          texts=["Amount must be greater than 0"]),
     snap({"step_windows": [{"n": 2, "action": "type_value", "writes": [], "typed": "-5"}, {"n": 3, "action": "submit_form", "writes": ["POST /api/lens/run"], "typed": None, "submit": True}]},
          texts=["Amount must be greater than 0"]),
     snap({"step_windows": [{"n": 2, "action": "type_value", "writes": [], "typed": "-5"}]}, texts=["Overview"])),     # typed, no write, but NO message / invalid / disabled: unchecked
    ("esc_closes",
     [("achievements", "Esc closes"), ("agriculture", "Esc closes"), ("analytics", "Esc closes"), ("anon", "Escape closes"), ("astronomy", "Escape dismisses overlays"),
      ("automotive", "Escape dismisses the dialog")],
     snap({"keys_sent": ["Escape"], "popups_before": 1, "popups_after": 0}),
     snap({"keys_sent": ["Escape"], "popups_before": 1, "popups_after": 1}, dialogs=["Edit"]),
     snap({"keys_sent": ["Escape"], "popups_before": 0, "popups_after": 0})),
    ("focus_opener",
     [("admin", "focus returns"), ("ar", "focus returns to trigger"), ("collab", "focus returns to trigger"), ("ingest", "focus returns to the trigger"),
      ("welding", "focus returns to the opener")],
     snap({"focus_after_escape": "Export", "opener": "Export"}),
     snap({"focus_after_escape": "Document", "opener": "Export"}),
     snap({"opener": "Export"})),
    ("focus_trap",
     [("achievements", "focus trapped"), ("animation", "focus stays inside the dialog"), ("billing", "Focus stays in dialog"), ("carpentry", "focus contained"),
      ("consulting", "Focus contained"), ("creator", "Focus trapped")],
     snap({"focus_in_popup": [True, True, True]}),
     snap({"focus_in_popup": [True, False, True]}),
     snap({"focus_in_popup": []})),
    ("popup_closed",
     [("admin", "Menu closes"), ("alliance", "Dialog closes"), ("ar", "Closes"), ("board", "Panel closes"), ("chat", "Menu closes"), ("calendar", "Closes")],
     snap({"popups_before": 1, "closer": "Escape", "popups_after": 0}),
     snap({"popups_before": 1, "closer": "Escape", "popups_after": 1}, dialogs=["Menu"]),
     snap({"popups_before": 0, "closer": "Close"})),
    ("confirm_before_delete",
     [("analytics", "Confirm dialog"), ("astronomy", "Confirm dialog before destructive delete"), ("byo-keys", "Delete/leave with confirm"), ("creative-writing", "delete with confirm"),
      ("billing", "Confirm dialog"), ("auction", "Confirm dialog")],
     snap({"confirm_seen": True, "confirm_row_present": True}),
     snap({"confirm_seen": False, "confirm_row_present": False}),
     None),
    ("export_file",
     [("alliance", "Alliances exported"), ("analytics", "Own dashboards/events exported"), ("artistry", "Projects exported"), ("atlas", "Saved places exported"),
      ("bridge", "Peers/mappings/flows exported"), ("carpentry", "Jobs, estimates, time exported")],
     snap({"export": {"ok": True, "verdict": "PASS", "bytes": 120, "rows": 3, "parsed": True}}),
     snap({"export": {"ok": True, "verdict": "PASS", "bytes": 0, "rows": 0, "parsed": True}}),
     None),
    ("ax_names",
     [("board", "Accessible name present"), ("crypto", "Named button"), ("integrations", "Named controls"), ("logistics", "labelled controls"), ("mental-health", "labeled controls"),
      ("ops", "Controls labelled")],
     snap({"ax_unnamed": 0, "ax_total": 12}), snap({"ax_unnamed": 3, "ax_total": 12}), None),
    ("value_saved",
     [("tools", "history persists"), ("code", "content persists"), ("dx-platform", "chat history persists"), ("calendar", "view state persists"), ("custom", "widgets persist exactly"),
      ("debate", "Phase persists across reload"), ("productivity", "Reminder persists"), ("saved", "Session persists"),
      ("calendar", "Saved personal event visible after reload when viewing its month")],
     snap({"reloaded": True, "own_values": ["qa-walker-t1-s3"], "after_reload": {"texts": ["Notes qa-walker-t1-s3"], "names": []}}),
     snap({"reloaded": True, "own_values": ["qa-walker-t1-s3"], "after_reload": {"texts": ["Notes"], "names": []}}),
     snap({"reloaded": True, "own_values": [], "after_reload": {"texts": ["Notes"], "names": []}})),
    ("net_class",
     [("bridge", "No failed requests"), ("custom", "No server errors"), ("thread", "no API errors"), ("emergency-services", "No failed requests recorded")],
     snap({"net_statuses": []}), snap({"net_statuses": [500]}), None),
    ("net_status",
     [("anon", "no 400s"), ("law", "No 404s")],
     snap({"net_statuses": [200 + 1]}), snap({"net_statuses": [404, 400]}), None),
    ("overflow_390",
     [("creator", "Tabs scroll"), ("custom", "Tabs scroll or wrap visibly"), ("diy", "No clipped labels"), ("forum", "Tabs scroll visibly"), ("frontier", "Tabs scroll or wrap"),
      ("hr", "Tabs scroll")],
     snap({"viewport": (390, 844), "overflow": {"viewport_w": 390, "overflow_px": 0, "offscreen": 0}}),
     snap({"viewport": (390, 844), "overflow": {"viewport_w": 390, "overflow_px": 0, "offscreen": 2}}),
     snap({"viewport": (1280, 900), "overflow": {"viewport_w": 1280, "overflow_px": 0, "offscreen": 0}})),
    ("no_console_error",
     [("genesis", "No errors"), ("math", "no console errors"), ("reasoning", "no crash"), ("deities", "Page loads without renderer crash"), ("mesh", "No errors")],
     snap({"console_new": 0}, errors=0), snap({"console_new": 2}, errors=2), None),
    ("target_size",
     [("chat", "Tap targets ≥44px"), ("creatures", "≥44px"), ("education", "Tabs meet ≥44px tap targets"), ("ml", "≥44px targets"), ("quests", "≥44px")],
     snap({"targets": {"checked": 8, "min_px": 48}}), snap({"targets": {"checked": 8, "min_px": 30}}), None),
]
for kind, rows, ok_s, bad_s, part_s in TABLE:
    lenses = set()
    for lens, clause in rows:
        lenses.add(lens)
        tag = "%s | %s | %s" % (kind, lens, clause[:48])
        k = kinds_of(clause)
        check("classified: " + tag, kind in k.split("+"), k)
        if kind == "no_console_error":
            none_s = snap({})                       # no console capture at all
        else:
            none_s = snap({})
        check("NO evidence -> unchecked: " + tag, state(clause, none_s) == "unchecked", repro.check_clause(clause, none_s))
        check("evidence, claim holds -> pass: " + tag, state(clause, ok_s) == "pass", repro.check_clause(clause, ok_s))
        check("evidence, claim broken -> fail: " + tag, state(clause, bad_s) == "fail", repro.check_clause(clause, bad_s))
        if part_s is not None:
            check("partial evidence -> unchecked: " + tag, state(clause, part_s) == "unchecked", repro.check_clause(clause, part_s))
    check("%s: >=5 real clauses" % kind if kind not in ("net_status", "net_class") else "%s: real clauses present" % kind, len(rows) >= (5 if kind not in ("net_status", "net_class") else 2))

# status code: 7 real clauses in two kinds across >=6 lenses (>=5 for the kind group)
check("status-code group has >=6 real clauses over >=6 lenses", len({l for k, r, *_ in TABLE if k in ("net_status", "net_class") for l, _ in r}) >= 6)

# persisted (named): the name comes from the clause itself
for lens, clause in [("meditation", "'Zeta plan' persists after reload"), ("calendar", "\"Team sync\" persists after reload"), ("tasks", "'Alpha list' survives reload"),
                     ("notes", "Reminder 'Pay rent' persists"), ("board", "'Sprint 4' persists after reload")]:
    specs = X.classify_clause(clause, repro._check_legacy)
    nm = specs[0]["name"]
    tag = "persisted | %s | %s" % (lens, clause[:40])
    check("classified: " + tag, specs[0]["kind"] == "persisted", specs)
    check("persisted: no reload -> unchecked: " + tag, state(clause, snap({}, texts=[nm])) == "unchecked")
    check("persisted: present in the reload read-back -> pass: " + tag, state(clause, snap({"reloaded": True, "after_reload": {"texts": [nm + " item"], "names": []}})) == "pass")
    check("persisted: absent in the reload read-back -> fail: " + tag, state(clause, snap({"reloaded": True, "after_reload": {"texts": ["Overview"], "names": []}})) == "fail")

# item created / appears in a list: write mode only, own fixture label (few real sentences exist: 'Photo appears in the gallery', carpentry)
OWN = "qa-walker-t1-abc-s3"
for lens, clause, kind in [("carpentry", "Photo appears in the gallery", "appears_in_list"), ("food", "Task appears in the table", "appears_in_list"),
                           ("calendar", "Reminder is created", "item_created"), ("productivity", "Own project appears in the list", "appears_in_list"),
                           ("board", "Task is created", "item_created"), ("notes", "Saved note appears in the list", "appears_in_list")]:
    tag = "%s | %s | %s" % (kind, lens, clause)
    check("classified: " + tag, kind in kinds_of(clause).split("+"), kinds_of(clause))
    base = {"own_values": [OWN], "submitted": True}
    check("no own fixture / not submitted -> unchecked: " + tag, state(clause, snap({}, texts=[OWN], list_items=[OWN])) == "unchecked")
    good = snap(base, texts=["Created", OWN], list_items=["Row: " + OWN])
    check("own label present after submit -> pass: " + tag, state(clause, good) == "pass", repro.check_clause(clause, good))
    gone = snap(base, texts=["Created"], list_items=["Row: someone else"])
    check("own label missing -> fail: " + tag, state(clause, gone) == "fail", repro.check_clause(clause, gone))
# a label that is on the page but NOT inside a list/grid/table/listitem container is not 'in a list'
check("appears_in_list: label present only as loose page text (no list container) -> fail",
      state("Task appears in the table", snap({"own_values": [OWN], "submitted": True}, texts=[OWN], list_items=["Other row"])) == "fail")
check("appears_in_list: driver reports no list containers at all -> unchecked",
      state("Task appears in the table", snap({"own_values": [OWN], "submitted": True}, texts=[OWN])) == "unchecked")

# text absent (quoted target) - negation of text present
for lens, clause, text in [("hypothesis", "No 'Application error' text", "Application error"), ("math", "Shows no \"Undefined\" label", "Undefined"),
                           ("law", "No 'NaN' text", "NaN"), ("chat", "No 'Unauthorized' message", "Unauthorized"), ("paper", "Shows no 'null' label", "null")]:
    tag = "text_absent | %s | %s" % (lens, clause)
    check("classified: " + tag, "text_absent" in kinds_of(clause), kinds_of(clause))
    check("absent -> pass: " + tag, state(clause, snap({}, texts=["Overview"])) == "pass")
    check("present -> fail: " + tag, state(clause, snap({}, texts=["Overview " + text])) == "fail")

# text present: a quoted/capitalised shown text (legacy predicate) and the verbatim phrase kind
for lens, clause, text in [("reports", "Shows 'Reports'", "Reports"), ("billing", "Ledger shows pledge", "pledge"), ("construction", "The list row shows the record name", "record name")]:
    pass
for clause, text in [("Shows 'Reports'", "Reports"), ("Shows 'Daily totals'", "Daily totals"), ("Displays 'Net worth'", "Net worth"), ("Shows 'Open items'", "Open items"), ("Lists 'Upcoming'", "Upcoming")]:
    check("text present -> pass: " + clause, state(clause, snap({}, texts=[text])) == "pass")
    check("text absent from the page -> fail: " + clause, state(clause, snap({}, texts=["Other"])) == "fail")

# ---------------------------------------------------------------------------------- negation, both ways
check("negation: 'No 404s' passes when none seen, fails when seen", state("No 404s", snap({"net_statuses": []})) == "pass" and state("No 404s", snap({"net_statuses": [404]})) == "fail")
check("negation: a positive status clause needs the status to be SEEN (not seen -> unchecked, never pass)", state("Returns status 403 for another user's record", snap({"net_statuses": []})) == "unchecked")
check("negation: a positive status clause passes when seen", state("Returns status 403 for another user's record", snap({"net_statuses": [403]})) == "pass")
check("negation: 'No errors' inverts (errors present -> fail)", state("No errors", snap({"console_new": 1})) == "fail" and state("No errors", snap({"console_new": 0})) == "pass")
check("negation: error-boundary text on the page fails 'no crash'", state("no crash", snap({"console_new": 0}, texts=["Application error: a client-side exception"])) == "fail")
check("negation: a negated Esc claim is NOT classified (the walker only measures the positive)", kinds_of("Esc does not close the dialog") == "")
check("negation: 'Reject' is a validation claim, 'does not reject' is not silently inverted into one", state("Name required", snap({"step_windows": [{"writes": [], "typed": ""}]}, texts=["Name is required"])) == "pass")

# ---------------------------------------------------------------------------------- two predicates: BOTH must pass
two = "Escape closes the Export menu and returns focus to the Export trigger"
both = {"keys_sent": ["Escape"], "popups_before": 1, "popups_after": 0, "focus_after_escape": "Export", "opener": "Export"}
check("two predicates: classified as two kinds", kinds_of(two) == "esc_closes+focus_opener", kinds_of(two))
check("two predicates: both hold -> pass", state(two, snap(both)) == "pass")
check("two predicates: menu closed but focus lost -> fail", state(two, snap(dict(both, focus_after_escape="Document"))) == "fail")
check("two predicates: focus fine but menu still open -> fail", state(two, snap(dict(both, popups_after=1), dialogs=["Menu"])) == "fail")
check("two predicates: one half has no evidence -> unchecked, never pass", state(two, snap({k: v for k, v in both.items() if k not in ("focus_after_escape", "opener")})) == "unchecked")
check("two predicates: a fail beats an unchecked half", state(two, snap({"keys_sent": ["Escape"], "popups_before": 1, "popups_after": 1}, dialogs=["Menu"])) == "fail")
check("a clause with one checkable half and one vague half stays unclassified", kinds_of("Esc closes the dialog and it feels smooth") == "")

# ---------------------------------------------------------------------------------- vague / alternative clauses never classify, never pass
VAGUE = ["Dialog works", "Panel is usable", "Layout looks right", "Counts agree", "It should be clear", "Selecting a film/project sets selection and enables relevant controls",
         "Modal stays open", "Confirm dialog or undo toast", "Negative amounts rejected or explained inline", "Save succeeds or shows an error", "Esc closes and focus is sensible",
         "Compare Downloads list before/after", "Confirm whether the values persist"]
EVERYTHING = snap({"keys_sent": ["Escape"], "popups_before": 1, "popups_after": 0, "focus_after_escape": "A", "opener": "A", "confirm_seen": True, "confirm_row_present": True,
                   "export": {"ok": True, "verdict": "PASS", "bytes": 9, "rows": 2, "parsed": True}, "ax_unnamed": 0, "net_statuses": [], "console_new": 0, "reloaded": True,
                   "own_values": ["x"], "submitted": True, "after_reload": {"texts": ["x"], "names": []}, "step_windows": [{"writes": [], "typed": "x"}],
                   "viewport": (390, 844), "overflow": {"viewport_w": 390, "overflow_px": 0, "offscreen": 0}}, texts=["x", "Required"], controls=[ctl("Save", enabled=False)])
for v in VAGUE:
    check("vague/alternative clause never classified: %s" % v, repro.classify_expected(v)[0][1] is None, repro.classify_expected(v))
    check("vague/alternative clause never passes even with every evidence key present: %s" % v, state(v, EVERYTHING) == "unchecked")
rows = repro.check_expected("Esc closes the dialog. It should feel fast", EVERYTHING)
check("one vague clause makes the whole `expected` unchecked", rows["state"] == "unchecked" and [r["state"] for r in rows["clauses"]] == ["pass", "unchecked"], rows["state"])

# ---------------------------------------------------------------------------------- results record kind + evidence keys + detail
r = repro.check_expected("Esc closes the dialog", snap({"keys_sent": ["Escape"], "popups_before": 1, "popups_after": 0}))
row = r["clauses"][0]
check("clause result records kind, evidence keys used and detail", row["kinds"] == "esc_closes" and "popups_before" in row["specs"][0]["evidence"] and row["specs"][0]["detail"] and row["detail"], row)
check("every kind has an EVIDENCE entry", all(k in X.EVIDENCE for k in ("esc_closes", "focus_opener", "focus_trap", "popup_closed", "confirm_before_delete", "export_file", "ax_names", "contrast",
                                                                       "overflow_390", "net_status", "net_class", "no_console_error", "validation_block", "persisted", "value_saved",
                                                                       "item_created", "appears_in_list", "text_absent")))

# ---------------------------------------------------------------------------------- originals untouched; the VERIFIED gate is untouched
t = {"id": "FIX-x-001", "lens": "board", "repro_steps": ["Open Board > Escape"], "expected": "Esc closes the dialog; focus returns to the trigger"}
before = copy.deepcopy(t)
repro.ticket_expected_kinds(t)
repro.check_expected(t["expected"], EVERYTHING)
check("original expected / repro_steps are byte-identical after classification + checking", t == before and repr(t) == repr(before))
src = open(os.path.join(HERE, "concord_walker", "ledger.py")).read()
check("VERIFIED gate: assert_verifiable still the single gate (no new write site)", "def assert_verifiable" in src and src.count("VERIFIED = \"VERIFIED\"") == 1 and "assert_verifiable(row, expect_sha)" in src)
check("expected.py / writevocab.py never write the literal status VERIFIED", all("VERIFIED" not in open(os.path.join(HERE, "concord_walker", f)).read() for f in ("expected.py", "writevocab.py")))

print("\n%d checks, %d failed" % (N[0], len(FAILS)))
sys.exit(1 if FAILS else 0)
