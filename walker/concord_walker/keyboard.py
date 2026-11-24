"""Keyboard actions (precapture item 1): combos, platform-aware Mod, Tab order, arrow navigation,
Enter-to-submit. Pure parsing + pure checks; the driver does the I/O.

Honesty rules:
  * an unknown key name is UNMAPPED with a reason - it is never guessed;
  * a shortcut whose key or surrounding text names delete / publish / share / pay / admin is REFUSED
    (the same refusal vocabulary as safety.py / writevocab.py - a key press can destroy data too);
  * every check that cannot be evaluated (no focus trace, no active-item reader, no net window) raises
    NotFound -> the replay stays NEEDS_HUMAN/UNVERIFIED, never PASS.
"""
import re

MAX_COUNT = 60
MAX_TABS = 60

_NAMED = {
    "esc": "Escape", "escape": "Escape", "enter": "Enter", "return": "Enter", "tab": "Tab", "space": "Space", "spacebar": "Space",
    "home": "Home", "end": "End", "pageup": "PageUp", "pagedown": "PageDown", "pgup": "PageUp", "pgdn": "PageDown",
    "backspace": "Backspace", "delete": "Delete", "del": "Delete", "insert": "Insert",
    "up": "ArrowUp", "down": "ArrowDown", "left": "ArrowLeft", "right": "ArrowRight",
    "arrowup": "ArrowUp", "arrowdown": "ArrowDown", "arrowleft": "ArrowLeft", "arrowright": "ArrowRight",
    "uparrow": "ArrowUp", "downarrow": "ArrowDown", "leftarrow": "ArrowLeft", "rightarrow": "ArrowRight",
}
_MODS = {"ctrl": "Control", "control": "Control", "shift": "Shift", "alt": "Alt", "option": "Alt", "opt": "Alt",
         "meta": "Meta", "cmd": "Meta", "command": "Meta", "win": "Meta", "super": "Meta"}
_PUNCT = {"/", ".", ",", ";", "'", "[", "]", "\\", "-", "=", "`", "?", "\\"}
_FKEY = re.compile(r"^f(?:[1-9]|1[0-2])$")
# a key whose own effect is destructive, or a shortcut described as doing one of these, is refused
_REFUSED_KEYS = {"Delete"}
_REFUSED_WORDS = re.compile(r"(?i)\b(delet\w*|remov\w*|trash|publish\w*|share|pay\w*|purchase|buy|checkout|withdraw\w*|transfer|admin\w*|revoke|wipe|destroy|drop|reset|sign\s*out|log\s*out)\b")

_COMBO_TOK = r"(?:ctrl|control|shift|alt|option|opt|meta|cmd|command|mod|win|super)"


def mod_for(platform):
    """Platform-aware 'Mod': Meta on macOS, Control elsewhere."""
    return "Meta" if (platform or "").lower() in ("darwin", "mac", "macos", "osx") else "Control"


def parse_key(tok):
    """'Esc' -> 'Escape', 'A' -> 'A', '/' -> '/', 'F5' -> 'F5'; unknown -> None (never guessed)."""
    t = (tok or "").strip()
    if not t:
        return None
    low = re.sub(r"[\s_\-]+", "", t.lower())
    if low in _NAMED:
        return _NAMED[low]
    if _FKEY.match(low):
        return low.upper()
    if len(t) == 1 and (t.isalnum() or t in _PUNCT):
        return t.upper() if t.isalpha() else t
    return None


def resolve(keys, platform):
    """'Mod+K' -> 'Meta+K' on macOS, 'Control+K' elsewhere (resolved at EXECUTION from the browser's platform)."""
    return re.sub(r"(?<![A-Za-z])Mod(?=\+)", mod_for(platform), keys)


def parse_combo(text, platform=None):
    """'Cmd/Ctrl+K' | 'Mod+K' | 'Ctrl+Shift+P' | 'Shift+Tab' | 'Ctrl+/' -> {key, mods, keys, mod_used, text} or None.
    'Cmd/Ctrl' (either-modifier prose) and 'Mod' resolve to the platform's modifier."""
    s = re.sub(r"\s+", "", (text or "").strip().rstrip(".,;"))
    if not s:
        return None
    s = re.sub(r"(?i)(cmd|command|meta)/(ctrl|control)|(ctrl|control)/(cmd|command|meta)", "mod", s)
    parts = [p for p in s.split("+") if p != ""] if not s.endswith("++") else [p for p in s[:-2].split("+") if p] + ["+"]
    if s.endswith("+") and not s.endswith("++") and len(parts) >= 1:   # 'Ctrl+' alone is not a combo
        return None
    if not parts:
        return None
    key = parse_key(parts[-1]) if parts[-1].lower() not in ("mod",) + tuple(_MODS) else None
    mods, mod_used = [], False
    for p in parts[:-1]:
        pl = p.lower()
        if pl == "mod":
            mods.append(mod_for(platform) if platform else "Mod")
            mod_used = True
        elif pl in _MODS:
            mods.append(_MODS[pl])
        else:
            return None
    if key is None:
        return None
    mods = list(dict.fromkeys(mods))
    return {"key": key, "mods": mods, "keys": "+".join(mods + [key]), "mod_used": mod_used, "text": text.strip()}


