#!/usr/bin/env python3
"""WALK-03 selftest (offline, no browser): the false-VERIFIED holes and the
unquoted element matching. Run against a walker tree:

    python3 test_walk03.py [tree_root]     # default: the tree this file lives in

Every case must PASS on the built tree and the WALK-03 cases must FAIL on the
pristine tree (that asymmetry is the evidence the holes were real).
"""
import json, os, sys, tempfile

ROOT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

RESULTS = []


def case(name, fn):
    try:
        ok, detail = fn()
    except Exception as e:
        ok, detail = False, "%s: %s" % (type(e).__name__, e)
    RESULTS.append((name, ok, detail))
    print("%s %s — %s" % ("PASS" if ok else "FAIL", name, detail))


from concord_walker import reverify as rv
from concord_walker import tickets as tk
import re as _re

try:
    from concord_walker import matching
except Exception:
    matching = None


def T(title, actual="", expected="", repro=None):
    return {"title": title, "actual": actual, "expected": expected, "repro_steps": repro or []}


# ---------------------------------------------------------------- classifier
case("classify: validation ticket is NOT tab_error (FIX-trades-009 shape)",
     lambda: (rv.classify(T("Form accepts blank input", "blank form submits", "an inline validation error")) != "tab_error",
              "got %r" % rv.classify(T("Form accepts blank input", "blank form submits", "an inline validation error"))))
case("classify: export-error title classifies as export, not tab_error",
     lambda: (rv.classify(T("Export fails with an error message")) == "export",
              "got %r" % rv.classify(T("Export fails with an error message"))))
case("classify: a true tab render error still classifies as tab_error",
     lambda: (rv.classify(T("Tab shows something went wrong")) == "tab_error",
              "got %r" % rv.classify(T("Tab shows something went wrong"))))
case("classify: console exception is pageerror/http territory, not tab_error",
     lambda: (rv.classify(T("Console shows an uncaught exception on load")) != "tab_error",
              "got %r" % rv.classify(T("Console shows an uncaught exception on load"))))

# ---------------------------------------------------------------- elements()
case("elements: quoted name still extracted",
     lambda: (rv.elements(T("Escape doesn't close the 'Filters' dialog")) == ["Filters"],
              "got %r" % rv.elements(T("Escape doesn't close the 'Filters' dialog"))))
case("elements: unquoted pair extracted (New Proposal / Schedule Meeting)",
     lambda: (rv.elements(T("Esc doesn't close New Proposal or Schedule Meeting dialogs")) == ["New Proposal", "Schedule Meeting"],
              "got %r" % rv.elements(T("Esc doesn't close New Proposal or Schedule Meeting dialogs"))))
case("elements: unquoted single dialog name",
     lambda: (rv.elements(T("Text in the Settings dialog is faint")) == ["Settings"],
              "got %r" % rv.elements(T("Text in the Settings dialog is faint"))))

# ---------------------------------------------------------------- matching
def _fuzzy():
    if matching is None:
        return False, "matching module absent"
    a = matching.fuzzy_match("New Proposal", ["New Proposal", "Schedule Meeting", "Settings"])
    b = matching.fuzzy_match("Settings dialog", ["Settings", "Export"])
    c = matching.fuzzy_match("Zebra", ["Settings", "Export"])
    d = matching.fuzzy_match("Filters", ["Filter by tag", "Settings"])
    return (a == "New Proposal" and b == "Settings" and c is None and d is None,
            "exact=%r containment=%r none=%r stemming-none=%r" % (a, b, c, d))
case("fuzzy_match: exact + containment hit, unrelated + stem-only miss", _fuzzy)

# ---------------------------------------------------------------- ticket path
case("ticket_path: sub-path extracted from repro",
     lambda: (rv.ticket_path(T("Page broken", repro=["Open /lenses/council/proposals", "Observe"])) == "/lenses/council/proposals",
              "got %r" % rv.ticket_path(T("Page broken", repro=["Open /lenses/council/proposals"]))))
case("ticket_path: no path -> None",
     lambda: (rv.ticket_path(T("Page broken")) is None, "got %r" % rv.ticket_path(T("Page broken"))))

# ---------------------------------------------------------------- export content
from concord_walker.checks import LensWalk
_lw = LensWalk.__new__(LensWalk)
_tmp = tempfile.mkdtemp(prefix="walk03-export-")


def _write(name, data, mode="w"):
    p = os.path.join(_tmp, name)
    with open(p, mode) as f:
        f.write(data)
    return p


def _export_match():
    p = _write("a.json", json.dumps([{"title": "Alpha Project", "id": 1}, {"title": "Beta Project", "id": 2}]))
    v, n, c = _lw._validate_export(p, visible=["Alpha Project", "Beta Project"])
    return (v == "PASS" and c == "match", "verdict=%r content=%r" % (v, c))
case("export content: file rows match the lens's rows -> match", _export_match)


def _export_wrong():
    p = _write("b.json", json.dumps([{"title": "Unrelated Row", "id": 9}, {"title": "Other Thing", "id": 10}]))
    v, n, c = _lw._validate_export(p, visible=["Alpha Project", "Beta Project"])
    return (v == "PASS" and c == "wrong", "verdict=%r content=%r" % (v, c))
