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
import time
from . import expected as _X
from . import labels as _L
from . import vocab as _V
from . import writevocab as _W
from . import precap as _P
from . import observe as _O
from . import viewport as _V2
from .matching import fuzzy_match
from .safety import HARD_DENY, SWEEP_PAYMENT, is_tab_safe, is_close_safe, write_step_decision, CREATE_OPENER, CREATE_SUBMIT
FIELD_NEVER_RX = _W.FIELD_NEVER

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
MAX_TAB_STOPS = _V.MAX_TAB_STOPS


def _sleep(sec):
    """Indirection so tests never really wait."""
    time.sleep(max(0.0, min(float(sec), _V.MAX_WAIT_S)))


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
    if re.fullmatch(r"(?i)(?:then\s+)?(?:a\s+)?hard\s+(?:reload|refresh)(?:\s+once)?", s):
        return dict(base, action="reload", mapped=True)
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
    m = re.match(r"(?i)^(?:then\s+)?(?:open|switch to|go to|select|click|choose|tap)\s+(?:on\s+)?(?:the\s+)?(?:" + _QNAME + r"|(?P<u>(?-i:[A-Z])[A-Za-z0-9'&.\- ]{0,40}?))\s+tab\b", s)
    if m:
        return dict(base, action="open_tab", name=(m.group("q") or m.group("u") or "").strip(), mapped=True)
    m = re.match(r"(?i)^(?:then\s+)?(?:type|enter|fill(?: in)?|input|write)\s+(?:" + _QNAME.replace("(?P<q>", "(?P<v>") + r"\s+)?(?:in|into|in to|to)\s+(?:the\s+)?(?:" + _QNAME + r"|(?P<u>(?-i:[A-Z])[A-Za-z0-9'&.\- ]{0,40}?))(?:\s+" + _NOUN + r")?\s*$", s)
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
_PREFIX_URL = re.compile(r"(?i)^(?:on\s+)?(?P<u>https?://\S+?|/lenses/[a-z0-9\-/]+?)(?:\s*\([^)]*\))?\s*(?::|,)\s*")
_PREFIX_ON = re.compile(r"(?i)^on\s+(?:(?:https?://\S+|/lenses/\S+?)\s*)?(?:as\s+\S+(?:\s*\(role [^)]*\))?\s*)?(?:,|:)\s*")
_PREFIX_FROM = re.compile(r"(?i)^from\s+(?:(?:https?://\S+|/lenses/[a-z0-9\-/]+)|the\s+[A-Za-z0-9 \-]{1,30}?\s+lens)\s*,\s*")
_PREFIX_WHO = re.compile(r"(?i)^on\s+[a-z0-9][a-z0-9_]*_t\d\s*(?:\([^)]*\))?\s*,\s*")  # legacy "On <handle>_t1 (role ...)," prefix; no account names hardcoded
_GENERIC_VALUE = re.compile(r"(?i)^(?:x|y|z|text|a query|query|a term|term|something|anything|a name|a title|a value|value|a word|some text|a search|test)$")
_ACT_VERB = re.compile(r"\b(create|click|type|press|delete|save|submit|add|open|edit|send|reload|rename|set|enter|select|drag|toggle|tap|remove|log|fill|paste)\b")
_CHECK_IN = re.compile(r"(?i)^check[\s-]?in\b")
_PATH_ONLY = re.compile(r"(?i)^(?:https?://\S+|/lenses/[a-z0-9\-/]+)$")
_SENT = re.compile(r"(?<=[a-z0-9)\]'\"])\.\s+(?=[A-Z])")
_NEXT_VERB = r"(?:hard|press|click|open|tap|select|type|enter|reload|hit|tab|look|inspect|record|check|confirm|verify|find|identify|scroll|hover|wait|repeat|do not|don't|never|if)\b"
_CHAIN = re.compile(r"(?i)\s*;\s*|,?\s+then\s+|,\s+(?=" + _NEXT_VERB + r")|\s+and\s+(?=(?:ask|press|click|open|tap|select|type|enter|reload|hit|look|inspect|record|check|confirm|verify|find|identify|scroll|hover|wait|repeat|do not|don't)\b)")
_GUARD_PAREN = re.compile(r"(?i)\s*\((?:do not|don't|never)\b[^)]*\)")
_COLON_LABEL = re.compile(r"^(?P<label>[A-Z][A-Za-z0-9&'\-]*(?:\s+[A-Z0-9][A-Za-z0-9&'\-]*){0,3}):\s+(?P<rest>\S.*)$")
_PATH_TITLE = re.compile(r"(?i)^on\s+(?P<u>https?://\S+|/lenses/[a-z0-9\-/]+)(?:\s*\([^)]*\))?\s+(?P<rest>\S.*)$")
_BARE_TAB = re.compile(r"^(?P<u>[A-Z][A-Za-z0-9'&.\-/ ]{0,30}?)\s+tab$")
_EXPORT_NAME = re.compile(r"(?i)^export(?:\s+(?:as\s+)?(?:json|csv|dtu|\.dtu))?$")
_FORMAT_NAME = re.compile(r"(?i)^\.?(json|csv|dtu|pdf|xlsx|txt)$")


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
    s = re.sub(r"(?i)\b(arrow)(left|right|up|down)\s*/\s*(left|right|up|down)\b", r"\1\2/\1\3", s)
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


_DESCRIPTORS = {"floating", "header", "footer", "sticky", "inline", "top", "bottom", "left", "right", "main", "lens", "page",
                "toolbar", "sidebar", "fixed", "global", "the", "a", "an"}
_QUANT = {"own", "any", "each", "every", "several", "multiple", "some", "both", "all", "first", "last", "another", "one", "that", "this", "these", "those"}
_PROSE_WORDS = {"while", "until", "when", "so", "it", "is", "are", "that", "which", "if", "then", "also", "once", "again", "repeatedly",
                "should", "must", "shows", "displays", "does", "did", "has", "have", "be", "been", "can", "will", "would",
                "on", "at", "from", "into", "onto", "by", "with", "as", "after", "before", "over", "under", "per", "about"}
_INNER_OK = {"for", "of", "to", "and", "or", "in", "&", "&amp;"}
_KEYISH = re.compile(r"(?i)\bpress\b|\barrow\s*(?:left|right|up|down)\b|\besc(?:ape)?\b\s*$|\bkey\b")


def _label_ok(txt, lens_names):
    """Is `txt` plausibly a control's accessible name (not prose)? -> cleaned name or None.
    Real labels may contain connectors ("Scan for residues", "Save & close") and a leading descriptor
    ("floating New listing" -> "New listing"); whole sentences, key phrases ("Map press ArrowRight")
    and generic targets ("own node", "each quick action") still fail."""
    t = txt.strip().strip(".").strip()
    q = re.match(r"^[\"'‘“](.{1,60}?)[\"'’”]$", t)
    if q:
        return q.group(1).strip()
    if not t or len(t) > 50 or _TOOLING.search(t) or _PROSE_START.match(t) or _KEYISH.search(t):
        return None
    if re.search(r"[,()/\[\]{}]", t):
        return None
    words = t.split()
    while words and len(words) > 1 and words[0][:1].islower() and words[0].lower() in _DESCRIPTORS:
        words = words[1:]
    if not words or len(words) > 6:
        return None
    if not (words[0][:1].isupper() or words[0][:1].isdigit() or words[0][:1] in "+&…") or words[0].lower() in _QUANT:
        return None
    for i, w in enumerate(words[1:], 1):
        wl = w.lower()
        if wl in _QUANT:
            return None
        if wl in _PROSE_WORDS:
            return None
        if wl in ("for", "of", "to", "and", "or") and i == len(words) - 1:
            return None  # a dangling connector ("Scan for") is a cut name
    t2 = " ".join(words)
    if re.search(r"[:;?!]|\bx\d+\b|\b\d+\s*(?:char|ms|px|kg|h|s)\b", t2) or any(re.match(r"^[-+]?\d+(?:[.,]\d+)?%?$", w) for w in words):
        return None
    return t2


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


def _list_items(rest, lens_names):
    """'Analytics / Status page / Repair net' | 'Closet, Outfits, Calendar, and Trends' -> [label, ...] or None."""
    if not re.search(r"\s/\s|(?<=[A-Za-z])/(?=[A-Z])|,|\band\b", rest):
        return None
    items = [x.strip() for x in re.split(r"\s*(?:,\s*(?:and\s+)?|\s/\s|/(?=[A-Z])|\s+and\s+)\s*", rest) if x and x.strip()]
    if len(items) < 2 or len(items) > 8:
        return None
    out = [_label_ok(x, lens_names) for x in items]
    return out if all(out) else None


def _map_segment(seg, lens, lens_names, prev, in_crumb):
    """One segment -> (list of sub-step dicts, None) or (None, reason)."""
    s = re.sub(r"(?i)^(?:then|and|also|try|separately|next|now)\s+", "", seg.strip()).strip().rstrip(".,;").strip()
    s = re.sub(r"(?i)\s*\(nothing sent\)\s*$", "", s).strip()
    if not s:
        return [], None
    if _CHECK_IN.match(s):
        return None, "'check in' is an app action, not an observation"
    if _PATH_ONLY.match(s):
        path = re.sub(r"^https?://[^/]+", "", s)
        return [{"action": "open", "target": path if path.startswith("/lenses/") else None, "raw": seg.strip()}], None
    # a trailing "(do not ...)" guard is its own recorded/enforced constraint, never part of the control name
    guard = []
    s = re.sub(r"(?i)\s*\((?:contrast|e\.g\.|for example|i\.e\.|note|see|full dtu bundle|tabular data)[^)]*\)", "", s).strip()
    gm = _GUARD_PAREN.search(s)
    if gm:
        guard = _V._constraint(re.sub(r"(?i)^\s*\((?:do not|don't|never)\s*|\)\s*$", "", gm.group(0)), seg.strip())
        s = (s[:gm.start()] + s[gm.end():]).strip()
    got = _map_core(s, seg, lens, lens_names, prev, in_crumb)
    if got[0] is None:
        return got
    return guard + got[0], None


