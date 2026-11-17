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
from . import observe as _OBS
from . import netcheck as _NC

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
    ("focus_opener", re.compile(r"(?i)\bfocus\s+(?:returns?|goes|moves|is\s+restored)\s+(?:back\s+)?to\s+(?:the\s+)?(?:[A-Za-z]+\s+)?(?:trigger|opener|opening|invoking|control that opened|button that opened|element that opened|menu button)|\breturns?\s+focus\s+to\s+(?:the\s+)?(?:[A-Za-z]+\s+)?(?:trigger|opener|invoking control|control that opened|button that opened)|^(?:the\s+)?focus\s+(?:returns?|is\s+restored|goes\s+back)\.?$|^returns?\s+focus\.?$"), lambda m: {}),
    ("arrow_moves", re.compile(r"(?i)\barrow(?:\s*keys?|(?:left|right|up|down)(?:\s*/\s*(?:left|right|up|down))?)?\b.*\b(?:moves?|changes?|cycles?|navigates?|shifts?)\s+(?:the\s+)?(?:keyboard\s+)?focus|\barrow keys?\s+(?:move|change|cycle|navigate)"), lambda m: {}),
    ("tab_reaches", re.compile(r"(?i)\btab(?:bing)?\s+(?:reaches|focuses|lands on|moves to|visits)\s+(?:the\s+)?" + r"(?:" + _Q + r"|([A-Z][A-Za-z0-9'&.\- ]{1,30}))\s*$"), lambda m: {"name": (m.group(1) or m.group(2) or "").strip()}),
    ("confirm_before_delete", re.compile(r"(?i)(?:confirm(?:ation)?\s+(?:dialog|prompt|step|modal)|asks?\s+(?:for\s+)?confirmation|are you sure|confirm(?:s|ed)?\s+before\s+(?:delet|remov)|\b(?:delet\w*|remov\w*|trash)\b.{0,40}\b(?:with|needs?|requires?|asks?(?:\s+for)?)\s+confirm\w*|confirm(?:ation)?\s+(?:for|on|before)\s+(?:a\s+)?(?:delete|removal|destructive))"), lambda m: {}),
    ("export_file", re.compile(r"(?i)\bexport(?:s|ed)?\b.*\b(?:file|downloads?|json|csv|non-?empty|valid|parses?|rows?|records?)\b|\b(?:json|csv)\s+(?:file|export)\b|\bdownloads?\s+(?:a|the)?\s*(?:file|json|csv)|\b(?:[A-Za-z]+\s+)?exported\b|^export(?:s|ed)?\b"), lambda m: {}),
    ("ax_names", re.compile(r"(?i)accessible names?|aria-?label|\b(?:is|are)\s+labell?ed\b|\bhas\s+an?\s+(?:accessible\s+)?(?:name|label)\b|(?:unnamed|unlabell?ed)\s+(?:buttons?|controls?|inputs?|fields?)|\b(?:labell?ed|named)\s+(?:controls?|buttons?|inputs?|fields?)\b|\bcontrols?\s+(?:are\s+)?(?:labell?ed|named)\b"), lambda m: {}),
    ("contrast", re.compile(r"(?i)\bcontrast\b|\bwcag\b"), lambda m: {}),
    ("overflow_390", re.compile(r"(?i)\bno\s+horizontal\s+(?:scroll(?:ing|bar)?|overflow)|(?:does\s*n[o']t|doesn't|do not|without)\s+(?:scroll\s+(?:sideways|horizontally)|overflow(?:s|ing)?|clip|get\s+clipped|get\s+cut\s+off)|\bfits?\s+(?:within|in)\s+(?:the\s+)?(?:390|viewport|screen|width)|\bno\s+(?:content\s+)?clipp(?:ing|ed)\b|\bno\s+clipped\s+\w+|\btabs?\s+(?:scroll|wrap)(?:\s+(?:or|and)\s+(?:scroll|wrap))?(?:\s+visibly)?$|\bno\s+(?:off-?screen|cut-?off)\b"), lambda m: {}),
    ("net_status", re.compile(r"(?i)\bno\s+(?:repeated\s+)?([45]\d\d)s?\b()"), lambda m: {"code": int(m.group(1)), "force_neg": True}),
    ("net_status", re.compile(r"(?i)\b(?:status|http|code|returns?|response)\s*:?\s*([2-5]\d\d)\b(?!\s*(?:ms|px|chars?|characters?|%|x\b))|\b([2-5]\d\d)\s+(?:status|response|errors?)\b"), lambda m: {"code": int(m.group(1) or m.group(2))}),
    ("net_class", re.compile(r"(?i)\b(?:no|without)\s+(?:repeated\s+)?(?:([45])xx|server\s+errors?|client/server\s+errors?|client\s+errors?|failed\s+(?:requests?|calls?)|network\s+errors?|(?:api|http|request)\s+errors?)"), lambda m: {"cls": m.group(1) or "45"}),
    ("no_console_error", re.compile(r"(?i)\bno\s+(?:new\s+)?(?:console|page|js|javascript|uncaught|runtime)\s+(?:errors?|exceptions?)\b|\bconsole\s+(?:is\s+)?(?:clean|error-?free)\b|\bno\s+(?:renderer\s+)?crash(?:es)?\b|\b(?:loads?|renders?|opens?)\s+without\s+(?:a\s+)?(?:renderer\s+)?(?:crash|errors?)\b|\b(?:does\s*n[o']t|doesn't|do not|should not|won't)\s+crash\b|\bno\s+errors?\b|\bwithout\s+(?:any\s+)?errors?\b"), lambda m: {"force_neg": True}),
    ("focus_trap", re.compile(r"(?i)\bfocus\s+(?:is\s+)?(?:trapped|contained|stays?\s+(?:in|inside|within)\s+(?:the\s+)?(?:dialog|modal|menu|popover|drawer|panel))\b|\bfocus\s+trap\b"), lambda m: {}),
    ("popup_closed", re.compile(r"(?i)^(?:the\s+|a\s+|an\s+)?(?:dialog|modal|menu|popup|popover|drawer|overlay|panel|dropdown|form)\s+(?:closes?|is\s+(?:closed|dismissed)|dismisses|disappears?)$|^(?:it\s+)?closes?$"), lambda m: {}),
    ("appears_in_list", re.compile(r"(?i)\b(?:appears?|is\s+listed|shows?\s+up|is\s+shown|is\s+visible)\s+(?:in|under|on)\s+(?:the\s+)?(?:list|table|grid|rows?|cards?|library|recipes|feed|records?|history|results|gallery|board|timeline|journal|log|queue|inventory)\b"), lambda m: {}),
    ("item_created", re.compile(r"(?i)\b(?:new|created|own)\s+(?:item|row|entry|record|event|task|note|project|reminder)\s+(?:appears?|is\s+(?:added|created|listed|shown))\b|\b(?:item|row|entry|record|event|task|note|project|reminder)\s+(?:is\s+)?(?:created|added)\b|\bcreate(?:s|d)?\s+(?:succeeds|works)\b(?!.)"), lambda m: {}),
    ("validation_block", re.compile(r"(?i)\b(?:rejects?|rejected|blocks?|blocked|prevents?|prevented|refuses?|refused|not\s+allowed|cannot\s+be\s+(?:saved|submitted|added)|clamps?|clamped|inline\s+(?:errors?|messages?|validation)|validation\s+(?:errors?|messages?)|(?:required|range|field|helper)\s*(?:/\s*\w+\s+)?(?:errors?|messages?)|visible\s+validation|not\s+accepted|not\s+saved|never\s+(?:saved|stored|persisted)|does\s*n[o']t\s+(?:accept|save|store)|should\s+not\s+(?:accept|save|store))\b|^(?:[A-Za-z]+\s+)?required(?:\s+(?:message|error))?$"), lambda m: {}),
]
_EXTRA_PRED = re.compile(r"\b(?:uses?|shows?|displays?|returns?|closes?|opens?|stays?|remains?|keeps?|matches|moves?|gets?|becomes?|appears?|renders?|lists?|contains?|includes?|saves?|loads?|resets?|clears?|highlights?|updates?|reloads?|redirects?|blocks?|rejects?|prevents?|downloads?|exports?|persists?|scrolls?|clips?|overflows?|covers?|overlaps?)\b")
_POS_ONLY = {"esc_closes", "focus_opener", "arrow_moves", "tab_reaches", "confirm_before_delete", "export_file", "focus_trap", "popup_closed", "item_created", "appears_in_list"}
_PERSIST = re.compile(r"(?i)\bpersists?\b|survives?\s+(?:a\s+)?(?:hard\s+)?reload|(?:still|remains?)\s+(?:present|listed|there|visible|shown)\s+after\s+(?:a\s+)?(?:hard\s+)?reload|\bafter\s+(?:a\s+)?(?:hard\s+)?reload\b")
_PNAME = re.compile(_Q + r"|\b([A-Z][A-Za-z0-9'&.\-]*(?:\s+[A-Z0-9][A-Za-z0-9'&.\-]*){0,4})\b")
_PHRASE = re.compile(r"(?i)\b(?:shows?|displays?|lists?|renders?|contains?)\s+(?:an?\s+|the\s+|some\s+)?([a-z][a-z0-9 \-/']{4,40}?)\s*$")
_OWN_VALUE_CLAUSE = re.compile(r"(?i)\b(?:saved?|persists?|persisted|stored|kept|retained|remembered|there)\b")
_ABSENT = re.compile(r"(?i)\b(?:no|without|never\s+shows?|does\s*n[o']t\s+(?:show|display|contain))\s+(?:the\s+)?(?:text\s+|label\s+|message\s+|banner\s+)?" + _Q + r"(?!.*\b(?:on|when|after|before|during|while|once|until)\b)")
_ALT = re.compile(r"(?i)\b(?:or|unless|except|otherwise|if|whether|when\s+truly)\b")
_IMPERATIVE = re.compile(r"(?i)^(?:compare|confirm\s+(?:whether|that)|check|inspect|observe|record|look|note|see|verify|read|identify|find|expect)\b")
_NO_PHRASE = re.compile(r"(?i)^(?:nothing|an? error|errors?|no\b.*|empty|blank)")
_CTRL_PRESENT = re.compile(r"(?i)^has a control matching:\s*(.+)$")


