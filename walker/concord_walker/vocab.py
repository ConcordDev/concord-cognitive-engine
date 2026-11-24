"""Walker-vocabulary bridge (mapper-vocab, items 1 + 3 + guard/meta of 2).

Testers wrote shorthand that names the walker's OWN standard checks ("DevTools 390x844", "Tab from
top", "Export JSON/CSV", "Dark theme", "with the Console open", "Ask '...'"). map_part() routes ONE
segment of a step to those checks and returns a list of sub-step dicts, or a (None, reason) pair, or
NOT_MINE when the segment is not walker vocabulary (the generic mapper then tries it).

Honesty:
  * No write verb, no typed boundary value, no create/save/submit recipe is added here (out of scope).
  * Lighthouse / performance audits are NOT a walker check -> unmapped with a NEEDS_HUMAN reason.
  * An observation ("look for X") becomes an `observe` sub-step carrying the `clause` it moves to the
    expected side (with provenance); if no machine check can read it, the clause is `unchecked`, so the
    ticket is NEEDS_HUMAN for that part - the step itself is still mapped and its other parts still run.
  * A guard ("do not Tab first") becomes a `constraint` the executor ENFORCES where checkable.
"""
import re

NOT_MINE = object()
MOBILE = (390, 844)
DESKTOP = (1280, 900)
MAX_WAIT_S = 60
MAX_TAB_STOPS = 40
MAX_REPEAT_TARGETS = 8

_VP_DIM = re.compile(r"(?i)\b(\d{3,4})\s*[x×]\s*(\d{3,4})\b")
_LIGHTHOUSE = re.compile(r"(?i)lighthouse|\bperformance (?:audit|panel|tab|trace)\b|web vitals|\btransfer size\b|\brequest count\b|domcontentloaded|\bheap\b|\bwaterfall\b")
_DEVTOOLS = re.compile(r"(?i)\b(?:with\s+)?(?:the\s+)?(?:chrome\s+)?devtools(?:\s+(?:console|network|issues|device (?:mode|toolbar)))?\b|\bdevice (?:mode|toolbar)\b")
_CONSOLE = re.compile(r"(?i)\bconsole\b")
_NETWORK = re.compile(r"(?i)\bnetwork(?:\s+(?:tab|log|panel|ledger))?\b")
_AXTREE = re.compile(r"(?i)\b(?:a11y|accessibility)\s+(?:tree|pane)\b")
_THEME = re.compile(r"(?i)\b(dark|light)\s+(?:theme|mode)\b|\btheme\s+toggle\b|\btoggle\s+(?:the\s+)?theme\b|\bswitch\s+(?:to\s+)?(?:the\s+)?(dark|light)\b")
_TABFROM = re.compile(r"(?i)^tab\s+(?:from|at)\s+(?:the\s+)?top(?:\s+of\s+(?:the\s+)?page)?(?:\s+to\s+(?:the\s+)?(?P<to>.+))?$")
_TABTHRU = re.compile(r"(?i)^(?:press\s+)?tab\s+(?:repeatedly\s+)?through\s+(?:the\s+)?(?P<what>.+)$")
_TABTO = re.compile(r"(?i)^(?:then\s+)?tab\s+to\s+(?:the\s+)?(?P<name>.+)$")
_ARROW = r"(?:arrow\s*)?(?:left|right|up|down)"
_ARROWS_ON = re.compile(r"(?i)^(?:press\s+)?(?P<keys>arrow\s*(?:left|right|up|down)(?:\s*(?:/|,|and|then)\s*(?:arrow\s*)?(?:left|right|up|down))*)\s+on\s+(?:the\s+)?(?P<name>.+)$")
_FOCUS_THEN = re.compile(r"(?i)^focus\s+(?:the\s+)?(?P<name>.+?)\s+and\s+press\s+(?P<keys>arrow\s*(?:left|right|up|down)(?:\s*(?:/|,|and)\s*(?:arrow\s*)?(?:left|right|up|down))*)$")
_FOCUS = re.compile(r"(?i)^focus\s+(?:on\s+)?(?:the\s+)?(?P<name>.+)$")
_ESC_OPEN = re.compile(r"(?i)^(?:press|hit)\s+(?:the\s+)?esc(?:ape)?(?:\s+(?:once|twice))?\s*(?:\((?P<g1>[^)]*)\)|\s+(?:while|with|when)\s+(?:the\s+)?(?P<w>dialog|menu|popover|drawer|modal|panel)s?\s+(?:is\s+)?open(?:\s*\((?P<g2>[^)]*)\))?)$")
_EXPORT = re.compile(r"(?i)\bexport\b|\.dtu\b|\bdownload\b")
_FORMAT = re.compile(r"(?i)\b(json|csv|\.?dtu|pdf|xlsx|txt|ics)\b")
_CHAT = re.compile(r"(?i)^(?:(?:lens\s+tools|chat|kay)\s*(?:>|→)\s*)?(?:(?:use|open|click)\s+)?(?:lens\s+)?(?:ask(?:\s+(?:about\s+[A-Za-z0-9 \-]+?)(?=\s*(?:,|$|[\"'‘“:]))|\s*:)?|send(?:\s+(?:question|prompt|message))?)(?P<rest>(?:\b|\s|:|[\"'‘“]).*|)$")
_QUOTE = re.compile(r"[\"'‘“](?P<q>[^\"'’”]{2,200})[\"'’”]")
_OBSERVE = re.compile(r"(?i)^(?:and\s+|then\s+|also\s+)?(?P<v>look(?:\s+for)?|inspect|observe|check(?:\s+whether|\s+that)?|record|identify|find|count|confirm|verify|read|note|compare|notice|watch|scroll|hover|walk|measure|expect)\b\s*(?P<rest>.*)$")
_GUARD_NOT = re.compile(r"(?i)^(?:do not|don'?t|never)\s+(?P<what>.+)$")
_GUARD_IF = re.compile(r"(?i)^if\b\s*(?P<cond>.+)$")
_WAIT = re.compile(r"(?i)^wait(?:\s*[-:]\s*for)?\b\s*(?P<rest>.*)$")
_REPEAT = re.compile(r"(?i)^repeat\b\s*(?P<rest>.*)$")


