"""repro_steps executor (replay-original-tickets).

The lens-walk testers wrote each ticket's repro by hand (`repro_steps`, plus `expected` /
`actual`). Until now those steps were only keyword-classified; nothing ever ran them. This
module runs them: each prose step is mapped to ONE action, executed on a driver, and the
ticket's `expected` outcome is machine-checked.

Honesty rules (they extend Dutch's Nov 15 recipe-only rule — these are the testers' own
hand-written repros, so they count as a basis, but only when nothing was guessed):
  * A ticket verdicts FIXED (basis "repro-steps") ONLY if EVERY step mapped, EVERY step
    executed, AND every clause of `expected` is a machine-checkable predicate that held.
  * Any unmapped step -> NEEDS_HUMAN naming the first unmapped step; NO step is run
    (a half-run repro proves nothing and could leave state behind).
  * A mapped step that could not run (named control not found / refused by the click
    policy) -> NEEDS_HUMAN naming that step.
  * An `expected` clause with no predicate -> NEEDS_HUMAN naming the clause.
  * All steps ran and a predicate was violated -> STILL_FAILING.
Per-step {mapped, executed, result} is returned and ends up on the ledger row.

The driver is an interface (see FakeDriver in the selftests); PlaywrightDriver adapts a
LensWalk's page/CDP session. Safety is the walker's own: tabs/openers/plain controls only
(safety.HARD_DENY refuses every write/destructive/payment/admin verb), fills use an own
labelled qa-walker value and never submit, write-skip and admin lenses stay read-only.
"""
import re
from .matching import fuzzy_match
from .safety import HARD_DENY, SWEEP_PAYMENT, is_tab_safe, write_step_decision, CREATE_OPENER

FIXED, STILL, HUMAN = "FIXED", "STILL_FAILING", "NEEDS_HUMAN"

_Q = "\"'‘’“”"
_QNAME = r"[\"'‘“](?P<q>[^\"'’”]{1,60})[\"'’”]"
_NOUN = r"(?:button|tab|link|field|input|box|toggle|switch|menu|dropdown|row|item|card|checkbox|option|icon|control|panel|dialog|modal)"
_KEYS = {"escape": "Escape", "esc": "Escape", "enter": "Enter", "return": "Enter", "tab": "Tab", "space": "Space",
         "spacebar": "Space", "shift+tab": "Shift+Tab", "arrow down": "ArrowDown", "down arrow": "ArrowDown",
         "arrow up": "ArrowUp", "up arrow": "ArrowUp", "arrow left": "ArrowLeft", "arrow right": "ArrowRight",
         "home": "Home", "end": "End", "backspace": "Backspace"}
_GENERIC = re.compile(r"(?i)^(a|an|any|each|every|some|one|another|first|last|next|several|multiple|the first|the last|the next|an? existing)\b")
_FILL_LABEL = "qa-walker replay"
MAX_KEY_REPEAT = 25


def split_steps(t):
    """repro_steps (list | string | missing) -> list of non-empty step strings."""
    rs = (t or {}).get("repro_steps")
    if isinstance(rs, list):
        out = [str(x).strip() for x in rs]
    elif isinstance(rs, str):
        parts = re.split(r"\n+|(?:^|\s)\d+[.)]\s+", rs)
        out = [p.strip() for p in parts]
    else:
        out = []
    return [re.sub(r"^\s*(?:\d+[.)]|[-*•])\s*", "", x).strip() for x in out if x and x.strip()]


def _name_from(m, text_after):
    """Quoted name wins; else the capitalised phrase right after the verb (before a noun/prep)."""
    q = m.group("q") if "q" in m.re.groupindex and m.group("q") else None
    if q:
        return q.strip()
    words = []
    for w in re.findall(r"[A-Za-z0-9][A-Za-z0-9'&.\-/]*", text_after):
        if w.lower() in ("button", "tab", "link", "field", "input", "box", "toggle", "switch", "menu", "dropdown", "checkbox", "icon",
                         "control", "in", "on", "at", "to", "from", "and", "then", "with", "of", "for", "when", "while", "until"):
            break
        words.append(w)
        if len(words) >= 5:
            break
    if words and words[0][:1].isupper() and not _GENERIC.match(" ".join(words)):
        return " ".join(words)
    return None


