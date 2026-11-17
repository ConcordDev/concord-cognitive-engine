"""Generic observe predicates (precapture item 3) - need NO control names.

A *window* is the evidence around ONE executed step:
  {n, console_new:[str], net:[{status,method,path}], url_before, url_after, alerts_before:[str], alerts_after:[str],
   rows_before:int|None, rows_after:int|None, spinner_before:bool|None, spinner_after:bool|None,
   blank:bool|None, boundary:bool|None, texts_after:[str]}
`window_from(before, after, console_new, net)` builds one from two driver snapshots (pure).

Every predicate returns (state, detail) with state in pass|fail|unverified. Missing evidence -> unverified
(fail closed). Clause text -> spec via `classify(fragment)`; expected.py calls it only for fragments its own
classifier left unclassified, so no existing classification changes.
"""
import re

BOUNDARY_TEXT = re.compile(r"(?i)something went wrong|application error|unexpected error|an error occurred|this page crashed|error boundary|failed to load (?:the )?(?:page|app)|\bchunkloaderror\b|\b(?:404|500)\b\s*[-–:]?\s*(?:page )?(?:not found|internal)")
SPINNER_ROLES = ("progressbar",)
_TELEMETRY = re.compile(r"(?i)/(?:telemetry|analytics|metrics|vitals|beacon|log|events/track)\b")


def window_from(before, after, console_new=(), net=(), n=None):
    before, after = before or {}, after or {}
    texts = list(after.get("texts") or [])
    return {
        "n": n,
        "console_new": list(console_new or []),
        "net": [dict(x) for x in (net or [])],
        "url_before": before.get("url"), "url_after": after.get("url"),
        "alerts_before": list(before.get("alerts") or []), "alerts_after": list(after.get("alerts") or []),
        "rows_before": len(before["list_items"]) if "list_items" in before else None,
        "rows_after": len(after["list_items"]) if "list_items" in after else None,
        "spinner_before": before.get("spinner"), "spinner_after": after.get("spinner"),
        "blank": (not after.get("controls") and not texts) if ("controls" in after and "texts" in after) else None,
        "boundary": any(BOUNDARY_TEXT.search(t or "") for t in texts) if "texts" in after else None,
        "texts_after": texts[:200],
    }


def _wins(ev):
    w = (ev or {}).get("obs")
    return [x for x in (w or []) if isinstance(x, dict)]


def _need(ev):
    w = _wins(ev)
    return (w, None) if w else (None, ("unverified", "no per-step observation windows were captured (driver cannot snapshot)"))


# ------------------------------------------------------------------ predicates
def no_new_console_errors(ev):
    w, bad = _need(ev)
    if bad:
        return bad
    if all(x.get("console_new") is None for x in w):
        return "unverified", "console not readable"
    errs = [m for x in w for m in (x.get("console_new") or [])]
    return ("fail", "%d new console error(s): %s" % (len(errs), "; ".join(e[:80] for e in errs[:3]))) if errs else ("pass", "no new console errors across %d step(s)" % len(w))


def no_http_errors(ev, allow=()):
    w, bad = _need(ev)
    if bad:
        return bad
    rows = [r for x in w for r in (x.get("net") or []) if isinstance(r.get("status"), int) and r["status"] >= 400 and not _TELEMETRY.search(r.get("path") or "")]
    rows = [r for r in rows if r["status"] not in set(allow)]
    return ("fail", "%d 4xx/5xx response(s): %s" % (len(rows), ", ".join("%s %s %s" % (r.get("method"), r.get("path"), r["status"]) for r in rows[:3]))) if rows else ("pass", "no unexpected 4xx/5xx%s" % (" (allowed: %s)" % sorted(allow) if allow else ""))


def expected_http_error(ev, codes):
    """'should 403' - the ticket EXPECTS a 4xx/5xx: it must actually be observed."""
    w, bad = _need(ev)
    if bad:
        return bad
    seen = {r["status"] for x in w for r in (x.get("net") or []) if isinstance(r.get("status"), int)}
    hit = seen & set(codes)
    return ("pass", "status %s observed" % sorted(hit)) if hit else ("fail", "expected %s but the step fired %s" % (sorted(codes), sorted(seen) or "no responses"))


