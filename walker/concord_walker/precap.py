"""Pre-capture action layer: mapping hook + executors for the actions that need NO live labels.

  map_part(seg, raw, lens_names, prev)  - called by repro._map_core ONLY for a segment the existing mapper
      left unmapped, so nothing that mapped before changes. -> list[sub-step] | (None, reason) | NOT_MINE.
  classify_part(seg, reason)            - rule table (no LLM) giving every still-unmapped part a distinct,
      counted state: pending_capture (needs a live label/endpoint name) or needs_post_capture_rewrite
      (prose a human/rewrite must fix) + a reason category. Never guessed into an action.
  execute(a, s, driver, ev, ctx)        - runs the new actions; raises Refused / NotFound (fail closed ->
      the replay stays NEEDS_HUMAN, never PASS).
"""
import re
from . import keyboard as K, viewport as V
from .safety import is_tab_safe

NOT_MINE = K.NOT_MINE


class _Refused(Exception):
    """Named _Refused/_NotFound (as the replay driver's exceptions always were) - repro aliases these, so the class name stays stable."""


class _NotFound(Exception):
    pass


Refused, NotFound = _Refused, _NotFound


PLATFORM = None      # Mod stays symbolic at map time; execute() resolves it from the BROWSER's platform (not this Mac)
NEW_ACTIONS = ("tab_order", "arrow_nav", "enter_submit", "close_with_escape", "press_combo", "set_offline", "set_reduced_motion", "set_zoom",
               "app_theme_toggle", "nav_away_back", "check_layout")


def map_part(seg, raw, lens_names=(), prev=None, platform=None):
    plat = platform or PLATFORM
    for fn in (lambda: K.map_part(seg, raw, prev, plat), lambda: V.map_part(seg, raw, lens_names), lambda: _nav_part(seg, raw)):
        r = fn()
        if r is not NOT_MINE and r is not V.NOT_MINE:
            return r
    return NOT_MINE


_NAV_BACK = re.compile(r"(?i)^(?:navigate|go|click)\s+away\s+(?:from\s+(?:the\s+)?(?:page|lens)\s+)?and\s+(?:back|return)(?:\s+to\s+(?:it|the\s+(?:page|lens)))?$|^leave\s+(?:the\s+(?:page|lens)\s+)?and\s+(?:come\s+back|return)$|^(?:reopen|return to)\s+the\s+(?:page|lens)\s+after\s+leaving$")


def _nav_part(seg, raw):
    s = seg.strip().rstrip(".,;")
    if _NAV_BACK.match(s):
        return [{"action": "nav_away_back", "raw": raw}]
    return V.NOT_MINE


# ------------------------------------------------------------------ rule table (deterministic, no LLM)
_ACTION_VERB = r"(?:create|add|new|make|log|save|submit|schedule|import|fill|record|set|edit|rename|enter|type|upload|join|leave|run|start|apply|generate|send|post|queue|register|place|draw|mark|book|pick|choose|select|open|click|press|toggle|change|update|search|filter|sort|expand|collapse|reopen|close|assess|derive|analy[sz]e|compare|convert|build|load|attach|link|connect|assign|enqueue|process|capture|scan|hang|bone|stake)"
_RULES = [
    # (state, category, regex on the segment, why)
    ("needs_post_capture_rewrite", "evidence_pointer", r"(?i)^see\s+evidence|evidence/[\w\-/.]+", "points at an evidence file, not an action"),
    ("needs_post_capture_rewrite", "no_text", r"(?i)^\s*(?:n/?a|none|x|-|tbd)?\s*$", "no actionable text"),
    ("needs_post_capture_rewrite", "tester_context", r"(?i)\b(?:sign(?:ed)? in as|log(?:ged)? in as|as [a-z]+_qa_t\d|confirm /api/auth/me|on [a-z]+_qa_t\d)\b|^(?:sign in|login)\b", "account/session setup the walker already owns - restate as the action itself"),
    ("needs_post_capture_rewrite", "fragment", r"^[^\"'‘“]*[\"'‘“][^\"'’”]*$|^[^()]*\([^)]*$|^[^()]*\)[^(]*$|^[\s'\"‘’“”,.;:)(\-]|[,(]\s*$", "text cut mid-quote/paren or mid-phrase"),
    ("needs_post_capture_rewrite", "bare_value", r"^(?:[\w.\-+/]{1,12}|\d[\d\s.,x×%/:\-]*)$", "a bare value with no verb or target"),
    ("pending_capture", "bad_input_value", r"(?i)\b(?:empty|blank|negative|invalid|\-\d+|\d{3,}\+?\s*-?char\w*|300\+|nonsense|too long|overlong|9{5,}|-1\b|\bmin/max\b|leave\b[^.]{0,30}\bempty)\b", "typed boundary value - needs the live field label (typed-values path)"),
    ("pending_capture", "generic_open_target", r"(?i)^(?:open|click|select|choose|view|go to)\s+(?:the\s+|an?\s+|own\s+|any\s+|each\s+)*[\w\- ]{1,40}$", "opens a generic/own item (no live label for it yet)"),
    ("pending_capture", "create_fill_flow", r"(?i)^(?:then\s+)?(?:try\s+to\s+)?" + _ACTION_VERB + r"\b", "a create/fill/run flow naming a control or form we have no live label for"),
    ("pending_capture", "named_control_path", r"[A-Za-z0-9][A-Za-z0-9 &'/+\-]{1,30}\s*>\s*[A-Za-z0-9]", "a named control path (A > B) - needs the captured control labels"),
    ("needs_post_capture_rewrite", "conditional_or_guard", r"(?i)^(?:if|unless|until|repeat|wait|do not|don't|never)\b|\b(?:if needed|if available|if present)\b", "conditional / guard prose"),
    ("needs_post_capture_rewrite", "observation_prose", r"(?i)\b(?:inspect|observe|look for|record|check whether|whether|compare|notice|read)\b", "free-form observation with no machine predicate"),
    ("needs_post_capture_rewrite", "tooling_or_environment", r"(?i)\b(?:devtools|lighthouse|throttl\w*|waterfall|performance)\b", "browser-tooling instruction"),
]


