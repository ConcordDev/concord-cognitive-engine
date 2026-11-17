"""`expected` -> typed, machine-checkable clauses (mapper-vocab, item 4).

Two jobs:
  * split_clauses(): sentence / semicolon / bullet splitting. The old splitter cut on every comma and
    "and" (4,235 fragments, 1,251 of <=3 words such as "(e.g" or "Controls"); this one yields the
    tester's sentences (about 2,877 clauses on the fold).
  * classify_clause() / check_specs(): a sentence is CHECKABLE only when every part of it reads as a
    typed predicate the walker has evidence for. Each spec names its kind; check_specs() evaluates it
    against the replay snapshot plus an `evidence` dict (net ledger, console, export file, focus trace,
    AX names, contrast, 390 overflow, keys sent, reload flag). A spec whose evidence is missing is
    `unchecked` - never `pass`. Vague wording ("usable", "works", "counts agree", "looks right") is
    never classified: it stays NEEDS_HUMAN.

The legacy single-predicate checks (enabled/disabled, selected, focus returns to X, dialog closes,
X is visible, shows 'X', no errors) stay in repro.py; they are passed in as `legacy` (a callable
(clause, snap) -> (state, detail)) so this module has no import cycle.
"""
import re

EMPTY_SNAP = {"controls": [], "texts": [], "dialogs": [], "errors": 0, "evidence": {}}

_VAGUE = re.compile(r"(?i)\b(usable|works?|working|properly|correctly|sensible|reasonable|intuitive|obvious|meaningful|helpful|honest|accurate|"
                    r"consistent|looks?\s+(?:right|good|correct|fine)|counts?\s+agree|feels?|smooth|expected|appropriate|clearly?|understandable|"
                    r"good|nice|polished|premium|as intended|makes? sense|reads? well|logical|sane|coherent)\b")
_NEG = re.compile(r"(?i)\b(no|not|never|without|doesn'?t|does not|don'?t|isn'?t|aren'?t|cannot|can'?t|nothing)\b")
_Q = r"[\"'‘“]([^\"'’”]{1,60})[\"'’”]"


def split_clauses(expected):
    """Sentences, semicolons and list bullets only - never commas or 'and'."""
    s = (expected or "").replace("\r", "")
    parts = re.split(r"\n\s*(?:[-*•]|\d+[.)])\s+|\n+|\s*;\s+|\s+•\s+|(?<=[a-z0-9)\]'\"”’%])\.\s+(?=[A-Z0-9(\"'‘“])", s)
    out = []
    for p in parts:
        p = re.sub(r"^\s*(?:[-*•]|\d+[.)])\s+", "", p or "").strip(" .\t")
        if p:
            out.append(p)
    return out


def _protect(s):
    keep = []

    def sub(m):
        keep.append(m.group(0))
        return "\x00%d\x00" % (len(keep) - 1)
    return re.sub(_Q, sub, s), keep


def _unprotect(s, keep):
    return re.sub(r"\x00(\d+)\x00", lambda m: keep[int(m.group(1))], s)


def fragments(clause):
    """A compound sentence ('A is X, and B is Y') -> its independent predicates (quotes kept whole)."""
    s, keep = _protect(clause)
    fr = [f.strip() for f in re.split(r"\s*(?:,\s*and\s+|,\s*but\s+|\s+and\s+(?=[A-Za-z\x00])|,\s+)\s*", s) if f and f.strip()]
    return [_unprotect(f, keep) for f in fr] or [clause]


# --------------------------------------------------------------------------- typed kinds
def _name(m):
    return (m.group(1) or "").strip()