def _norm(s):
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def toast_present(ev, text=None, present=True):
    w, bad = _need(ev)
    if bad:
        return bad
    if all(x.get("alerts_after") is None for x in w):
        return "unverified", "alert/toast regions unreadable"
    seen = [a for x in w for a in (x.get("alerts_after") or [])]
    if text:
        hit = [a for a in seen if _norm(text) in _norm(a)]
    else:
        hit = seen
    if present:
        return ("pass", "toast/alert shown: %r" % (hit[0][:80],)) if hit else ("fail", "no toast/alert%s appeared (alerts seen: %s)" % ((" containing %r" % text) if text else "", [a[:40] for a in seen[:3]]))
    return ("fail", "toast/alert %r appeared" % (hit[0][:80],)) if hit else ("pass", "no toast/alert%s" % ((" containing %r" % text) if text else ""))


def url_changed(ev, changed=True, contains=None):
    w, bad = _need(ev)
    if bad:
        return bad
    first, last = w[0].get("url_before"), w[-1].get("url_after")
    if first is None or last is None:
        return "unverified", "url unreadable"
    did = first != last
    if contains is not None:
        ok = _norm(contains) in _norm(last)
        return ("pass", "url now %s" % last[-60:]) if ok == changed else ("fail", "url %s does not %s %r" % (last[-60:], "contain" if changed else "avoid", contains))
    return ("pass", "route %s (%s -> %s)" % ("changed" if did else "unchanged", first[-40:], last[-40:])) if did == changed else ("fail", "route %s but expected it to %s (%s)" % ("changed" if did else "did not change", "change" if changed else "stay", last[-60:]))


def count_changed(ev, direction="any"):
    w, bad = _need(ev)
    if bad:
        return bad
    b, a = w[0].get("rows_before"), w[-1].get("rows_after")
    if b is None or a is None:
        return "unverified", "list/row count unreadable"
    ok = {"any": a != b, "more": a > b, "fewer": a < b, "same": a == b}[direction]
    return ("pass" if ok else "fail"), "rows %d -> %d (expected %s)" % (b, a, direction)


def spinner_resolved(ev):
    w, bad = _need(ev)
    if bad:
        return bad
    last = w[-1].get("spinner_after")
    if last is None:
        return "unverified", "loading indicator unreadable"
    return ("fail", "a loading indicator is still present after the step settled") if last else ("pass", "no loading indicator after the step settled")


def not_blank(ev):
    w, bad = _need(ev)
    if bad:
        return bad
    if w[-1].get("blank") is None and w[-1].get("boundary") is None:
        return "unverified", "page content unreadable"
    if w[-1].get("boundary"):
        return "fail", "an error boundary / crash message is on screen"
    if w[-1].get("blank"):
        return "fail", "the page rendered blank (no controls, no text)"
    return "pass", "page has content and no error boundary"


def persisted_after_reload(ev):
    """The walker's OWN unique test value is still present after reload / navigating away and back."""
    own = [v for v in (ev or {}).get("own_values") or [] if v]
    ar = (ev or {}).get("after_reload")
    if not (ev or {}).get("reloaded") or ar is None:
        return "unverified", "no reload / navigate-away-and-back happened in this replay"
    if not own:
        return "unverified", "the walker created no value of its own to read back"
    pool = [_norm(x) for x in list(ar.get("texts") or []) + list(ar.get("names") or [])]
    gone = [v for v in own if not any(_norm(v) in x for x in pool)]
    return ("fail", "own value(s) gone after reload: %s" % gone[:2]) if gone else ("pass", "own value(s) still present after reload: %s" % own[:2])