def map_step(raw, lens_slug=None):
    """One prose step -> {raw, action, mapped, ...}. action in open|click|open_tab|fill|press|reload|observe."""
    s = (raw or "").strip()
    low = s.lower()
    base = {"raw": s, "mapped": False, "action": None}
    if not s or low in ("see evidence", "n/a", "none", "x", "-"):
        return dict(base, reason="step has no actionable text")
    if re.search(r"\b\d{3,4}\s*[x×]\s*\d{3,4}\b|\b(mobile|viewport|390)\b", low):
        return dict(base, reason="viewport/mobile change is not a supported step")
    if re.match(r"(?i)^(observe|verify|check|confirm|note|notice|see|look|watch|expect|ensure|inspect|read|compare)\b", s):
        return dict(base, action="observe", mapped=True)
    if re.search(r"(?i)\b(reload|refresh)\b", s) and re.match(r"(?i)^(reload|refresh|then|and|hit|press|click)\b", s):
        return dict(base, action="reload", mapped=True)
    m = re.match(r"(?i)^(?:then\s+)?(?:press|hit|type)\s+(?:the\s+)?([A-Za-z+ ]{1,20}?)(?:\s+key)?\s*$", s)
    if m and m.group(1).strip().lower() in _KEYS:
        return dict(base, action="press", key=_KEYS[m.group(1).strip().lower()], mapped=True)
    m = re.match(r"(?i)^(?:open|go to|navigate to|visit|load|browse to)\b.*?(https?://[^\s\"'<>]+|/lenses/[a-z0-9\-/]+)", s)
    if m:
        return dict(base, action="open", target=m.group(1), mapped=True)
    m = re.match(r"(?i)^(?:open|go to|navigate to|visit|load)\s+(?:the\s+)?([A-Za-z0-9 \-]{1,40}?)\s+(?:lens|page)\s*$", s)
    if m and lens_slug and re.sub(r"[^a-z0-9]+", "", m.group(1).lower()) == re.sub(r"[^a-z0-9]+", "", lens_slug.lower()):
        return dict(base, action="open", target=None, mapped=True)  # the lens root
    m = re.match(r"(?i)^(?:then\s+)?(?:open|switch to|go to|select|click|choose|tap)\s+(?:on\s+)?(?:the\s+)?(?:" + _QNAME + r"|(?P<u>[A-Z][A-Za-z0-9'&.\- ]{0,40}?))\s+tab\b", s)
    if m:
        return dict(base, action="open_tab", name=(m.group("q") or m.group("u") or "").strip(), mapped=True)
    m = re.match(r"(?i)^(?:then\s+)?(?:type|enter|fill(?: in)?|input|write)\s+(?:" + _QNAME.replace("(?P<q>", "(?P<v>") + r"\s+)?(?:in|into|in to|to)\s+(?:the\s+)?(?:" + _QNAME + r"|(?P<u>[A-Z][A-Za-z0-9'&.\- ]{0,40}?))(?:\s+" + _NOUN + r")?\s*$", s)
    if m:
        name = (m.group("q") or m.group("u") or "").strip()
        if name:
            return dict(base, action="fill", name=name, mapped=True)
    m = re.match(r"(?i)^(?:then\s+)?(?:click|tap|select|choose|activate|toggle|expand|focus|check)\s+(?:on\s+)?(?:the\s+)?(?:" + _QNAME + r"|(?P<rest>.+))$", s)
    if m:
        name = (m.group("q") or "").strip() or _name_from(m, m.group("rest") or "")
        if name:
            return dict(base, action="click", name=name, mapped=True)
        return dict(base, reason="names no specific control (generic target: %r)" % (m.group("rest") or "")[:60])
    return dict(base, reason="no recognised action verb")



# --------------------------------------------------------------- breadcrumb / navigation-prose mapper
# A tester's repro is often not a sentence but a path: "Global > Search view > type X",
# "Explorer > Scatter", "Save view > Export > JSON", "Open Share and press Esc, then Tab".
# expand_step() turns ONE raw step into an ordered list of sub-steps, each mapped to one action.
# A step is mapped only when EVERY segment of it is; anything else stays unmapped with the
# segment named, and the executor then runs nothing (a half-run repro proves nothing).
_CRUMB_SEP = re.compile(r"\s*(?:\s>\s|→|->|=>|»|›)\s*")
_STOP = {"the", "a", "an", "own", "any", "each", "every", "several", "multiple", "with", "while", "until", "when", "so", "it", "is",
         "are", "that", "which", "if", "as", "see", "all", "some", "both", "then", "also", "once", "again", "repeatedly", "first", "last",
         "in", "on", "at", "to", "from", "for", "by", "into", "onto", "until", "or"}
_PROSE_START = re.compile(r"(?i)^(inspect|observe|check|verify|look|see|note|read|compare|scroll|resize|wait|hover|record|walk|confirm|"
                          r"expect|watch|ensure|notice|measure|dismiss|leave|paste|set|restore|emulate|reload|hard)\b")
_TOOLING = re.compile(r"(?i)devtools|lighthouse|a11y|accessibility (?:tree|pane)|viewport|\b\d{3,4}\s*[x×]\s*\d{3,4}\b|\bconsole\b|network tab|\bnetwork\b")
_KEYTOK = r"(?:esc(?:ape)?|enter|return|tab|space(?:bar)?|home|end|backspace|shift\s*\+\s*tab|(?:ctrl|control|shift|alt|meta|cmd)\s*\+\s*[a-z0-9]|arrow\s*(?:up|down|left|right)|(?:up|down|left|right)\s+arrow)"
_KEYRUN = re.compile(r"(?i)^(?:(?:press|hit|try)\s+)?(?:the\s+)?(?P<keys>" + _KEYTOK + r"(?:\s*(?:,|/|\bthen\b|\band\b|\bor\b)\s*" + _KEYTOK + r")*)(?:\s*(?:key|keys))?(?:\s*(?:x\s*(?P<x>\d+)|(?P<n>\d+)\s*times|(?P<w>once|twice)|again))?\s*$")
_NAME_WORD = r"[A-Z0-9][A-Za-z0-9'&.\-/+]*"
_VERB_CLICK = re.compile(r"(?i)^(?:open|click|tap|select|choose|use|view|switch to|go to|expand|toggle|activate|focus)\s+(?:on\s+)?(?:the\s+)?(?P<rest>.+?)\s*$")
_TYPE = re.compile(r"(?i)^(?:type|enter|fill(?: in)?|input|write)\s+(?P<v>.+?)\s*$")
_ANY_TAB = re.compile(r"(?i)^(?:any|each|every|a|the first)\s+sub-?\s?tabs?$|^(?:any|each|every)\s+tab$")
_TAB_TO_TABS = re.compile(r"(?i)^tab\s+to\s+(?:the\s+)?(?:view\s+)?tabs?(?:\s+list)?$")
_LENS_ROOT = re.compile(r"(?i)^(?:open\s+|load\s+|go to\s+|visit\s+)?(?:the\s+)?(?:this\s+)?(?:lens|page)$")
_SEARCHY = re.compile(r"(?i)search|filter|find|query")
_PREFIX_URL = re.compile(r"(?i)^(?:on\s+)?(?P<u>https?://\S+?|/lenses/[a-z0-9\-/]+?)\s*(?::|,)\s*")
_PREFIX_ON = re.compile(r"(?i)^on\s+(?:(?:https?://\S+|/lenses/\S+?)\s*)?(?:as\s+\S+(?:\s*\(role [^)]*\))?\s*)?(?:,|:)\s*")
_PREFIX_WHO = re.compile(r"(?i)^on\s+zuko_qa_t\d\s*(?:\([^)]*\))?\s*,\s*")
_GENERIC_VALUE = re.compile(r"(?i)^(?:x|y|z|text|a query|query|a term|term|something|anything|a name|a title|a value|value|a word|some text|a search|test)$")
_ACT_VERB = re.compile(r"\b(create|click|type|press|delete|save|submit|add|open|edit|send|reload|rename|set|enter|select|drag|toggle|tap|remove|log|fill|paste)\b")
_CHECK_IN = re.compile(r"(?i)^check[\s-]?in\b")
_PATH_ONLY = re.compile(r"(?i)^(?:https?://\S+|/lenses/[a-z0-9\-/]+)$")
_SENT = re.compile(r"(?<=[a-z0-9)\]'\"])\.\s+(?=[A-Z])")
_CHAIN = re.compile(r"(?i)\s*;\s*|,?\s+then\s+|,\s+(?=(?:press|click|open|tap|select|type|enter|reload|hit|tab)\b)|\s+and\s+(?=(?:press|click|open|tap|select|type|enter|reload|hit)\b)")