case("export content: disjoint file -> wrong (the GB-1538 genus)", _export_wrong)


def _export_empty():
    p = _write("c.json", json.dumps([]))
    v, n, c = _lw._validate_export(p, visible=["Alpha Project"])
    return (v == "EMPTY" and c == "empty", "verdict=%r content=%r" % (v, c))
case("export content: empty dataset -> EMPTY/empty", _export_empty)


def _export_csv():
    p = _write("d.csv", "title,id\nAlpha Project,1\nBeta Project,2\n")
    v, n, c = _lw._validate_export(p, visible=["Alpha Project", "Beta Project"])
    p2 = _write("e.csv", "title,id\n")
    v2, n2, c2 = _lw._validate_export(p2, visible=["Alpha Project"])
    return (v == "PASS" and c == "match" and v2 == "EMPTY", "csv match=%r/%r header-only=%r" % (v, c, v2))
case("export content: CSV match + header-only EMPTY", _export_csv)


def _export_uncomparable():
    p = _write("f.pdf", b"%PDF-1.4 fake bytes", "wb")
    v, n, c = _lw._validate_export(p, visible=["Alpha Project", "Beta Project"])
    return (v == "PASS" and c == "uncomparable", "verdict=%r content=%r" % (v, c))
case("export content: unparseable format -> uncomparable (never auto-verified)", _export_uncomparable)


def _export_label():
    p = _write("g.json", json.dumps([{"title": "qa-walker-demo-20261114-1"}]))
    v, n, c = _lw._validate_export(p, visible=[], fixture_label="qa-walker-demo-20261114-1")
    v2, n2, c2 = _lw._validate_export(p, visible=[], fixture_label="qa-walker-other-1")
    return (c == "match" and c2 == "wrong", "label present=%r absent=%r" % (c, c2))
case("export content: own-fixture label decisive in write mode", _export_label)

# ---------------------------------------------------------------- contrast examples carry text
def _contrast_text():
    from concord_walker.checks import contrast_from_snapshot
    S = []
    def intern(x):
        if x not in S:
            S.append(x)
        return S.index(x)
    text = "Faint label"
    # styles: [color, background-color, background-image, font-size, font-weight, opacity, visibility, display]
    def style(color, bg):
        return [intern(color), intern(bg), intern("none"), intern("14px"), intern("400"), intern("1"), intern("visible"), intern("block")]
    nodes = {"parentIndex": [-1, 0], "nodeType": [1, 3], "nodeValue": [-1, intern(text)]}
    layout = {"nodeIndex": [0, 1], "bounds": [[0, 0, 800, 600], [10, 10, 120, 20]],
              "styles": [style("rgb(0, 0, 0)", "rgb(255, 255, 255)"), style("rgb(200, 200, 200)", "rgb(255, 255, 255)")]}
    snap = {"documents": [{"nodes": nodes, "layout": layout}], "strings": S}
    res = contrast_from_snapshot(snap, {"contrast_large": 3.0, "contrast_normal": 4.5}, (1280, 900))
    ex = res["examples"]
    return (len(res["failing_groups"]) == 1 and ex and ex[0].get("text") == text,
            "groups=%r examples=%r" % (res["failing_groups"], ex))
case("contrast: failing example carries its text (attribution)", _contrast_text)

# ---------------------------------------------------------------- element confirmation
def _confirmed():
    chk = {"surface_inventory": {"button_names": ["Export", "Filters"], "tab_names": ["Overview"],
                                 "non_focusable_names": ["Filters"]},
           "keyboard_focus": {"no_visible_names": []}}
    a = rv.Reverifier._elem_confirmed("unnamed", ["Filters"], chk)
    b = rv.Reverifier._elem_confirmed("keyboard", ["Filters"], chk)
    c = rv.Reverifier._elem_confirmed("keyboard", ["Export"], chk)
    d = rv.Reverifier._elem_confirmed("unnamed", ["Missing Thing"], chk)
    return (a == "Filters" and b is None and c == "Export" and d is None,
            "unnamed=%r keyboard-nonfocusable=%r keyboard-ok=%r absent=%r" % (a, b, c, d))
case("_elem_confirmed: named / non-focusable / focusable / absent", _confirmed)

# ---------------------------------------------------------------- no page JS
def _no_page_js():
    banned = _re.compile(r"\.(evaluate|evaluate_handle|locator|query_selector|query_selector_all|add_init_script|add_script_tag|expose_function|expose_binding|fill|get_by_\w+|wait_for_selector|wait_for_function|route)\(|Runtime\.evaluate|Runtime\.callFunctionOn")
    pkg = os.path.join(ROOT, "concord_walker")
    hits = [f for f in os.listdir(pkg) if f.endswith(".py") and banned.search(open(os.path.join(pkg, f)).read())]
    return (not hits, "hits=%r" % hits)
case("no page-JS calls anywhere in the package (incl. matching.py)", _no_page_js)

fails = [r for r in RESULTS if not r[1]]
print("\nWALK-03 SELFTEST: %d/%d pass%s" % (len(RESULTS) - len(fails), len(RESULTS),
      (" — FAILURES: " + ", ".join(r[0] for r in fails)) if fails else ""))
sys.exit(1 if fails else 0)
