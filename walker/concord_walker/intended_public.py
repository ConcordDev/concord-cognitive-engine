"""Intended-public allowlist for the two-account check (walker/config/intended_public.json).

A route listed here was decided readable by any signed-in member; a t2 read of t1's object on it
is graded PUBLIC_INTENDED, not OWNERSHIP_FAIL. Matching is by method + route template, where a
':name' segment on either side matches any one segment (records store templated paths like
/api/ct/merit/:uuid; the allowlist names /api/ct/merit/:userId)."""
import json, os

DEFAULT_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config", "intended_public.json")
REQUIRED = ("method", "route", "reason", "decided_by", "date")


def load(path=None):
    path = path or DEFAULT_PATH
    try:
        with open(path) as f:
            data = json.load(f)
    except FileNotFoundError:
        return []
    out = []
    for e in data.get("routes", []):
        missing = [k for k in REQUIRED if not e.get(k)]
        if missing:
            raise ValueError("intended_public entry %r missing %s" % (e.get("route"), ", ".join(missing)))
        out.append(e)
    return out


def _segs(p):
    return [s for s in (p or "").split("?")[0].split("/") if s]


def _seg_match(a, b):
    return a == b or a.startswith(":") or b.startswith(":")


def match(entries, method, path):
    """The allowlist entry covering (method, path), or None."""
    ps = _segs(path)
    for e in entries:
        if e["method"].upper() != (method or "").upper():
            continue
        rs = _segs(e["route"])
        if len(rs) == len(ps) and all(_seg_match(r, p) for r, p in zip(rs, ps)):
            return e
    return None


def tag(e):
    """What a record stores about the decision (no reason text needed downstream, but cheap)."""
    return {"route": e["route"], "decided_by": e["decided_by"], "date": e["date"], "reason": e["reason"]}