def _norm(x):
    return re.sub(r"[^a-z0-9]+", "", (x or "").lower())


def _key_name(tok):
    t = re.sub(r"\s+", " ", tok.strip().lower())
    t = re.sub(r"\s*\+\s*", "+", t)
    t = re.sub(r"^arrow\s*(up|down|left|right)$", r"arrow \1", t)
    if t in _KEYS:
        return _KEYS[t]
    m = re.match(r"^(ctrl|control|shift|alt|meta|cmd)\+([a-z0-9]|tab)$", t)
    if m:
        mod = {"ctrl": "Control", "control": "Control", "shift": "Shift", "alt": "Alt", "meta": "Meta", "cmd": "Meta"}[m.group(1)]
        return "%s+%s" % (mod, m.group(2).upper() if len(m.group(2)) == 1 else "Tab")
    return None


def _parse_keys(s):
    """'Esc then Tab, Ctrl+M' / 'Tab x9' / 'press Escape once' -> [(key, count)] or None."""
    m = _KEYRUN.match(s.strip().rstrip("."))
    if not m:
        return None
    cnt = int(m.group("x") or m.group("n") or 0) or (2 if (m.group("w") or "").lower() == "twice" else 1)
    if cnt > MAX_KEY_REPEAT:
        return None
    toks = re.split(r"(?i)\s*(?:,|/|\bthen\b|\band\b|\bor\b)\s*", m.group("keys"))
    keys = [_key_name(t) for t in toks if t.strip()]
    if not keys or any(k is None for k in keys):
        return None
    return [(k, cnt) for k in keys]


def _label_ok(txt, lens_names):
    """Is `txt` plausibly a control's accessible name (not prose)? -> cleaned name or None."""
    t = txt.strip().strip(".").strip()
    q = re.match(r"^[\"'‘“](.{1,60}?)[\"'’”]$", t)
    if q:
        return q.group(1).strip()
    if not t or len(t) > 50 or _TOOLING.search(t) or _PROSE_START.match(t):
        return None
    if re.search(r"[,()/\[\]{}]", t):
        return None
    words = t.split()
    if len(words) > 5 or not (words[0][:1].isupper() or words[0][:1].isdigit() or words[0][:1] in "+&…"):
        return None
    if any(w.lower() in _STOP for w in words[1:]) or words[0].lower() in _STOP:
        return None
    if re.search(r"[:;?!]|\bx\d+\b|\b\d+\s*(?:char|ms|px|kg|h|s)\b", t) or any(re.match(r"^[-+]?\d+(?:[.,]\d+)?%?$", w) for w in words):
        return None
    return t


def _legacy_trusted(legacy, text):
    """map_step() cuts an unquoted control name at the first stop word ("Scan for residues" -> "Scan",
    "Save script with Network open" -> "Save script"): a click on a cut name could hit the wrong control
    and silently drop part of the step. Trust a legacy click only when its name is the WHOLE phrase."""
    if not legacy["mapped"] or legacy["action"] != "click":
        return legacy["mapped"]
    m = _VERB_CLICK.match(re.sub(r"(?i)^(?:then\s+)?", "", text.strip()).rstrip("."))
    if not m or re.match(r"^[\"'‘“]", m.group("rest").strip()):
        return True  # quoted name: exact by construction
    rest = re.sub(r"(?i)\s+(?:button|tab|link|menu|control|panel|form|dialog|view|field|input|box|toggle|switch|dropdown|checkbox|icon)$", "", m.group("rest").strip())
    return _norm(rest) == _norm(legacy.get("name"))