_KINDS = [
    ("control_present", re.compile(r"(?i)^(?:an?\s+|the\s+|each\s+)?([A-Za-z][A-Za-z /\-]{1,30}?)\s+(?:control|button|field|action|option|link|toggle|menu)s?\s+(?:is\s+|are\s+)?(?:available|present|exists?|visible|shown|offered)\b"),
     lambda m: {"names": [x.strip() for x in re.split(r"\s*(?:/|,|\bor\b|\band\b)\s*", m.group(1)) if x.strip()]}),
    ("target_size", re.compile(r"(?i)(?:≥|>=|at least|minimum(?: of)?)\s*(\d{2})\s*(?:px|pt|css px)\b"), lambda m: {"px": int(m.group(1))}),
    # (kind, compiled regex, spec builder)
    ("esc_closes", re.compile(r"(?i)\besc(?:ape)?\b.*\b(?:closes?|dismiss(?:es|ed)?|exits?)\b|\b(?:closes?|dismiss(?:es|ed)?)\b.*\b(?:on|with|by|when)\s+(?:pressing\s+)?esc(?:ape)?\b"), lambda m: {}),
    ("focus_opener", re.compile(r"(?i)\bfocus\s+(?:returns?|goes|moves|is\s+restored)\s+(?:back\s+)?to\s+(?:the\s+)?(?:[A-Za-z]+\s+)?(?:trigger|opener|opening|invoking|control that opened|button that opened|element that opened|menu button)|\breturns?\s+focus\s+to\s+(?:the\s+)?(?:[A-Za-z]+\s+)?(?:trigger|opener|invoking control|control that opened|button that opened)"), lambda m: {}),
    ("arrow_moves", re.compile(r"(?i)\barrow(?:\s*keys?|(?:left|right|up|down)(?:\s*/\s*(?:left|right|up|down))?)?\b.*\b(?:moves?|changes?|cycles?|navigates?|shifts?)\s+(?:the\s+)?(?:keyboard\s+)?focus|\barrow keys?\s+(?:move|change|cycle|navigate)"), lambda m: {}),
    ("tab_reaches", re.compile(r"(?i)\btab(?:bing)?\s+(?:reaches|focuses|lands on|moves to|visits)\s+(?:the\s+)?" + r"(?:" + _Q + r"|([A-Z][A-Za-z0-9'&.\- ]{1,30}))\s*$"), lambda m: {"name": (m.group(1) or m.group(2) or "").strip()}),
    ("confirm_before_delete", re.compile(r"(?i)(?:confirm(?:ation)?\s+(?:dialog|prompt|step|modal)|asks?\s+(?:for\s+)?confirmation|are you sure|confirm(?:s|ed)?\s+before\s+(?:delet|remov))"), lambda m: {}),
    ("export_file", re.compile(r"(?i)\bexport(?:s|ed)?\b.*\b(?:file|downloads?|json|csv|non-?empty|valid|parses?|rows?|records?)\b|\b(?:json|csv)\s+(?:file|export)\b|\bdownloads?\s+(?:a|the)?\s*(?:file|json|csv)"), lambda m: {}),
    ("ax_names", re.compile(r"(?i)accessible names?|aria-?label|\b(?:is|are)\s+labell?ed\b|\bhas\s+an?\s+(?:accessible\s+)?(?:name|label)\b|(?:unnamed|unlabell?ed)\s+(?:buttons?|controls?|inputs?|fields?)"), lambda m: {}),
    ("contrast", re.compile(r"(?i)\bcontrast\b|\bwcag\b"), lambda m: {}),
    ("overflow_390", re.compile(r"(?i)\bno\s+horizontal\s+(?:scroll(?:ing|bar)?|overflow)|(?:does\s*n[o']t|doesn't|do not|without)\s+(?:scroll\s+(?:sideways|horizontally)|overflow(?:s|ing)?|clip|get\s+clipped|get\s+cut\s+off)|\bfits?\s+(?:within|in)\s+(?:the\s+)?(?:390|viewport|screen|width)|\bno\s+(?:content\s+)?clipp(?:ing|ed)\b"), lambda m: {}),
    ("net_status", re.compile(r"(?i)\bno\s+(?:repeated\s+)?([45]\d\d)s?\b()"), lambda m: {"code": int(m.group(1)), "force_neg": True}),
    ("net_status", re.compile(r"(?i)\b(?:http\s*)?([2-5]\d\d)\b(?=.*\b(?:status|response|returns?|request|api|http|code|error)\b)|\b(?:status|response|returns?|http|code)\b.*?\b([2-5]\d\d)\b"), lambda m: {"code": int(m.group(1) or m.group(2))}),
    ("net_class", re.compile(r"(?i)\b(?:no|without)\s+(?:repeated\s+)?(?:([45])xx|server\s+errors?|client/server\s+errors?|client\s+errors?|failed\s+(?:requests?|calls?)|network\s+errors?)"), lambda m: {"cls": m.group(1) or "45"}),
    ("validation_block", re.compile(r"(?i)\b(?:rejects?|rejected|blocks?|blocked|prevents?|prevented|refuses?|refused|not\s+allowed|cannot\s+be\s+(?:saved|submitted|added)|clamps?|clamped|inline\s+(?:error|message|validation)|validation\s+(?:error|message))\b"), lambda m: {}),
]
_EXTRA_PRED = re.compile(r"\b(?:uses?|shows?|displays?|returns?|closes?|opens?|stays?|remains?|keeps?|matches|moves?|gets?|becomes?|appears?|renders?|lists?|contains?|includes?|saves?|loads?|resets?|clears?|highlights?|updates?|reloads?|redirects?|blocks?|rejects?|prevents?|downloads?|exports?|persists?|scrolls?|clips?|overflows?|covers?|overlaps?)\b")
_POS_ONLY = {"esc_closes", "focus_opener", "arrow_moves", "tab_reaches", "confirm_before_delete", "export_file"}
_PERSIST = re.compile(r"(?i)\bpersists?\b|survives?\s+(?:a\s+)?(?:hard\s+)?reload|(?:still|remains?)\s+(?:present|listed|there|visible|shown)\s+after\s+(?:a\s+)?(?:hard\s+)?reload|\bafter\s+(?:a\s+)?(?:hard\s+)?reload\b")
_PNAME = re.compile(_Q + r"|\b([A-Z][A-Za-z0-9'&.\-]*(?:\s+[A-Z0-9][A-Za-z0-9'&.\-]*){0,4})\b")
_PHRASE = re.compile(r"(?i)\b(?:shows?|displays?|lists?|renders?|contains?)\s+(?:an?\s+|the\s+|some\s+)?([a-z][a-z0-9 \-/']{4,40}?)\s*$")
_NO_PHRASE = re.compile(r"(?i)^(?:nothing|an? error|errors?|no\b.*|empty|blank)")
_CTRL_PRESENT = re.compile(r"(?i)^has a control matching:\s*(.+)$")