def classify_fragment(f, legacy):
    """Base typed kinds first (unchanged), then the generic observe predicates (observe.py) for what the base left unclassified."""
    sp = _classify_fragment_base(f, legacy)
    if sp is None:
        sp = _OBS.classify(f) or _NC.classify(f)
    return sp


def _classify_fragment_base(f, legacy):
    """One predicate -> a spec dict, or None. Never classifies vague wording."""
    f = f.strip()
    if not f or _VAGUE.search(f) or _IMPERATIVE.match(f):
        return None
    m = _CTRL_PRESENT.match(f)
    if m:
        names = [n.strip() for n in re.split(r"\s*\|\s*", m.group(1)) if n.strip()]
        return {"kind": "control_present", "names": names} if names else None
    for kind, rx, build in _KINDS:
        m = rx.search(f)
        if m:
            outside = f[:m.start()] + " " + f[m.end():]
            if _EXTRA_PRED.search(outside) or (kind not in ("control_present",) and _ALT.search(outside)):
                return None       # a second predicate / an alternative outcome rides along; checking only the first would hide it
            spec = dict(build(m), kind=kind, text=f, neg=bool(_NEG.search(f)) or bool(build(m).get("force_neg")))
            if kind == "contrast":
                r = re.search(r"(\d(?:\.\d)?)\s*:\s*1", f)
                spec["ratio"] = float(r.group(1)) if r else None
            if kind in _POS_ONLY and spec["neg"]:
                return None  # a negated claim ("Esc does not close...") is not what these checks measure
            return spec
    if _PERSIST.search(f):
        q = re.search(_Q, f)
        if q:
            name = q.group(1).strip()
        else:
            # a sentence-initial capital ("Saved value persists", "Phase persists") is grammar, not a control name: only a
            # Capitalised word LATER in the sentence names the thing that must be read back
            nm = next((x for x in _PNAME.finditer(f) if x.start() > 0 and x.group(2)), None)
            name = (nm.group(2) if nm else "").strip()
        if _NEG.search(f):
            return None
        if name and name.lower() not in ("after", "the", "reload", "hard"):
            return {"kind": "persisted", "name": name, "text": f}
        # no named target: the value THIS ticket wrote (own typed value / fixture label) must be read back after a reload
        if _OWN_VALUE_CLAUSE.search(f):
            return {"kind": "value_saved", "text": f}
        return None
    m = _ABSENT.search(f)
    if m and not _EXTRA_PRED.search(f[:m.start()] + " " + f[m.end():]):
        return {"kind": "text_absent", "name": m.group(1).strip(), "text": f}
    if not _ALT.search(f) and legacy(f, EMPTY_SNAP)[0] != "unchecked":
        return {"kind": "legacy", "text": f}
    m = _PHRASE.search(f)
    if m and m.start() > 0 and not _NEG.search(f) and not _ALT.search(f) and not _NO_PHRASE.match(m.group(1)) and len(re.findall(r"[a-z0-9]+", m.group(1))) >= 2:
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
# Evidence keys each kind READS (recorded on every clause result, and used by mapped_rate's runtime-evidence estimate).
# AUTO = the executor gathers it itself at the end of a replay (read-only measurements); STEP = only a mapped step of the
# ticket itself can produce it (an Escape press, an export, a typed value, a 390 viewport...), so a ticket without that step
# leaves the clause `unchecked`.
EVIDENCE = {
    "esc_closes": ("keys_sent", "popups_before", "popups_after"),
    "popup_closed": ("popups_before", "popups_after", "closer"),
    "focus_opener": ("focus_after_escape", "opener"),
    "focus_trap": ("focus_in_popup",),
    "arrow_moves": ("focus_trace",),
    "tab_reaches": ("tab_trace",),
    "confirm_before_delete": ("confirm_seen", "confirm_row_present"),
    "export_file": ("export",),
    "ax_names": ("ax_unnamed", "ax_total"),
    "contrast": ("contrast",),
    "overflow_390": ("overflow", "viewport"),
    "target_size": ("targets",),
    "net_status": ("net_statuses",),
    "net_class": ("net_statuses",),
    "no_console_error": ("console_new", "snapshot.errors", "snapshot.texts"),
    "validation_block": ("step_windows", "snapshot.texts", "snapshot.controls"),
    "persisted": ("reloaded", "after_reload"),
    "value_saved": ("own_values", "reloaded", "after_reload"),
    "item_created": ("own_values", "submitted", "snapshot.texts"),
    "appears_in_list": ("own_values", "submitted", "snapshot.list_items"),
    "text_phrase": ("snapshot.texts",),
    "text_absent": ("snapshot.texts",),
    "control_present": ("snapshot.controls",),
    "legacy": ("snapshot",),
}
EVIDENCE.update(_OBS.EVIDENCE)
EVIDENCE.update(_NC.EVIDENCE)
AUTO_EVIDENCE = {"ax_names", "contrast", "target_size", "net_class", "no_console_error", "control_present", "text_phrase", "text_absent", "legacy"}
_ERR_TEXT = re.compile(r"(?i)application error|something went wrong|unexpected error|failed to load|internal server error|\b50[0-4]\b")
_MSG = re.compile(r"(?i)\b(invalid|required|must|cannot|can't|too (?:long|short|large|small)|at least|at most|not allowed|error|between|greater than|less than|out of range|maximum|minimum|limit)\b")