def _map_segment(seg, lens, lens_names, prev, in_crumb):
    """One segment -> list of sub-step dicts, or (None, reason)."""
    s = re.sub(r"(?i)^(?:then|and|also|try|separately|next|now)\s+", "", seg.strip()).strip().rstrip(".").strip()
    s = re.sub(r"(?i)\s*\(nothing sent\)\s*$", "", s).strip()
    if not s:
        return [], None
    if _CHECK_IN.match(s):
        return None, "'check in' is an app action, not an observation"
    if _PATH_ONLY.match(s):
        path = re.sub(r"^https?://[^/]+", "", s)
        return [{"action": "open", "target": path if path.startswith("/lenses/") else None, "raw": seg.strip()}], None
    if _TOOLING.search(s) and not _KEYRUN.match(s):
        return None, "tooling/viewport instruction is not a supported step"
    if _norm(s) in lens_names or _LENS_ROOT.match(s):
        return [{"action": "noop", "note": "already on the lens", "raw": seg.strip()}], None
    m = re.match(r"(?i)^(?:open|go to|load|visit)\s+(?:the\s+)?(.+?)(?:\s+lens)?$", s)
    if m and _norm(m.group(1)) in lens_names:
        return [{"action": "noop", "note": "already on the lens", "raw": seg.strip()}], None
    keys = _parse_keys(s)
    if keys:
        return [{"action": "press", "key": k, "count": c, "raw": seg.strip()} for k, c in keys], None
    if _TAB_TO_TABS.match(s):
        return [{"action": "focus_tab_list", "raw": seg.strip()}], None
    if _ANY_TAB.match(s):
        return [{"action": "open_any_tab", "raw": seg.strip()}], None
    m = _TYPE.match(s)
    if m and not re.search(r"(?i)\b(?:in|into|to)\s+(?:the\s+)?\S", m.group("v")):
        if not prev or prev.get("action") not in ("click", "open_tab", "fill"):
            return None, "'type' names no field (nothing precedes it that names a control)"
        v = m.group("v").strip().rstrip("….").strip()
        q = re.match(r"^[\"'‘“](.{1,40}?)[\"'’”]$", v)
        if q and _SEARCHY.search(prev["name"]):
            lit = q.group(1)
        elif _GENERIC_VALUE.match(v):
            lit = None
        else:
            return None, "the typed value %r is the point of the step - an own labelled value would not reproduce it" % v[:40]
        return [{"action": "fill", "name": prev["name"], "literal": lit, "raw": seg.strip(), "merge_prev": True}], None
    legacy = map_step(s, lens)
    if legacy["mapped"] and not _legacy_trusted(legacy, s):
        legacy = dict(legacy, mapped=False, reason="control name cut mid-phrase by the legacy mapper")
    if legacy["mapped"] and legacy["action"] == "observe" and _ACT_VERB.search(s):
        return None, "an observation segment that also names an action (%s) - not run as a bare observation" % _ACT_VERB.search(s).group(1)
    if legacy["mapped"] and legacy["action"] != "observe":
        return [dict(legacy, raw=seg.strip())], None
    m = _VERB_CLICK.match(s)
    if m:
        rest = re.sub(r"(?i)\s+(?:button|tab|link|menu|control|panel|form|dialog|view)$", "", m.group("rest").strip())
        rest = re.sub(r"(?i)\s+on\s+(?:the\s+)?(.+)$", lambda mm: "" if _norm(mm.group(1)) in lens_names else mm.group(0), rest)
        if _norm(rest) in lens_names:
            return [{"action": "noop", "note": "already on the lens", "raw": seg.strip()}], None
        nm = _label_ok(rest, lens_names)
        if nm:
            return [dict({"action": "click", "name": nm, "raw": seg.strip()}, **({"exact": True} if re.search(r"(?i)\b(and|or)\b", nm) else {}))], None
        return None, "names no specific control (%r)" % rest[:50]
    if in_crumb:
        nm = _label_ok(s, lens_names)
        if nm:
            return [{"action": "click", "name": nm, "crumb": True, "raw": seg.strip()}], None
    if legacy["mapped"]:
        return [dict(legacy, raw=seg.strip())], None
    return None, legacy.get("reason") or "no recognised action"


def expand_step(raw, lens_slug=None, lens_title=None):
    """One prose step -> {raw, mapped, substeps:[{raw, action, ...}], reason}. See the section comment."""
    s0 = (raw or "").strip()
    out = {"raw": s0, "mapped": False, "substeps": [], "reason": None}
    legacy = map_step(s0, lens_slug)
    if legacy["mapped"] and not _CHECK_IN.match(s0) and not (legacy["action"] == "observe" and _ACT_VERB.search(s0)) and _legacy_trusted(legacy, s0):
        out.update(mapped=True, substeps=[dict(legacy)])
        return out
    lens_names = {n for n in (_norm(lens_slug), _norm(lens_title), _norm((lens_slug or "").replace("-", " "))) if n}
    s = s0
    subs = []
    m = _PREFIX_URL.match(s)
    if m:
        path = re.sub(r"^https?://[^/]+", "", m.group("u"))
        subs.append({"action": "open", "target": path if path.startswith("/lenses/") else None, "raw": m.group(0).strip(), "mapped": True})
        s = s[m.end():]
    else:
        for pre in (_PREFIX_ON, _PREFIX_WHO):
            mm = pre.match(s)
            if mm:
                s = s[mm.end():]
                break
    if not s.strip():
        out.update(mapped=bool(subs), substeps=subs, reason=None if subs else "step has no actionable text")
        return out
    chunks = [c.strip() for sent in _SENT.split(s) for c in _CHAIN.split(sent) if c and c.strip()]
    for ci, chunk in enumerate(chunks):
        if True:
            crumbs = [c for c in _CRUMB_SEP.split(chunk) if c.strip()]
            # a bare label is a control name only inside a path ("A > B") or a multi-part chain ("A, then B")
            in_crumb = len(crumbs) > 1 or len(chunks) > 1
            keylist = _parse_keys(chunk) if not in_crumb else None
            if keylist:
                subs += [{"action": "press", "key": k, "count": c, "raw": chunk, "mapped": True} for k, c in keylist]
                continue
            for i, cr in enumerate(crumbs):
                prev = next((x for x in reversed(subs) if x.get("action") != "noop"), None) if i else None
                got, why = _map_segment(cr, lens_slug, lens_names, prev, in_crumb)
                if got is None:
                    out["reason"] = "segment %r: %s" % (cr.strip()[:80], why)
                    out["substeps"] = []
                    return out
                for g in got:
                    if g.pop("merge_prev", False) and subs and subs[-1].get("action") in ("click", "open_tab"):
                        subs.pop()
                    subs.append(dict(g, mapped=True))
    if not subs:
        out["reason"] = "step has no actionable text"
        return out
    out.update(mapped=True, substeps=subs)
    return out