def _map_core(s, seg, lens, lens_names, prev, in_crumb):
    """Existing mapper first (unchanged); only a segment it left unmapped is offered to the pre-capture layer."""
    got = _map_core_base(s, seg, lens, lens_names, prev, in_crumb)
    if got[0] is None:
        p = _P.map_part(s, seg.strip(), lens_names, prev)
        if p is not _P.NOT_MINE:
            if isinstance(p, tuple):
                return got if p[1] is None else (None, p[1])
            return [dict(x, raw=x.get("raw", seg.strip())) for x in p], None
    if got[0] is None and not re.search(r"[\"'‘“]", s) and re.search(r",|;|\bthen\b", s):
        # "Tab x10, Esc" / "Open Export, Esc x2" / "Focus X, Ctrl+K": every comma piece must map on its own, else the whole stays unmapped
        pieces = [x for x in re.split(r"\s*(?:,|;|\bthen\b)\s*", s) if x.strip()]
        if 2 <= len(pieces) <= 6:
            out, pv = [], prev
            for pc in pieces:
                g = _map_core(pc, pc, lens, lens_names, pv, True)
                if g[0] is None:
                    break
                out += g[0]
                pv = next((x for x in reversed(g[0]) if x.get("action") != "noop"), pv)
            else:
                return [dict(x, raw=x.get("raw", seg.strip())) for x in out], None
    return got


def _map_core_base(s, seg, lens, lens_names, prev, in_crumb):
    # ---- walker vocabulary first (viewport / theme / keyboard / export / console / a11y / chat / guard / observe)
    v = _V.map_part(s, seg.strip(), lens_names, prev)
    if v is not _V.NOT_MINE:
        if isinstance(v, tuple):
            return v
        return [dict(x, raw=x.get("raw", seg.strip())) for x in v], None
    w = _W.map_part(s, seg.strip(), lens_names, prev)
    if w is not _W.NOT_MINE:
        if isinstance(w, tuple):
            return w
        return [dict(x, raw=x.get("raw", seg.strip())) for x in w], None
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
    if legacy["mapped"] and legacy["action"] == "observe":
        legacy = dict(legacy, mapped=False, reason="repro is a pointer to an evidence file / observation, not a replayable action" if re.match(r"(?i)^see\b", s) else "observation is mapped by the vocab observe split")
    if legacy["mapped"] and not _legacy_trusted(legacy, s):
        legacy = dict(legacy, mapped=False, reason="control name cut mid-phrase by the legacy mapper")
    if legacy["mapped"] and legacy["action"] != "observe":
        return [dict(legacy, raw=seg.strip())], None
    mt = _BARE_TAB.match(s)
    if mt and not _TOOLING.search(s):
        nm = mt.group("u").strip()
        if _norm(nm) in lens_names:
            return [{"action": "noop", "note": "already on the lens", "raw": seg.strip()}], None
        return [{"action": "open_tab", "name": nm, "raw": seg.strip()}], None
    m = _VERB_CLICK.match(s)
    if m:
        rest = re.sub(r"(?i)\s+(?:button|tab|link|menu|control|panel|form|dialog|view)$", "", m.group("rest").strip())
        rest = re.sub(r"(?i)\s+on\s+(?:the\s+)?(.+)$", lambda mm: "" if _norm(mm.group(1)) in lens_names else mm.group(0), rest)
        if _norm(rest) in lens_names:
            return [{"action": "noop", "note": "already on the lens", "raw": seg.strip()}], None
        nm = _label_ok(rest, lens_names)
        if nm:
            return [dict({"action": "click", "name": nm, "raw": seg.strip()}, **({"exact": True} if re.search(r"(?i)\b(and|or)\b", nm) else {}))], None
        items = _list_items(rest, lens_names)
        if items:
            return [{"action": "click", "name": n, "raw": seg.strip(), "fanout": True} for n in items], None
        return None, "names no specific control (%r)" % rest[:50]
    items = _list_items(s, lens_names) if (in_crumb or True) else None
    if items and not _PROSE_START.match(s):
        return [{"action": "click", "name": n, "raw": seg.strip(), "fanout": True, "crumb": True} for n in items], None
    if in_crumb:
        nm = _label_ok(s, lens_names)
        if nm:
            return [{"action": "click", "name": nm, "crumb": True, "raw": seg.strip()}], None
    elif len(s.split()) <= 3 and not _ACT_VERB.search(s.lower()):
        nm = _label_ok(s, lens_names)
        if nm and nm[:1].isupper():
            return [{"action": "click", "name": nm, "bare": True, "raw": seg.strip()}], None
    if legacy["mapped"]:
        return [dict(legacy, raw=seg.strip())], None
    return None, legacy.get("reason") or "no recognised action"


def _collapse_exports(subs):
    """click Export (+ format clicks / export_check) -> ONE export_check. A click on Export followed by
    anything else (Esc, Tab, another control) stays a plain control click."""
    out, i = [], 0
    while i < len(subs):
        x = subs[i]
        if x.get("action") == "click" and _EXPORT_NAME.match(x.get("name") or ""):
            fm, j = [], i + 1
            em = re.search(r"(?i)(json|csv|dtu)$", x["name"])
            if em:
                fm.append(em.group(1).lower())
            while j < len(subs) and ((subs[j].get("action") == "click" and _FORMAT_NAME.match(subs[j].get("name") or ""))
                                     or subs[j].get("action") == "export_check"):
                if subs[j].get("action") == "export_check":
                    fm += subs[j].get("formats") or []
                else:
                    fm.append(_FORMAT_NAME.match(subs[j]["name"]).group(1).lower())
                j += 1
            if j == len(subs) or j > i + 1:
                out.append({"action": "export_check", "formats": list(dict.fromkeys(fm)), "raw": x.get("raw"), "mapped": True, "collapsed": j - i})
                i = j
                continue
        if x.get("action") == "export_check" and out and out[-1].get("action") == "export_check":
            out[-1] = dict(out[-1], formats=list(dict.fromkeys((out[-1].get("formats") or []) + (x.get("formats") or []))))
            i += 1
            continue
        out.append(x)
        i += 1
    return out


def _expand_repeats(subs):
    """repeat_prev -> a copy of the previous actionable sub-steps; repeat_for -> one click per named target."""
    out = []
    for x in subs:
        if x.get("action") == "repeat_prev":
            prev = [y for y in out if y.get("action") not in ("constraint", "conditional", "wait", "noop", "observe")]
            take = prev[-1:] if prev else []
            if not take:
                return None, "repeat has no earlier action to repeat"
            for _ in range(int(x.get("times") or 1)):
                out += [dict(y, repeated=True) for y in take]
        elif x.get("action") == "repeat_for":
            out += [{"action": "click", "name": t, "raw": x.get("raw"), "mapped": True, "repeated": True} for t in x["targets"]]
        else:
            out.append(x)
    return out, None