def classify_fragment(f, legacy):
    """One predicate -> a spec dict, or None. Never classifies vague wording."""
    f = f.strip()
    if not f or _VAGUE.search(f):
        return None
    m = _CTRL_PRESENT.match(f)
    if m:
        names = [n.strip() for n in re.split(r"\s*\|\s*", m.group(1)) if n.strip()]
        return {"kind": "control_present", "names": names} if names else None
    for kind, rx, build in _KINDS:
        m = rx.search(f)
        if m:
            outside = f[:m.start()] + " " + f[m.end():]
            if _EXTRA_PRED.search(outside):
                return None       # a second predicate rides along; checking only the first would hide it
            spec = dict(build(m), kind=kind, text=f, neg=bool(_NEG.search(f)) or bool(build(m).get("force_neg")))
            if kind == "contrast":
                r = re.search(r"(\d(?:\.\d)?)\s*:\s*1", f)
                spec["ratio"] = float(r.group(1)) if r else None
            if kind in _POS_ONLY and spec["neg"]:
                return None  # a negated claim ("Esc does not close...") is not what these checks measure
            return spec
    if _PERSIST.search(f):
        nm = _PNAME.search(f)
        name = (nm.group(1) or nm.group(2) or "").strip() if nm else ""
        if name and not _NEG.search(f) and name.lower() not in ("after", "the", "reload", "hard"):
            return {"kind": "persisted", "name": name, "text": f}
        return None
    if legacy(f, EMPTY_SNAP)[0] != "unchecked":
        return {"kind": "legacy", "text": f}
    m = _PHRASE.search(f)
    if m and not _NEG.search(f) and not _NO_PHRASE.match(m.group(1)) and len(re.findall(r"[a-z0-9]+", m.group(1))) >= 2:
        return {"kind": "text_phrase", "phrase": m.group(1).strip(), "text": f}
    return None