# --------------------------------------------------------------- expected -> predicates
_ERR_TEXT = re.compile(r"(?i)application error|something went wrong|unexpected error|failed to load|internal server error|\b50[0-4]\b")


def _find(snap, name, role=None):
    names = [c["name"] for c in snap["controls"] if c.get("name") and (role is None or c.get("role") == role)]
    hit = fuzzy_match(name, names)
    return next((c for c in snap["controls"] if c.get("name") == hit and (role is None or c.get("role") == role)), None) if hit else None


def _text_present(snap, name):
    return bool(fuzzy_match(name, snap["texts"] + [c["name"] for c in snap["controls"] if c.get("name")]))


def _clauses(expected):
    parts = re.split(r"\s*(?:;|\.\s+|\.$|,\s*and\s+|\s+and\s+|,\s+)", (expected or "").strip())
    return [p.strip(" .") for p in parts if p and p.strip(" .")]


def check_clause(clause, snap):
    """(state, detail). state: 'pass' | 'fail' | 'unchecked'."""
    c = clause.strip()
    m = re.search(r"(?i)\bno (?:console |page |js |javascript |visible )?errors?\b|without (?:any )?errors?|(?:does(?:n't| not)|should not|won't) crash|\bno crash\b", c)
    if m:
        bad = snap.get("errors") or 0
        bad_txt = [t for t in snap["texts"] if _ERR_TEXT.search(t)]
        return ("fail", "errors=%s error-text=%s" % (bad, bad_txt[:2])) if bad or bad_txt else ("pass", "no page errors, no error text")
    m = re.search(r"(?i)(?:" + _QNAME + r"|(?P<u>[A-Z][A-Za-z0-9'&.\- ]{0,40}?))\s*(?:" + _NOUN + r")?\s+(?:is|are|becomes?|should be|gets?|stays?|remains?)\s+(?:now\s+)?(enabled|disabled)\b", c)
    if m:
        name = (m.group("q") or m.group("u") or "").strip()
        node = _find(snap, name)
        if node is None:
            return "fail", "control %r not found" % name
        want = m.group(m.lastindex).lower() == "enabled"
        return ("pass" if bool(node.get("enabled", True)) == want else "fail"), "%r enabled=%s" % (node["name"], node.get("enabled", True))
    m = re.search(r"(?i)(?:" + _QNAME + r"|(?P<u>[A-Z][A-Za-z0-9'&.\- ]{0,40}?))\s*(?:" + _NOUN + r")?\s+(?:is|are|becomes?|should be|gets?)\s+(selected|checked|expanded|pressed)\b", c)
    if m:
        name = (m.group("q") or m.group("u") or "").strip()
        node = _find(snap, name)
        if node is None:
            return "fail", "control %r not found" % name
        return ("pass" if (node.get("props") or {}).get(m.group(m.lastindex).lower()) in (True, "true") else "fail"), "%r props=%s" % (node["name"], node.get("props"))
    m = re.search(r"(?i)focus\s+(?:returns?|goes|moves|is|stays|remains)\s+(?:back\s+)?(?:to|on)\s+(?:the\s+)?(?:" + _QNAME + r"|(?P<u>[A-Z][A-Za-z0-9'&.\- ]{0,40}?))(?:\s+" + _NOUN + r")?\s*$", c)
    if m:
        name = (m.group("q") or m.group("u") or "").strip()
        foc = next((x for x in snap["controls"] if x.get("focused")), None)
        return ("pass" if foc and fuzzy_match(name, [foc.get("name") or ""]) else "fail"), "focused=%r" % (foc or {}).get("name")
    if re.search(r"(?i)\b(dialog|modal|popup|drawer|menu|overlay)s?\b.*\b(closes?|is dismissed|dismisses|is closed|disappears?|is gone)\b|\bcloses?\s+(?:the\s+)?(dialog|modal|popup|drawer|menu|overlay)", c):
        n = len(snap.get("dialogs") or [])
        return ("pass" if n == 0 else "fail"), "%d dialog(s) open" % n
    m = re.search(r"(?i)(?:" + _QNAME + r"|(?P<u>[A-Z][A-Za-z0-9'&.\- ]{0,40}?))\s*(?:" + _NOUN + r")?\s+(?:is|are|should be|becomes?|appears?|renders?|gets?)\s+(?:now\s+)?(?:visible|shown|displayed|present|listed|rendered)\b", c)
    if not m:
        m = re.search(r"(?i)\b(?:shows?|displays?|reads?|says?|contains?|lists?)\s+(?:the\s+)?(?:" + _QNAME + r"|(?P<u>[A-Z][A-Za-z0-9'&.\- ]{0,40}))\s*$", c)
    if m:
        name = (m.group("q") or m.group("u") or "").strip()
        if name:
            return ("pass" if _text_present(snap, name) else "fail"), "%r %s" % (name, "present" if _text_present(snap, name) else "absent")
    m = re.search(r"(?i)(?:" + _QNAME + r"|(?P<u>[A-Z][A-Za-z0-9'&.\- ]{0,40}?))\s*(?:" + _NOUN + r")?\s+(?:is|are)\s+(?:no longer|not)\s+(?:visible|shown|displayed|present)\b", c)
    if m:
        name = (m.group("q") or m.group("u") or "").strip()
        return ("fail" if _text_present(snap, name) else "pass"), "%r %s" % (name, "present" if _text_present(snap, name) else "absent")
    return "unchecked", "no machine-checkable predicate for this clause"


