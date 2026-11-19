#!/usr/bin/env python3
"""C3 (ULW 43-upgrade): action-vocabulary widening — repro segments
"type X in 'field'", "wait", "press Enter" parse to walker actions
(repro.py: _type_in_field + the map_step widening).

Pure python, no browser: the pins are parser pins over expand_step (the
segment path the rewrite pass sizes against) and map_step (the legacy
single-step mapper it falls back to).

What this pins (each with its failure path):
  * "type X in 'field'" parses for quoted and unquoted values, quoted,
    bare-capitalised, and noun-carrying fields — and the value rides as
    the fill's literal (at the pre-C3 head the unquoted forms were
    unmapped and the quoted forms parsed but DROPPED the value);
  * the literal policy: quoted -> its text · generic ("a query") -> None
    (the executor's own labelled value stands) · unquoted specific ->
    its text, delimited by the field tail;
  * prose tails stay unmapped ("in the morning" is not a field; "into
    the field" names no field; a bare "type hello" still names no field);
  * "wait" / durations / "wait for <text>" parse in BOTH mappers
    (map_step had no wait at the pre-C3 head);
  * "press Enter" parses in both mappers (already true at head — pinned
    as the control so the trio's third leg cannot silently regress);
  * neighbours untouched: quoted click, the crumb chain, and the
    prev-control type form (click a search control, then type a quoted
    literal -> fill with merge_prev).
Run: python3 selftest/test_c3_vocab.py
"""
import os, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from concord_walker import repro

repro._sleep = lambda s: None
FAILS = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + ((" " + str(extra)[:300]) if extra and not cond else ""))
    if not cond:
        FAILS.append(name)


def subs(step, slug="hub"):
    e = repro.expand_step(step, slug)
    return e, e.get("substeps") or []


# ---- the audit trio, segment path
e, s = subs("type hello in 'Search'")
check("type unquoted value in quoted field parses", e["mapped"] and len(s) == 1 and s[0]["action"] == "fill"
      and s[0]["name"] == "Search" and s[0].get("literal") == "hello", e)
e, s = subs("Type Hello World in 'Name'")
check("multi-word unquoted value parses with its literal", e["mapped"] and s and s[0].get("literal") == "Hello World"
      and s[0]["name"] == "Name", e)
e, s = subs("enter concord in Search")
check("bare capitalised field parses", e["mapped"] and s and s[0]["name"] == "Search" and s[0].get("literal") == "concord", e)
e, s = subs("type hello into the Search field")
check("bare field + noun parses", e["mapped"] and s and s[0]["name"] == "Search" and s[0].get("literal") == "hello", e)
e, s = subs("type hello in 'Search' then press Enter")
check("type segment chains with press Enter", e["mapped"] and [x["action"] for x in s] == ["fill", "press"]
      and s[1].get("key") == "Enter", e)
e, s = subs("press Enter")
check("press Enter parses (control, true at head)", e["mapped"] and s and s[0]["action"] == "press" and s[0].get("key") == "Enter", e)
e, s = subs("wait")
check("bare wait parses", e["mapped"] and s and s[0]["action"] == "wait" and s[0].get("seconds") == 1.0, e)
e, s = subs("wait 2 seconds")
check("wait with duration parses", e["mapped"] and s and s[0].get("seconds") == 2.0, e)
e, s = subs("wait for 'Results'")
check("wait for quoted text parses as wait_for", e["mapped"] and s and s[0]["action"] == "wait_for" and s[0].get("text") == "Results", e)

# ---- the literal policy + the value-drop regression
e, s = subs("type 'hello' in 'Search'")
check("quoted value now rides as the literal (was dropped at head)", e["mapped"] and s and s[0].get("literal") == "hello", e)
e, s = subs('type "hello world" in "Search"')
check("double-quoted value rides as the literal", e["mapped"] and s and s[0].get("literal") == "hello world", e)
e, s = subs("fill 'My Title' in 'Title'")
check("fill verb with quoted value rides as the literal", e["mapped"] and s and s[0]["name"] == "Title"
      and s[0].get("literal") == "My Title", e)
e, s = subs("type a query in 'Search'")
check("generic value parses with literal None (own labelled value stands)", e["mapped"] and s
      and s[0]["action"] == "fill" and s[0].get("literal") is None, e)

# ---- failure paths stay unmapped
e, s = subs("type hello in the morning")
check("prose tail is not a field", not e["mapped"] and s == [], e)
e, s = subs("type the value into the field")
check("a field noun with no name is not a field", not e["mapped"] and s == [], e)
e, s = subs("type hello")
check("type with no field and no preceding control stays unmapped", not e["mapped"] and s == [], e)
e, s = subs("type hello in 'Search' then dance a jig")
check("one unmappable part keeps the whole step unmapped", not e["mapped"] and s == [], e)

# ---- map_step parity
m = repro.map_step("wait", "hub")
check("map_step: bare wait parses", m["mapped"] and m["action"] == "wait" and m.get("seconds") == 1.0, m)
m = repro.map_step("wait 2 seconds", "hub")
check("map_step: wait duration parses", m["mapped"] and m.get("seconds") == 2.0, m)
m = repro.map_step("wait for 'Results'", "hub")
check("map_step: wait-for parses", m["mapped"] and m["action"] == "wait_for" and m.get("text") == "Results", m)
m = repro.map_step("type hello in 'Search'", "hub")
check("map_step: type-in-field parses with literal", m["mapped"] and m["action"] == "fill"
      and m.get("name") == "Search" and m.get("literal") == "hello", m)
m = repro.map_step("press Enter", "hub")
check("map_step: press Enter parses (control)", m["mapped"] and m["action"] == "press" and m.get("key") == "Enter", m)
m = repro.map_step("type hello in the morning", "hub")
check("map_step: prose tail stays unmapped", not m["mapped"], m)

# ---- neighbours untouched
e, s = subs("click 'Filters'")
check("quoted click unchanged", e["mapped"] and s and s[0]["action"] == "click" and s[0].get("name") == "Filters", e)
e, s = subs("Open Share and press Esc, then Tab")
check("crumb/key chain unchanged", e["mapped"] and [x["action"] for x in s] == ["click", "press", "press"], e)
e, s = subs("Click 'Search', type 'concord'")
check("prev-control type form unchanged (fill merged into the click, literal rides)", e["mapped"]
      and len(s) == 1 and s[0]["action"] == "fill" and s[0].get("name") == "Search"
      and s[0].get("literal") == "concord", e)

print("%d failure(s)" % len(FAILS))
sys.exit(1 if FAILS else 0)