def _viewport(w, h):
    return {"action": "set_viewport", "w": w, "h": h, "name": "mobile" if w <= 430 else "desktop"}


def _title_case_label(x):
    return bool(x) and x[0].isupper()


def _keys_from(text):
    out = []
    for tok in re.split(r"(?i)\s*(?:/|,|\band\b|\bthen\b)\s*", text):
        t = re.sub(r"(?i)^arrow\s*", "", tok.strip())
        if not t:
            continue
        d = {"left": "ArrowLeft", "right": "ArrowRight", "up": "ArrowUp", "down": "ArrowDown"}.get(t.lower())
        if not d:
            return None
        out.append(d)
    return out


def map_part(seg, raw, lens_names, prev=None):
    """-> list[sub-step] | (None, reason) | NOT_MINE.  `raw` is the original segment text for the record."""
    s = seg.strip().rstrip(".").strip()
    if not s:
        return []
    low = s.lower()

    # ---- unsupported tooling: stay NEEDS_HUMAN, say why
    if _LIGHTHOUSE.search(s):
        return None, "Lighthouse / performance audit is not a walker check - NEEDS_HUMAN (no walker check covers it)"

    # ---- guard / meta
    if re.fullmatch(r"(?i)(?:then\s+)?(?:click|press|do it|try)\s+again", s):
        return [{"action": "repeat_prev", "times": 1, "raw": raw}]
    m = _GUARD_NOT.match(s)
    if m:
        return _constraint(m.group("what"), raw)
    m = re.match(r"(?i)^(?:without)\s+(?P<what>(?:clicking|pressing|submitting|navigating|using)\b.+)$", s)
    if m:
        return _constraint(m.group("what"), raw)
    m = _GUARD_IF.match(s)
    if m:
        return [{"action": "conditional", "text": s, "asserted": False, "note": "conditional guard recorded; its branch is not run unless mapped separately", "raw": raw}]
    m = _WAIT.match(s)
    if m:
        return _wait(m.group("rest"), raw)
    m = _REPEAT.match(s)
    if m:
        return _repeat(m.group("rest"), raw)

    m = re.match(r"(?i)^(?:a\s+)?hard\s+(?:reload|refresh)\b(?P<rest>.*)$", s)
    if m:
        rest = re.sub(r"[^a-z0-9]", "", m.group("rest").lower())
        if not rest or rest in lens_names or re.fullmatch(r"(?i)\s*with the cache disabled\s*", m.group("rest")):
            return [{"action": "reload", "raw": raw}]
    # ---- viewport / layout / theme
    vp = _VP_DIM.search(s)
    if vp or re.search(r"(?i)\b(mobile|desktop)\b", s) or _DEVTOOLS.search(s) and vp:
        r = _viewport_part(s, raw, lens_names)
        if r is not NOT_MINE:
            return r
    m = re.match(r"(?i)^(?:then\s+)?(?:restore|set|switch)\s+(?:the\s+)?(?:theme\s+)?(?:to\s+)?(dark|light)(?:\s+via\s+(?:dark|light))?$|^toggle\s+(?:the\s+)?theme\s+from\s+(?:dark|light)\s+to\s+(dark|light)$|^set\s+theme\s+to\s+(dark|light)$", s)
    if m:
        sc = next(g for g in m.groups() if g).lower()
        return [{"action": "set_scheme", "scheme": sc, "raw": raw}]
    m = _THEME.search(s)
    left = re.sub(r"(?i)\b(?:view|set|switch|to|the|open|in|toggle|theme|mode|dark|light|and|then|check|contrast|a|with|on|from|of)\b|[^a-z]+", " ", s).split() if m else ["x"]
    if m and not left:
        scheme = (m.group(1) or m.group(2) or "").lower() or "toggle"
        subs = [{"action": "set_scheme", "scheme": scheme, "raw": raw}]
        if re.search(r"(?i)contrast", s):
            subs.append({"action": "check_contrast", "raw": raw})
        return subs
    if re.fullmatch(r"(?i)(?:check\s+)?contrast", s):
        return [{"action": "check_contrast", "raw": raw}]

    # ---- console / network / a11y
    if re.fullmatch(r"(?i)(?:chrome\s+)?devtools(?:\s+issues(?:\s+panel)?)?(?:\s+on\s+/lenses/[a-z0-9\-/]+)?", s):
        pm = re.search(r"(?i)(/lenses/[a-z0-9\-/]+)", s)
        acts = ([{"action": "open", "target": pm.group(1), "raw": raw}] if pm else []) + ([{"action": "check_console", "raw": raw}] if re.search(r"(?i)issues", s) else [{"action": "noop", "note": "DevTools framing (nothing to run)", "raw": raw}])
        return acts
    if _CONSOLE.search(s) or _NETWORK.search(s) or _AXTREE.search(s):
        r = _tooling_part(s, raw, lens_names)
        if r is not NOT_MINE:
            return r

    # ---- keyboard prose
    r = _keyboard_part(s, raw)
    if r is not NOT_MINE:
        return r

    # ---- export
    r = _export_part(s, raw)
    if r is not NOT_MINE:
        return r

    # ---- chat ask
    m = _CHAT.match(s)
    if m and not re.search(r"(?i)\bask\s+(?:a\s+)?(?:friend|admin|support)\b", s):
        q = _QUOTE.search(m.group("rest") or "")
        return [{"action": "chat_ask", "question": q.group("q").strip() if q else None, "raw": raw}]

    # ---- observation split
    m = _OBSERVE.match(s)
    if m:
        return _observe(m, s, raw)
    return NOT_MINE


