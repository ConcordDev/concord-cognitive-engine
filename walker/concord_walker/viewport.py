"""Viewport / theme / responsive actions (precapture item 2). Pure parsing + pure layout analysis.

Honesty: the app's OWN theme toggle is only pressed when a generic, unambiguous control exists (a
control whose name says theme / dark mode / light mode); otherwise the step is pending_capture (we
need the live label), while prefers-color-scheme emulation always works without one.
"""
import re

PRESETS = {"mobile": (390, 844), "tablet": (820, 1180), "desktop": (1440, 900)}
MIN_DIM, MAX_DIM = 200, 4000
ZOOMS = (0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0)

NOT_MINE = object()
_DIM = re.compile(r"(?i)(?<![\d.])(\d{3,4})\s*(?:[x×]|by)\s*(\d{3,4})(?![\d])")
_PXW = re.compile(r"(?i)(?:~|about\s+|at\s+)?(\d{3,4})\s*(?:css\s*)?px\s*(?:wide|width)?")
_PRESET = re.compile(r"(?i)\b(mobile|phone|tablet|ipad|desktop|laptop)\b")
_ZOOM = re.compile(r"(?i)\bzoom(?:ed)?\s*(?:to|at|in to|=)?\s*(\d{2,3})\s*%|(\d{2,3})\s*%\s*zoom\b|\bdevice\s*pixel\s*ratio\s*(?:of|=)?\s*(\d(?:\.\d+)?)\b|\bdpr\s*(?:=|of)?\s*(\d(?:\.\d+)?)\b")
_REDUCED = re.compile(r"(?i)\breduced[\s-]motion\b|\bprefers[\s-]reduced[\s-]motion\b")
_SCHEME = re.compile(r"(?i)^(?:view|open|check|switch|set|use|read)?\s*(?:the\s+)?(?:lens\s+|page\s+|app\s+)?(?:in|on|to|with)?\s*(?:the\s+)?(dark|light)\s*(?:theme|mode|scheme)?(?:\s+(?:and|then)\s+(?:the\s+)?(dark|light))?\s*$")
_OFFLINE = re.compile(r"(?i)^(?:go|set|switch|put)\s+(?:the\s+)?(?:browser\s+|page\s+|app\s+)?offline$|^devtools\s+offline$|^go\s+back\s+online$|^(?:go|come|set|switch)\s+(?:back\s+)?online$")
_APP_TOGGLE = re.compile(r"(?i)^(?:click|press|use|toggle|switch)\s+(?:the\s+)?(?:app'?s?\s+)?(?:theme|dark mode|light mode|dark\s*/\s*light)\s*(?:toggle|switch|button)?$|^theme\s+toggle$")
_OVERFLOW = re.compile(r"(?i)\b(?:horizontal(?:ly)?\s+scroll(?:ing|bar)?|overflow(?:s|ing)?|clipp(?:ed|ing)|cut\s+off|truncat\w+|text\s+overflow)\b")


def clamp_dims(w, h):
    return MIN_DIM <= w <= MAX_DIM and MIN_DIM <= h <= MAX_DIM


def viewport_for(text):
    """'390x844' | 'mobile' | 'tablet' | 'at ~390px width' -> (w, h, name) or None."""
    m = _DIM.search(text or "")
    if m:
        w, h = int(m.group(1)), int(m.group(2))
        return (w, h, "%dx%d" % (w, h)) if clamp_dims(w, h) else None
    m = _PRESET.search(text or "")
    if m:
        k = {"phone": "mobile", "ipad": "tablet", "laptop": "desktop"}.get(m.group(1).lower(), m.group(1).lower())
        w, h = PRESETS[k]
        return w, h, k
    m = _PXW.search(text or "")
    if m:
        w = int(m.group(1))
        # width only: keep the preset height closest in class (mobile-ish widths keep the phone height)
        h = 844 if w <= 600 else (1180 if w <= 1000 else 900)
        return (w, h, "%dpx-wide" % w) if clamp_dims(w, h) else None
    return None


def zoom_for(text):
    m = _ZOOM.search(text or "")
    if not m:
        return None
    if m.group(1) or m.group(2):
        z = int(m.group(1) or m.group(2)) / 100.0
    else:
        z = float(m.group(3) or m.group(4))
    return z if 0.25 <= z <= 5 else None