def check_expected(expected, snap):
    """Every clause must be machine-checkable. -> {state: pass|fail|unchecked, clauses: [...]}"""
    clauses = _clauses(expected)
    if not clauses:
        return {"state": "unchecked", "clauses": [], "why": "ticket has no `expected` text"}
    rows = []
    for c in clauses:
        st, d = check_clause(c, snap)
        rows.append({"clause": c, "state": st, "detail": d})
    state = "unchecked" if any(r["state"] == "unchecked" for r in rows) else ("fail" if any(r["state"] == "fail" for r in rows) else "pass")
    return {"state": state, "clauses": rows}


# --------------------------------------------------------------- executor
def run_repro(ticket, driver, *, lens_slug, allow_fill=True, log=None, write=None, lens_title=None):
    """Replay a ticket's repro_steps on `driver`. Returns the replay dict (see module doc).

    write: None (read-only, as before) or a dict for --allow-write replay:
      allow_write (bool), admin (bool), write_skip (bool), account ('t1'|'t2'), label_base (str: this
      ticket's own fixture-label stem), fixtures (callable -> labels of live walker fixtures for this
      lens+account), on_fixture(label, state, note) (records into fixtures.jsonl / LEFTOVERS)."""
    log = log or (lambda *a: None)
    wr = write or {}
    raw_steps = split_steps(ticket)
    expanded = [expand_step(r, lens_slug, lens_title) for r in raw_steps]
    out = {"basis": "repro-steps", "steps": [], "expected": None, "verdict": HUMAN, "notes": "", "evidence": []}
    flat = []
    for i, e in enumerate(expanded):
        for j, sub in enumerate(e["substeps"]):
            flat.append(dict(sub, mapped=True, step=i + 1, sub=j + 1, n=len(flat) + 1))

    def rec(st, executed, result):
        out["steps"].append({"n": st["n"], "step": st.get("step"), "sub": st.get("sub"), "raw": st["raw"], "action": st.get("action"),
                             "mapped": bool(st["mapped"]), "executed": executed, "result": result})

    if not raw_steps:
        out["notes"] = "ticket has no repro_steps to replay"
        return out
    bad = next((e for e in expanded if not e["mapped"]), None)
    if bad:
        bi = expanded.index(bad) + 1
        for i, e in enumerate(expanded):
            if not e["mapped"]:
                out["steps"].append({"n": i + 1, "step": i + 1, "sub": None, "raw": e["raw"], "action": None, "mapped": False, "executed": False,
                                     "result": "UNMAPPED: " + (e.get("reason") or "")})
            else:
                out["steps"].append({"n": i + 1, "step": i + 1, "sub": None, "raw": e["raw"], "action": None, "mapped": True, "executed": False,
                                     "result": "not run: step %d is unmapped" % bi})
        out["notes"] = "step %d not mapped to an action: %r (%s)" % (bi, bad["raw"][:120], bad.get("reason"))
        return out
    created = []          # labels this ticket typed (own fixtures)
    created_clicked = set()
    live_labels = lambda: [l for l in (wr["fixtures"]() if callable(wr.get("fixtures")) else []) if l] + created
    # start at the lens root unless the first step opens something itself
    if not any(s["action"] == "open" for s in flat):
        driver.open(None)
    try:
        for s in flat:
            a = s["action"]
            try:
                if a == "noop":
                    rec(s, True, s.get("note") or "no-op")
                elif a == "observe":
                    rec(s, True, "observed (checked against `expected` below)")
                elif a == "open":
                    driver.open(s.get("target"))
                    rec(s, True, "opened %s" % (s.get("target") or "the lens root"))
                elif a == "reload":
                    driver.reload()
                    rec(s, True, "reloaded")
                elif a == "press":
                    n = int(s.get("count") or 1)
                    for _ in range(n):
                        driver.press(s["key"])
                    rec(s, True, "pressed %s%s" % (s["key"], (" x%d" % n) if n > 1 else ""))
                elif a == "focus_tab_list":
                    fn = getattr(driver, "focus_role", None)
                    got = fn("tab") if fn else None
                    if not got:
                        raise _NotFound("no tab list to move keyboard focus to on the live page")
                    rec(s, True, "moved keyboard focus to the tab list (%s)" % (got if isinstance(got, str) else "first tab"))
                elif a == "open_any_tab":
                    fn = getattr(driver, "tab_names", None)
                    names = [x for x in (fn() if fn else []) if x and is_tab_safe(x)]
                    if not names:
                        raise _NotFound("no safe sub-tab visible on the live page ('any sub-tab' needs at least one)")
                    # explicit, not random: the FIRST safe visible tab, recorded by name
                    if not driver.click(names[0], role="tab"):
                        raise _NotFound("sub-tab %r could not be opened" % names[0])
                    rec(s, True, "'any sub-tab' = first of %d safe visible tab(s): opened %r" % (len(names), names[0]))
                elif a in ("click", "open_tab"):
                    nm = s["name"]
                    if a == "open_tab" and not is_tab_safe(nm):
                        raise _Refused("tab %r refused by the click policy" % nm)
                    kind = "read"
                    if a == "click":
                        if wr.get("allow_write"):
                            ok, why, kind = write_step_decision(nm, admin=wr.get("admin", False), write_skip=wr.get("write_skip", False),
                                                                allow_write=True, fixture_labels=live_labels())
                            if not ok:
                                raise _Refused(why)
                            # a bare Create/Add/Save/Submit... is the form's SUBMIT; "New X" / "Add lesson" / "+" open a form
                            submit = re.match(r"(?i)^\s*(?:(?:save|submit|apply|confirm|ok|done|update|rename)\b|(?:create|add)\s*$)", nm)
                            opener = bool(CREATE_OPENER.search(nm)) and not submit
                            if kind == "create" and not created and not opener:
                                raise _Refused("write step %r refused: no own labelled qa-walker value was entered first in this ticket, so it would not act on a walker fixture" % nm)
                        elif SWEEP_PAYMENT.search(nm):
                            raise _Refused("control %r is payment/billing-adjacent - payments are never touched" % nm)
                        elif HARD_DENY.search(nm):
                            raise _Refused("write step needs --allow-write: control %r is a write/destructive/payment/admin action (safety.HARD_DENY) - the walker never clicks it" % nm)
                    if kind == "delete_scoped":
                        fn = getattr(driver, "click_in_row", None)
                        hit = None
                        for l in (live_labels() if fn else []):
                            hit = fn(nm, l)
                            if hit:
                                break
                        if not hit:
                            raise _Refused("delete refused: no %r control scoped to a walker-created fixture row" % nm)
                    else:
                        if kind == "create" and created:
                            for l in created:
                                if l not in created_clicked:
                                    created_clicked.add(l)
                                    if wr.get("on_fixture"):
                                        wr["on_fixture"](l, "create_clicked", "repro-steps replay: %s" % ticket.get("id"))
                        hit = driver.click(nm, role="tab" if a == "open_tab" else None)
                    if not hit:
                        raise _NotFound("no control matching %r on the live page" % nm)
                    if s.get("exact") and isinstance(hit, str) and _norm(hit) != _norm(nm):
                        raise _NotFound("control %r matched only loosely (%r); a multi-word label must match exactly" % (nm, hit))
                    rec(s, True, "clicked %r (matched %r)%s" % (nm, hit if isinstance(hit, str) else nm, "" if kind == "read" else " [write: %s on own fixture]" % kind))
                elif a == "fill":
                    if not allow_fill:
                        raise _Refused("fill refused: this lens is read-only here (write-skip or admin look-only)")
                    if wr.get("allow_write") and not wr.get("admin") and not wr.get("write_skip"):
                        label = "%s-s%d" % (wr.get("label_base") or "qa-walker-replay", s["n"])
                        val = label
                    else:
                        label, val = None, (s.get("literal") or (_FILL_LABEL + " value"))
                    if not driver.type_into(s["name"], val):
                        raise _NotFound("no field matching %r on the live page" % s["name"])
                    if label:
                        created.append(label)
                        if wr.get("on_fixture"):
                            wr["on_fixture"](label, "never_created", "repro-steps replay %s: typed into %r, not yet submitted" % (ticket.get("id"), s["name"]))
                        rec(s, True, "typed own labelled fixture value %r into %r (not submitted by this step)" % (label, s["name"]))
                    else:
                        rec(s, True, "typed %s into %r (not submitted)" % (("the literal %r" % s["literal"]) if s.get("literal") else "an own labelled qa-walker value", s["name"]))
            except (_Refused, _NotFound) as e:
                rec(s, False, str(e))
                for rest in flat[s["n"]:]:
                    rec(rest, False, "not run: step %d.%d did not execute" % (s["step"], s["sub"]))
                out["notes"] = "step %d mapped but not executed: %s" % (s["step"], e)
                if "needs --allow-write" in str(e):
                    out["notes"] = "step %d is a write step: write step needs --allow-write (%s)" % (s["step"], e)
                out["evidence"] = [driver.screenshot("repro-stopped")]
                return out
        snap = driver.snapshot()
    finally:
        _cleanup(driver, created, wr, ticket, out)
    chk = check_expected(ticket.get("expected"), snap)
    out["expected"] = chk
    out["evidence"] = [e for e in (driver.screenshot("repro-final"),) if e]
    if chk["state"] == "unchecked":
        why = chk.get("why") or next((r["clause"] for r in chk["clauses"] if r["state"] == "unchecked"), "")
        out["notes"] = "all %d step(s) mapped + executed, but the expected outcome is not machine-checkable: %r" % (len(flat), why[:120])
    elif chk["state"] == "fail":
        out["verdict"] = STILL
        out["notes"] = "all %d step(s) executed; expected outcome violated: %s" % (
            len(flat), "; ".join("%r -> %s" % (r["clause"][:60], r["detail"]) for r in chk["clauses"] if r["state"] == "fail")[:240])
    else:
        out["verdict"] = FIXED
        out["notes"] = "all %d step(s) mapped + executed; expected outcome machine-checked: %s" % (
            len(flat), "; ".join(r["detail"] for r in chk["clauses"])[:240])
    if out.get("fixtures"):
        out["notes"] += " [fixtures: %s]" % ", ".join("%s=%s" % (k, v) for k, v in out["fixtures"].items())
    return out