# ---------------------------------------------------------------------------------------- parts
def _constraint(what, raw):
    w = what.strip().rstrip(".")
    m = re.match(r"(?i)^(?:press\s+)?(tab|shift\+tab|escape|esc|enter)\b(?:\s+(?:first|before|yet|until))?", w)
    if m:
        key = {"tab": "Tab", "shift+tab": "Shift+Tab", "escape": "Escape", "esc": "Escape", "enter": "Enter"}[m.group(1).lower()]
        return [{"action": "constraint", "kind": "forbid_key", "key": key, "text": "do not " + w, "raw": raw}]
    m = re.match(r"(?i)^(?:click|press|activate|use)\s+(?:the\s+)?(?:a\s+)?(?:separate\s+)?(?P<n>[A-Za-z][A-Za-z0-9 \-]{0,30}?)(?:\s+(?:a\s+second\s+time|twice|again|more than once))\s*$", w)
    if m:
        return [{"action": "constraint", "kind": "forbid_click_repeat", "name": m.group("n").strip(), "text": "do not " + w, "raw": raw}]
    m = re.match(r"(?i)^(create|delete|submit|save|post|file|add|remove)(?:\s+or\s+(create|delete|submit|save|post|file|add|remove))?\b", w)
    if m:
        verbs = [v.lower() for v in m.groups() if v]
        return [{"action": "constraint", "kind": "forbid_write_verbs", "verbs": verbs, "text": "do not " + w, "raw": raw}]
    return [{"action": "constraint", "kind": "recorded", "asserted": False, "text": "do not " + w,
             "note": "constraint recorded; no machine assertion exists for it (the replay is read-only by policy)", "raw": raw}]