def classify_clause(clause, legacy):
    """sentence -> list of specs (EVERY fragment classified) or None. An unclassified fragment is re-tried
    joined to its right neighbour ("Text and disabled labels meet WCAG AA contrast")."""
    fr = fragments(clause)
    specs, i = [], 0
    while i < len(fr):
        sp = classify_fragment(fr[i], legacy)
        j = i + 1
        while sp is None and j < len(fr):
            sp = classify_fragment(" and ".join(fr[i:j + 1]), legacy)
            j += 1
        if sp is None:
            return None
        specs.append(sp)
        i = j
    return specs


def classify_expected(expected, legacy, extra=()):
    """[(clause, kind|None)] for the clauses of `expected` followed by `extra` (observe-derived) clauses."""
    out = []
    for c in list(split_clauses(expected)) + [e for e in extra if e]:
        sp = classify_clause(c, legacy)
        out.append((c, None if sp is None else "+".join(s["kind"] for s in sp)))
    return out


# --------------------------------------------------------------------------- evaluation
def _ev(snap):
    return snap.get("evidence") or {}


def _norm(x):
    return re.sub(r"[^a-z0-9]+", "", (x or "").lower())


def _spec_check(sp, snap, legacy):
    k, ev = sp["kind"], _ev(snap)
    if k == "legacy":
        return legacy(sp["text"], snap)
    if k == "esc_closes":
        keys = ev.get("keys_sent")
        if keys is None or "Escape" not in keys:
            return "unchecked", "no Escape key was sent during the replay, so 'Esc closes' was not exercised"
        n = len(snap.get("dialogs") or [])
        return ("pass" if n == 0 else "fail"), "Escape sent; %d dialog(s) open after" % n
    if k == "focus_opener":
        fa, op = ev.get("focus_after_escape"), ev.get("opener")
        if fa is None or not op:
            return "unchecked", "no recorded opener / focus-after-Escape (no Escape pressed after opening a control)"
        return ("pass" if _norm(fa) == _norm(op) else "fail"), "focus after Escape=%r, opener=%r" % (fa, op)
    if k == "arrow_moves":
        tr = ev.get("focus_trace")
        if not tr or len(tr) < 2:
            return "unchecked", "no focus trace across arrow keys"
        return ("pass" if len({_norm(x) for x in tr}) > 1 else "fail"), "focus trace %s" % tr[:6]
    if k == "tab_reaches":
        tr = ev.get("tab_trace")
        if tr is None:
            return "unchecked", "no Tab sweep recorded"
        hit = any(_norm(sp["name"]) and _norm(sp["name"]) in _norm(x) for x in tr)
        return ("pass" if hit else "fail"), "Tab sweep %s %r" % ("reached" if hit else "did not reach", sp["name"])
    if k == "confirm_before_delete":
        c = ev.get("confirm_seen")
        if c is None:
            return "unchecked", "no delete was exercised (deletes are never run read-only), so no confirm prompt was observed"
        return ("pass" if c else "fail"), "confirm before delete seen=%s" % c
    if k == "export_file":
        x = ev.get("export")
        if not x:
            return "unchecked", "no export was run in this replay"
        return ("pass" if x.get("ok") else "fail"), "export %s (bytes=%s rows=%s parsed=%s)" % (x.get("verdict"), x.get("bytes"), x.get("rows"), x.get("parsed"))
    if k == "ax_names":
        n = ev.get("ax_unnamed")
        if n is None:
            return "unchecked", "no accessibility-tree name check was run"
        return ("pass" if n == 0 else "fail"), "%d unnamed interactive control(s) of %s" % (n, ev.get("ax_total"))
    if k == "contrast":
        c = ev.get("contrast")
        if not c or not c.get("checked"):
            return "unchecked", "no contrast measurement in this replay"
        want = sp.get("ratio")
        if want is not None and c.get("threshold") is not None and want > c["threshold"]:
            return "unchecked", "clause asks %.1f:1 but the walker measures at %.1f:1" % (want, c["threshold"])
        return ("pass" if not c.get("fails") else "fail"), "%d low-contrast of %d checked" % (c.get("fails", 0), c["checked"])
    if k == "overflow_390":
        o = ev.get("overflow")
        if not o or (o.get("viewport_w") or 9999) > 430:
            return "unchecked", "no overflow measurement at a 390-class viewport"
        if re.search(r"(?i)clip|cut\s+off", sp.get("text", "")) and o.get("offscreen") is None:
            return "unchecked", "no off-screen control measurement"
        bad = (o.get("overflow_px") or 0) > 2 or (re.search(r"(?i)clip|cut\s+off", sp.get("text", "")) and (o.get("offscreen") or 0) > 0)
        return ("fail" if bad else "pass"), "overflow %spx, %s control(s) off-screen at %spx wide" % (o.get("overflow_px"), o.get("offscreen"), o.get("viewport_w"))
    if k == "target_size":
        t = ev.get("targets")
        if not t or not t.get("checked"):
            return "unchecked", "no tap-target measurement in this replay"
        return ("pass" if (t.get("min_px") or 0) >= sp["px"] else "fail"), "smallest of %d target(s) is %spx (need >= %dpx)" % (t["checked"], t.get("min_px"), sp["px"])
    if k == "net_status":
        st = ev.get("net_statuses")
        if st is None:
            return "unchecked", "no network ledger in this replay"
        present = sp["code"] in st
        if sp["neg"]:
            return ("fail" if present else "pass"), "status %d %s" % (sp["code"], "seen" if present else "not seen")
        return ("pass", "status %d seen" % sp["code"]) if present else ("unchecked", "status %d not observed (the walker did not trigger it)" % sp["code"])
    if k == "net_class":
        st = ev.get("net_statuses")
        if st is None:
            return "unchecked", "no network ledger in this replay"
        bad = [s for s in st if str(s)[:1] in sp["cls"]]
        return ("fail" if bad else "pass"), "%s responses: %s" % ("/".join(c + "xx" for c in sp["cls"]), bad[:4] or "none")
    if k == "validation_block":
        w = ev.get("net_writes")
        if w is None:
            return "unchecked", "no write-call ledger in this replay"
        if w:
            return "fail", "write call(s) went out: %s" % w[:3]
        texts = " ".join(snap.get("texts") or [])
        msg = re.search(r"(?i)\b(invalid|required|must|cannot|can't|too (?:long|short|large|small)|at least|at most|not allowed|error)\b", texts)
        dis = [c["name"] for c in snap.get("controls") or [] if c.get("enabled") is False and re.search(r"(?i)save|submit|add|create|apply", c.get("name") or "")]
        if msg or dis:
            return "pass", "no write call; %s" % ("message text present" if msg else "submit control disabled: %s" % dis[:2])
        return "unchecked", "no write call, but no inline message or disabled submit control was observed"
    if k == "persisted":
        if not ev.get("reloaded"):
            return "unchecked", "no reload happened in this replay"
        names = [c["name"] for c in snap.get("controls") or [] if c.get("name")] + list(snap.get("texts") or [])
        ok = any(_norm(sp["name"]) in _norm(x) for x in names)
        return ("pass" if ok else "fail"), "%r %s after reload" % (sp["name"], "present" if ok else "absent")
    if k == "text_phrase":
        pool = [_norm(c["name"]) for c in snap.get("controls") or [] if c.get("name")] + [_norm(t) for t in snap.get("texts") or []]
        p = _norm(sp["phrase"])
        return ("pass", "text %r present" % sp["phrase"]) if any(p in x for x in pool) else ("unchecked", "phrase %r not found verbatim (paraphrase - a human reads it)" % sp["phrase"])
    if k == "control_present":
        pool = [c["name"] for c in snap.get("controls") or [] if c.get("name")]
        got = [n for n in sp["names"] if any(_norm(n) in _norm(x) for x in pool)]
        return ("pass", "control(s) present: %s" % got) if got else ("unchecked", "no control matching %s is visible (a fixture/state may be missing)" % sp["names"])
    return "unchecked", "unknown spec kind %s" % k


def check_specs(specs, snap, legacy):
    """All specs must pass; any fail -> fail; any unchecked -> unchecked (never pass on missing evidence)."""
    rows = [(s, *_spec_check(s, snap, legacy)) for s in specs]
    if any(r[1] == "fail" for r in rows):
        return "fail", "; ".join("%s: %s" % (r[0]["kind"], r[2]) for r in rows if r[1] == "fail")
    if any(r[1] == "unchecked" for r in rows):
        return "unchecked", "; ".join("%s: %s" % (r[0]["kind"], r[2]) for r in rows if r[1] == "unchecked")
    return "pass", "; ".join(r[2] for r in rows)