def map_part(seg, raw, lens_names=()):
    """-> list[sub-step] | (None, reason) | NOT_MINE."""
    s = re.sub(r"(?i)^(?:then|and|also|now)\s+", "", seg.strip()).strip().rstrip(".,;")
    if not s:
        return NOT_MINE
    if _OFFLINE.match(s):
        online = bool(re.search(r"(?i)online", s)) and not re.search(r"(?i)offline", s)
        return [{"action": "set_offline", "offline": not online, "raw": raw}]
    if _REDUCED.search(s):
        return [{"action": "set_reduced_motion", "on": not re.search(r"(?i)\b(?:no|off|disable|without|normal)\b", s), "raw": raw}]
    z = zoom_for(s)
    if z is not None:
        return [{"action": "set_zoom", "zoom": z, "raw": raw}]
    if _APP_TOGGLE.match(s):
        return [{"action": "app_theme_toggle", "raw": raw}]
    m = _SCHEME.match(s)
    if m:
        out = [{"action": "set_scheme", "scheme": m.group(1).lower(), "raw": raw}]
        if m.group(2):
            out.append({"action": "set_scheme", "scheme": m.group(2).lower(), "raw": raw})
        return out
    vp = viewport_for(s)
    if vp is None and re.search(r"\b\d{3,4}\s*(?:[x×]|by)\s*\d{3,4}\b", s):
        return None, "viewport %r outside %d..%d - not guessed" % (_DIM.search(s).group(0), MIN_DIM, MAX_DIM)
    if vp and re.fullmatch(r"(?i)(?:(?:view|open|at|on|in|set|resize|natively|use|switch to)\s+)*(?:(?:chrome|content|the\s+window|the\s+viewport|window|viewport)\s+)?(?:(?:to|at)\s+)?(?:about\s+|around\s+)?(?:the\s+)?(?:(?:a|an)\s+)?(?:devtools\s+)?(?:device\s+(?:mode|toolbar)\s+)?(?:at\s+)?(?:~?\d{3,4}\s*(?:[x×]|by)\s*\d{3,4}|~?\d{3,4}\s*px(?:\s*(?:wide|width))?|mobile|phone|tablet|ipad|desktop|laptop)(?:\s*(?:viewport|size|width|layout|view))?", s):
        return [{"action": "set_viewport", "w": vp[0], "h": vp[1], "name": vp[2], "raw": raw}]
    if _OVERFLOW.search(s) and re.match(r"(?i)^(?:check|inspect|look|verify|confirm|observe|scroll)\b", s):
        return [{"action": "check_layout", "raw": raw}]
    return NOT_MINE


# ------------------------------------------------------------------ pure layout analysis
def analyze_layout(m, tol=2):
    """m = driver.measure_layout(): {vw, vh, scrollW, bodyScrollW, clipped:[{sel,right,left,w}], textOverflow:[sel...], hscroll:bool}.
    -> {state, issues:[...]}. Unreadable metrics are UNVERIFIED, never pass."""
    if not isinstance(m, dict) or not m.get("vw"):
        return {"state": "unverified", "issues": ["layout metrics unavailable"]}
    issues = []
    vw = m["vw"]
    sw = max(m.get("scrollW") or 0, m.get("bodyScrollW") or 0)
    if sw > vw + tol:
        issues.append("horizontal scroll: document is %dpx wide in a %dpx viewport" % (sw, vw))
    for c in (m.get("clipped") or [])[:5]:
        issues.append("clipped outside viewport: %s (left=%s right=%s)" % (c.get("sel"), c.get("left"), c.get("right")))
    for t in (m.get("textOverflow") or [])[:5]:
        issues.append("text overflows its box: %s" % t)
    return {"state": "fail" if issues else "pass", "issues": issues}


def find_theme_toggle(controls):
    """Generic (no live labels): the one control named for theme / dark mode / light mode. Zero or
    ambiguous -> None (the step becomes pending_capture, never a guess)."""
    hits = [c for c in controls or [] if c.get("name") and re.search(r"(?i)\b(theme|dark mode|light mode|toggle dark|switch to (?:dark|light))\b", c["name"]) and c.get("role") in ("button", "switch", "menuitem", "checkbox", None)]
    names = {h["name"] for h in hits}
    return hits[0]["name"] if len(names) == 1 else None


def scheme_applied(before, after):
    """Did the app's own toggle change the rendered colour scheme? (bg luminance / data-theme / class)"""
    if before is None or after is None:
        return "unverified", "scheme unreadable"
    return ("pass", "theme changed %r -> %r" % (before, after)) if before != after else ("fail", "theme unchanged at %r after the toggle" % (after,))
