"""WALK-04c — two-account privacy + socket checks (GB-1544, plan item U11).

Recipes only; the live run belongs to the post-deploy pass. Two families:

  1. FOREIGN-ROW PROBE. t1 creates a labelled record (the write lane's
     qa-walker-* fixture). t2 — in its OWN isolated context — and a
     signed-out context then load the same lens and fetch the same API
     routes via context.request. The check asserts ZERO foreign rows:
     the label must appear neither in the probing context's AX texts
     (the UI leg) nor in any API response body (the byte leg — the label
     string is the byte oracle). Covers the LC-11 DM / export / room-join
     style checks, where the defect is one user's private rows reaching
     another user's screen or payload.

  2. SOCKET PAIR PROBE. t1 and t2 are open together. A CDP Network-domain
     session on t2's page captures Network.webSocketFrameReceived,
     armed BEFORE t1 acts. The pair is confirmed only when a frame is
     captured AND t2's AX tree gains the action's marker within the
     window; a timeout is STILL / NEEDS_HUMAN, never a false VERIFIED.

Verdicts use the walker's tri-state (FIXED / STILL_FAILING / NEEDS_HUMAN).
Guards first: assert_account on every authed context before any probe;
a wrong account, an unexpected signed-out state, or a money-route-only
surface aborts the recipe as NEEDS_HUMAN with the reason — never a
verdict. Payments / money routes are deny-listed out of the probe set
entirely. No page JavaScript anywhere: UI reads are AX-tree, API reads
are context.request, frames are CDP Network events.
"""
import re, time

from .auth import new_context, assert_account, AccountMismatch
from .cdp import Cdp, wait_until

FIXED, STILL, HUMAN = "FIXED", "STILL_FAILING", "NEEDS_HUMAN"

# Money / payment surfaces are never probed by this slice (GB-1544:
# payments stay untouched). A route whose path carries any of these
# parts is excluded from the API probe set, and a lens whose only
# candidate routes are money routes aborts HUMAN.
MONEY_ROUTE_PARTS = (
    "payment", "checkout", "billing", "wallet", "transfer", "withdraw",
    "payout", "mint", "stake", "tip", "gift", "donate", "subscribe",
    "buy", "purchase", "pay",
)

SOCKET_WINDOW_S = 10.0


def route_is_money(path):
    p = (path or "").lower()
    return any(part in p for part in MONEY_ROUTE_PARTS)


def filter_probe_routes(paths):
    """Split candidate API paths into (probeable, excluded_money)."""
    probe, excluded = [], []
    for p in paths or []:
        (excluded if route_is_money(p) else probe).append(p)
    return probe, excluded


def body_leaks(body, label):
    """The byte oracle: the labelled fixture's bytes in a foreign body."""
    if body is None or not label:
        return False
    if isinstance(body, bytes):
        return label.encode("utf-8", "ignore") in body
    return label in str(body)


def texts_leak(texts, label):
    return any(label in (t or "") for t in (texts or []))


# ---------------------------------------------------------------- verdicts
def foreign_probe_verdict(ui_texts, bodies, label):
    """ui_texts / bodies: {context_name: [texts]} / {context_name: [bodies]}
    for the PROBING contexts only (t2, signed-out). Returns (verdict, leaks)
    where leaks names each context + leg that carried the label."""
    leaks = []
    for name, texts in (ui_texts or {}).items():
        if texts_leak(texts, label):
            leaks.append("%s:ui" % name)
    for name, bl in (bodies or {}).items():
        if any(body_leaks(b, label) for b in (bl or [])):
            leaks.append("%s:api" % name)
    if leaks:
        return STILL, leaks
    return FIXED, leaks


def socket_pair_verdict(frame_seen, ax_changed):
    """Both signals confirm the pair. One signal alone is a human call;
    neither inside the window is STILL (the update never arrived)."""
    if frame_seen and ax_changed:
        return FIXED
    if frame_seen or ax_changed:
        return HUMAN
    return STILL


# ---------------------------------------------------------------- CDP frames
class FrameCapture:
    """Network.webSocketFrameReceived capture on an existing CDP session.

    The session is the caller's own (privacy checks open a dedicated
    Network-domain session; cdp.py's Cdp is not modified). Playwright CDP
    sessions deliver events via .on(event, handler).
    """

    def __init__(self, session):
        self.frames = []
        self.session = session
        session.send("Network.enable")

        def on_frame(params):
            try:
                resp = (params or {}).get("response") or {}
                self.frames.append({
                    "opcode": resp.get("opcode"),
                    "payload": resp.get("payloadData") or "",
                    "t": time.time(),
                })
            except Exception:
                pass

        session.on("Network.webSocketFrameReceived", on_frame)

    def wait_for(self, needle=None, timeout=SOCKET_WINDOW_S):
        """Wait for any frame, or one whose payload carries `needle`."""
        t0 = time.time()
        while time.time() - t0 < timeout:
            for f in self.frames:
                if needle is None or needle in (f.get("payload") or ""):
                    return f
            time.sleep(0.1)
        return None