# ------------------------------------------------------------------ clause -> spec
_NUM = re.compile(r"\b([45]\d\d)\b")
_ALT = re.compile(r"(?i)\b(?:or|either|otherwise|else|unless|depending|if)\b")
_Q = "\"'‘’“”"
_QUOTED = re.compile(r"[" + _Q + r"]([^" + _Q + r"]{2,80})[" + _Q + r"]")
_RULES = [
    ("g_no_console_error", re.compile(r"(?i)\bno\s+(?:new\s+)?console\s+(?:errors?|exceptions?)\b|\bconsole\s+(?:stays|remains|is)\s+(?:clean|quiet|empty)\b|\bwithout\s+(?:any\s+)?console\s+errors?\b")),
    ("g_no_http_error", re.compile(r"(?i)\bno\s+(?:new\s+)?(?:4xx|5xx|4xx/5xx|failed (?:network )?requests?|network errors?|http errors?|failing requests?)\b|\bno\s+[45]\d\d\s+(?:responses?|errors?)\b|\bwithout\s+(?:any\s+)?(?:4xx|5xx|network errors?)\b")),
    ("g_http_expected", re.compile(r"(?i)\b(?:should|must|returns?|responds?\s+with|gets?|expect(?:s|ed)?|is)\s+(?:an?\s+)?(?:http\s+)?([45]\d\d)\b")),
    ("g_toast_shown", re.compile(r"(?i)\b(?:a\s+)?(?:toast|snackbar|banner|alert|notification|error message|success message|confirmation message|message)\b[^.]{0,30}\b(?:appears?|is shown|shows?|displays?|is displayed|pops up|visible)\b|\b(?:shows?|displays?|appears?)\s+(?:a|an|the)\s+(?:toast|snackbar|alert|error message|success message|notification)\b")),
    ("g_url_changed", re.compile(r"(?i)\b(?:url|route|address bar|location)\s+(?:changes?|updates?|now (?:reads?|is|shows?)|becomes?|navigates?)\b|\b(?:navigates?|redirects?)\s+to\b")),
    ("g_url_unchanged", re.compile(r"(?i)\b(?:url|route)\s+(?:does(?:n't| not) change|stays?|remains?)\b|\b(?:stays|remains)\s+on\s+the\s+same\s+(?:page|route|url)\b|\bno\s+navigation\b")),
    ("g_count_changed", re.compile(r"(?i)\b(?:list|rows?|cards?|items?|entries|results?)\s+(?:count\s+)?(?:grows?|increases?|gains?|shrinks?|decreases?|drops?|changes?|updates?)\b|\b(?:one|an?)\s+(?:more|extra|additional)\s+(?:row|item|card|entry)\b|\b(?:row|item|card|entry)\s+count\s+(?:changes?|increases?|decreases?)\b")),
    ("g_spinner_resolves", re.compile(r"(?i)\b(?:spinner|loading (?:state|indicator|skeleton)|skeleton|progress (?:bar|indicator))\s+(?:disappears?|goes away|resolves?|clears?|stops?|finishes?|is gone)\b|\bloading\s+(?:finishes|completes|resolves|ends)\b|\bno\s+(?:infinite|endless|stuck)\s+(?:spinner|loading)\b|\bnever\s+(?:stuck|hangs?)\s+(?:on|in)\s+loading\b")),
    ("g_not_blank", re.compile(r"(?i)\bno\s+(?:blank|white|empty)\s+(?:screen|page)\b|\b(?:page|screen)\s+(?:is\s+not|isn't|does not (?:go|render))\s+blank\b|\bno\s+error\s+boundary\b|\bno\s+(?:crash|white screen of death)\b|\b(?:page|lens|view)\s+(?:renders?|loads?)\s+(?:without\s+(?:crash|error)|with content)\b|\bdoes(?:n't| not)\s+show\s+(?:an?\s+)?(?:error|something went wrong)\b")),
    ("g_layout_clean", re.compile(r"(?i)^(?:check|verify|inspect|confirm|look\s+for|test)\b[^.]{0,30}\b(?:layout|horizontal\s+scroll\w*|clipp\w+|overflow\w*|cut[\s-]?off|truncat\w+)\b|\b(?:no|without|nothing(?:\s+is)?)\s+(?:any\s+)?(?:horizontal\s+scroll\w*|clipp\w+|clipped|text\s+overflow|overflow\w*|cut[\s-]?off|content\s+(?:cut|clipped))\b|\b(?:content|layout|page)\s+fits\s+(?:the\s+)?(?:viewport|screen|width)\b|\bnothing\s+(?:is\s+)?(?:clipped|cut\s+off|overflowing)\b")),
    ("g_persists", re.compile(r"(?i)\b(?:still\s+(?:there|present|visible|listed|appears?|shown|exists?|displayed)|persists?|persisted|is\s+retained|survives?)\s+(?:after\s+)?(?:a\s+)?(?:reload|refresh|navigat\w+|leaving|returning|re-?open\w*)\b|\bafter\s+(?:a\s+)?(?:reload|refresh|navigating away(?: and back)?|reopening)\b[^.]{0,40}\b(?:still|persists?|remains?|present|visible|listed)\b")),
]


