#!/usr/bin/env python3
"""C26 (ULW 43-upgrade): DevTools read-back capture — console + failed-request
capture as first-class recipe evidence (concord_walker/readback.py, wired into
LensWalk.console_network as result["readback"]).

Pure python, no browser: the pins are over build_readback's row building plus
a source pin for the wiring (the fleet's wiring-pin form; the live exercise
is the walker desk's run).

What this pins:
  * rows dedupe by (type, route, message) with occurrences — repeats of the
    same failure file ONE row;
  * failed requests (status >= 400) carry weight "high" and file first,
    5xx before 4xx, both above console/page rows (weight "normal");
  * a 500 files above the console warning it printed — and the browser's
    "Failed to load resource" echo of that 500 is not double-filed;
  * sub-400 responses are not evidence; driver-shaped response dicts file
    under "METHOD path" routes with their status;
  * console and page errors are distinct types even with identical text;
  * empty streams file no rows; the build is deterministic.
Run: python3 selftest/test_c26_readback.py
"""
import os, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from concord_walker import readback as RB

FAILS = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + ((" " + str(extra)[:300]) if extra and not cond else ""))
    if not cond:
        FAILS.append(name)


rows = RB.build_readback(
    console_errors=["TypeError: x is not a function", "TypeError: x is not a function"],
    page_errors=["TypeError: x is not a function"],
    bad_responses=[(500, "/api/lens/run"), (500, "/api/lens/run"), (500, "/api/lens/run"),
                   (404, "/api/dtus/9")])
check("dedupe by (type, route, message) with occurrences",
      len(rows) == 4 and [r["occurrences"] for r in rows] == [3, 1, 2, 1], rows)
check("5xx files first at weight high", rows[0]["type"] == "http_error" and rows[0].get("status") == 500
      and rows[0]["weight"] == "high" and rows[0]["route"] == "/api/lens/run", rows[0])
check("4xx files second at weight high", rows[1].get("status") == 404 and rows[1]["weight"] == "high", rows[1])
check("console rows file below http rows at weight normal", rows[2]["type"] == "console_error"
      and rows[2]["weight"] == "normal" and rows[2]["route"] is None, rows[2])
check("page errors are their own type, below console rows", rows[3]["type"] == "page_error"
      and rows[3]["message"] == "TypeError: x is not a function", rows[3])

rows = RB.build_readback(
    console_errors=["Failed to load resource: the server responded with a status of 500 (Internal Server Error)"],
    bad_responses=[(500, "/api/lens/run")])
check("a 500 files above its own warning — the echo is not double-filed",
      len(rows) == 1 and rows[0]["type"] == "http_error" and rows[0].get("status") == 500, rows)

rows = RB.build_readback(responses=[{"method": "POST", "path": "/api/lens/run", "status": 500},
                                    {"method": "GET", "path": "/api/lens/list", "status": 200},
                                    {"method": "GET", "path": "/api/lens/list", "status": 302}])
check("driver-shaped responses: only failures file, under METHOD path routes",
      len(rows) == 1 and rows[0]["route"] == "POST /api/lens/run" and rows[0].get("status") == 500, rows)

check("empty streams file no rows", RB.build_readback() == [] and RB.build_readback([], [], [], []) == [])

a = RB.build_readback(console_errors=["boom"], bad_responses=[(503, "/api/x"), (404, "/api/y")])
b = RB.build_readback(console_errors=["boom"], bad_responses=[(503, "/api/x"), (404, "/api/y")])
check("deterministic across calls", a == b, (a, b))

src = open(os.path.join(HERE, "concord_walker", "checks.py")).read()
body = src[src.index("def console_network"):]
body = body[:body.index("\n    def ", 10)] if "\n    def " in body[10:] else body
check("wiring: console_network files result[\"readback\"] from the captured streams",
      'self.result["readback"] = _readback.build_readback(self.console_errors, self.page_errors, self.bad_responses)' in body)

print("%d failure(s)" % len(FAILS))
sys.exit(1 if FAILS else 0)