def expand_step(raw, lens_slug=None, lens_title=None):
    """One raw step -> {raw, mapped, substeps:[...], reason, parts:[...]}.

    `parts` records EVERY part of the step ({raw, mapped, substeps | reason}); one unmappable part
    never aborts mapping of the others, but the step counts as mapped / runnable only when ALL its
    parts are. An unmapped step carries substeps == [] (nothing is run) with the first reason."""
    s0 = (raw or "").strip()
    out = {"raw": s0, "mapped": False, "substeps": [], "reason": None, "parts": []}
    legacy = map_step(s0, lens_slug)
    trailing = legacy["mapped"] and legacy["action"] == "open" and re.search(r"(?i)(?:https?://\S+|/lenses/[a-z0-9\-/]+)\s*[.,;]?\s*\S", s0.split("://", 1)[-1] if False else s0) is not None \
        and not re.search(r"(?i)(?:https?://\S+|/lenses/[a-z0-9\-/]+)[.]?\s*$", s0)
    # the legacy single-verb mapper reads only the START of a step ("Open X tab, then record Y" -> open_tab):
    # a multi-clause step goes through the per-part route so no clause is silently dropped
    multi = re.search(r"(?:;|,|\bthen\b|\band\b|\s>\s|→|->|\.\s+[A-Z])", re.sub(r"[\"'‘“][^\"'’”]*[\"'’”]", "", s0)) is not None
    if legacy["mapped"] and not trailing and not multi and legacy["action"] != "observe" and not _CHECK_IN.match(s0) and _legacy_trusted(legacy, s0):
        out.update(mapped=True, substeps=[dict(legacy)], parts=[{"raw": s0, "mapped": True, "substeps": [dict(legacy)]}])
        return out
    lens_names = {n for n in (_norm(lens_slug), _norm(lens_title), _norm((lens_slug or "").replace("-", " "))) if n}
    s = s0
    subs, parts = [], []
    m = _PREFIX_URL.match(s)
    if m:
        path = re.sub(r"^https?://[^/]+", "", m.group("u"))
        sub = {"action": "open", "target": path if path.startswith("/lenses/") else None, "raw": m.group(0).strip(), "mapped": True}
        subs.append(sub)
        parts.append({"raw": m.group(0).strip(), "mapped": True, "substeps": [sub]})
        s = s[m.end():]
    else:
        stripped = False
        for pre in (_PREFIX_ON, _PREFIX_WHO, _PREFIX_FROM):
            mm = pre.match(s)
            if mm:
                s = s[mm.end():]
                stripped = True
                break
        if not stripped:
            mm = _PATH_TITLE.match(s)
            if mm:  # "On /lenses/plumbing Field Service > Schedule a Job": path + lens title = already on the lens
                rest = mm.group("rest")
                path = re.sub(r"^https?://[^/]+", "", mm.group("u"))
                sub = {"action": "open", "target": path if path.startswith("/lenses/") else None, "raw": s0[:mm.start("rest")].strip(), "mapped": True}
                subs.append(sub)
                parts.append({"raw": sub["raw"], "mapped": True, "substeps": [sub]})
                first = _CRUMB_SEP.split(rest, 1)[0].strip()
                if rest[:1].isupper() and len(first.split()) <= 5 and _label_ok(first, lens_names):
                    sub = {"action": "noop", "note": "already on the lens (path prefix + lens title %r)" % first, "raw": first, "mapped": True}
                    subs.append(sub)
                    parts.append({"raw": first, "mapped": True, "substeps": [sub]})
                    rest = rest[len(first):].lstrip(" >→-=»›").strip()
                s = rest
    if not s.strip():
        out.update(mapped=bool(subs), substeps=subs, parts=parts, reason=None if subs else "step has no actionable text")
        return out
    # "Meditation: Export > JSON" / "Music Home: read metric cards": a short Title-case label before a colon is a crumb
    lm = _COLON_LABEL.match(s)
    if lm and not re.match(r"(?i)^(?:note|expected|actual|steps?|result|tip|warning)$", lm.group("label")):
        lab = lm.group("label")
        if _norm(lab) in lens_names:
            sub = {"action": "noop", "note": "already on the lens (label prefix %r)" % lab, "raw": lab + ":", "mapped": True}
        elif _label_ok(lab, lens_names):
            sub = {"action": "click", "name": _label_ok(lab, lens_names), "crumb": True, "raw": lab + ":", "mapped": True}
        else:
            sub = None
        if sub:
            subs.append(sub)
            parts.append({"raw": sub["raw"], "mapped": True, "substeps": [sub]})
            s = lm.group("rest")
    chunks = [c.strip() for sent in _SENT.split(s) for c in _CHAIN.split(sent) if c and c.strip()]
    first_reason = None
    for ci, chunk in enumerate(chunks):
        crumbs = [c for c in _CRUMB_SEP.split(chunk) if c.strip()]
        # a bare label is a control name only inside a path ("A > B") or a multi-part chain ("A, then B")
        in_crumb = len(crumbs) > 1 or len(chunks) > 1
        keylist = _parse_keys(chunk) if not in_crumb else None
        if keylist:
            ks = [{"action": "press", "key": k, "count": c, "raw": chunk, "mapped": True} for k, c in keylist]
            subs += ks
            parts.append({"raw": chunk, "mapped": True, "substeps": ks})
            continue
        for i, cr in enumerate(crumbs):
            prev = next((x for x in reversed(subs) if x.get("action") != "noop"), None) if i or subs else None
            got, why = _map_segment(cr, lens_slug, lens_names, prev, in_crumb)
            if got is None:
                if first_reason is None:
                    first_reason = "segment %r: %s" % (cr.strip()[:80], why)
                parts.append(dict({"raw": cr.strip(), "mapped": False, "reason": why}, **_P.classify_part(cr, why)))
                continue
            mapped_here = []
            for g in got:
                if g.pop("merge_prev", False) and subs and subs[-1].get("action") in ("click", "open_tab"):
                    subs.pop()
                g = dict(g, mapped=True)
                subs.append(g)
                mapped_here.append(g)
            parts.append({"raw": cr.strip(), "mapped": True, "substeps": mapped_here})
    out["parts"] = parts
    if first_reason is not None:
        out["reason"] = first_reason
        return out
    subs, why = _expand_repeats(subs)
    if subs is None:
        out["reason"] = why
        return out
    subs = _collapse_exports(subs)
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
    """Sentences / semicolons / bullets only (never commas or 'and' - see expected.split_clauses)."""
    return _X.split_clauses(expected)


def _check_legacy(clause, snap):
    """Single-predicate checks (enabled/selected/focus/dialog/visible/shows/no-errors). (state, detail)."""
    c = clause.strip()
    m = re.search(r"(?i)\bno (?:console |page |js |javascript |visible )?errors?\b|without (?:any )?errors?|(?:does(?:n't| not)|should not|won't) crash|\bno crash\b", c)
    if m:
        bad = snap.get("errors") or 0
        bad_txt = [t for t in snap["texts"] if _ERR_TEXT.search(t)]
        return ("fail", "errors=%s error-text=%s" % (bad, bad_txt[:2])) if bad or bad_txt else ("pass", "no page errors, no error text")
    m = re.search(r"(?i)(?:" + _QNAME + r"|(?P<u>(?-i:[A-Z])[A-Za-z0-9'&.\- ]{0,40}?))\s*(?:" + _NOUN + r")?\s+(?:is|are|becomes?|should be|gets?|stays?|remains?)\s+(?:now\s+)?(enabled|disabled)\b", c)
    if m:
        name = (m.group("q") or m.group("u") or "").strip()
        node = _find(snap, name)
        if node is None:
            return "fail", "control %r not found" % name
        want = m.group(m.lastindex).lower() == "enabled"
        return ("pass" if bool(node.get("enabled", True)) == want else "fail"), "%r enabled=%s" % (node["name"], node.get("enabled", True))
    m = re.search(r"(?i)(?:" + _QNAME + r"|(?P<u>(?-i:[A-Z])[A-Za-z0-9'&.\- ]{0,40}?))\s*(?:" + _NOUN + r")?\s+(?:is|are|becomes?|should be|gets?)\s+(selected|checked|expanded|pressed)\b", c)
    if m:
        name = (m.group("q") or m.group("u") or "").strip()
        node = _find(snap, name)
        if node is None:
            return "fail", "control %r not found" % name
        return ("pass" if (node.get("props") or {}).get(m.group(m.lastindex).lower()) in (True, "true") else "fail"), "%r props=%s" % (node["name"], node.get("props"))
    m = re.search(r"(?i)focus\s+(?:returns?|goes|moves|is|stays|remains)\s+(?:back\s+)?(?:to|on)\s+(?:the\s+)?(?:" + _QNAME + r"|(?P<u>(?-i:[A-Z])[A-Za-z0-9'&.\- ]{0,40}?))(?:\s+" + _NOUN + r")?\s*$", c)
    if m:
        name = (m.group("q") or m.group("u") or "").strip()
        foc = next((x for x in snap["controls"] if x.get("focused")), None)
        return ("pass" if foc and fuzzy_match(name, [foc.get("name") or ""]) else "fail"), "focused=%r" % (foc or {}).get("name")
    if re.search(r"(?i)\b(dialog|modal|popup|drawer|menu|overlay)s?\b.*\b(closes?|is dismissed|dismisses|is closed|disappears?|is gone)\b|\bcloses?\s+(?:the\s+)?(dialog|modal|popup|drawer|menu|overlay)", c):
        n = len(snap.get("dialogs") or [])
        return ("pass" if n == 0 else "fail"), "%d dialog(s) open" % n
    m = re.search(r"(?i)(?:" + _QNAME + r"|(?P<u>(?-i:[A-Z])[A-Za-z0-9'&.\- ]{0,40}?))\s*(?:" + _NOUN + r")?\s+(?:is|are|should be|becomes?|appears?|renders?|gets?)\s+(?:now\s+)?(?:visible|shown|displayed|present|listed|rendered)\b", c)
    if not m:
        m = re.search(r"(?i)\b(?:shows?|displays?|reads?|says?|contains?|lists?)\s+(?:the\s+)?(?:" + _QNAME + r"|(?P<u>(?-i:[A-Z])[A-Za-z0-9'&.\- ]{0,40}))\s*$", c)
    if m:
        name = (m.group("q") or m.group("u") or "").strip()
        if name:
            return ("pass" if _text_present(snap, name) else "fail"), "%r %s" % (name, "present" if _text_present(snap, name) else "absent")
    m = re.search(r"(?i)(?:" + _QNAME + r"|(?P<u>(?-i:[A-Z])[A-Za-z0-9'&.\- ]{0,40}?))\s*(?:" + _NOUN + r")?\s+(?:is|are)\s+(?:no longer|not)\s+(?:visible|shown|displayed|present)\b", c)
    if m:
        name = (m.group("q") or m.group("u") or "").strip()
        return ("fail" if _text_present(snap, name) else "pass"), "%r %s" % (name, "present" if _text_present(snap, name) else "absent")
    return "unchecked", "no machine-checkable predicate for this clause"


def check_clause(clause, snap):
    """(state, detail). state: 'pass' | 'fail' | 'unchecked'. A sentence is checkable only when EVERY
    predicate in it is a typed kind (expected.classify_clause); evidence missing from the snapshot ->
    'unchecked', never 'pass'."""
    specs = _X.classify_clause(clause, _check_legacy)
    if specs is None:
        return "unchecked", "no machine-checkable predicate for this clause"
    return _X.check_specs(specs, snap, _check_legacy)


def classify_expected(expected, extra=()):
    """[(clause, kind|None)] - kind None means no machine check can read the clause (NEEDS_HUMAN)."""
    return _X.classify_expected(expected, _check_legacy, extra)


def observe_clauses(ticket, lens_slug=None, lens_title=None):
    """Clauses moved from observe steps ("look for X") to the expected side (provenance kept on the step)."""
    out = []
    for r in split_steps(ticket):
        e = expand_step(r, lens_slug or (ticket or {}).get("lens"), lens_title)
        if e["mapped"]:
            out += [x["clause"] for x in e["substeps"] if x.get("action") == "observe" and x.get("clause")]
    return out


def ticket_expected_kinds(ticket, lens_title=None):
    """classify_expected over the ticket's `expected` PLUS its observe-step clauses."""
    return classify_expected((ticket or {}).get("expected"), extra=observe_clauses(ticket, None, lens_title))