def classify(f):
    """fragment -> spec {kind, text, ...} or None."""
    t = (f or "").strip()
    if not t:
        return None
    for kind, rx in _RULES:
        m = rx.search(t)
        if not m:
            continue
        if _ALT.search(t) and kind != "g_layout_clean":
            return None       # "A or B" / "otherwise": an alternative outcome rides along - checking one branch would hide the other
        sp = {"kind": kind, "text": t}
        if kind == "g_http_expected":
            sp["codes"] = sorted({int(x) for x in _NUM.findall(t)})
        elif kind == "g_toast_shown":
            q = _QUOTED.search(t)
            sp["match"] = q.group(1) if q else None
            sp["present"] = not bool(re.search(r"(?i)\b(?:no|not|without|never|does(?:n't| not))\b", t[:m.start()]))
        elif kind == "g_url_changed":
            q = _QUOTED.search(t) or re.search(r"(/[a-z0-9\-/]{2,})", t)
            sp["contains"] = (q.group(1) if q else None)
        elif kind == "g_count_changed":
            sp["direction"] = "more" if re.search(r"(?i)grow|increase|gain|more|extra|additional", t) else ("fewer" if re.search(r"(?i)shrink|decrease|drop", t) else "any")
        if kind == "g_no_http_error":
            sp["allow"] = sorted({int(x) for x in _NUM.findall(t)}) if re.search(r"(?i)\bexcept\b|\bother than\b", t) else []
        return sp
    return None


def check(sp, snap):
    """-> (state, detail) in the expected.py vocabulary: pass|fail|unchecked."""
    ev = (snap or {}).get("evidence") or {}
    k = sp["kind"]
    if k == "g_no_console_error":
        r = no_new_console_errors(ev)
    elif k == "g_no_http_error":
        r = no_http_errors(ev, sp.get("allow") or ())
    elif k == "g_http_expected":
        r = expected_http_error(ev, sp.get("codes") or []) if sp.get("codes") else ("unverified", "no status code in the clause")
    elif k == "g_toast_shown":
        r = toast_present(ev, sp.get("match"), sp.get("present", True))
    elif k == "g_url_changed":
        r = url_changed(ev, True, sp.get("contains"))
    elif k == "g_url_unchanged":
        r = url_changed(ev, False)
    elif k == "g_count_changed":
        r = count_changed(ev, sp.get("direction") or "any")
    elif k == "g_spinner_resolves":
        r = spinner_resolved(ev)
    elif k == "g_not_blank":
        r = not_blank(ev)
    elif k == "g_persists":
        r = persisted_after_reload(ev)
    elif k == "g_layout_clean":
        lay = (ev or {}).get("layout")
        r = ("unverified", "layout was not measured (driver cannot measure_layout)") if not isinstance(lay, dict) else (lay["state"], "; ".join(lay.get("issues") or []) or "no horizontal scroll, clipping or text overflow")
    else:
        r = ("unverified", "unknown generic predicate %s" % k)
    st, d = r
    return ("unchecked" if st == "unverified" else st), d


EVIDENCE = {k: ("obs",) for k, _ in _RULES}
EVIDENCE["g_persists"] = ("reloaded", "after_reload", "own_values")
EVIDENCE["g_layout_clean"] = ("layout",)
KINDS = tuple(k for k, _ in _RULES)