def _wait(rest, raw):
    r = rest.strip().strip(",.")
    m = re.match(r"(?i)^~?\s*(\d+(?:\.\d+)?)\s*(ms|s|sec|secs|seconds?|m|min|minutes?)?\b(?P<tail>.*)$", r)
    if m:
        if m.group("tail").strip(" ,."):
            return None, "wait has trailing text that is not part of the duration (%r)" % m.group("tail").strip()[:40]
        n = float(m.group(1))
        u = (m.group(2) or "s").lower()
        secs = n / 1000 if u == "ms" else n * 60 if u.startswith("m") and u != "ms" else n
        return [{"action": "wait", "seconds": min(secs, MAX_WAIT_S), "capped": secs > MAX_WAIT_S, "raw": raw}]
    if not r:
        return [{"action": "wait", "seconds": 1.0, "raw": raw}]
    m = re.match(r"(?i)^for\s+(?:the\s+)?(?:" + _QUOTE.pattern + r"|(?P<t>[A-Z][A-Za-z0-9'&.\- ]{1,40}))$", r)
    if m:
        t = (m.group("q") or m.group("t") or "").strip()
        if t:
            return [{"action": "wait_for", "text": t, "raw": raw}]
    if re.match(r"(?i)^(?:for\s+)?(?:the\s+)?(?:page\s+)?(?:to\s+)?(?:settle|load|finish loading|idle)$", r):
        return [{"action": "wait", "seconds": 2.0, "raw": raw}]
    m = re.match(r"(?i)^without\s+(?P<w>.+)$", r)
    if m:
        c = _constraint(m.group("w"), raw)
        if c and c[0].get("kind") != "recorded":
            return [{"action": "wait", "seconds": 1.0, "raw": raw}] + c
    return None, "wait target %r is not a duration or a named text" % r[:50]


def _repeat(rest, raw):
    r = rest.strip().strip(",.")
    if not r or re.fullmatch(r"(?i)(?:once|again|once more|one more time|twice)", r):
        return [{"action": "repeat_prev", "times": 2 if r.lower() == "twice" else 1, "raw": raw}]
    m = re.match(r"(?i)^(?:for|with|on)\s+(?P<list>.+)$", r)
    if m:
        items = [x.strip(" .") for x in re.split(r"\s*(?:,|/|\band\b)\s*", m.group("list")) if x.strip(" .")]
        items = [x for x in items if x]
        if 1 <= len(items) <= MAX_REPEAT_TARGETS and all(_title_case_label(x) and len(x.split()) <= 4 and not re.search(r"[()\[\]{}:;?!]", x) for x in items):
            return [{"action": "repeat_for", "targets": items, "raw": raw}]
        return None, "repeat list is not a bounded list of control names (%r)" % r[:50]
    return None, "repeat names no bounded targets (%r)" % r[:50]