def check_expected(expected, snap, extra=()):
    """Every clause must be machine-checkable. -> {state: pass|fail|unchecked, clauses: [...]}"""
    clauses = [(c, "expected") for c in _clauses(expected)] + [(c, "observe-step") for c in extra if c]
    if not clauses:
        return {"state": "unchecked", "clauses": [], "why": "ticket has no `expected` text"}
    rows = []
    for c, src in clauses:
        specs = _X.classify_clause(c, _check_legacy)
        if specs is None:
            st, d, sub = "unchecked", "no machine-checkable predicate for this clause", []
        else:
            st, d, sub = _X.check_specs_detailed(specs, snap, _check_legacy)
        rows.append({"clause": c, "state": st, "detail": d, "source": src, "kinds": "+".join(x["kind"] for x in sub), "specs": sub})
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

    flat = _W.expand_fanout(flat)
    for _i, _f in enumerate(flat):
        _f["n"] = _i + 1

    def rec(st, executed, result, **extra):
        row = {"n": st["n"], "step": st.get("step"), "sub": st.get("sub"), "raw": st["raw"], "action": st.get("action"),
               "mapped": bool(st["mapped"]), "executed": executed, "result": result}
        row.update(extra)
        out["steps"].append(row)

    if not raw_steps:
        out["notes"] = "ticket has no repro_steps to replay"
        return out
    bad = next((e for e in expanded if not e["mapped"]), None)
    if bad:
        bi = expanded.index(bad) + 1
        for i, e in enumerate(expanded):
            if not e["mapped"]:
                out["steps"].append({"n": i + 1, "step": i + 1, "sub": None, "raw": e["raw"], "action": None, "mapped": False, "executed": False,
                                     "result": "UNMAPPED: " + (e.get("reason") or ""), "parts": e.get("parts")})
            else:
                out["steps"].append({"n": i + 1, "step": i + 1, "sub": None, "raw": e["raw"], "action": None, "mapped": True, "executed": False,
                                     "result": "not run: step %d is unmapped" % bi})
        out["notes"] = "step %d not mapped to an action: %r (%s)" % (bi, bad["raw"][:120], bad.get("reason"))
        return out
    created = []          # labels this ticket typed (own fixtures)
    created_clicked = set()
    live_labels = lambda: [l for l in (wr["fixtures"]() if callable(wr.get("fixtures")) else []) if l] + created
    ev = {"keys_sent": [], "reloaded": False, "own_values": [], "typed_values": [], "submitted": False}      # evidence the expected-clause checks read
    if getattr(driver, "net_mark", None):
        ev["step_windows"] = []          # per-step net-ledger windows (validation checks read the typed/submit steps')
    _cb = getattr(driver, "console_errors", None)
    console_base = _cb() if _cb else None
    # generic observe predicates / network read-back need a per-step evidence window (before/after snapshot + console + responses)
    _oc = [x.get("clause") for e in expanded for x in e["substeps"] if x.get("action") == "observe" and x.get("clause")]
    _ok = {sp["kind"] for c in _X.split_clauses(ticket.get("expected")) + _oc for sp in (_X.classify_clause(c, _check_legacy) or [])}
    want_obs = bool(_ok & (set(_O.KINDS) | {"g_net_readback", "g_net_status_class", "g_net_shape"})) and hasattr(driver, "snapshot")
    if want_obs:
        ev["obs"] = []
        driver._obs_on = True
    gone = set()                         # own fixtures a ticket step already deleted (cleanup must not report them leftover)

    def write_ok(what):
        if not wr.get("allow_write"):
            raise _Refused("write step needs --allow-write: %s writes only to the walker's own labelled fixtures" % what)
        if wr.get("admin"):
            raise _Refused("%s refused: admin lens stays look-only (no write step)" % what)
        if wr.get("write_skip"):
            raise _Refused("%s refused: write-skip lens stays read-only (no write step)" % what)

    def register_label(label, note):
        created.append(label)
        if label not in ev["own_values"]:
            ev["own_values"].append(label)
        if wr.get("on_fixture"):
            wr["on_fixture"](label, "never_created", "repro-steps replay %s: %s" % (ticket.get("id"), note))
    forbid_keys, forbid_repeat, forbid_verbs, click_counts, st = set(), set(), set(), {}, {"opener": None}
    observed = []

    def cap(name):
        fn = getattr(driver, name, None)
        if not fn:
            raise _NotFound("this driver cannot %s - the step stays NEEDS_HUMAN rather than being skipped" % name)
        return fn

    def send_key(key):
        if key in forbid_keys:
            raise _Refused("constraint violated: the ticket says 'do not %s first' but this step sends %s first" % (key, key))
        pc = getattr(driver, "popup_count", None)
        before = pc() if pc else None
        driver.press(key)
        ev["keys_sent"].append(key)
        forbid_keys.clear()           # a 'first' guard only governs the first key sent after it
        if key == "Escape" and before is not None:
            if before >= 1 and not ev.get("_esc_open"):
                ev["popups_before"], ev["_esc_open"] = before, True
            elif "popups_before" not in ev:
                ev["popups_before"] = before
            ev["popups_after"], ev["closer"] = pc(), "Escape"
        if key == "Tab" and before:
            fip = getattr(driver, "focus_in_popup", None)
            if fip:
                ev.setdefault("focus_in_popup", []).append(bool(fip()))
        if key == "Escape":
            fn = getattr(driver, "focused_name", None)
            if fn and st["opener"]:
                ev["focus_after_escape"], ev["opener"] = fn(), st["opener"]

    # start at the lens root unless the first step opens something itself
    if not any(s["action"] == "open" for s in flat):
        driver.open(None)
    try:
        for s in flat:
            a = s["action"]
            # a driver that predates the form-scoped helpers keeps the pass-1 behaviour: a bare Create/Save/Delete is a named click
            if a == "submit_form" and not hasattr(driver, "find_submit"):
                s, a = dict(s, action="click", name=s["verb"].title()), "click"
            elif a == "delete_own" and not hasattr(driver, "delete_with_confirm"):
                s, a = dict(s, action="click", name=s["verb"].title()), "click"
            mk = driver.net_mark() if "step_windows" in ev else None
            om = ob0 = None
            if want_obs and getattr(driver, "obs_mark", None):
                om, ob0 = driver.obs_mark(), driver.snapshot()
            try:
                if a == "noop":
                    rec(s, True, s.get("note") or "no-op")
                elif a == "observe":
                    observed.append(s)
                    rec(s, True, "observation moved to the expected side as %r (%s)" % ((s.get("clause") or "")[:80],
                                                                                         "machine-checkable kind" if s.get("machine") else "no machine check: NEEDS_HUMAN for this part"),
                        provenance=s.get("provenance"))
                elif a == "constraint":
                    k = s.get("kind")
                    if k == "forbid_key":
                        forbid_keys.add(s["key"])
                    elif k == "forbid_click_repeat":
                        forbid_repeat.add(_norm(s["name"]))
                    elif k == "forbid_write_verbs":
                        forbid_verbs.update(s.get("verbs") or [])
                    rec(s, True, "constraint %s: %s" % ("enforced" if k != "recorded" else "recorded only (no machine assertion)", s.get("text")))
                elif a == "conditional":
                    rec(s, True, "conditional recorded, not run: %s" % s.get("text"))
                elif a == "wait":
                    _sleep(float(s.get("seconds") or 0))
                    rec(s, True, "waited %ss%s" % (s.get("seconds"), " (capped)" if s.get("capped") else ""))
                elif a == "wait_for":
                    got = False
                    for _ in range(20):
                        sn = driver.snapshot()
                        if _text_present(sn, s["text"]):
                            got = True
                            break
                        _sleep(0.5)
                    if not got:
                        raise _NotFound("text %r did not appear within 10 s" % s["text"])
                    rec(s, True, "waited for %r" % s["text"])
                elif a == "open":
                    driver.open(s.get("target"))
                    rec(s, True, "opened %s" % (s.get("target") or "the lens root"))
                elif a == "reload":
                    driver.reload()
                    ev["reloaded"] = True
                    snr = driver.snapshot()
                    ev["after_reload"] = {"texts": list(snr.get("durable") or snr.get("texts") or []), "names": [c["name"] for c in snr.get("controls") or [] if c.get("name")]}
                    rec(s, True, "reloaded")
                elif a in _P.NEW_ACTIONS:
                    rec(s, True, _P.execute(a, s, driver, ev, {"allow_write": bool(wr.get("allow_write")) and not wr.get("admin") and not wr.get("write_skip"),
                                                               "send_key": send_key, "forbid_keys": forbid_keys}))
                elif a == "set_viewport":
                    cap("set_viewport")(s["w"], s["h"])
                    ev["viewport"] = (s["w"], s["h"])
                    rec(s, True, "viewport set to %dx%d (%s)" % (s["w"], s["h"], s.get("name")))
                elif a == "set_scheme":
                    cap("set_scheme")(s["scheme"])
                    rec(s, True, "colour scheme emulated: %s" % s["scheme"])
                elif a == "check_overflow":
                    ev["overflow"] = cap("measure_overflow")()
                    _fl = getattr(driver, "measure_layout", None)
                    if _fl:
                        ev["layout"] = _V2.analyze_layout(_fl())
                    fn_t = getattr(driver, "measure_targets", None)
                    if fn_t:
                        ev["targets"] = fn_t()
                    rec(s, True, "overflow measured: %s" % ev["overflow"])
                elif a == "check_contrast":
                    ev["contrast"] = cap("measure_contrast")()
                    rec(s, True, "contrast measured: %s" % ev["contrast"])
                elif a == "check_console":
                    ev["console_errors"] = cap("console_errors")()
                    rec(s, True, "console errors so far: %s" % ev["console_errors"])
                elif a == "check_network":
                    net = cap("net_summary")()
                    ev["net_statuses"], ev["net_writes"] = net.get("statuses"), net.get("writes")
                    rec(s, True, "network ledger read: %d error response(s), %d write call(s)" % (len(net.get("statuses") or []), len(net.get("writes") or [])))
                elif a == "check_ax":
                    r = cap("ax_check")(s.get("scope"))
                    ev["ax_unnamed"], ev["ax_total"] = r.get("unnamed"), r.get("total")
                    rec(s, True, "accessibility tree: %s unnamed of %s interactive control(s)%s" % (r.get("unnamed"), r.get("total"), (" in %r" % s["scope"]) if s.get("scope") else ""))
                elif a in ("tab_sweep", "tab_to"):
                    if "Tab" in forbid_keys:
                        raise _Refused("constraint violated: the ticket says 'do not Tab first' but this step starts with Tab")
                    if a == "tab_sweep":
                        tr = cap("tab_sweep")(MAX_TAB_STOPS, bool(s.get("from_top")))
                        ok = True
                    else:
                        ok, tr = cap("tab_to")(s["name"], MAX_TAB_STOPS)
                    ev["tab_trace"] = list(tr or [])
                    ev["keys_sent"] += ["Tab"] * len(tr or [])
                    forbid_keys.clear()
                    if not ok:
                        raise _NotFound("Tab did not reach %r within %d stops (trace: %s)" % (s.get("name"), MAX_TAB_STOPS, (tr or [])[:6]))
                    rec(s, True, "Tab swept %d stop(s): %s" % (len(tr or []), (tr or [])[:6]))
                elif a == "focus_name":
                    if not cap("focus_name")(s["name"]):
                        raise _NotFound("no control matching %r to focus on the live page" % s["name"])
                    ev.setdefault("focus_trace", []).append(s["name"])
                    rec(s, True, "focused %r" % s["name"])
                elif a == "walk_tabs":
                    names = [x for x in (cap("tab_names")() or []) if x and is_tab_safe(x)][:8]
                    if not names:
                        raise _NotFound("no safe sub-tab visible to walk")
                    done = [n for n in names if driver.click(n, role="tab")]
                    rec(s, True, "walked %d of %d safe tab(s): %s" % (len(done), len(names), done[:8]))
                elif a == "export_check":
                    r = cap("export_check")(s.get("formats") or [])
                    ev["export"] = r
                    if r.get("verdict") in ("NO_CONTROL", "NO_FILE"):
                        raise _NotFound("export: %s" % (r.get("note") or r.get("verdict")))
                    rec(s, True, "export checked: %s (bytes=%s parsed=%s rows=%s)" % (r.get("verdict"), r.get("bytes"), r.get("parsed"), r.get("rows")))
                elif a == "chat_ask":
                    if not (wr.get("allow_write") and not wr.get("admin") and not wr.get("write_skip")):
                        raise _Refused("chat send needs --allow-write on a non-admin, non-write-skip lens (a send is a labelled, budgeted write)")
                    r = cap("chat_ask")(s.get("question"))
                    ev["chat"] = r
                    if not r.get("sent"):
                        raise _NotFound("chat: %s" % (r.get("note") or "no composer / budget exhausted"))
                    rec(s, True, "chat question sent; reply=%s" % bool(r.get("reply")))
                elif a == "press":
                    n = int(s.get("count") or 1)
                    if s.get("trace") and not ev.get("focus_trace"):
                        fn0 = getattr(driver, "focused_name", None)
                        ev.setdefault("focus_trace", [])
                        if fn0:
                            ev["focus_trace"].append(fn0())
                    for _ in range(n):
                        send_key(s["key"])
                        if s.get("trace"):
                            fn = getattr(driver, "focused_name", None)
                            ev.setdefault("focus_trace", []).append(fn() if fn else None)
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
                    if _norm(nm) in forbid_repeat and click_counts.get(_norm(nm)):
                        raise _Refused("constraint violated: the ticket says not to click %r a second time" % nm)
                    vv = [v for v in forbid_verbs if re.search(r"(?i)\b%s" % re.escape(v), nm)]
                    if vv:
                        raise _Refused("constraint violated: the ticket says do not %s, but this step clicks %r" % ("/".join(sorted(forbid_verbs)), nm))
                    kind = "read"
                    pc_before = 0
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
                        _pc = getattr(driver, "popup_count", None)
                        pc_before = _pc() if _pc else 0
                        hit = driver.click(nm, role="tab" if a == "open_tab" else None)
                    res = getattr(driver, "last_resolution", None)
                    if not hit:
                        raise _NotFound(_L.describe(res) if res and res.get("status") in (_L.AMBIGUOUS, _L.ABSENT) else "no control matching %r on the live page" % nm)
                    if s.get("exact") and isinstance(hit, str) and _norm(hit) != _norm(nm) and not (res and res.get("status") == _L.ALIAS):
                        raise _NotFound("control %r matched only loosely (%r); a multi-word label must match exactly" % (nm, hit))
                    click_counts[_norm(nm)] = click_counts.get(_norm(nm), 0) + 1
                    if kind == "create" and wr.get("allow_write") and CREATE_OPENER.search(nm) and not re.match(r"(?i)^\s*(?:save|submit|apply|confirm|ok|done|update|rename)\b", nm):
                        st["form_open"] = True
                    if pc_before and is_close_safe(nm):
                        ev["popups_before"], ev["closer"] = pc_before, nm
                        ev["popups_after"] = driver.popup_count()
                    st["opener"] = hit if isinstance(hit, str) else nm
                    rec(s, True, "clicked %r (matched %r)%s" % (nm, hit if isinstance(hit, str) else nm, "" if kind == "read" else " [write: %s on own fixture]" % kind),
                        resolution=dict(res) if res else None)
                elif a == "type_value":
                    why = _W.field_refusal(s["name"])
                    if why:
                        raise _Refused(why)
                    write_ok("typing the test value into %r" % s["name"])
                    if not (st.get("form_open") or created or live_labels()):
                        raise _Refused("typed value refused: field %r is not on a form the walker opened in this ticket (no create opener clicked) or on its own fixture" % s["name"])
                    label_base = "%s-s%d" % (wr.get("label_base") or "qa-walker-replay", s["n"])
                    val = _W.build_value(s["specs"][0], label_base)
                    if not cap("type_value")(s["name"], val):
                        raise _NotFound("no field matching %r on the live page" % s["name"])
                    s["_typed"] = val
                    ev["typed_values"].append(val[:80])
                    if label_base in val:
                        register_label(label_base, "typed own label value into %r" % s["name"])
                    rec(s, True, "typed %r (%d chars) into %r%s" % (val[:80], len(val), s["name"], (" [value %d of %d]" % (s["fan"], s["fan_of"])) if s.get("fan") else ""),
                        typed=val[:80], typed_len=len(val))
                elif a == "fill_label":
                    write_ok("filling the form")
                    if not st.get("form_open"):
                        raise _Refused("fill refused: no create form was opened by this ticket, so the label would not go on a walker fixture")
                    label = "%s-s%d" % (wr.get("label_base") or "qa-walker-replay", s["n"])
                    got = cap("fill_label_field")(label, [x["name"] for x in flat if x.get("action") == "type_value"])
                    if not got:
                        raise _NotFound("no empty name/title field in the open form to hold the walker's own label")
                    register_label(label, "typed own label into %r" % got)
                    rec(s, True, "typed own labelled fixture value %r into %r (not submitted by this step)" % (label, got))
                elif a == "submit_form":
                    write_ok("submitting a form")
                    if not created:
                        if not st.get("form_open"):
                            raise _Refused("submit refused: no create form was opened by this ticket")
                        label = "%s-s%d" % (wr.get("label_base") or "qa-walker-replay", s["n"])
                        got = cap("fill_label_field")(label, [x["name"] for x in flat if x.get("action") == "type_value"])
                        if not got:
                            raise _Refused("submit refused: no own labelled qa-walker value could be entered in this form, so it would not act on a walker fixture")
                        register_label(label, "auto-labelled own fixture in %r before submit" % got)
                    nm = cap("find_submit")(s["verb"])
                    if not nm:
                        raise _NotFound("no single enabled %r control in the open form" % s["verb"])
                    ok, why, kind = write_step_decision(nm, admin=wr.get("admin", False), write_skip=wr.get("write_skip", False),
                                                        allow_write=True, fixture_labels=live_labels())
                    if not ok:
                        raise _Refused(why)
                    if kind != "create":
                        raise _Refused("submit control %r is not a plain create/save action" % nm)
                    s["_submit"] = True
                    if not driver.click(nm):
                        raise _NotFound("submit control %r could not be clicked" % nm)
                    ev["submitted"] = True
                    for l in created:
                        if l not in created_clicked:
                            created_clicked.add(l)
                            if wr.get("on_fixture"):
                                wr["on_fixture"](l, "create_clicked", "repro-steps replay: %s" % ticket.get("id"))
                    rec(s, True, "submitted the form via %r (own fixture %s)" % (nm, created[-1] if created else "-"))
                elif a == "delete_own":
                    write_ok("delete")
                    labels = [l for l in live_labels() if l and l not in gone]
                    if not labels:
                        raise _Refused("delete refused: no fixture created by this walker in this run to target (a delete is never run on anything not own-labelled)")
                    r = None
                    for l in reversed(labels):
                        r = cap("delete_with_confirm")(l)
                        if r and r.get("hit"):
                            gone.add(l)
                            break
                    if not r or not r.get("hit"):
                        raise _Refused("delete refused: no delete control scoped to an own fixture row")
                    ev["confirm_seen"], ev["confirm_row_present"] = bool(r.get("confirm")), r.get("row_present")
                    rec(s, True, "deleted own fixture %r via %r; confirm shown before removal=%s, row present until confirmed=%s, removed=%s" % (
                        l, r.get("hit"), r.get("confirm"), r.get("row_present"), r.get("removed")))
                elif a == "open_first":
                    labels = [l for l in live_labels() if l]
                    hit = driver.click(labels[-1]) if labels else cap("click_first")(s["thing"])
                    if not hit:
                        raise _NotFound("no own fixture and no first %r row/card on the live page to open (read-only first-of-role open)" % s["thing"])
                    st["opener"] = hit if isinstance(hit, str) else labels[-1] if labels else s["thing"]
                    rec(s, True, "opened %s %r (generic target %r)" % ("own fixture" if labels else "first-of-role", hit if isinstance(hit, str) else "", s["thing"]))
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
                if a in _SETTLE_ACTIONS and getattr(driver, "settle", None):
                    driver.settle()          # in-flight writes/renders after this step land BEFORE its net window closes and the snapshot is taken
                if om is not None:
                    od = driver.obs_since(om)
                    ev["obs"].append(_O.window_from(ob0, driver.snapshot(), od.get("console_new"), od.get("net"), n=s["n"]))
                if mk is not None:
                    ev["step_windows"].append({"n": s["n"], "action": a, "writes": driver.net_since(mk), "typed": s.get("_typed"), "submit": bool(s.get("_submit"))})
            except (_Refused, _NotFound) as e:
                rec(s, False, str(e))
                for rest in flat[s["n"]:]:
                    rec(rest, False, "not run: step %d.%d did not execute" % (s["step"], s["sub"]))
                out["notes"] = "step %d mapped but not executed: %s" % (s["step"], e)
                if "needs --allow-write" in str(e):
                    out["notes"] = "step %d is a write step: write step needs --allow-write (%s)" % (s["step"], e)
                out["evidence"] = [driver.screenshot("repro-stopped")]
                return out
        _gather(driver, ev, ticket, [o.get("clause") for o in observed], console_base)
        snap = dict(driver.snapshot())
        base_ev = {}
        fn_ev = getattr(driver, "evidence", None)
        if fn_ev:
            base_ev = dict(fn_ev() or {})
        base_ev.update(ev)
        snap["evidence"] = base_ev
    finally:
        _cleanup(driver, created, wr, ticket, out, gone)
    chk = check_expected(ticket.get("expected"), snap, extra=[o.get("clause") for o in observed])
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


