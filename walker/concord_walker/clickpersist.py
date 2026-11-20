"""WALK-04e — click-sends-request + reload persistence recipes (GB-1544, seat B10).

Self-contained slice module at build; the dispatch driver at the bottom of
this file is the WALK-04e wiring leg that routes reverify categories into
the recipes. Recipes operate on a
page + Cdp pair (as produced by LensWalk.open in checks.py) and return
reverify-shaped result dicts {verdict, method, category, evidence, notes}.

Verdict vocabulary mirrors concord_walker.reverify (FIXED / STILL_FAILING /
NEEDS_HUMAN) — the values are defined locally, not imported, so a future
dispatch import from reverify cannot create an import cycle. The records layer
maps STILL_FAILING -> REOPENED on a FIXED_PENDING_VERIFY / VERIFIED prior and
FIXED -> VERIFIED (see reverify.status_update); this module invents no terms.

Mapping of record for this slice:
  toast-only / no-request / 5xx / missing-after-reload / computed mismatch
      -> STILL_FAILING
  full reload + new-context read-back
      -> FIXED
  element missing / cannot reproduce / observation layer unavailable
      -> NEEDS_HUMAN

No page JavaScript anywhere: CDP protocol domains + Playwright mouse/keyboard
only. Network evidence comes from the CDP Network domain on the walker's own
CDP session (this slice's own capture; not shared with other slices).
"""
import re, time, zlib
from datetime import datetime
from zoneinfo import ZoneInfo

from .cdp import wait_until

FIXED, STILL, HUMAN = "FIXED", "STILL_FAILING", "NEEDS_HUMAN"
TZ = ZoneInfo("America/New_York")

CLICKABLE_ROLES = ("button", "link", "menuitem", "menuitemcheckbox", "menuitemradio",
                   "tab", "switch", "checkbox", "radio", "option")
TOAST_WORDS = re.compile(r"(?i)\b(saved|created|added|updated|deleted|done|success|"
                         r"submitted|uploaded|recorded|published)\b")
AMOUNT = re.compile(r"-?\$?\s?\d[\d,]*\.\d{2}\b|-?\$?\s?\d[\d,]*\b")
WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


# --------------------------------------------------------------------------
# Network capture (CDP Network domain, this slice's own)
# --------------------------------------------------------------------------
class NetworkTap:
    """Records Network-domain events from an existing Cdp session.

    arm() enables the Network domain and subscribes to its events. If the
    session cannot carry protocol events, arm() raises and the calling recipe
    must degrade to NEEDS_HUMAN — an unobserved click proves nothing either
    way, and this slice never guesses a verdict it did not observe.
    """

    def __init__(self, cdp):
        self.cdp = cdp
        self.requests = []    # {rid, url, method, ts}
        self.responses = []   # {rid, url, status, ts}
        self.failures = []    # {rid, url, error, ts}
        self.armed = False

    def arm(self):
        s = self.cdp.s
        s.send("Network.enable")
        s.on("Network.requestWillBeSent", self._on_request)
        s.on("Network.responseReceived", self._on_response)
        s.on("Network.loadingFailed", self._on_failure)
        self.armed = True
        return self

    # Playwright CDP event payloads are plain dicts.
    def _on_request(self, ev):
        req = ev.get("request") or {}
        self.requests.append({"rid": ev.get("requestId"), "url": req.get("url", ""),
                              "method": (req.get("method") or "GET").upper(), "ts": time.time()})

    def _on_response(self, ev):
        resp = ev.get("response") or {}
        self.responses.append({"rid": ev.get("requestId"), "url": resp.get("url", ""),
                               "status": int(resp.get("status") or 0), "ts": time.time()})

    def _on_failure(self, ev):
        self.failures.append({"rid": ev.get("requestId"), "url": "",
                              "error": ev.get("errorText", ""), "ts": time.time()})

    def since(self, t0, pattern=None):
        out = [r for r in self.requests if r["ts"] >= t0]
        if pattern:
            out = [r for r in out if re.search(pattern, r["url"])]
        return out

    def writes_since(self, t0, pattern=None):
        return [r for r in self.since(t0, pattern) if r["method"] in WRITE_METHODS]

    def status_of(self, rid):
        for r in self.responses:
            if r["rid"] == rid:
                return r["status"]
        return None

    def statuses_since(self, t0, pattern=None):
        rids = {r["rid"] for r in self.since(t0, pattern)}
        return [r["status"] for r in self.responses if r["rid"] in rids]


