"""WALK-04h: chat / LLM-output checks with a send budget.

The recipe generalises the one chat exercise the walker already had
(r_fix007): composer discovery by role + name vocabulary, typing via the
keyboard (never .fill), the send through Enter — safety.HARD_DENY bars
Send clicks in every mode — and every sent probe logged as a leftover
fixture by label.

Verdict logic is factored into pure functions (SendBudget, pick_reply,
assess) so it is unit-testable without a browser. Quality of the reply
stays human; the machine judges only: a reply arrived, no handler_error,
two different prompts did not draw the same canned reply, and a tool-call
surface appeared when the ticket expects one. Sends are counted per lens
and the budget is enforced BEFORE a send is made — an exhausted budget
sends the remainder to NEEDS_HUMAN, never to VERIFIED.
"""
import difflib, re, time
from .cdp import wait_until
from .auth import assert_account
from .checks import LensWalk
from .util import scrub

FIXED, STILL, HUMAN = "FIXED", "STILL_FAILING", "NEEDS_HUMAN"

DEFAULT_BUDGETS = {"default": 20, "psyops": 5, "detective": 5}
REPLY_TIMEOUT_S = 45
CANNED_SIMILARITY = 0.85

# Two probes with known-answer shapes. The expected token is recorded as a
# signal in the notes; it is never a verdict gate (phrasing varies).
PROBES = [
    ("What is 17 + 25? Answer with just the number.", "42"),
    ("Name the planet known as the red planet. One word.", "mars"),
]

# Office ruling (2026-11-14, on the WALK-04h SECTION DONE receipt): psyops
# generation checks are account-shaped, not lens-barred — they run ONLY
# under the admin account, with the cap of 5. Every other admin lens stays
# look-only for chat checks under every account.
ADMIN_CHAT_LENSES = {"psyops"}

TOOL_WORDS = re.compile(r"(?i)\btool|macro|solver|citation|search results?\b")
TOOL_SURFACE = re.compile(r"(?i)\btool|macro|solver|source|citation|ran\b|called\b")


class SendBudget:
    """Per-lens send counter. Caps come from cfg["chat_budgets"] when the
    desk configures them, else the founder defaults (20/lens; 5 on
    psyops/detective)."""

    def __init__(self, cfg=None):
        self.cfg = (cfg or {}).get("chat_budgets") or {}
        self.used = {}

    def cap(self, lens):
        if lens in self.cfg:
            return int(self.cfg[lens])
        return DEFAULT_BUDGETS.get(lens, DEFAULT_BUDGETS["default"])

    def allow(self, lens, n=1):
        return self.used.get(lens, 0) + n <= self.cap(lens)

    def spend(self, lens, n=1):
        self.used[lens] = self.used.get(lens, 0) + n

    def remaining(self, lens):
        return self.cap(lens) - self.used.get(lens, 0)


def _norm(s):
    return re.sub(r"\s+", " ", (s or "").lower()).strip()


def similarity(a, b):
    return difflib.SequenceMatcher(None, _norm(a), _norm(b)).ratio()


def pick_reply(before, after, prompt):
    """The reply = a text present after the send, absent before, that is not
    the prompt itself. The longest candidate wins (replies outrank chrome)."""
    bset = {_norm(x) for x in before}
    nprompt = _norm(prompt)
    cands = [x for x in after
             if _norm(x) and _norm(x) not in bset and nprompt not in _norm(x)]
    return max(cands, key=len) if cands else None


def assess(replies, errors, budget_exhausted=False, composer_missing=False,
           http_5xx=False, tool_expected=False, tool_seen=None):
    """Pure verdict logic over one exchange. replies: one entry per probe
    (None when no reply arrived). errors: console/page error strings seen
    during the exchange."""
    if composer_missing:
        return HUMAN, "no composer textbox found on the lens (missing-composer path)"
    if http_5xx:
        return HUMAN, "a 5xx response landed during the exchange; the failure is environmental, not a verdict"
    if budget_exhausted:
        return HUMAN, "send budget exhausted before the exchange completed; the remainder is not verified"
    if any("handler_error" in (e or "") for e in errors) or \
       any(r and "handler_error" in r.lower() for r in replies):
        return STILL, "handler_error in the exchange"
    if any(r is None for r in replies):
        return STILL, "no reply arrived within %ds of a send" % REPLY_TIMEOUT_S
    if len(replies) >= 2 and similarity(replies[0], replies[1]) >= CANNED_SIMILARITY:
        return STILL, "two different prompts drew near-identical replies (similarity %.2f) — canned" % similarity(replies[0], replies[1])
    if tool_expected and not tool_seen:
        return STILL, "the ticket expects a tool-call surface; none appeared in the exchange"
    return FIXED, "replies arrived for both probes, distinct, no handler_error"