def _gather(driver, ev, ticket, extra_clauses, console_base):
    """Read-only measurements the clauses need and the ticket's own steps did not produce (auto-gathered evidence:
    console/page errors in THIS run, net ledger, AX names, contrast, tap targets). A driver without the capability
    leaves the key unset, so the clause stays `unchecked`."""
    kinds = set()
    for c in _X.split_clauses(ticket.get("expected")) + [e for e in extra_clauses if e]:
        for sp in (_X.classify_clause(c, _check_legacy) or []):
            kinds.add(sp["kind"])
    cb = getattr(driver, "console_errors", None)
    if cb and console_base is not None:
        try:
            ev["console_new"] = max(0, cb() - console_base)
        except Exception:
            pass
    jobs = []
    if "ax_names" in kinds and "ax_unnamed" not in ev:
        jobs.append(("ax_check", lambda f: ev.update(zip(("ax_unnamed", "ax_total"), (lambda r: (r.get("unnamed"), r.get("total")))(f(None))))))
    if "g_layout_clean" in kinds and "layout" not in ev:
        jobs.append(("measure_layout", lambda f: ev.update(layout=_V2.analyze_layout(f()))))
    if "contrast" in kinds and "contrast" not in ev:
        jobs.append(("measure_contrast", lambda f: ev.update(contrast=f())))
    if "target_size" in kinds and "targets" not in ev:
        jobs.append(("measure_targets", lambda f: ev.update(targets=f())))
    if kinds & {"net_class", "net_status"} and "net_statuses" not in ev:
        jobs.append(("net_summary", lambda f: (lambda n: ev.update(net_statuses=n.get("statuses"), net_writes=n.get("writes")))(f())))
    for name, run in jobs:
        fn = getattr(driver, name, None)
        if fn:
            try:
                run(fn)
            except Exception:
                pass