def refusal(combo, context=""):
    """-> reason string when the shortcut must be refused, else None."""
    if combo is None:
        return "no key"
    if combo["key"] in _REFUSED_KEYS:
        return "refused: %s is a destructive key (delete) - the walker never presses it" % combo["key"]
    m = _REFUSED_WORDS.search(context or "")
    if m:
        return "refused: shortcut described as %r (delete/publish/share/pay/admin stay look-only)" % m.group(1)
    return None


_KEY_WORDS = re.compile(r"(?i)^(?:(?:press|hit|try|use|then)\s+)+(?:the\s+)?(?P<k>.+?)(?:\s+key)?\s*$")
_COMBO_SHAPE = re.compile(r"(?i)^(?:" + _COMBO_TOK + r"(?:/" + _COMBO_TOK + r")?\+)+\S+$|^mod\+\S+$")
_TABN = re.compile(r"(?i)^(?:press\s+|hit\s+)?tab\s*(?:x\s*|×\s*)?(?P<n>\d{1,3})\s*(?:x|×|times)?(?P<fresh>\s+(?:from|at)\s+(?:a\s+|the\s+)?(?:top|load|fresh load|page load|start)(?:\s+of\s+(?:the\s+)?page)?)?$")
_SHIFTTABN = re.compile(r"(?i)^(?:press\s+)?shift\s*\+\s*tab\s*(?:x\s*|×\s*)?(?P<n>\d{1,3})\s*(?:x|×|times)?$")
_ARROW_ENTER_ON = re.compile(r"(?i)^(?:press\s+)?(?P<keys>(?:arrow\s*)?(?:left|right|up|down)(?:\s*(?:/|,|and|then)\s*(?:(?:arrow\s*)?(?:left|right|up|down)|enter|space|home|end))*)\s+on\s+(?:the\s+)?(?P<name>[A-Za-z0-9][^,;.]{0,40})$")
_ENTER_SUBMIT = re.compile(r"(?i)^(?:press|hit)\s+enter\s+(?:in|inside|on|within)\s+(?:the\s+)?(?:a\s+)?(?P<what>[^,;.]{0,50}?)(?:\s+(?:to|and)\s+(?:submit|send|search|confirm|save)\b.*)?$|^(?:submit|send|search)\s+(?:with|via|using)\s+(?:the\s+)?enter(?:\s+key)?$")
_ESC_CLOSE = re.compile(r"(?i)^(?:press|hit)\s+(?:esc(?:ape)?)\s+(?:to\s+)?(?:close|dismiss)\s+(?:the\s+)?(?P<what>dialog|modal|menu|popover|drawer|panel|popup|overlay)s?$|^(?:press|hit)\s+(?:esc(?:ape)?)\s+while\s+(?:(?:it|the\s+(?P<w2>dialog|modal|menu|popover|drawer|panel|popup|overlay))\s+(?:is\s+)?)?open$")
_ARROWS_BARE = re.compile(r"(?i)^(?:press\s+)?(?P<keys>(?:left|right|up|down)(?:\s*(?:/|,|and|then)\s*(?:left|right|up|down))*)\s+arrow\s+keys?$")


def _arrow_keys(text):
    out = []
    for tok in re.split(r"(?i)\s*(?:/|,|\band\b|\bthen\b)\s*", text):
        k = parse_key(re.sub(r"(?i)^arrow\s*", "arrow", tok.strip()))
        if k is None:
            return None
        out.append(k)
    return out