def _message_texts(cdp):
    return [n.name for n in cdp.ax().live()
            if n.role in ("StaticText", "paragraph", "article", "listitem") and n.name]


def _composer(cdp):
    boxes = [n for n in cdp.ax().by_role("textbox") if n.backend and not n.disabled]
    return next((n for n in boxes if re.search(r"(?i)message|ask|chat|type|prompt|say", n.name)),
                boxes[-1] if boxes else None)


def scope_check(lens, account, admin_lenses):
    """Account-conditional scope for a chat check. Returns None to proceed,
    or the NEEDS_HUMAN note when the account shape bars the check."""
    if lens not in (admin_lenses or []):
        return None
    if lens in ADMIN_CHAT_LENSES and account == "admin":
        return None
    return ("admin look-only lens under the %s account: generation checks run "
            "only where the office has ruled an account-shaped lane (psyops "
            "under admin); refused here, never a send" % account)


def run_chat_check(rv, t, account="t1"):
    """Drive one chat ticket. rv is the Reverifier (browser, cfg, rec, inv,
    chat_budget). Returns the standing verdict dict shape."""
    lens = t["lens"]
    barred = scope_check(lens, account, rv.cfg.get("admin_lenses", []))
    if barred:
        return {"verdict": HUMAN, "method": "chat recipe", "category": "chat", "evidence": [],
                "notes": barred}
    budget = rv.chat_budget
    label = "%s-%s-%s" % (rv.cfg["fixture_prefix"], lens, rv.rec.rid)
    lw = LensWalk(rv.b, rv.cfg, rv.rec, rv.inv[lens], account, rv.log, allow_write=True,
                  inv_entry=rv.inv[lens], phases=[])
    ctx, page, cdp = lw.open()
    try:
        assert_account(ctx, rv.cfg, account, "chat check", rv.log)
        lw.nav(page, cdp)
        if not _composer(cdp):
            v, note = assess([], [], composer_missing=True)
            return {"verdict": v, "method": "chat recipe", "category": "chat",
                    "evidence": [lw.shot(page, "chat-no-composer")], "notes": note}
        from .reverify import ticket_text
        tool_expected = bool(TOOL_WORDS.search(ticket_text(t)))
        replies, errors, signals = [], [], []
        exhausted = False
        for i, (probe, token) in enumerate(PROBES):
            if not budget.allow(lens):
                exhausted = True
                break
            comp = _composer(cdp)
            if not comp:
                v, note = assess([], [], composer_missing=True)
                return {"verdict": v, "method": "chat recipe", "category": "chat",
                        "evidence": [lw.shot(page, "chat-composer-gone")], "notes": note}
            text = "[%s-%d] %s" % (label, i + 1, probe)
            before = _message_texts(cdp)
            e0 = len(lw.console_errors) + len(lw.page_errors)
            r0 = len(lw.bad_responses)
            if not cdp.click(comp.backend):
                replies.append(None)
                continue
            page.keyboard.type(text, delay=20)
            assert_account(ctx, rv.cfg, account, "chat send", rv.log)
            budget.spend(lens)
            rv.rec.fixture("%s-%d" % (label, i + 1), lens, "leftover",
                           "Chat probe from a WALK-04h check; delete the thread/message by its label if the lens allows.")
            page.keyboard.press("Enter")
            reply, _dt = wait_until(lambda: pick_reply(before, _message_texts(cdp), text),
                                    timeout=REPLY_TIMEOUT_S)
            replies.append(reply)
            errors.extend((lw.console_errors + lw.page_errors)[e0:])
            if any(st >= 500 for st, _ in lw.bad_responses[r0:]):
                v, note = assess(replies, errors, http_5xx=True)
                return {"verdict": v, "method": "chat recipe", "category": "chat",
                        "evidence": [lw.shot(page, "chat-5xx")], "notes": note}
            if reply:
                signals.append("probe %d expected-token %s: %s" % (i + 1, token, "seen" if token in reply.lower() else "not seen"))
        tool_seen = None
        if tool_expected:
            tool_seen = any(TOOL_SURFACE.search(x or "") for x in _message_texts(cdp))
        v, note = assess(replies, errors, budget_exhausted=exhausted,
                         tool_expected=tool_expected, tool_seen=tool_seen)
        note = "%s. Budget: %d/%d sends used on %s. %s" % (
            note, budget.used.get(lens, 0), budget.cap(lens), lens, " ".join(signals))
        return {"verdict": v, "method": "chat recipe (2 probes)", "category": "chat",
                "evidence": [lw.shot(page, "chat-check")], "notes": scrub(note, 400)}
    finally:
        lw._close(ctx)