def _cleanup(driver, created, wr, ticket, out, gone=()):
    """Every own fixture this ticket created is deleted (row-scoped to its label) or recorded as a leftover."""
    if not created:
        return
    res = {}
    for label in created:
        if label in gone:
            res[label] = "deleted"
            if wr.get("on_fixture"):
                wr["on_fixture"](label, "deleted", "repro-steps replay %s: deleted by the ticket's own delete step" % ticket.get("id"))
            continue
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


_Refused = _P.Refused
_NotFound = _P.NotFound


# --------------------------------------------------------------- Playwright adapter
_INTERACTIVE = ("button", "link", "tab", "menuitem", "checkbox", "switch", "radio", "option", "row", "treeitem",
                "textbox", "searchbox", "combobox", "spinbutton", "listitem", "cell", "gridcell", "heading")
_FIELD_ROLES = ("textbox", "searchbox", "combobox", "spinbutton")


_ACTIONABLE = ("button", "link", "tab", "menuitem", "menuitemradio", "menuitemcheckbox", "checkbox", "switch", "radio", "option",
               "treeitem", "combobox", "textbox", "searchbox", "spinbutton")



_GENERIC_SUBMIT_VERBS = ("submit", "save", "ok", "done", "apply", "confirm", "create", "add", "post")


def settle_loop(inflight, sleep, now, *, quiet_ms=180, max_ms=2500, step_ms=50):
    """Pure settle logic (no browser): wait until `inflight()` has been 0 for `quiet_ms` straight, bounded by `max_ms`.
    -> (settled, waited_ms). Never loops past the bound, so a page that polls forever cannot hang a replay."""
    t0 = now()
    quiet_since = None
    while True:
        t = now()
        waited = (t - t0) * 1000.0
        if inflight() == 0:
            quiet_since = t if quiet_since is None else quiet_since
            if (t - quiet_since) * 1000.0 >= quiet_ms:
                return True, waited
        else:
            quiet_since = None
        if waited >= max_ms:
            return False, waited
        sleep(step_ms / 1000.0)


_SETTLE_ACTIONS = {"click", "submit_form", "delete_own", "fill", "type_value", "press", "open_first"}


def pick_submit(buttons, verb):
    """Pure submit discovery over [(name, disabled)]: the ONE enabled button whose name starts with `verb`; for a generic verb
    ('submit', 'save', ...) any single enabled create/save-like button (the ticket says 'submit', the button reads 'Create').
    None when there are 0 or 2+ distinct candidates."""
    v = (verb or "").strip().lower()
    live = [(n, d) for n, d in buttons if n and not d]
    cands = [n for n, _ in live if re.match(r"(?i)^\s*" + re.escape(v) + r"\b", n)]
    if not cands:
        cands = [n for n, _ in live if CREATE_SUBMIT.search(n) and (v in n.lower() or v in _GENERIC_SUBMIT_VERBS)]
    names = list(dict.fromkeys(cands))
    return names[0] if len(names) == 1 else None


def alert_texts(ax):
    """Text of live alert/status regions. Such a region usually has NO accessible name of its own (name-from-author only):
    its message is in the StaticText children, so fall back to those."""
    out = []
    for n in ax.live():
        if n.role not in ("alert", "status"):
            continue
        t = n.name or " ".join(d.name for d in ax.descendants(n) if d.role in ("StaticText", "text") and d.name and not d.ignored)
        if t and t.strip():
            out.append(t.strip())
    return out