# --------------------------------------------------------------------------
# AX helpers (pure — unit-tested without a browser)
# --------------------------------------------------------------------------
def ax_names(ax):
    return {n.name for n in ax.live() if n.name}


def ax_diff(before, after):
    b, a = ax_names(before), ax_names(after)
    return {"appeared": sorted(a - b), "gone": sorted(b - a)}


def find_clickable(ax, name_pattern):
    """First enabled clickable node whose name matches the pattern (regex, case-insensitive)."""
    for n in ax.live():
        if n.role in CLICKABLE_ROLES and n.backend and not n.disabled:
            if re.search(name_pattern, n.name or "", re.I):
                return n
    return None


def toast_seen(ax):
    for n in ax.live():
        if n.role in ("status", "alert") and n.name and TOAST_WORDS.search(n.name):
            return n.name
    return None


def label_visible(ax, label):
    return any(label in (n.name or "") for n in ax.live())


# --------------------------------------------------------------------------
# Decision tables (pure — the verdict logic, unit-tested without a browser)
# --------------------------------------------------------------------------
def decide_click(*, element_found, has_box, statuses, any_request, toast,
                 ax_changed, record_after_reload):
    """Map observed click evidence to a verdict. record_after_reload is
    True/False when a label read-back was performed, None when not applicable."""
    if not element_found:
        return HUMAN, "named control not found on the lens (element missing)"
    if not has_box:
        return STILL, "control is in the AX tree but has no rendered box — not clickable"
    if any(s >= 500 for s in statuses):
        return STILL, "click fired a request that returned 5xx (%s)" % [s for s in statuses if s >= 500]
    if not any_request:
        if toast and record_after_reload is not True:
            return STILL, "toast-only success: '%s' shown, no request fired, no record behind it" % toast
        if not ax_changed:
            return STILL, "dead click: no request fired and the AX tree did not change"
        return STILL, "no request fired; the change is local-only and does not persist as a record"
    # A request fired and did not 5xx.
    if record_after_reload is False:
        return STILL, "request succeeded but the record is not visible after reload"
    if record_after_reload is True:
        return FIXED, "request fired (%s), record visible after reload" % (statuses or ["2xx"])
    if ax_changed or statuses:
        return FIXED, "request fired (%s) and the surface updated" % (statuses or ["2xx"])
    return STILL, "request fired but nothing on the surface changed"


def decide_persistence(*, seen_now, seen_after_reload, seen_new_context):
    if not seen_now:
        return HUMAN, "labelled fixture not present to test (create side not exercised here)"
    if not seen_after_reload:
        return STILL, "fixture present before reload, gone after reload"
    if not seen_new_context:
        return STILL, "fixture survives reload but not a new context (session-local only)"
    return FIXED, "fixture read back after reload and in a new context"


# --------------------------------------------------------------------------
# Computed-value oracle (pure)
# --------------------------------------------------------------------------
def parse_amounts(text):
    out = []
    for m in AMOUNT.finditer(text or ""):
        raw = m.group(0).replace("$", "").replace(",", "").strip()
        try:
            out.append(float(raw))
        except ValueError:
            pass
    return out