def _cleanup(driver, created, wr, ticket, out):
    """Every own fixture this ticket created is deleted (row-scoped to its label) or recorded as a leftover."""
    if not created:
        return
    res = {}
    for label in created:
        ok, why = False, "driver has no delete_fixture"
        fn = getattr(driver, "delete_fixture", None)
        if fn:
            try:
                ok = bool(fn(label))
                why = "" if ok else "no unambiguous delete control tied to the label"
            except Exception as e:  # a closed page etc.: never crash the lens, never claim cleanup
                ok, why = False, "cleanup errored: %s: %s" % (type(e).__name__, str(e)[:80])
        res[label] = "deleted" if ok else "leftover"
        if wr.get("on_fixture"):
            wr["on_fixture"](label, "deleted" if ok else "leftover",
                             "repro-steps replay %s cleanup" % ticket.get("id") + ("" if ok else ": " + why))
    out["fixtures"] = res


class _Refused(Exception):
    pass


class _NotFound(Exception):
    pass


# --------------------------------------------------------------- Playwright adapter
_INTERACTIVE = ("button", "link", "tab", "menuitem", "checkbox", "switch", "radio", "option", "row", "treeitem",
                "textbox", "searchbox", "combobox", "spinbutton", "listitem", "cell", "gridcell", "heading")