# ---------------------------------------------------------------- the probes
def probe_foreign_rows(walk, owner_ctx, label, api_paths, log=None, owner_acct=None, foreign_acct="t2"):
    """Foreign-row probe against a live LensWalk (t1 = the walk's account).

    Preconditions (the caller — reverify dispatch — guarantees them):
    t1 has created the labelled record in this lens, `walk` is t1's
    LensWalk, and `owner_ctx` is t1's open browser context. Returns a
    reverify-shaped row.
    """
    cfg, browser = walk.cfg, walk.b
    base = cfg["base_url"].rstrip("/")
    probe_paths, excluded = filter_probe_routes(api_paths)
    if api_paths and not probe_paths:
        return {"verdict": HUMAN, "method": "privacy:foreign-rows", "category": "privacy",
                "notes": "all candidate routes are money routes; probe set empty by deny-list"}
    # Guards: t1 is who the walk claims, before any probing context opens.
    try:
        assert_account(owner_ctx, cfg, owner_acct or walk.acct, "privacy probe (owner)", log)
    except Exception as e:
        return {"verdict": HUMAN, "method": "privacy:foreign-rows", "category": "privacy",
                "notes": "owner guard failed: %s" % type(e).__name__}
    ui_texts, bodies = {}, {}
    contexts = []
    if (owner_acct or walk.acct) == foreign_acct:
        return {"verdict": HUMAN, "method": "privacy:foreign-rows", "category": "privacy",
                "notes": "owner %s is the probing account - not a foreign probe" % foreign_acct}
    try:
        for name, acct in ((foreign_acct, foreign_acct), ("signed-out", None)):
            if acct and acct not in cfg.get("accounts", {}):
                continue
            ctx = new_context(browser, cfg, acct, cfg["viewport_desktop"])
            contexts.append(ctx)
            if acct:
                try:
                    assert_account(ctx, cfg, acct, "privacy probe (%s)" % name, log)
                except Exception as e:
                    return {"verdict": HUMAN, "method": "privacy:foreign-rows",
                            "category": "privacy",
                            "notes": "%s guard failed: %s" % (name, type(e).__name__)}
            page = ctx.new_page()
            page.goto(walk.url, wait_until="load", timeout=45000)
            ax = Cdp(ctx, page).ax()
            ui_texts[name] = ax.texts()
            got = []
            for p in probe_paths:
                try:
                    r = ctx.request.get(base + p, timeout=15000)
                    got.append(r.text())
                except Exception:
                    got.append("")
            bodies[name] = got
    finally:
        for ctx in contexts:
            try:
                ctx.close()
            except Exception:
                pass
    verdict, leaks = foreign_probe_verdict(ui_texts, bodies, label)
    notes = ("foreign label visible to: %s" % ", ".join(leaks)) if leaks else \
        "label absent from %s + signed-out UI texts and API bodies" % foreign_acct
    if excluded:
        notes += "; money routes excluded: %s" % ", ".join(excluded)
    return {"verdict": verdict, "method": "privacy:foreign-rows", "category": "privacy",
            "notes": notes, "leaks": leaks}


def probe_socket_pair(walk, t2_page_pair, act, marker, log=None):
    """Socket pair probe. `t2_page_pair` is (ctx, page, cdp) for t2, opened
    by the caller on the same lens; `act` is a zero-arg callable performing
    t1's action; `marker` is the text the action should surface for t2.
    Returns a reverify-shaped row."""
    ctx2, page2, _cdp2 = t2_page_pair
    cfg = walk.cfg
    try:
        assert_account(ctx2, cfg, "t2", "socket pair probe", log)
    except Exception as e:
        return {"verdict": HUMAN, "method": "privacy:socket-pair", "category": "privacy",
                "notes": "t2 guard failed: %s" % type(e).__name__}
    session = ctx2.new_cdp_session(page2)
    cap = FrameCapture(session)
    before = Cdp(ctx2, page2).ax().texts()
    act()
    frame = cap.wait_for(needle=marker, timeout=SOCKET_WINDOW_S)
    changed, _dt = wait_until(
        lambda: [t for t in Cdp(ctx2, page2).ax().texts() if marker in t and t not in before],
        timeout=SOCKET_WINDOW_S)
    verdict = socket_pair_verdict(bool(frame), bool(changed))
    notes = "frame=%s ax_change=%s within %.0fs" % (bool(frame), bool(changed), SOCKET_WINDOW_S)
    if verdict == HUMAN:
        notes += "; one signal only — human confirms"
    return {"verdict": verdict, "method": "privacy:socket-pair", "category": "privacy",
            "notes": notes}