def _amount_after(keyword, text):
    """The first amount appearing after the LAST use of keyword, or None.
    The computed value a ticket asserts is the one bound to its keyword —
    matching ANY amount anywhere false-matches quantities and unit prices
    (a wrong total still 'matches' via the quantity)."""
    idx = (text or "").lower().rfind(keyword)
    if idx < 0:
        return None
    amts = parse_amounts(text[idx:])
    return amts[0] if amts else None


def expected_amounts(ticket_text_value):
    """The amount the ticket asserts: the one bound to 'expected', else the
    one bound to 'total', else any amount present (weakest form)."""
    txt = ticket_text_value or ""
    for kw in ("expected", "total"):
        amt = _amount_after(kw, txt)
        if amt is not None:
            return [amt]
    return parse_amounts(txt)


def amounts_match(expected, displayed, tol_abs=0.01, tol_rel=0.001):
    return any(abs(e - d) <= max(tol_abs, tol_rel * abs(e)) for e in expected for d in displayed)


def tz_date_strings(ts=None):
    """The current date in America/New_York in the shapes lenses display."""
    dt = datetime.fromtimestamp(ts if ts is not None else time.time(), TZ)
    return {dt.strftime("%Y-%m-%d"), dt.strftime("%b %d, %Y").replace(" 0", " "),
            dt.strftime("%B %d, %Y").replace(" 0", " "), dt.strftime("%m/%d/%Y")}


def decide_computed(*, displayed_text, ticket_text_value):
    exps = expected_amounts(ticket_text_value)
    if exps:
        disp_total = _amount_after("total", displayed_text)
        disps = [disp_total] if disp_total is not None else parse_amounts(displayed_text)
        if amounts_match(exps, disps):
            return FIXED, "displayed value matches the ticket's expected %s (displayed %s)" % (exps, disps)
        return STILL, "computed mismatch: ticket expects %s, lens displays %s" % (exps, disps)
    # Date-shaped expectations compare in America/New_York.
    dates = set(re.findall(r"\d{4}-\d{2}-\d{2}", ticket_text_value or "")) & tz_date_strings()
    if dates and any(d in (displayed_text or "") for d in dates):
        return FIXED, "displayed date matches the ticket's expected date in America/New_York"
    return HUMAN, "ticket names no comparable expected value (no oracle available)"


# --------------------------------------------------------------------------
# PNG uniformity probe (pure; screenshot pixel evidence without image libs)
# --------------------------------------------------------------------------
def png_distinct_values(png_bytes):
    """Decompress the IDAT stream and count distinct byte values.
    A uniform (blank / solid) screenshot yields very few; a real thumbnail
    yields many. Returns None when the bytes are not a decodable PNG."""
    try:
        if not png_bytes or png_bytes[:8] != b"\x89PNG\r\n\x1a\n":
            return None
        pos, idat = 8, b""
        while pos + 8 <= len(png_bytes):
            ln = int.from_bytes(png_bytes[pos:pos + 4], "big")
            typ = png_bytes[pos + 4:pos + 8]
            if typ == b"IDAT":
                idat += png_bytes[pos + 8:pos + 8 + ln]
            pos += 12 + ln
        raw = zlib.decompress(idat)
        return len(set(raw))
    except Exception:
        return None


def png_looks_uniform(png_bytes, threshold=10):
    d = png_distinct_values(png_bytes)
    return None if d is None else d < threshold


# --------------------------------------------------------------------------
# Recipes (browser-driving; verdicts decided by the pure tables above)
# --------------------------------------------------------------------------
def _shot(walk, page, name):
    try:
        return walk.shot(page, name)
    except Exception:
        return None