_FIELD_ROLES = ("textbox", "searchbox", "combobox", "spinbutton")


class PlaywrightDriver:
    """Adapts a LensWalk's page + CDP session. Requires a browser, so it is exercised on the
    walker box (selftest/test_replay_playwright.py skips where playwright is absent)."""

    def __init__(self, lw, ctx, page, cdp, lens_url):
        self.lw, self.ctx, self.page, self.cdp, self.lens_url = lw, ctx, page, cdp, lens_url
        self._base = lw.cfg["base_url"].rstrip("/")

    def open(self, target):
        # Only the PATH of a ticket's URL is used, joined onto this run's own base_url: a ticket
        # that names https://concord-os.org/... never sends a selftest/fixture run to prod.
        from urllib.parse import urlparse
        path = urlparse(target).path if target else None
        if not path or path.rstrip("/") == urlparse(self.lens_url).path.rstrip("/"):
            self.lw.url = self.lens_url
        else:
            self.lw.url = self._base + path
        self.lw.nav(self.page, self.cdp)

    def reload(self):
        self.page.reload(wait_until="domcontentloaded", timeout=self.lw.th["nav_timeout_ms"])
        try:
            self.page.wait_for_load_state("networkidle", timeout=self.lw.th["settle_ms_judgment"])
        except Exception:
            pass

    def press(self, key):
        self.page.keyboard.press(key)

    def _nodes(self, role=None):
        ax = self.cdp.ax()
        return [n for n in ax.live() if n.name and (n.role == role if role else n.role in _INTERACTIVE)]

    def click(self, name, role=None):
        nodes = self._nodes(role)
        hit = fuzzy_match(name, [n.name for n in nodes])
        if not hit:
            return None
        node = next(n for n in nodes if n.name == hit)
        return hit if node.backend is not None and self.cdp.click(node.backend) else None

    def type_into(self, name, value):
        ax = self.cdp.ax()
        nodes = [n for n in ax.live() if n.role in _FIELD_ROLES and n.name]
        hit = fuzzy_match(name, [n.name for n in nodes])
        if not hit:
            return False
        node = next(n for n in nodes if n.name == hit)
        if node.backend is None or not self.cdp.focus(node.backend):
            return False
        self.page.keyboard.press("Control+A")
        self.page.keyboard.type(value)
        return True

    def tab_names(self):
        return [n.name for n in self._nodes("tab")]

    def focus_role(self, role):
        nodes = self._nodes(role)
        if not nodes or nodes[0].backend is None or not self.cdp.focus(nodes[0].backend):
            return None
        return nodes[0].name

    def click_in_row(self, name, label):
        """Click the single control `name` that sits in the same row/card as an own fixture `label`
        (nearest ancestor, <=4 up, holding exactly one match). None when ambiguous or absent."""
        ax = self.cdp.ax()
        lab = next((n for n in ax.live() if label in (n.name or "")), None)
        if lab is None:
            return None
        for anc in ax.ancestors(lab)[:4]:
            desc = ax.descendants(anc)
            btns = [d for d in desc if d.role in ("button", "menuitem") and d.backend and d.name and fuzzy_match(name, [d.name])]
            if len(btns) == 1:
                return btns[0].name if self.cdp.click(btns[0].backend) else None
            if len(btns) > 1:
                return None
        return None

    def delete_fixture(self, label):
        """Row-scoped delete of an own fixture + confirm; True only when the label is gone afterwards."""
        from .safety import CONFIRM_DELETE
        prior = getattr(self.lw, "dialog_mode", None)
        try:
            self.lw.dialog_mode = "accept"
            hit = self.click_in_row("Delete", label) or self.click_in_row("Remove", label)
            if not hit:
                return False
            self.page.wait_for_timeout(900)
            ax = self.cdp.ax()
            for p in ax.popups():
                btn = next((d for d in ax.descendants(p) if d.role == "button" and d.backend and CONFIRM_DELETE.search(d.name or "")), None)
                if btn:
                    self.cdp.click(btn.backend)
                    self.page.wait_for_timeout(900)
                    break
            return not any(label in (n.name or "") for n in self.cdp.ax().live())
        finally:
            if prior is not None:
                self.lw.dialog_mode = prior

    def snapshot(self):
        ax = self.cdp.ax()
        ctl = [{"name": n.name, "role": n.role, "enabled": not n.disabled, "focused": n.focused, "props": dict(n.props)}
               for n in ax.live() if n.name and n.role in _INTERACTIVE]
        return {"controls": ctl, "texts": ax.texts(), "dialogs": [n.name or "dialog" for n in ax.dialogs()],
                "errors": len(self.lw.page_errors) + len(self.lw.console_errors), "url": self.page.url}

    def screenshot(self, name):
        return self.lw.shot(self.page, name)

    def close(self):
        self.lw._close(self.ctx)