def _viewport_part(s, raw, lens_names):
    vp = _VP_DIM.search(s)
    subs = []
    if vp:
        w, h = int(vp.group(1)), int(vp.group(2))
        if (w, h) == (390, 844) or w <= 430:
            subs += [_viewport(w, h), {"action": "check_overflow", "raw": raw}]
        else:
            subs += [_viewport(w, h)]
        rest = (s[:vp.start()] + " " + s[vp.end():])
    elif re.search(r"(?i)\bmobile\b", s):
        subs += [_viewport(*MOBILE), {"action": "check_overflow", "raw": raw}]
        rest = re.sub(r"(?i)\bmobile\b", " ", s)
    elif re.search(r"(?i)\bdesktop\b", s):
        subs += [_viewport(*DESKTOP)]
        rest = re.sub(r"(?i)\bdesktop\b", " ", s)
    else:
        return NOT_MINE
    # whatever remains must be pure framing ("DevTools", "Set viewport", "Device Toolbar", "at", "on /lenses/x", "open <this lens>")
    rest = re.sub(r"(?i)\b(?:set|use|switch to|emulate|resize(?: the)? (?:viewport|window)? to|open(?: the)?|at|on|in|with|chrome|devtools|dev tools|device (?:mode|toolbar)|viewport|view|size|mobile|desktop|main qa account|navigation|top|and|responsive|iphone \d+(?: pro| max| plus)?|device|resize|resize to|dimensions|1280|100%|no throttling|in chrome|mode|in desktop mode|scrolls?|\d+|\+|to|at)\b", " ", rest)
    rest = re.sub(r"(?i)/lenses/[a-z0-9\-/]+|https?://\S+|[():,;]", " ", rest)
    rest = re.sub(r"\s+", " ", rest).strip(" .+")
    if not rest:
        return subs
    if re.fullmatch(r"(?i)(?:walk|switch|scroll|click|open)\s+(?:the\s+)?tabs?|walk tabs|switch tabs|scroll tabs|\+?\s*\d scrolls?", rest) or re.fullmatch(r"(?i)top\s*\+\s*\d scrolls?", rest):
        if re.search(r"(?i)tab", rest):
            subs.append({"action": "walk_tabs", "raw": raw})
            return subs
        return None, "unmapped remainder %r after the viewport phrase" % rest[:40]
    if re.sub(r"[^a-z0-9]", "", rest.lower()) in lens_names:
        return subs
    return None, "unmapped remainder %r after the viewport phrase" % rest[:40]


def _tooling_part(s, raw, lens_names):
    acts = []
    if _AXTREE.search(s):
        nm = re.search(r"(?i)\b(?:on|of|for|in)\s+(?:the\s+)?(?P<n>[A-Z][A-Za-z0-9'&.\- ]{1,30}?)(?:\s+(?:in|with|and|to)\b|$)", s)
        inspect_in = re.search(r"(?i)\binspect\s+(?P<n>.+?)\s+in\s+(?:the\s+)?(?:a11y|accessibility)", s)
        name = (nm.group("n").strip() if nm else None) or (inspect_in.group("n").strip() if inspect_in else None)
        acts.append({"action": "check_ax", "scope": name, "raw": raw})
        return acts
    if _CONSOLE.search(s) or _NETWORK.search(s):
        if re.search(r"(?i)\bhard\s+reload\b|\breload\b|\brefresh\b", s):
            acts.append({"action": "reload", "raw": raw})
        else:
            pm = re.search(r"(?i)(/lenses/[a-z0-9\-/]+)", s)
            if pm:
                acts.append({"action": "open", "target": pm.group(1), "raw": raw})
        if _CONSOLE.search(s):
            acts.append({"action": "check_console", "raw": raw})
        if _NETWORK.search(s):
            acts.append({"action": "check_network", "raw": raw})
        tail = re.sub(r"(?i)/lenses/[a-z0-9\-/]+", " ", s)
        tail = re.sub(r"(?i)\b(?:open|load|reload|hard|refresh|with|the|browser|devtools|dev tools|console|network|and|tab|log|panel|check|watch|for|errors?|any|on|in|cors|issues|lens|page|is|ledger|chrome|cache|disabled|then)\b", " ", tail)
        tail = re.sub(r"[^A-Za-z0-9]+", " ", tail).strip()
        if tail:
            return None, "unmapped remainder %r next to the console/network check (the walker records errors and statuses only)" % tail[:50]
        return acts
    return NOT_MINE