def click_recipe(walk, page, cdp, *, element_name, label=None, request_pattern=None,
                 timeout=6.0):
    """Dead-click recipe: click the named control; prove a request fired;
    read the record back after reload when a label is known."""
    ax0 = cdp.ax()
    node = find_clickable(ax0, element_name)
    if node is None:
        return {"verdict": HUMAN, "method": "click + network tap", "category": "dead_click",
                "evidence": [_shot(walk, page, "click-element-missing")],
                "notes": "named control '%s' not found among clickable elements" % element_name}
    try:
        tap = NetworkTap(cdp).arm()
    except Exception as e:
        return {"verdict": HUMAN, "method": "click + network tap", "category": "dead_click",
                "evidence": [], "notes": "network tap unavailable (%s); click not judged unobserved" % e}
    has_box = cdp.box(node.backend) is not None
    t0 = time.time()
    clicked = False
    if has_box:
        clicked = bool(cdp.click(node.backend))
    wait_until(lambda: tap.since(t0, request_pattern) or tap.failures, timeout=timeout, step=0.1)
    time.sleep(0.5)
    ax1 = cdp.ax()
    diff = ax_diff(ax0, ax1)
    toast = toast_seen(ax1)
    reqs = tap.since(t0, request_pattern)
    statuses = tap.statuses_since(t0, request_pattern)
    record = None
    if label:
        try:
            page.reload(wait_until="load", timeout=15000)
        except Exception:
            pass
        record = label_visible(cdp.ax(), label)
    verdict, why = decide_click(element_found=True, has_box=has_box and clicked,
                                statuses=statuses, any_request=bool(reqs), toast=toast,
                                ax_changed=bool(diff["appeared"] or diff["gone"]),
                                record_after_reload=record)
    return {"verdict": verdict, "method": "click + network tap + reload read-back",
            "category": "dead_click",
            "evidence": [_shot(walk, page, "click-after")],
            "notes": "%s. requests=%s statuses=%s toast=%r appeared=%s" %
                     (why, [(r["method"], r["url"][-60:]) for r in reqs], statuses, toast, diff["appeared"][:4])}


def persistence_recipe(walk, page, cdp, *, label, open_fresh, close_ctx):
    """Persistence recipe: the labelled fixture must read back after a reload
    AND in a brand-new context. open_fresh() -> (ctx, page, cdp) on the same
    lens with the same account; close_ctx(ctx) disposes it."""
    seen_now = label_visible(cdp.ax(), label)
    seen_reload = None
    if seen_now:
        try:
            page.reload(wait_until="load", timeout=15000)
        except Exception:
            pass
        seen_reload = label_visible(cdp.ax(), label)
    seen_new = None
    if seen_reload:
        ctx2 = None
        try:
            ctx2, page2, cdp2 = open_fresh()
            seen_new = label_visible(cdp2.ax(), label)
        except Exception:
            seen_new = None
        finally:
            if ctx2 is not None:
                close_ctx(ctx2)
    if seen_now and seen_reload and seen_new is None:
        return {"verdict": HUMAN, "method": "reload + new-context read-back", "category": "persistence",
                "evidence": [_shot(walk, page, "persist-reload")],
                "notes": "new-context read-back could not be performed; persistence not judged on reload alone"}
    verdict, why = decide_persistence(seen_now=bool(seen_now), seen_after_reload=bool(seen_reload),
                                      seen_new_context=bool(seen_new))
    return {"verdict": verdict, "method": "reload + new-context read-back", "category": "persistence",
            "evidence": [_shot(walk, page, "persist-final")], "notes": why + " (label %r)" % label}


def computed_recipe(walk, page, cdp, *, ticket_text_value, display_pattern=None):
    """Computed-value oracle: compare the value the lens displays against the
    value the ticket expects (amounts, or today's date in America/New_York)."""
    ax = cdp.ax()
    texts = [n.name for n in ax.live() if n.name]
    if display_pattern:
        texts = [t for t in texts if re.search(display_pattern, t, re.I)] or texts
    displayed = " | ".join(texts)
    verdict, why = decide_computed(displayed_text=displayed, ticket_text_value=ticket_text_value)
    return {"verdict": verdict, "method": "computed-value oracle", "category": "computed",
            "evidence": [_shot(walk, page, "computed")], "notes": why}