def classify_part(seg, reason=""):
    """-> {state, category, why}. Order matters (first match wins); the fall-through is a rewrite request, never a guess."""
    s = (seg or "").strip()
    if (reason or "").startswith("Lighthouse"):
        return {"state": "needs_post_capture_rewrite", "category": "tooling_or_environment", "why": "Lighthouse is automated by automate.run_lighthouse (human-only ticket), not a replay step"}
    for state, cat, rx, why in _RULES:
        if re.search(rx, s):
            return {"state": state, "category": cat, "why": why}
    return {"state": "needs_post_capture_rewrite", "category": "no_actionable_verb", "why": "no recognised action verb and no named control"}


# ------------------------------------------------------------------ executors
def _focus_desc(driver):
    fn = getattr(driver, "focused_name", None)
    return fn() if fn else None


def execute(a, s, driver, ev, ctx):
    """-> result string. ctx: {allow_write, send_key(key), forbid_keys(set)}. Raises Refused / NotFound."""
    def cap(name):
        fn = getattr(driver, name, None)
        if not fn:
            raise NotFound("this driver cannot %s - the step stays NEEDS_HUMAN rather than being skipped" % name)
        return fn

    if a == "press_combo":
        why = K.refusal({"key": s["combo"].split("+")[-1] or "+"}, s.get("raw", ""))
        if why:
            raise Refused(why)
        plat = (getattr(driver, "platform", None) or (lambda: "linux"))()
        keys = K.resolve(s["combo"], plat)
        ctx["send_key"](keys)
        ev.setdefault("combos", []).append(keys)
        return "pressed %s%s" % (keys, " (Mod -> %s)" % K.mod_for(plat) if s.get("mod_used") else "")
    if a == "tab_order":
        if "Tab" in ctx["forbid_keys"]:
            raise Refused("constraint violated: the ticket says 'do not Tab first' but this step starts with Tab")
        key = "Shift+Tab" if s.get("reverse") else "Tab"
        foc = cap("focused_name")
        trace = []
        for _ in range(int(s["count"])):
            ctx["send_key"](key)
            trace.append(foc())
        st, detail = K.focus_order_check(trace, s.get("reverse", False))
        ev["focus_order"] = {"state": st, "detail": detail, "trace": trace[:MAX_TRACE]}
        ev.setdefault("tab_trace", []).extend(trace)
        if st == "unverified":
            raise NotFound("Tab x%d: %s" % (s["count"], detail))
        return "Tab order: %s - %s" % (st, detail)
    if a == "arrow_nav":
        for k in s["keys"]:
            if k in ("Enter", "Space") and not (s.get("name") and is_tab_safe(s["name"])):
                raise Refused("%s on %r refused: activating a control is only allowed on a tab-safe target (arrows alone navigate)" % (k, s.get("name")))
        active = cap("active_item")
        if s.get("name") and not cap("focus_name")(s["name"]):
            raise NotFound("no control matching %r to focus before the arrow keys" % s["name"])
        before = active()
        trace = [before]
        for k in s["keys"]:
            ctx["send_key"](k)
            trace.append(active())
        st, detail = K.active_changed(before, trace[-1])
        ev.setdefault("focus_trace", []).extend(x for x in trace)
        ev["arrow_nav"] = {"state": st, "detail": detail}
        if st == "unverified":
            raise NotFound("arrow keys on %r: %s" % (s["name"], detail))
        return "arrow keys %s on %r: %s - %s" % (s["keys"], s["name"], st, detail)
    if a == "enter_submit":
        if not ctx.get("allow_write"):
            raise Refused("Enter-to-submit is a write: needs --allow-write on a non-admin, non-write-skip lens")
        if s.get("field") and not cap("focus_name")(s["field"]):
            raise NotFound("no field matching %r to press Enter in" % s["field"])
        mk = cap("net_mark")()
        before = driver.snapshot()
        ctx["send_key"]("Enter")
        if getattr(driver, "settle", None):
            driver.settle()
        writes = cap("net_since")(mk)
        after = driver.snapshot()
        ev["submitted"] = bool(writes)
        changed = (after.get("texts") != before.get("texts")) or (len(after.get("dialogs") or []) != len(before.get("dialogs") or []))
        if writes:
            return "Enter submitted: %d write call(s) %s" % (len(writes), [str(w)[:40] for w in writes[:2]])
        if changed:
            return "Enter changed the page (no network write): dialogs %d -> %d" % (len(before.get("dialogs") or []), len(after.get("dialogs") or []))
        raise NotFound("Enter produced no network write and no DOM change - submission not confirmed")
    if a == "close_with_escape":
        pc = cap("popup_count")
        before = pc()
        if before < 1:
            raise NotFound("nothing (%s) is open to close with Escape" % s.get("what"))
        ctx["send_key"]("Escape")
        after = pc()
        if after >= before:
            return "Escape did NOT close the %s (%d popup(s) before, %d after)" % (s.get("what"), before, after)
        return "Escape closed the %s (%d -> %d popup(s))" % (s.get("what"), before, after)
    if a == "set_offline":
        cap("set_offline")(bool(s["offline"]))
        ev["offline"] = bool(s["offline"])
        return "browser %s" % ("offline" if s["offline"] else "back online")
    if a == "set_reduced_motion":
        cap("set_reduced_motion")(bool(s["on"]))
        ev["reduced_motion"] = bool(s["on"])
        return "reduced motion %s" % ("emulated" if s["on"] else "off")
    if a == "set_zoom":
        cap("set_zoom")(float(s["zoom"]))
        ev["zoom"] = float(s["zoom"])
        return "zoom set to %d%%" % round(s["zoom"] * 100)
    if a == "app_theme_toggle":
        names = V.find_theme_toggle(driver.snapshot().get("controls"))
        if not names:
            raise NotFound("PENDING_CAPTURE: no single generic theme toggle control on this page - needs the captured label")
        before = cap("page_scheme")()
        if not driver.click(names):
            raise NotFound("theme toggle %r could not be clicked" % names)
        after = driver.page_scheme()
        st, d = V.scheme_applied(before, after)
        ev["app_theme"] = {"state": st, "detail": d, "control": names}
        if st == "unverified":
            raise NotFound("theme toggle: %s" % d)
        return "app theme toggle %r: %s - %s" % (names, st, d)
    if a == "check_layout":
        m = cap("measure_layout")()
        r = V.analyze_layout(m)
        ev["layout"] = r
        if r["state"] == "unverified":
            raise NotFound("layout: %s" % "; ".join(r["issues"]))
        return "layout %s: %s" % (r["state"], "; ".join(r["issues"]) or "no horizontal scroll, clipping or text overflow")
    if a == "nav_away_back":
        cap("nav_away_back")()
        ev["reloaded"] = True
        snr = driver.snapshot()
        ev["after_reload"] = {"texts": list(snr.get("durable") or snr.get("texts") or []), "names": [c["name"] for c in snr.get("controls") or [] if c.get("name")]}
        return "navigated away and back"
    raise NotFound("unknown pre-capture action %s" % a)


MAX_TRACE = 60