def map_part(seg, raw, prev=None, platform=None):
    """-> list[sub-step] | (None, reason) | NOT_MINE (a module-level sentinel)."""
    s = re.sub(r"(?i)^(?:then|and|also|try|now)\s+", "", seg.strip()).strip().rstrip(".,;")
    if not s:
        return NOT_MINE
    s = re.sub(r"(?i)\s+(?:on|in|within)\s+the\s+(?:lens|page|app|editor|canvas)$", "", s) if re.search(r"(?i)\b(?:ctrl|cmd|alt|shift|meta|mod)\s*\+", s) else s
    # --- Tab x N / Shift+Tab x N with focus-order assertion
    m = _TABN.match(s)
    if m:
        n = int(m.group("n"))
        if n < 1 or n > MAX_TABS:
            return None, "Tab count %d outside 1..%d - not guessed" % (n, MAX_TABS)
        pre = [{"action": "reload", "raw": raw}] if m.group("fresh") and re.search(r"(?i)fresh|load", m.group("fresh")) else []
        return pre + [{"action": "tab_order", "count": n, "reverse": False, "raw": raw}]
    m = _SHIFTTABN.match(s)
    if m:
        n = int(m.group("n"))
        if n < 1 or n > MAX_TABS:
            return None, "Shift+Tab count %d outside 1..%d - not guessed" % (n, MAX_TABS)
        return [{"action": "tab_order", "count": n, "reverse": True, "raw": raw}]
    # --- arrow keys on a named widget (assert the active/selected item changes)
    m = _ARROW_ENTER_ON.match(s)
    if m:
        keys = _arrow_keys(m.group("keys"))
        if keys is None:
            return None, "unknown key in %r - not guessed" % m.group("keys")
        name = re.sub(r"(?i)\s+(?:tabs?|list|menu|grid|widget)$", "", m.group("name").strip()) or m.group("name").strip()
        return [{"action": "arrow_nav", "name": name, "keys": keys, "raw": raw}]
    # --- Enter in a field submits
    m = _ENTER_SUBMIT.match(s)
    if m:
        what = (m.group("what") or "").strip()
        fm = re.match(r"(?i)^(?P<n>[A-Za-z0-9][A-Za-z0-9 \-_/]{0,40}?)\s+(?:field|input|box|textbox|text box)$", what)
        step = {"action": "enter_submit", "raw": raw}
        if fm:
            step["field"] = fm.group("n").strip()   # the named field is focused first - Enter must land in it, not wherever focus drifted
        return [step]
    m = _ESC_CLOSE.match(s)
    if m:
        return [{"action": "close_with_escape", "what": (m.group("what") or m.group("w2") or "popup").lower(), "raw": raw}]
    m = _ARROWS_BARE.match(s)
    if m:
        keys = _arrow_keys("arrow" + re.sub(r"(?i)(\s*(?:/|,|and|then)\s*)", lambda x: x.group(1) + "arrow", m.group("keys")))
        if keys:
            return [{"action": "arrow_nav", "name": None, "keys": keys, "raw": raw}]
    # --- a combo / key press
    m = _KEY_WORDS.match(s)
    body = m.group("k") if m else s
    body = re.sub(r"(?i)\s+(?:x\s*\d+|\d+\s*(?:x|×|times)|once|twice)$", "", body).strip()
    if _COMBO_SHAPE.match(body.replace(" ", "")) or (m and re.search(r"\+", body)):
        combo = parse_combo(body, platform)
        if combo is None:
            return None, "unknown key combination %r - not guessed" % body[:40]
        why = refusal(combo, raw)
        if why:
            return None, why
        return [{"action": "press_combo", "combo": combo["keys"], "mod_used": combo["mod_used"], "text": combo["text"], "raw": raw}]
    if m:
        k = parse_key(body)
        if k is None and re.fullmatch(r"[A-Za-z0-9 ]{1,20}", body or ""):
            # 'press the Foo key' - a key name we do not know: refuse to guess
            return None, "unknown key %r - not guessed" % body[:30]
        if k is not None:
            if k in _REFUSED_KEYS:
                return None, refusal({"key": k}, raw)
            return [{"action": "press_combo", "combo": k, "mod_used": False, "text": body, "raw": raw}]
    return NOT_MINE


NOT_MINE = object()


# ------------------------------------------------------------------ pure checks
def focus_order_check(trace, reverse=False, min_distinct=2):
    """trace = [descriptor|None per press]. -> (state, detail). Focus must MOVE: a trap (>=3 identical
    consecutive stops) or a trace with no readable focus is not a pass."""
    t = list(trace or [])
    if not t:
        return "unverified", "no focus trace captured"
    if all(x is None for x in t):
        return "unverified", "focused element unreadable on every stop"
    run = best = 1
    for a, b in zip(t, t[1:]):
        run = run + 1 if (a == b and a is not None) else 1
        best = max(best, run)
    if best >= 3:
        return "fail", "focus stuck on %r for %d consecutive Tab stops (possible focus trap)" % (next(x for x in t if x), best)
    if len({x for x in t if x}) < min_distinct and len(t) >= 3:
        return "fail", "focus never left %r over %d stops" % (next(x for x in t if x), len(t))
    return "pass", "focus moved through %d distinct stop(s) over %d press(es)%s" % (len({x for x in t if x}), len(t), " (reverse)" if reverse else "")


def expect_focus_order(trace, expected_names):
    """Assert expected_names appear in the trace IN ORDER (subsequence, case-insensitive substring). -> (state, detail)."""
    if not expected_names:
        return "unverified", "no expected order given"
    if not trace or all(x is None for x in trace):
        return "unverified", "no focus trace captured"
    i = 0
    low = [(x or "").lower() for x in trace]
    for want in expected_names:
        w = want.lower()
        j = next((k for k in range(i, len(low)) if w in low[k]), None)
        if j is None:
            return "fail", "focus order violated: %r not reached after position %d (trace head: %s)" % (want, i, [x for x in trace[:6]])
        i = j + 1
    return "pass", "focus visited %s in order" % list(expected_names)


def active_changed(before, after):
    """Arrow navigation moved the active/selected item. None readings are UNVERIFIED, equal is FAIL."""
    if before is None or after is None:
        return "unverified", "active item unreadable (before=%r after=%r)" % (before, after)
    if before == after:
        return "fail", "arrow key left the active item at %r" % (after,)
    return "pass", "active item %r -> %r" % (before, after)