def find_file_input_backend(cdp):
    """Locate input[type=file] via the CDP DOM domain (no page script)."""
    try:
        doc = cdp.s.send("DOM.getDocument", {"depth": -1})
        root = doc["root"]["nodeId"]
        res = cdp.s.send("DOM.querySelectorAll", {"nodeId": root, "selector": "input[type='file']"})
        ids = res.get("nodeIds") or []
        if not ids:
            return None
        desc = cdp.s.send("DOM.describeNode", {"nodeId": ids[0]})
        return (desc.get("node") or {}).get("backendNodeId")
    except Exception:
        return None


def upload_recipe(walk, page, cdp, *, fixture_path, fixture_name, timeout=6.0):
    """Upload lane: set a tiny fixture file via DOM.setFileInputFiles, prove
    the upload fired, and read back a non-uniform thumbnail + the file name."""
    backend = find_file_input_backend(cdp)
    if backend is None:
        return {"verdict": HUMAN, "method": "CDP upload", "category": "upload",
                "evidence": [_shot(walk, page, "upload-no-input")],
                "notes": "no input[type=file] found on the lens (element missing)"}
    try:
        tap = NetworkTap(cdp).arm()
    except Exception as e:
        return {"verdict": HUMAN, "method": "CDP upload", "category": "upload",
                "evidence": [], "notes": "network tap unavailable (%s); upload not judged unobserved" % e}
    t0 = time.time()
    try:
        cdp.s.send("DOM.setFileInputFiles", {"files": [fixture_path], "backendNodeId": backend})
    except Exception as e:
        return {"verdict": HUMAN, "method": "CDP upload", "category": "upload",
                "evidence": [], "notes": "DOM.setFileInputFiles failed (%s)" % e}
    wait_until(lambda: tap.since(t0) or tap.failures, timeout=timeout, step=0.1)
    time.sleep(0.5)
    statuses = tap.statuses_since(t0)
    ax1 = cdp.ax()
    name_back = label_visible(ax1, fixture_name)
    shot_bytes = None
    try:
        shot_bytes = page.screenshot()
    except Exception:
        pass
    uniform = png_looks_uniform(shot_bytes) if shot_bytes else None
    if any(s >= 500 for s in statuses):
        verdict, why = STILL, "upload request returned 5xx (%s)" % [s for s in statuses if s >= 500]
    elif not tap.since(t0) and not name_back:
        verdict, why = STILL, "file set on the input but no request fired and no read-back appeared"
    elif not name_back:
        verdict, why = STILL, "upload fired but the file name never reads back on the lens"
    elif uniform is True:
        verdict, why = STILL, "read-back present but the rendered surface is a uniform blank (no thumbnail)"
    else:
        verdict, why = FIXED, "upload fired (%s), file name reads back, surface renders content" % (statuses or ["2xx"])
    return {"verdict": verdict, "method": "CDP upload (DOM.setFileInputFiles)", "category": "upload",
            "evidence": [_shot(walk, page, "upload-after")], "notes": why}


# --------------------------------------------------------------------------
# Reverify dispatch (WALK-04e wiring)
#
# reverify.generic() routes the dead_click / computed / upload categories
# here, and persistence tickets that name their fixture. The driver opens
# its own LensWalk in the standing driver pattern (cf. chatcheck's
# run_chat_check and reverify's _hidden_text) and hands the walk to the
# recipes above. Heavy imports are function-level on purpose: this module
# stays importable standalone (its selftest loads it without the walker
# core), and reverify imports this module at its own top level.
# --------------------------------------------------------------------------