def _keyboard_part(s, raw):
    m = _ESC_OPEN.match(s)
    if m:
        g = (m.group("g1") or m.group("g2") or "").strip()
        subs = []
        if g:
            c = re.match(r"(?i)^(?:do not|don'?t)\s+(?P<w>.+)$", g)
            if c:
                subs += _constraint(c.group("w"), raw)
        subs.append({"action": "press", "key": "Escape", "count": 2 if re.search(r"(?i)twice", s) else 1, "raw": raw})
        return subs
    m = re.match(r"(?i)^(?:press\s+)?(?:left|right|up|down)(?:\s*/\s*(?:left|right|up|down))+$", s)
    if m:
        ks = _keys_from(s.split(None, 1)[1] if s.lower().startswith("press") else s)
        if ks:
            return [{"action": "press", "key": k, "count": 1, "raw": raw, "trace": True} for k in ks]
    m = re.match(r"(?i)^(?:press\s+)?tab\s*x\s*(\d+)(?:\s+from\s+(?:load|the top|top))$", s)
    if m and int(m.group(1)) <= 25:
        return [{"action": "press", "key": "Tab", "count": int(m.group(1)), "raw": raw}]
    if re.fullmatch(r"(?i)from\s+(?:the\s+)?(?:page\s+)?top\s*,?\s*(?:press\s+)?tab", s):
        return [{"action": "tab_sweep", "from_top": True, "raw": raw}]
    m = _TABFROM.match(s)
    if m:
        subs = [{"action": "tab_sweep", "from_top": True, "to": (m.group("to") or None), "raw": raw}]
        return subs
    if re.fullmatch(r"(?i)(?:press\s+)?tab\s+repeatedly", s):
        return [{"action": "tab_sweep", "from_top": False, "raw": raw}]
    m = _TABTHRU.match(s)
    if m:
        return [{"action": "tab_sweep", "from_top": False, "what": m.group("what").strip(), "raw": raw}]
    if re.fullmatch(r"(?i)tab\s+(?:through|order)(?:\s+.+)?|tab through page", s):
        return [{"action": "tab_sweep", "from_top": False, "raw": raw}]
    m = _FOCUS_THEN.match(s)
    if m:
        ks = _keys_from(m.group("keys"))
        if ks:
            return [{"action": "focus_name", "name": m.group("name").strip(), "raw": raw}] + [{"action": "press", "key": k, "count": 1, "raw": raw, "trace": True} for k in ks]
    m = _ARROWS_ON.match(s)
    if m:
        ks = _keys_from(m.group("keys"))
        if ks:
            return [{"action": "focus_name", "name": m.group("name").strip(), "raw": raw}] + [{"action": "press", "key": k, "count": 1, "raw": raw, "trace": True} for k in ks]
    m = re.match(r"(?i)^tab\s+to\s+(?:the\s+)?(?P<name>[^.]+?)\.\s*(?:press\s+)?(?P<keys>arrow\s*(?:left|right|up|down)(?:\s*(?:/|,|and)\s*(?:arrow\s*)?(?:left|right|up|down))*)$", s)
    if m:
        ks = _keys_from(m.group("keys"))
        if ks:
            return [{"action": "tab_to", "name": m.group("name").strip(), "raw": raw}] + [{"action": "press", "key": k, "count": 1, "raw": raw, "trace": True} for k in ks]
    m = _TABTO.match(s)
    if m and not re.search(r"(?i)tabs?\s*(?:list)?$", m.group("name")):
        nm = m.group("name").strip()
        if len(nm.split()) <= 5 and not re.search(r"[,;:()]", nm):
            return [{"action": "tab_to", "name": nm, "raw": raw}]
    m = _FOCUS.match(s)
    if m:
        nm = m.group("name").strip()
        if re.fullmatch(r"(?i)(?:this\s+|the\s+)?(?:lens|page)", nm):
            return [{"action": "noop", "note": "already on the lens", "raw": raw}]
        if re.fullmatch(r"(?i)(?:the\s+)?tab\s*list", nm):
            return [{"action": "focus_tab_list", "raw": raw}]
        if len(nm.split()) <= 4 and not re.search(r"[,;:()]", nm) and not re.match(r"(?i)^(?:an?|any|each|every|some|first|one|another|that|this)\b", nm):
            return [{"action": "focus_name", "name": nm, "raw": raw}]
        return None, "focus target %r names no specific control" % nm[:40]
    return NOT_MINE


