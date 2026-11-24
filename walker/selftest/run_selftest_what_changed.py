#!/usr/bin/env python3
"""Selftest for walker/tools/what_changed.py (ULW C33).

Browser-free. Pins all six change classes (action added / removed /
re-wired, route added / removed / re-wired) plus the two noise
negatives: file/line movement alone is NOT re-wiring, and an fe_callers
reorder is NOT re-wiring (set semantics).
"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "tools"))
import what_changed as wc  # noqa: E402

FAILS = []


def check(name, cond):
    print(("PASS " if cond else "FAIL ") + name)
    if not cond:
        FAILS.append(name)


def act(domain, action, rc="NONE", callers=(), file="f.js", line=1):
    return {"domain": domain, "action": action, "receipt_class": rc,
            "fe_callers": list(callers), "file": file, "line": line}


def route(method, pattern, mount="/", file="r.js", source="express", line=1):
    return {"method": method, "pattern": pattern, "mount": mount,
            "file": file, "source": source, "line": line}


before = {"sha": "aaa", "routes": [
    route("GET", "/keep"), route("GET", "/gone"),
    route("POST", "/moved", file="old.js"), route("GET", "/shifted", line=5)],
    "actions": [
    act("chem", "keep"), act("chem", "gone"),
    act("chem", "reclass", rc="NEAR"), act("chem", "rewired", callers=("a",)),
    act("chem", "shifted", line=9), act("chem", "reorder", callers=("a", "b"))]}
after = {"sha": "bbb", "routes": [
    route("GET", "/keep"), route("GET", "/new"),
    route("POST", "/moved", file="new.js"), route("GET", "/shifted", line=50)],
    "actions": [
    act("chem", "keep"), act("chem", "new"),
    act("chem", "reclass", rc="PRODUCT"), act("chem", "rewired", callers=("a", "c")),
    act("chem", "shifted", line=99), act("chem", "reorder", callers=("b", "a"))]}

d = wc.diff_snapshots(before, after)
A, R = d["actions"], d["routes"]
check("action added", A["added"] == ["chem new"])
check("action removed", A["removed"] == ["chem gone"])
rw = {x["action"]: x["changes"] for x in A["rewired"]}
check("action re-wired: receipt_class change named",
      any("receipt_class" in c for c in rw.get("chem reclass", [])))
check("action re-wired: fe_callers change named",
      any("fe_callers" in c for c in rw.get("chem rewired", [])))
check("action line-move is NOT re-wired", "chem shifted" not in rw)
check("action fe_callers reorder is NOT re-wired", "chem reorder" not in rw)
check("route added", R["added"] == ["GET /new /"])
check("route removed", R["removed"] == ["GET /gone /"])
rrw = {x["route"]: x["changes"] for x in R["rewired"]}
check("route re-wired: file change named",
      any("file" in c for c in rrw.get("POST /moved /", [])))
check("route line-move is NOT re-wired", "GET /shifted /" not in rrw)

ident = wc.diff_snapshots(before, before)
check("identity: zero action changes",
      not ident["actions"]["added"] and not ident["actions"]["removed"]
      and not ident["actions"]["rewired"])
check("identity: zero route changes",
      not ident["routes"]["added"] and not ident["routes"]["removed"]
      and not ident["routes"]["rewired"])
check("identity: totals preserved",
      ident["actions"]["before"] == ident["actions"]["after"] == 6
      and ident["routes"]["before"] == ident["routes"]["after"] == 4)

print("SELFTEST %s (%d failures)" % ("PASS" if not FAILS else "FAIL", len(FAILS)))
sys.exit(1 if FAILS else 0)