def _fixture_png_bytes():
    """A tiny deterministic PNG with varied pixels (never a uniform blank),
    built from zlib/struct so the upload fixture needs no shipped binary."""
    import struct

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    w, h = 8, 8
    raw = b""
    for y in range(h):
        raw += b"\x00" + bytes(v for x in range(w)
                               for v in ((x * 31 + y * 17) % 256, (x * 7 + y * 41) % 256,
                                         (x * 13 + y * 3) % 256))
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def _open_driver_walk(rv, t, label, account=None):
    """Open this driver's own LensWalk on the ticket's lens and account,
    assert the account, and navigate. Returns (lw, ctx, page, cdp).
    `account` overrides the walk account (ULW v3 W4: uploads are test
    writes and run as the write account, not the observer)."""
    from .checks import LensWalk
    from .auth import assert_account
    lens = t["lens"]
    acct, admin = rv.account_for(lens)
    if account:
        acct = account
    lw = LensWalk(rv.b, rv.cfg, rv.rec, rv.inv[lens], acct, rv.log,
                  admin=admin, inv_entry=rv.inv[lens])
    ctx, page, cdp = lw.open()
    if acct:
        assert_account(ctx, rv.cfg, acct, label, rv.log)
    lw.nav(page, cdp)
    return lw, ctx, page, cdp


def run_clickpersist_check(rv, t, cat):
    """Drive one dead_click / computed / upload ticket. rv is the
    Reverifier (browser, cfg, rec, inv, account_for). Returns the standing
    verdict dict shape, from the recipes above."""
    from .reverify import elements, ticket_text
    # ULW v3 W4: the upload recipe writes a fixture file to the lens - a test
    # write, routed through the write account like every other write recipe.
    _acct = None
    if cat == "upload":
        from .auth import write_account_key
        _acct = write_account_key(rv.cfg)
    lw, ctx, page, cdp = _open_driver_walk(rv, t, "clickpersist %s check" % cat, account=_acct)
    try:
        if cat == "dead_click":
            elems = elements(t)
            if not elems:
                return {"verdict": HUMAN, "method": "click + network tap",
                        "category": "dead_click",
                        "evidence": [_shot(lw, page, "click-no-element")],
                        "notes": "ticket names no control to click; an unnamed click cannot be judged"}
            label = elems[1] if len(elems) > 1 else None
            return click_recipe(lw, page, cdp, element_name=elems[0], label=label)
        if cat == "computed":
            return computed_recipe(lw, page, cdp, ticket_text_value=ticket_text(t))
        # upload: a fresh named fixture per run, so the read-back name is
        # this run's own and never a previous run's leftover.
        import os, tempfile
        fixture_name = "%s-upload-%s.png" % (rv.cfg["fixture_prefix"], rv.rec.rid)
        fixture_path = os.path.join(tempfile.mkdtemp(prefix="walk04e-"), fixture_name)
        with open(fixture_path, "wb") as f:
            f.write(_fixture_png_bytes())
        try:
            return upload_recipe(lw, page, cdp, fixture_path=fixture_path,
                                 fixture_name=fixture_name)
        finally:
            try:
                os.unlink(fixture_path)
            except Exception:
                pass
    finally:
        lw._close(ctx)


def run_persistence_check(rv, t):
    """Drive the persistence recipe for a ticket that names its created
    fixture. Returns None when the ticket names no label — the caller's
    smoke path then keeps its standing decision."""
    from .reverify import elements
    from .auth import new_context
    from .cdp import Cdp
    elems = elements(t)
    if not elems:
        return None
    label = elems[0]
    lw, ctx, page, cdp = _open_driver_walk(rv, t, "clickpersist persistence check")

    def open_fresh():
        acct, _admin = rv.account_for(t["lens"])
        ctx2 = new_context(rv.b, rv.cfg, acct, rv.cfg["viewport_desktop"])
        page2 = ctx2.new_page()
        page2.goto(lw.url, wait_until="load", timeout=45000)
        return ctx2, page2, Cdp(ctx2, page2)

    try:
        return persistence_recipe(lw, page, cdp, label=label, open_fresh=open_fresh,
                                  close_ctx=lambda c: c.close())
    finally:
        lw._close(ctx)