class PlaywrightDriver:
    """Adapts a LensWalk's page + CDP session. Requires a browser, so it is exercised on the
    walker box (selftest/test_replay_playwright.py skips where playwright is absent).

    Name resolution (labels.resolve): a ticket's control name is resolved against the LIVE accessible
    names by exact -> alias -> token rules; 2+ candidates = ambiguous = not clicked; every resolution is
    left in `last_resolution` and written into the step record. Controls inside an open menu/dialog are
    resolved first (nested submenu items such as Export > JSON)."""

    def __init__(self, lw, ctx, page, cdp, lens_url):
        self.lw, self.ctx, self.page, self.cdp, self.lens_url = lw, ctx, page, cdp, lens_url
        self._base = lw.cfg["base_url"].rstrip("/")
        self.last_resolution = None
        self.chat_budget = None
        self._scheme = None
        self._writes = []
        self._inflight = 0
        try:
            page.on("request", lambda r: setattr(self, "_inflight", self._inflight + 1))
            page.on("requestfinished", lambda r: setattr(self, "_inflight", max(0, self._inflight - 1)))
            page.on("requestfailed", lambda r: setattr(self, "_inflight", max(0, self._inflight - 1)))
        except Exception:
            pass
        self._resp = []
        try:
            page.on("response", self._on_resp)
        except Exception:
            pass
        try:
            page.on("request", lambda r: self._writes.append("%s %s" % (r.method, r.url.split("?")[0][-80:]))
                    if r.method in ("POST", "PUT", "PATCH", "DELETE") and "/api/" in r.url else None)
        except Exception:
            pass

    # ---- pre-capture capabilities (precap.py / observe.py / netcheck.py)
    _MAX_RESP = 400

    def _on_resp(self, r):
        """Record every /api/ response: method, templated path, status and (JSON only) the SHAPE of the body - never values."""
        try:
            if "/api/" not in r.url:
                return
            from urllib.parse import urlparse
            from . import netledger as _N, netcheck as _NC
            req = r.request
            row = {"method": req.method, "path": _N.template_path(urlparse(r.url).path), "raw_path": urlparse(r.url).path, "status": r.status, "t": time.monotonic()}
            if "json" in ((r.headers or {}).get("content-type") or "") and int((r.headers or {}).get("content-length") or 0) < 200000:
                try:
                    body = r.json()
                    row["shape"] = _NC.shape_of(body)
                    row["ids"] = sorted(_NC.ids_of(body))
                    row["leaf"] = sorted(_NC.leaf_hashes(body))
                except Exception:
                    pass
            self._resp.append(row)
            if len(self._resp) > self._MAX_RESP:
                del self._resp[:100]
        except Exception:
            pass

    def platform(self):
        try:
            return "darwin" if "Mac" in (self.page.evaluate("navigator.platform") or "") else "linux"
        except Exception:
            return "linux"

    def obs_mark(self):
        return (len(self.lw.console_errors) + len(self.lw.page_errors), len(self._resp), len(self._writes))

    def obs_since(self, mark):
        ce = (self.lw.console_errors + self.lw.page_errors)[mark[0]:]
        return {"console_new": list(ce), "net": [dict(x) for x in self._resp[mark[1]:] if x]}

    def resp_since(self, mark):
        return [dict(x) for x in self._resp[mark[1]:]]

    def set_reduced_motion(self, on):
        self.page.emulate_media(reduced_motion="reduce" if on else "no-preference", **({"color_scheme": self._scheme} if self._scheme else {}))

    def set_offline(self, offline):
        self.ctx.set_offline(bool(offline))

    def set_zoom(self, z):
        self.page.evaluate("z => { document.documentElement.style.zoom = String(z); }", float(z))

    def page_scheme(self):
        return self.page.evaluate("() => { const d = document.documentElement; const bg = getComputedStyle(document.body).backgroundColor; return (d.getAttribute('data-theme') || d.className || '') + '|' + bg; }")

    def nav_away_back(self):
        self.page.goto(self._base + "/", wait_until="domcontentloaded")
        self.page.goto(self.lens_url, wait_until="domcontentloaded")
        try:
            self.page.wait_for_load_state("networkidle", timeout=4000)
        except Exception:
            pass

    def active_item(self):
        """The active/selected item of the focused widget: aria-selected / aria-current / roving tabindex, else the focused name."""
        return self.page.evaluate("""() => { const a = document.activeElement; if (!a) return null;
          const d = (e) => (e && ((e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 60))) || null;
          const sel = a.closest('[role=tablist],[role=listbox],[role=menu],[role=grid],[role=radiogroup],[role=toolbar]');
          if (sel) { const s = sel.querySelector('[aria-selected=true],[aria-current=true],[aria-checked=true]'); if (s) return d(s) + '#sel'; }
          return d(a) + '#focus'; }""")

    def measure_layout(self):
        return self.page.evaluate("""() => { const vw = innerWidth, vh = innerHeight; const de = document.documentElement;
          const clipped = [], textOverflow = [];
          for (const e of document.querySelectorAll('body *')) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
            let anc = e.parentElement, scrolled = false; while (anc && anc !== document.body) { const o = getComputedStyle(anc).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') { scrolled = true; break; } anc = anc.parentElement; }
            if (!scrolled && (r.right > vw + 2 || r.left < -2) && clipped.length < 8) clipped.push({sel: e.tagName.toLowerCase() + (e.id ? '#' + e.id : ''), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width)});
            if (e.children.length === 0 && e.scrollWidth > e.clientWidth + 2 && cs.overflowX === 'visible' && e.textContent.trim() && textOverflow.length < 8) textOverflow.push(e.tagName.toLowerCase() + ':' + e.textContent.trim().slice(0, 30)); }
          return {vw, vh, scrollW: de.scrollWidth, bodyScrollW: document.body.scrollWidth, clipped, textOverflow}; }""")

    def obs_state(self):
        """Extra generic readings the base snapshot lacks: a visible loading indicator."""
        return self.page.evaluate("""() => { const q = (s) => Array.from(document.querySelectorAll(s)).filter(e => { const r = e.getBoundingClientRect(); return r.width && r.height; });
          return {spinner: q('[role=progressbar],[aria-busy=true],.animate-spin,[class*=spinner],[class*=skeleton]').length > 0}; }""")

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

    def _resolve_node(self, name, role=None):
        """-> (node|None, resolution). Open menu/dialog contents first, then the whole page; actionable roles first."""
        ax = self.cdp.ax()
        want = (lambda n: n.role == role) if role else (lambda n: n.role in _ACTIONABLE)
        pools = []
        pops = [d for p in ax.popups() for d in ax.descendants(p) if d.name and want(d)]
        if pops:
            pools.append((pops, "+open-menu"))
        pools.append(([n for n in ax.live() if n.name and want(n)], ""))
        if not role:
            pools.append(([n for n in ax.live() if n.name and n.role in _INTERACTIVE], "+any-role"))
        res = None
        for pool, tag in pools:
            res = _L.resolve(name, [n.name for n in pool])
            if res["status"] != _L.ABSENT:
                res["rule"] = (res["rule"] or "") + tag
                if res["status"] in (_L.EXACT, _L.ALIAS, _L.TOKEN):
                    node = next(n for n in pool if n.name == res["label"])
                    return node, res
                return None, res  # ambiguous: never fall through to a looser pool
        return None, res

    _CONTAINER_ROLES = ("dialog", "alertdialog", "menu", "menubar", "listbox", "toolbar", "region", "navigation", "form",
                        "group", "tabpanel", "tablist", "list", "grid", "table", "complementary", "main", "banner", "search")

    def _resolve_container(self, name):
        """-> (node|None, resolution|None). Container/landmark roles only, same label rules; closed menus/dialogs are
        simply absent from the live AX tree, so they resolve ABSENT (never opened implicitly)."""
        ax = self.cdp.ax()
        pool = [n for n in ax.live() if n.name and n.role in self._CONTAINER_ROLES]
        res = _L.resolve(name, [n.name for n in pool])
        if res["status"] in (_L.EXACT, _L.ALIAS, _L.TOKEN):
            return next(n for n in pool if n.name == res["label"]), res
        return None, res

    def click(self, name, role=None):
        node, res = self._resolve_node(name, role)
        self.last_resolution = res
        if node is None or node.backend is None:
            return None
        return node.name if self.cdp.click(node.backend) else None

    def focus_name(self, name):
        node, res = self._resolve_node(name)
        self.last_resolution = res
        return bool(node and node.backend is not None and self.cdp.focus(node.backend))

    def focused_name(self):
        # Chromium also marks the RootWebArea focused (and lists it first): take the deepest focused
        # node and never report the document itself as the focused control.
        n = self.cdp.ax().focused()
        if n is None or n.role in ("RootWebArea", "WebArea") or not (n.name or "").strip():
            return None
        return n.name

    def tab_sweep(self, max_stops, from_top=False):
        if from_top:
            self.reload()       # a reload puts focus back at the top of the document
        trace = []
        for _ in range(max_stops):
            self.page.keyboard.press("Tab")
            nm = self.focused_name()
            if nm and trace and nm == trace[0] and len(trace) > 1:
                break
            trace.append(nm)
        return trace

    def tab_to(self, name, max_stops):
        self.reload()
        trace = []
        for _ in range(max_stops):
            self.page.keyboard.press("Tab")
            nm = self.focused_name()
            trace.append(nm)
            if nm and _L.resolve(name, [nm])["status"] in (_L.EXACT, _L.ALIAS, _L.TOKEN):
                return True, trace
        return False, trace

    def set_viewport(self, w, h):
        self.page.set_viewport_size({"width": int(w), "height": int(h)})
        try:
            self.page.wait_for_load_state("networkidle", timeout=4000)
        except Exception:
            pass

    def set_scheme(self, scheme):
        if scheme == "toggle":
            if self._scheme is None:
                raise _NotFound("'toggle theme' needs a known current scheme; the walker only emulates an explicit dark/light")
            scheme = "light" if self._scheme == "dark" else "dark"
        self.page.emulate_media(color_scheme=scheme)
        self._scheme = scheme

    def measure_overflow(self):
        from .checks import scroll_container_backends, _ancestor_backends
        vw = (self.page.viewport_size or {}).get("width") or 0
        lm = self.cdp.layout_metrics()
        eff = max(lm["content_w"] or 0, lm["viewport_w"] or 0)
        snap, off = self.cdp.snapshot(), 0
        scrollers = scroll_container_backends(snap)
        for n in self.cdp.ax().by_role("tab", "button"):
            b = self.cdp.box(n.backend) if n.backend and not n.disabled else None
            if b and (b[0] + b[2] > vw + 2 or b[0] < -2) and not (_ancestor_backends(snap, n.backend) & scrollers):
                off += 1
        return {"viewport_w": vw, "overflow_px": max(0, round(eff - vw)), "offscreen": off}

    def measure_targets(self):
        sizes = []
        for n in self.cdp.ax().by_role("tab", "button", "link", "checkbox", "switch"):
            b = self.cdp.box(n.backend) if n.backend and not n.disabled else None
            if b:
                sizes.append(min(b[2], b[3]))
        return {"checked": len(sizes), "min_px": round(min(sizes), 1) if sizes else None}

    def measure_contrast(self):
        from .checks import contrast_from_snapshot
        vp = self.page.viewport_size or {"width": 1280, "height": 900}
        res = contrast_from_snapshot(self.cdp.snapshot(), self.lw.th, [vp["width"], vp["height"]])
        return {"checked": res["checked"], "fails": len(res["failing_groups"]), "threshold": self.lw.th["contrast_normal"]}

    def console_errors(self):
        return len(self.lw.console_errors) + len(self.lw.page_errors)

    def net_summary(self):
        return {"statuses": [s for s, _ in self.lw.bad_responses], "writes": list(self._writes)}

    def ax_check(self, scope=None):
        ax = self.cdp.ax()
        pool = [n for n in ax.nodes if n.role in ("button", "link", "textbox", "checkbox", "combobox", "tab", "menuitem", "switch", "radio") and not n.ignored]
        if scope:
            node, res = self._resolve_container(scope)
            if node is None and res["status"] == _L.ABSENT:
                node, res = self._resolve_node(scope)   # fall back to actionable resolution
            self.last_resolution = res
            if node is None:
                raise _NotFound(_L.describe(res))
            inside = {d.id for d in ax.descendants(node)} | {node.id}
            pool = [n for n in pool if n.id in inside]
        return {"unnamed": sum(1 for n in pool if not (n.name or "").strip()), "total": len(pool)}

    def evidence(self):
        return {"console_errors": self.console_errors(), "net_statuses": [s for s, _ in self.lw.bad_responses], "net_writes": list(self._writes)}

    def export_check(self, formats):
        """The walker's own export check, on the control the step names: click Export, pick the format from the
        opened menu when there is one, save the download, validate it (non-empty, parses, has rows)."""
        import os
        from . import safety
        node, res = self._resolve_node("Export", None)
        self.last_resolution = res
        if node is None:
            return {"verdict": "NO_CONTROL", "ok": False, "note": _L.describe(res)}
        before = {p.backend for p in self.cdp.ax().popups()}
        dl = self.lw._try_download(self.page, lambda: self.cdp.click(node.backend), 6000)
        if not dl:
            got = self.lw._popup_new(self.cdp, before, node.backend)
            if got:
                ax2, pop = got
                scope = ax2.descendants(pop) if pop else ax2.live()
                opts = [d for d in scope if d.role in ("menuitem", "button", "option", "link", "menuitemradio") and d.backend and not d.disabled
                        and d.backend != node.backend and safety.is_menu_format_safe(d.name)]
                want = [f.lower() for f in (formats or [])]
                pick = [d for d in opts if not want or any(w in d.name.lower() for w in want)]
                if len(pick) == 1 or (pick and not want):
                    dl = self.lw._try_download(self.page, lambda: self.cdp.click(pick[0].backend), 8000)
                elif len(pick) > 1:
                    return {"verdict": "NO_FILE", "ok": False, "note": "ambiguous format options: %s" % [d.name for d in pick[:4]]}
        if not dl:
            return {"verdict": "NO_FILE", "ok": False, "note": "no download started"}
        fpath = os.path.join(self.lw.ev, "walker-export-" + re.sub(r"[^\w.-]", "_", dl.suggested_filename)[:60])
        dl.save_as(fpath)
        verdict, note, content = self.lw._validate_export(fpath)
        rows = re.search(r"(\d+) rows", note or "")
        return {"verdict": verdict, "ok": verdict == "PASS" and content != "wrong", "bytes": os.path.getsize(fpath),
                "parsed": verdict in ("PASS", "EMPTY"), "rows": int(rows.group(1)) if rows else None, "note": note, "file": os.path.basename(fpath)}

    def chat_ask(self, question):
        """One budgeted chat send through the walker's chat helpers (chatcheck). Needs the Reverifier's budget."""
        from .chatcheck import _composer, _message_texts, pick_reply, REPLY_TIMEOUT_S
        from .cdp import wait_until
        lens = self.lw.slug
        if self.chat_budget is None or not self.chat_budget.allow(lens):
            return {"sent": False, "note": "no chat send budget for this lens"}
        comp = _composer(self.cdp)
        if not comp:
            return {"sent": False, "note": "no chat composer on the page"}
        text = "[%s-replay] %s" % (self.lw.cfg["fixture_prefix"], (question or "What is this lens for?")[:200])
        before = _message_texts(self.cdp)
        if not self.cdp.click(comp.backend):
            return {"sent": False, "note": "composer not clickable"}
        self.page.keyboard.type(text, delay=20)
        self.chat_budget.spend(lens)
        self.page.keyboard.press("Enter")
        reply, _dt = wait_until(lambda: pick_reply(before, _message_texts(self.cdp), text), timeout=REPLY_TIMEOUT_S)
        return {"sent": True, "reply": bool(reply)}

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

    # ---- ULW pass 2: per-step net window, popups, typed values, create/fill/submit, delete-with-confirm, first-of-role
    _LIST_ROLES = ("list", "listbox", "grid", "table", "treegrid", "tree", "feed", "rowgroup")
    _ITEM_ROLES = ("listitem", "row", "gridcell", "cell", "treeitem", "option", "article")

    def settle(self, max_ms=2500):
        """Bounded wait for the step's in-flight requests to finish plus a short DOM-settle, so an async list render
        (fetch(POST).then(render)) is in the DOM before the snapshot / delete-row lookup."""
        try:
            self.page.wait_for_timeout(60)       # let a just-clicked handler issue its request
            return settle_loop(lambda: self._inflight, lambda sec: self.page.wait_for_timeout(int(sec * 1000)), time.monotonic, max_ms=max_ms)
        except Exception:
            return False, 0

    def net_mark(self):
        return len(self._writes)

    def net_since(self, mark):
        return list(self._writes[mark:])

    def popup_count(self):
        return len(self.cdp.ax().popups())

    def focus_in_popup(self):
        """True when keyboard focus sits inside an open dialog/menu (Tab did not leak out of it)."""
        ax = self.cdp.ax()
        f = ax.focused()
        if f is None or f.role in ("RootWebArea", "WebArea"):
            return False
        for p in ax.popups():
            if f.id == p.id or ax.is_inside(f, p):
                return True
        return False

    def type_value(self, name, value):
        """Type the ticket's literal into the field `name` (own-form policy is enforced by the executor, not here).
        An empty value clears the field. False when no matching text field is on the page."""
        ax = self.cdp.ax()
        nodes = [n for n in ax.live() if n.role in _FIELD_ROLES and n.name]
        hit = fuzzy_match(name, [n.name for n in nodes])
        if not hit:
            return False
        node = next(n for n in nodes if n.name == hit)
        if node.backend is None or not self.cdp.focus(node.backend):
            return False
        self.page.keyboard.press("Control+A")
        if value == "":
            self.page.keyboard.press("Backspace")
        else:
            self.page.keyboard.insert_text(value) if len(value) > 80 else self.page.keyboard.type(value)
        return True

    _LABELISH = re.compile(r"(?i)\b(name|title|label|subject|summary|topic|heading)\b")

    def _form_scope(self, ax):
        """Nodes of the open dialog when there is one, else the whole live tree."""
        dlg = ax.dialogs()
        return ax.descendants(dlg[-1]) if dlg else ax.live()

    def fill_label_field(self, label, avoid=()):
        """Type the walker's own label into ONE empty name/title-like field of the open form (never a field the ticket
        itself typed a test value into). Falls back to any other empty text field. Returns the field name or None."""
        ax = self.cdp.ax()
        pool = [n for n in self._form_scope(ax) if n.role in ("textbox", "searchbox") and n.name and n.backend is not None and not n.disabled]
        avoid_n = [a for a in avoid if a]
        pool = [n for n in pool if not any(fuzzy_match(a, [n.name]) for a in avoid_n) and not (n.value or "").strip()]
        pick = next((n for n in pool if self._LABELISH.search(n.name)), None) or (pool[0] if len(pool) == 1 else None)
        if pick is None or FIELD_NEVER_RX.search(pick.name):
            return None
        if not self.cdp.focus(pick.backend):
            return None
        self.page.keyboard.press("Control+A")
        self.page.keyboard.type(label)
        return pick.name

    def find_submit(self, verb):
        """The ONE enabled create/save control in the open dialog (else on the page) matching `verb`; None when 0 or 2+."""
        ax = self.cdp.ax()
        return pick_submit([(n.name, n.disabled) for n in self._form_scope(ax) if n.role == "button" and n.name], verb)

    def delete_with_confirm(self, label):
        """Click Delete/Remove/Trash scoped to the row of own fixture `label`, observe whether a confirm (in-page dialog or native
        confirm()) appears BEFORE the row is gone, then confirm it. -> {hit, confirm, row_present, removed}."""
        from .safety import CONFIRM_DELETE
        prior = getattr(self.lw, "dialog_mode", None)
        n_native = len(getattr(self.lw, "native_dialogs", []) or [])
        try:
            self.lw.dialog_mode = "dismiss"          # a native confirm() is observed, answered 'cancel': nothing is removed yet
            hit = self.click_in_row("Delete", label) or self.click_in_row("Remove", label) or self.click_in_row("Trash", label)
            if not hit:
                return {"hit": None}
            self.page.wait_for_timeout(700)
            ax = self.cdp.ax()
            native = len(getattr(self.lw, "native_dialogs", []) or []) > n_native
            in_page = [d for d in ax.dialogs()] + [p for p in ax.popups() if p.role in ("dialog", "alertdialog")]
            confirm = bool(native or in_page)
            row_present = any(label in (n.name or "") for n in ax.live())
            removed = False
            if native:
                self.lw.dialog_mode = "accept"       # replay the click so the (now accepted) native confirm completes the delete
                self.click_in_row("Delete", label) or self.click_in_row("Remove", label) or self.click_in_row("Trash", label)
                self.page.wait_for_timeout(700)
            elif in_page:
                btn = next((d for p in in_page for d in ax.descendants(p) if d.role == "button" and d.backend and CONFIRM_DELETE.search(d.name or "")), None)
                if btn:
                    self.cdp.click(btn.backend)
                    self.page.wait_for_timeout(700)
            removed = not any(label in (n.name or "") for n in self.cdp.ax().live())
            return {"hit": hit, "confirm": confirm, "row_present": row_present, "removed": removed}
        finally:
            if prior is not None:
                self.lw.dialog_mode = prior

    _FIRST_ROLES = ("row", "listitem", "treeitem", "option", "gridcell", "article")

    def click_first(self, thing):
        """Read-only first-of-role open: the first visible row/list item/card whose accessible name passes the click policy
        (never HARD_DENY / payment words) and, when `thing` names a noun, prefers one whose name contains it."""
        ax = self.cdp.ax()
        cands = [n for n in ax.live() if n.role in self._FIRST_ROLES and n.name and n.backend is not None and not n.disabled
                 and not HARD_DENY.search(n.name) and not SWEEP_PAYMENT.search(n.name)]
        word = (thing or "").split()[-1].lower() if thing else ""
        pick = next((n for n in cands if word and word in n.name.lower()), None) or (cands[0] if cands else None)
        if pick is None:
            return None
        return pick.name if self.cdp.click(pick.backend) else None

    def snapshot(self):
        ax = self.cdp.ax()
        ctl = [{"name": n.name, "role": n.role, "enabled": not n.disabled, "focused": n.focused, "props": dict(n.props)}
               for n in ax.live() if n.name and n.role in _INTERACTIVE]
        lists = [n for n in ax.live() if n.role in self._LIST_ROLES]
        items = []
        for ln in lists:
            items += [d.name for d in ax.descendants(ln) if d.role in self._ITEM_ROLES and d.name]
            items += [d.name for d in ax.descendants(ln) if d.role in ("StaticText", "text", "link", "heading") and d.name]
        items += [n.name for n in ax.live() if n.role in self._ITEM_ROLES and n.name]
        return {"controls": ctl, "texts": ax.texts(), "durable": ax.durable_texts(), "dialogs": [n.name or "dialog" for n in ax.dialogs()],
                "alerts": alert_texts(ax),
                "list_items": list(dict.fromkeys(items)),
                "errors": len(self.lw.page_errors) + len(self.lw.console_errors), "url": self.page.url,
                **({"spinner": self.obs_state().get("spinner")} if getattr(self, "_obs_on", False) else {})}

    def screenshot(self, name):
        return self.lw.shot(self.page, name)

    def close(self):
        self.lw._close(self.ctx)
