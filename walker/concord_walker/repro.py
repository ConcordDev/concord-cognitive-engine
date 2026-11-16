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
from .safety import HARD_DENY, is_tab_safe

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
def run_repro(ticket, driver, *, lens_slug, allow_fill=True, log=None):
    """Replay a ticket's repro_steps on `driver`. Returns the replay dict (see module doc)."""
    log = log or (lambda *a: None)
    raw_steps = split_steps(ticket)
    steps = [dict(map_step(r, lens_slug), n=i + 1) for i, r in enumerate(raw_steps)]
    out = {"basis": "repro-steps", "steps": [], "expected": None, "verdict": HUMAN, "notes": "", "evidence": []}

    def rec(st, executed, result):
        out["steps"].append({"n": st["n"], "raw": st["raw"], "action": st.get("action"), "mapped": bool(st["mapped"]),
                             "executed": executed, "result": result})

    if not steps:
        out["notes"] = "ticket has no repro_steps to replay"
        return out
    bad = next((s for s in steps if not s["mapped"]), None)
    if bad:
        for s in steps:
            rec(s, False, ("UNMAPPED: " + s.get("reason", "")) if not s["mapped"] else "not run: step %d is unmapped" % bad["n"])
        out["notes"] = "step %d not mapped to an action: %r (%s)" % (bad["n"], bad["raw"][:120], bad.get("reason"))
        return out
    # start at the lens root unless the first step opens something itself
    if not any(s["action"] == "open" for s in steps):
        driver.open(None)
    for s in steps:
        a = s["action"]
        try:
            if a == "observe":
                rec(s, True, "observed (checked against `expected` below)")
            elif a == "open":
                driver.open(s.get("target"))
                rec(s, True, "opened %s" % (s.get("target") or "the lens root"))
            elif a == "reload":
                driver.reload()
                rec(s, True, "reloaded")
            elif a == "press":
                driver.press(s["key"])
                rec(s, True, "pressed %s" % s["key"])
            elif a in ("click", "open_tab"):
                nm = s["name"]
                if a == "open_tab" and not is_tab_safe(nm):
                    raise _Refused("tab %r refused by the click policy" % nm)
                if a == "click" and HARD_DENY.search(nm):
                    raise _Refused("control %r is a write/destructive/payment/admin action (safety.HARD_DENY) - the walker never clicks it" % nm)
                hit = driver.click(nm, role="tab" if a == "open_tab" else None)
                if not hit:
                    raise _NotFound("no control matching %r on the live page" % nm)
                rec(s, True, "clicked %r (matched %r)" % (nm, hit if isinstance(hit, str) else nm))
            elif a == "fill":
                if not allow_fill:
                    raise _Refused("fill refused: this lens is read-only here (write-skip or admin look-only)")
                if not driver.type_into(s["name"], _FILL_LABEL + " value"):
                    raise _NotFound("no field matching %r on the live page" % s["name"])
                rec(s, True, "typed an own labelled qa-walker value into %r (not submitted)" % s["name"])
        except (_Refused, _NotFound) as e:
            rec(s, False, str(e))
            for rest in steps[s["n"]:]:
                rec(rest, False, "not run: step %d did not execute" % s["n"])
            out["notes"] = "step %d mapped but not executed: %s" % (s["n"], e)
            out["evidence"] = [driver.screenshot("repro-stopped")]
            return out
    snap = driver.snapshot()
    chk = check_expected(ticket.get("expected"), snap)
    out["expected"] = chk
    out["evidence"] = [e for e in (driver.screenshot("repro-final"),) if e]
    if chk["state"] == "unchecked":
        why = chk.get("why") or next((r["clause"] for r in chk["clauses"] if r["state"] == "unchecked"), "")
        out["notes"] = "all %d step(s) mapped + executed, but the expected outcome is not machine-checkable: %r" % (len(steps), why[:120])
    elif chk["state"] == "fail":
        out["verdict"] = STILL
        out["notes"] = "all %d step(s) executed; expected outcome violated: %s" % (
            len(steps), "; ".join("%r -> %s" % (r["clause"][:60], r["detail"]) for r in chk["clauses"] if r["state"] == "fail")[:240])
    else:
        out["verdict"] = FIXED
        out["notes"] = "all %d step(s) mapped + executed; expected outcome machine-checked: %s" % (
            len(steps), "; ".join(r["detail"] for r in chk["clauses"])[:240])
    return out


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