_EXPORT_WORDS = {"export", "as", "json", "csv", "dtu", "and", "or", "the", "header", "lens", "use", "open", "click", "menu", "button", "control",
                 "then", "choose", "pick", "select", "a", "an", "try", "so", "are", "is", "visible", "both", "separately", "to", "file"}


def _export_part(s, raw):
    if re.fullmatch(r"(?i)\.?(?:json|csv|dtu)(?:\s*(?:/|,|and|or)\s*\.?(?:json|csv|dtu))*", s.strip()):
        return [{"action": "export_check", "formats": list(dict.fromkeys(x.lower().lstrip(".") for x in _FORMAT.findall(s))), "raw": raw}]
    if not (_EXPORT.search(s) or _FORMAT.search(s)):
        return NOT_MINE
    core = re.sub(r"\([^)]*\)", " ", s)
    core = re.sub(r"(?i)\s+(?:with|after|on|for|from)\b.*$", " ", core)
    core = re.sub(r"(?i)/lenses/\S+|\.dtu\b", lambda m: " dtu " if m.group(0).lower() == ".dtu" else " ", core)
    toks = re.findall(r"[a-z]+", core.lower())
    if not toks or any(t not in _EXPORT_WORDS for t in toks):
        return NOT_MINE
    fm = list(dict.fromkeys(x.lower().lstrip(".") for x in _FORMAT.findall(core)))
    if re.search(r"(?i)\b(?:esc|escape|tab|focus)\b", s):
        return NOT_MINE
    # a bare "open/click Export" is a plain control click (it may start "Export, Esc" or "Export > JSON"); the mapper
    # collapses a TERMINAL click on Export into the export check afterwards. Formats / "use Export" / .dtu are explicit.
    if fm or re.match(r"(?i)^use\b|.*\bdownload\b", s.strip()) or "dtu" in toks:
        return [{"action": "export_check", "formats": fm, "raw": raw}]
    if re.fullmatch(r"(?i)(?:the\s+)?(?:lens\s+|header\s+)+export(?:\s+(?:menu|control|button))?", s.strip()):
        return [{"action": "export_check", "formats": fm, "raw": raw}]
    return NOT_MINE


def _observe(m, s, raw):
    verb, rest = m.group("v").lower().strip(), (m.group("rest") or "").strip().strip(".")
    veto = None if verb.startswith(("look", "inspect", "observe", "record", "identify", "find")) else re.search(
        r"(?i)(?:^|[,;]\s*|\band\s+)(click|press|type|enter|delete|create|save|submit|add|rename|send)\b", rest)
    if veto:
        return None, "an observation segment that also names an action (%s) - not run as a bare observation" % veto.group(1)
    clause, kind_hint = None, None
    ml = re.match(r"(?i)^(?:for\s+)?(?:an?\s+|the\s+|any\s+)?(?P<names>[A-Za-z][A-Za-z0-9 \-]{1,24}(?:\s*(?:/|,|\bor\b|\band\b)\s*[A-Za-z][A-Za-z0-9 \-]{1,24}){0,5}?)(?:\s+(?:control|button|action|icon|link)s?)?(?:\s+(?:on|in|for|after|beside|at)\b.*)?$", rest)
    if verb.startswith(("look", "find", "identify")) and ml:
        names = [n.strip() for n in re.split(r"\s*(?:/|,|\bor\b|\band\b)\s*", ml.group("names")) if n.strip()]
        names = [re.sub(r"(?i)^(?:an?|the|any)\s+", "", n) for n in names]
        if names and all(len(n.split()) <= 3 for n in names):
            clause = "has a control matching: " + " | ".join(names)
    return [{"action": "observe", "verb": verb, "text": s, "clause": clause or s,
             "machine": clause is not None, "provenance": "moved from repro step to the expected side: %r" % raw[:100], "raw": raw}]