def _ev(snap):
    return snap.get("evidence") or {}


def _norm(x):
    return re.sub(r"[^a-z0-9]+", "", (x or "").lower())


def _pool(snap):
    return [c["name"] for c in snap.get("controls") or [] if c.get("name")] + list(snap.get("texts") or [])


def _spec_check(sp, snap, legacy):
    k, ev = sp["kind"], _ev(snap)
    if k in _OBS.KINDS:
        return _OBS.check(sp, snap)
    if k in _NC.KINDS:
        return _NC.check(sp, snap)
    if k == "legacy":
        return legacy(sp["text"], snap)
    if k == "esc_closes":
        keys = ev.get("keys_sent")
        if keys is None or "Escape" not in keys:
            return "unchecked", "no Escape key was sent during the replay, so 'Esc closes' was not exercised"
        pb = ev.get("popups_before")
        if pb is None:
            return "unchecked", "no record of what was open when Escape was pressed"
        if pb < 1:
            return "unchecked", "nothing was open when Escape was pressed (no dialog/menu to close)"
        n = len(snap.get("dialogs") or []) if ev.get("popups_after") is None else ev["popups_after"]
        return ("pass" if n == 0 else "fail"), "Escape sent with %d popup(s) open; %d open after" % (pb, n)
    if k == "popup_closed":
        pb, cl = ev.get("popups_before"), ev.get("closer")
        if pb is None or not cl:
            return "unchecked", "no close action (Escape / Close control) was exercised while a popup was open"
        if pb < 1:
            return "unchecked", "nothing was open when %s was used" % cl
        n = len(snap.get("dialogs") or []) if ev.get("popups_after") is None else ev["popups_after"]
        return ("pass" if n == 0 else "fail"), "closed via %s: %d popup(s) before, %d after" % (cl, pb, n)
    if k == "focus_opener":
        fa, op = ev.get("focus_after_escape"), ev.get("opener")
        if fa is None or not op:
            return "unchecked", "no recorded opener / focus-after-Escape (no Escape pressed after opening a control)"
        return ("pass" if _norm(fa) == _norm(op) else "fail"), "focus after Escape=%r, opener=%r" % (fa, op)
    if k == "focus_trap":
        tr = ev.get("focus_in_popup")
        if not tr:
            return "unchecked", "no Tab press was made while a dialog/menu was open"
        return ("pass" if all(tr) else "fail"), "%d Tab press(es) with a popup open, %d left the popup" % (len(tr), sum(1 for x in tr if not x))
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
            return "unchecked", "no delete of an own fixture was exercised (deletes are never run read-only), so no confirm prompt was observed"
        if not c:
            return "fail", "delete click on own fixture opened NO confirm dialog / alertdialog / native confirm()"
        if ev.get("confirm_row_present") is False:
            return "fail", "a confirm appeared but the row was already gone before it was confirmed"
        return "pass", "confirm shown before removal; row still present until confirmed"
    if k == "export_file":
        x = ev.get("export")
        if not x:
            return "unchecked", "no export was run in this replay"
        ok = bool(x.get("ok")) and (x.get("bytes") or 0) > 0 and (x.get("rows") is None or x.get("rows") >= 1 or x.get("verdict") == "PASS")
        if x.get("rows") == 0:
            ok = False
        fx = [v for v in (ev.get("own_values") or []) if v]
        miss = ""
        if ok and fx and x.get("has_label") is False:
            ok, miss = False, "; own fixture label not in the file"
        return ("pass" if ok else "fail"), "export %s (bytes=%s rows=%s parsed=%s)%s" % (x.get("verdict"), x.get("bytes"), x.get("rows"), x.get("parsed"), miss)
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
        vp = ev.get("viewport")
        if not o or (o.get("viewport_w") or 9999) > 430 or (vp is not None and (vp[0] or 9999) > 430):
            return "unchecked", "no overflow measurement at a 390-class viewport set in this run"
        txt = sp.get("text", "")
        wants_off = bool(re.search(r"(?i)clip|cut[\s-]*off|off-?screen|tabs?\s+(?:scroll|wrap)", txt))
        if wants_off and o.get("offscreen") is None:
            return "unchecked", "no off-screen control measurement"
        bad = (o.get("overflow_px") or 0) > 2 or (wants_off and (o.get("offscreen") or 0) > 0) or (o.get("offscreen") or 0) > 0
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
    if k == "no_console_error":
        n = ev.get("console_new")
        if n is None:
            n = snap.get("errors")
        if n is None:
            return "unchecked", "no console / page-error capture in this replay"
        bad_txt = [t for t in snap.get("texts") or [] if _ERR_TEXT.search(t)]
        if n or bad_txt:
            return "fail", "%s new console/page error(s); error text %s" % (n, bad_txt[:2])
        return "pass", "0 new console/page errors in this run, no error-boundary text, page reachable"
    if k == "validation_block":
        wins = ev.get("step_windows")
        if wins is None:
            w = ev.get("net_writes")           # legacy whole-run ledger
            if w is None:
                return "unchecked", "no write-call ledger in this replay"
            wins = [{"typed": True, "writes": list(w)}] if w else [{"typed": True, "writes": []}]
        rel = [x for x in wins if x.get("typed") is not None or x.get("submit")]
        if not rel:
            return "unchecked", "no typed-value or submit step in this replay, so no validation was exercised"
        # a write in ANY window at/after the first typed-or-submit step counts: the create click is its own step window
        first = next(i for i, x in enumerate(wins) if x.get("typed") is not None or x.get("submit"))
        bad = [x for x in wins[first:] if x.get("writes")]
        if bad:
            return "fail", "invalid input reached the API: %s" % (bad[0]["writes"][:3],)
        pool = " ".join(snap.get("texts") or [])
        alerts = [a for a in snap.get("alerts") or []]
        invalid = [c.get("name") for c in snap.get("controls") or [] if (c.get("props") or {}).get("invalid") in (True, "true")]
        dis = [c["name"] for c in snap.get("controls") or [] if c.get("enabled") is False and re.search(r"(?i)save|submit|add|create|apply|post|schedule", c.get("name") or "")]
        why = []
        if _MSG.search(pool) or alerts:
            why.append("message text present")
        if invalid:
            why.append("aria-invalid on %s" % invalid[:2])
        if dis:
            why.append("submit control disabled: %s" % dis[:2])
        if why:
            return "pass", "no write call in %d step window(s); %s" % (len(rel), ", ".join(why))
        return "unchecked", "no write call, but no inline message, aria-invalid field or disabled submit control was observed"
    if k in ("persisted", "value_saved"):
        if not ev.get("reloaded"):
            return "unchecked", "no reload happened in this replay"
        rb = ev.get("after_reload")
        pool = (list(rb.get("texts") or []) + list(rb.get("names") or [])) if rb else _pool(snap)
        if k == "persisted":
            ok = any(_norm(sp["name"]) in _norm(x) for x in pool)
            return ("pass" if ok else "fail"), "%r %s after reload" % (sp["name"], "present" if ok else "absent")
        own = [v for v in (ev.get("own_values") or []) if v]
        if not own:
            return "unchecked", "the ticket typed no own value, so there is nothing of its own to read back after the reload"
        gone = [v for v in own if not any(_norm(v) in _norm(x) for x in pool)]
        return ("fail" if gone else "pass"), "own value(s) %s after reload" % ("missing: %s" % [g[:30] for g in gone[:2]] if gone else "present")
    if k in ("item_created", "appears_in_list"):
        own = [v for v in (ev.get("own_values") or []) if v]
        if not own or not ev.get("submitted"):
            return "unchecked", "no own labelled fixture was created and submitted in this replay (write mode only)"
        pool = list(snap.get("list_items") or []) if k == "appears_in_list" else _pool(snap)
        if k == "appears_in_list" and snap.get("list_items") is None:
            return "unchecked", "driver reports no list/table/grid container contents"
        gone = [v for v in own if not any(_norm(v) in _norm(x) for x in pool)]
        return ("fail" if gone else "pass"), "own fixture %s %s" % ("label" if k == "item_created" else "label in a list/grid/table/listitem", "missing" if gone else "present after submit")
    if k == "text_absent":
        gone = not any(_norm(sp["name"]) in _norm(x) for x in _pool(snap))
        return ("pass" if gone else "fail"), "text %r %s" % (sp["name"], "absent" if gone else "still present")
    if k == "text_phrase":
        pool = [_norm(x) for x in _pool(snap)]
        p = _norm(sp["phrase"])
        return ("pass", "text %r present" % sp["phrase"]) if any(p in x for x in pool) else ("unchecked", "phrase %r not found verbatim (paraphrase - a human reads it)" % sp["phrase"])
    if k == "control_present":
        pool = [c["name"] for c in snap.get("controls") or [] if c.get("name")]
        got = [n for n in sp["names"] if any(_norm(n) in _norm(x) for x in pool)]
        return ("pass", "control(s) present: %s" % got) if got else ("unchecked", "no control matching %s is visible (a fixture/state may be missing)" % sp["names"])
    return "unchecked", "unknown spec kind %s" % k


def check_specs_detailed(specs, snap, legacy):
    """-> (state, detail, rows). rows: [{kind, state, detail, evidence: [keys it reads]}] - recorded on the clause result."""
    rows = []
    for sp in specs:
        st, d = _spec_check(sp, snap, legacy)
        rows.append({"kind": sp["kind"], "state": st, "detail": d, "evidence": list(EVIDENCE.get(sp["kind"], ()))})
    if any(r["state"] == "fail" for r in rows):
        return "fail", "; ".join("%s: %s" % (r["kind"], r["detail"]) for r in rows if r["state"] == "fail"), rows
    if any(r["state"] == "unchecked" for r in rows):
        return "unchecked", "; ".join("%s: %s" % (r["kind"], r["detail"]) for r in rows if r["state"] == "unchecked"), rows
    return "pass", "; ".join(r["detail"] for r in rows), rows


def check_specs(specs, snap, legacy):
    """All specs must pass; any fail -> fail; any unchecked -> unchecked (never pass on missing evidence)."""
    return check_specs_detailed(specs, snap, legacy)[:2]
