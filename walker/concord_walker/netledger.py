"""MST-W0-02: per-control endpoint ledger.

Every walker activation (load, tab click, opener click, Escape, export, write
step, 390 load, sweep click) opens a *control window*. Same-origin API requests
that START inside the window are attributed to that control. Attribution uses
the browser's own request start time (Playwright request.timing.startTime, epoch
ms) so late event delivery in the sync API cannot shift a request onto the
wrong control; the CDP Network.requestWillBeSent initiator type is kept when the
CDP session is wired (Cdp.watch_initiators).

Window rule (WALKER-PREMAP-SPEC 3.1): a timed window stays open 1.5 s after it
opens or after the last request attributed to it started, capped at 5 s. A
sticky window (page load) stays open until close_window(). Requests outside any
window go to `load:page:-` with background=True (polling, late fetches).

Redaction (spec 3.2, binding): no bodies, no field values (only the boolean
flags whitelist), no header values, no cookies, no query values (sorted key list
only), third-party URLs counted by host only. Paths are templated.

No page JS: Playwright event hooks, request/response objects and CDP only.
"""
import hashlib, json, re, time
from collections import OrderedDict, Counter
from urllib.parse import urlsplit, parse_qsl

WRITE_METHODS = ("POST", "PUT", "PATCH", "DELETE")
API_TYPES = ("fetch", "xhr", "eventsource", "websocket")
MAX_BODY = 256 * 1024
CAPS = {"per_control": 60, "per_lens": 400, "controls": 120, "keys": 40}
WIN_GAP_S, WIN_CAP_S = 1.5, 5.0
LOAD_CONTROL = "load:page:-"

_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_NUM = re.compile(r"^\d+$")
_HEX = re.compile(r"^[0-9a-fA-F]{12,}$")
_MIXED = re.compile(r"^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9_.~%-]{16,}$")
_ACTION_TOKEN = re.compile(r"^[A-Za-z0-9._-]{1,64}$")  # real actions are camelCase (balanceReaction, beamStudy)
_SLUG = re.compile(r"[^a-z0-9]+")


def template_segment(seg):
    if seg == "":
        return seg
    if _NUM.match(seg):
        return ":n"
    if _UUID.match(seg):
        return ":uuid"
    if _HEX.match(seg):
        return ":hex"
    if _MIXED.match(seg):
        return ":id"
    if len(seg) > 40:
        return ":long"
    return seg


def template_path(path):
    """'/api/dtus/123/x?b=1&a=2' -> ('/api/dtus/:n/x', ['a', 'b'])."""
    p, _, q = (path or "/").partition("?")
    segs = [template_segment(s) for s in p.split("/")]
    keys = sorted({k for k, _ in parse_qsl(q, keep_blank_values=True)})
    return "/".join(segs) or "/", keys


def _tag(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "b"
    if isinstance(v, (int, float)):
        return "n"
    if isinstance(v, str):
        return "s"
    if isinstance(v, list):
        return "a"
    return "o"


def key_shape(obj, limit=CAPS["keys"]):
    """Top-level keys with type tags only (values are never kept)."""
    if not isinstance(obj, dict):
        return None
    return {k: _tag(obj[k]) for k in sorted(obj)[:limit]}


def flags_of(obj):
    """Boolean whitelist: ok, signed (bool values); receiptId / signingReason (presence only).
    Looks at the top level and inside `result` (the lens-run envelope)."""
    if not isinstance(obj, dict):
        return None
    scopes = [obj] + ([obj["result"]] if isinstance(obj.get("result"), dict) else [])
    f = {}
    for s in scopes:
        for k in ("ok", "signed"):
            if k in s and isinstance(s[k], bool) and k not in f:
                f[k] = s[k]
        f["has_receiptId"] = f.get("has_receiptId", False) or ("receiptId" in s)
        f["has_signingReason"] = f.get("has_signingReason", False) or ("signingReason" in s)
    return f


def lens_action(method, path_t, post_json):
    """POST /api/lens/run {domain, action} -> {domain, action}; GET /api/lens/:domain[/:id] -> {domain, op}."""
    if method == "POST" and path_t.rstrip("/") == "/api/lens/run" and isinstance(post_json, dict):
        d, a = post_json.get("domain"), post_json.get("action")
        if isinstance(d, str) and isinstance(a, str) and _ACTION_TOKEN.match(d) and _ACTION_TOKEN.match(a):
            return {"domain": d, "action": a}
        return None
    if method == "GET":
        segs = path_t.strip("/").split("/")
        if len(segs) in (3, 4) and segs[:2] == ["api", "lens"] and _ACTION_TOKEN.match(segs[2]) and segs[2] != "run":
            return {"domain": segs[2], "op": "list" if len(segs) == 3 else "get"}
    return None


_NORM_WS = re.compile(r"\s+")
_NORM_NUM = re.compile(r"\d+")
# a11y containers that make a control's place on the page, not its sibling index
PATH_ROLES = ("dialog", "alertdialog", "navigation", "banner", "main", "complementary", "contentinfo", "region",
              "tablist", "toolbar", "menu", "menubar", "form", "search", "tabpanel", "listbox", "grid", "tree")


def norm_name(name):
    """Whitespace-collapsed, case-folded, digits -> '#' ('Notifications (30 unread)' == 'notifications (# unread)')."""
    return _NORM_NUM.sub("#", _NORM_WS.sub(" ", (name or "").strip()).lower())


def stable_id(role, name, path=()):
    """Upgrade 5: c_<12 hex> from role + normalized accessible name + a11y container path.
    Sibling order and whitespace/number churn in the name do not change it."""
    key = "%s|%s|%s" % ((role or "page").lower(), norm_name(name), "/".join(path))
    return "c_" + hashlib.sha1(key.encode("utf-8")).hexdigest()[:12]


def a11y_path(ax, node):
    """Container chain (role:normalized-name) for node, outermost first."""
    out = []
    try:
        for a in ax.ancestors(node):
            if a.role in PATH_ROLES:
                out.append("%s:%s" % (a.role, norm_name(a.name)[:40]))
    except Exception:
        return ()
    return tuple(reversed(out))


ERROR_KINDS = ("exception", "rejection", "boundary", "console", "asset_fail", "crash")
_REJECTION = re.compile(r"(?i)unhandled ?(promise )?rejection|uncaught \(in promise\)")
_BOUNDARY = re.compile(r"(?i)the above error occurred in|error boundary|minified react error|react will try to recreate")
STATIC_TYPES = ("script", "stylesheet", "image", "font", "media")
# Telemetry beacons are not user actions: never a write for read-back, never a control failure,
# never replayed as t2 (live run 2026-11-16: POST /api/metrics/vitals made 5 false fake_success).
TELEMETRY_RE = re.compile(r"^/api/(metrics|telemetry|analytics|vitals|rum|beacons?|perf|track|tracking|"
                          r"client-?(errors?|logs?)|errors/report|logs?|heartbeat|presence|events/track)(/|$)", re.I)
# A client-side cancel (Next.js prefetch abort, navigation, unmount) is not a failed request.
ABORTED = ("net::ERR_ABORTED", "aborted")


def is_telemetry(path, rtype=None):
    return rtype in ("ping", "beacon") or bool(TELEMETRY_RE.match(path or ""))


def is_aborted(err):
    return bool(err) and any(a in str(err) for a in ABORTED)


def control_id(phase, role, name):
    slug = _SLUG.sub("-", (name or "").lower()).strip("-")[:48] or "-"
    return "%s:%s:%s" % (phase, role or "page", slug)


class NetLedger:
    def __init__(self, base_url, clock=time.time, stamp=None, slow_ms=3000, long_task_ms=1000, shapes=False):
        self.shapes = shapes      # --capture-wiring: also record request/response SHAPES (types only, redacted keys); default off
        self.host = urlsplit(base_url).netloc
        self.clock = clock
        self.stamp = stamp or {}
        self.windows = []          # [{cid, t0, sticky, closed_at}]
        self.cur = None
        self.meta = OrderedDict()  # cid -> {phase, role, name, exercised, reason, effect_hint}
        self.raw = []              # pending raw entries
        self.done = []             # finalized entries
        self.console = []          # times of console errors
        self.third_party = Counter()
        self.static = 0
        self.overflow = 0
        self.initiators = {}       # (method, url) -> [types]
        self._live = {}            # id(request) -> pending entry
        self._static_live = {}     # id(request) -> templated static path
        self.resolved = []         # resolved rows, attributed in build()
        self.errors = []           # (t, kind, scrubbed msg) -- upgrade 1
        self.violations = []       # (t, kind, ms) long tasks / blocked handlers -- upgrade 4
        self.slow_ms, self.long_task_ms = slow_ms, long_task_ms
        self.replay = []           # IN MEMORY ONLY (never written): raw object calls for the t2 replay (upgrade 3)

    # ---------------------------------------------------------------- windows
    def open_window(self, phase, role, name, sticky=False, cid=None, sid=None):
        cid = cid or control_id(phase, role, name)
        if cid not in self.meta:
            self.meta[cid] = {"phase": phase, "role": role or "page", "name": name or "-",
                              "exercised": True, "reason": None, "effect_hint": None}
        self.meta[cid]["sid"] = sid or self.meta[cid].get("sid") or stable_id(role, name, (phase,) if sticky else ())
        if self.cur and self.cur["closed_at"] is None:
            self.cur["closed_at"] = self.clock()
        self.cur = {"cid": cid, "t0": self.clock(), "sticky": sticky, "closed_at": None, "last": None}
        self.windows.append(self.cur)
        return cid

    def close_window(self):
        if self.cur and self.cur["closed_at"] is None:
            self.cur["closed_at"] = self.clock()
        self.cur = None

    def note_control(self, phase, role, name, exercised, reason=None, cid=None, effect_hint=None, **extra):
        """A control row with no window (skipped, reused, or recorded by name)."""
        cid = cid or control_id(phase, role, name)
        m = self.meta.setdefault(cid, {"phase": phase, "role": role or "page", "name": name or "-",
                                       "exercised": exercised, "reason": reason, "effect_hint": effect_hint})
        if effect_hint:
            m["effect_hint"] = effect_hint
        m.update(extra)
        m.setdefault("sid", stable_id(role, name))
        return cid

    def annotate(self, cid, **kw):
        """Attach walker-side facts to a control row (fake_success, ownership, evidence, ax_ms...)."""
        if cid in self.meta:
            for k, v in kw.items():
                if isinstance(v, list):
                    self.meta[cid].setdefault(k, []).extend(v)
                else:
                    self.meta[cid][k] = v

    def set_effect(self, cid, effect):
        if cid in self.meta:
            self.meta[cid]["effect_hint"] = effect

    def _accepts(self, w, t):
        """Does window w contain a request that started at t? (mutates gap anchor on accept)"""
        if w["sticky"]:
            return w["closed_at"] is None or t <= w["closed_at"]
        anchor = w["last"] if w["last"] is not None else w["t0"]
        if t - w["t0"] <= WIN_CAP_S and t - anchor <= WIN_GAP_S:
            w["last"] = max(t, w["last"] or t)
            return True
        return False

    def _assign(self, t):
        """Window for a request that started at epoch t (seconds).
        A window that opened AFTER the request started must not steal it when an earlier
        window actually contains t; the 0.05s clock-skew slack applies only otherwise."""
        for w in reversed(self.windows):
            if w["t0"] <= t:
                if self._accepts(w, t):
                    return w, False
                break
        for w in reversed(self.windows):
            if t < w["t0"] <= t + 0.05:
                if self._accepts(w, t):
                    return w, False
                return None, True
        return None, True

    # ---------------------------------------------------------------- hooks
    def attach(self, page, account=None):
        # ULW C28: every recorded call is tagged with the account whose context made it, so the
        # isolation replay never replays an account's calls as that same account.
        page.on("request", lambda req: self._on_request(req, account))
        page.on("requestfinished", self._on_finished)
        page.on("requestfailed", self._on_failed)
        page.on("console", self._on_console)
        page.on("pageerror", self._on_pageerror)
        page.on("response", self._on_response)
        page.on("crash", lambda _p: self.errors.append((self.clock(), "crash", "renderer crashed")))

    def watch_initiators(self, cdp_session):
        try:
            cdp_session.send("Network.enable")
            cdp_session.on("Network.requestWillBeSent", self._on_cdp_request)
        except Exception:
            pass
        # upgrade 4: main-thread long tasks / blocked handlers via CDP violation reports (no page JS)
        try:
            cdp_session.send("Log.enable")
            cdp_session.send("Log.startViolationsReport", {"config": [
                {"name": "longTask", "threshold": self.long_task_ms},
                {"name": "blockedEvent", "threshold": self.long_task_ms},
                {"name": "handler", "threshold": self.long_task_ms}]})
            cdp_session.on("Log.entryAdded", self._on_log_entry)
        except Exception:
            pass

    _VIOL_MS = re.compile(r"(\d+)\s*ms")

    def _on_log_entry(self, ev):
        try:
            e = ev.get("entry") or {}
            if e.get("source") != "violation":
                return
            m = self._VIOL_MS.search(e.get("text") or "")
            ms = int(m.group(1)) if m else None
            if ms is None or ms >= self.long_task_ms:
                self.violations.append((self.clock(), "long_task", ms))
        except Exception:
            pass

    def note_freeze(self, ms, t=None):
        """The walker's own probe: the click ack / a CDP AX read took ms (main thread busy).
        t = when the click started, so it lands on that click's window."""
        self.violations.append((t if t is not None else self.clock(), "freeze", int(ms)))

    def _on_pageerror(self, err):
        try:
            msg = str(err)
        except Exception:
            msg = "error"
        kind = "rejection" if _REJECTION.search(msg) else "exception"
        self.errors.append((self.clock(), kind, _scrub(msg)))

    def _on_response(self, resp):
        try:
            if resp.status >= 400 and getattr(resp.request, "resource_type", None) in STATIC_TYPES:
                u = urlsplit(resp.url)
                if u.netloc == self.host:
                    self.errors.append((self.clock(), "asset_fail", "%d %s" % (resp.status, template_path(u.path)[0][:80])))
        except Exception:
            pass

    def _on_cdp_request(self, ev):
        try:
            r = ev.get("request") or {}
            key = (r.get("method"), r.get("url"))
            self.initiators.setdefault(key, []).append((ev.get("initiator") or {}).get("type"))
        except Exception:
            pass

    def _on_console(self, m):
        try:
            if m.type == "error":
                self.console.append(self.clock())
                txt = m.text or ""
                if _BOUNDARY.search(txt):
                    self.errors.append((self.clock(), "boundary", _scrub(txt)))
                elif _REJECTION.search(txt):
                    self.errors.append((self.clock(), "rejection", _scrub(txt)))
                elif not txt.startswith("Failed to load resource"):
                    self.errors.append((self.clock(), "console", _scrub(txt)))
        except Exception:
            pass

    def _on_request(self, req, account=None):
        try:
            u = urlsplit(req.url)
        except Exception:
            return
        if u.scheme in ("data", "blob", "chrome-extension"):
            return
        if u.netloc != self.host:
            self.third_party[u.netloc or "?"] += 1
            return
        rtype = getattr(req, "resource_type", None)
        is_doc = rtype == "document"
        if not (rtype in API_TYPES or u.path.startswith("/api/") or is_doc):
            self.static += 1
            self._static_live[id(req)] = template_path(u.path)[0][:80]
            return
        e = {"req": req, "t_seen": self.clock(), "failed": None, "finished": False, "acct": account}
        self.raw.append(e)
        self._live[id(req)] = e

    def _on_finished(self, req):
        e = self._live.pop(id(req), None)
        if e is not None:
            e["finished"] = True

    def _on_failed(self, req):
        sp = self._static_live.pop(id(req), None)
        if sp is not None:
            try:
                why = (req.failure or "failed")[:30]
            except Exception:
                why = "failed"
            if "ERR_ABORTED" not in why:  # navigation-cancelled assets are not failures
                self.errors.append((self.clock(), "asset_fail", "%s %s" % (why, sp)))
            return
        e = self._live.pop(id(req), None)
        if e is not None:
            try:
                e["failed"] = (req.failure or "failed")[:40]
            except Exception:
                e["failed"] = "failed"

    # ---------------------------------------------------------------- finalize
    def flush(self):
        """Resolve pending entries (status, timing, sizes, key shapes). Called from the
        main flow (window change, page close, record build) -- never from a handler."""
        raw, self.raw = self.raw, []
        self._live = {}
        rows = []
        for e in raw:
            rows.append(self._resolve(e))
        self.resolved.extend(rows)

    def _polling_templates(self, rows):
        """GET templates that repeat at a steady interval (spec 3.1: background polling
        stays on load:page:-). >=3 starts inside load windows, or >=4 overall, with a
        coefficient of variation of the intervals under 0.5."""
        by = {}
        for r in rows:
            if r["method"] == "GET" and r.get("type") != "document":
                by.setdefault(r["path"], []).append(r["_t"])
        def steady(ts):
            ts = sorted(ts)
            gaps = [b - a for a, b in zip(ts, ts[1:])]
            mean = sum(gaps) / len(gaps)
            if mean <= 0:
                return False
            var = sum((g - mean) ** 2 for g in gaps) / len(gaps)
            return (var ** 0.5) / mean < 0.5

        # polling = repeats inside ONE page lifetime (between navigations); a call that
        # merely recurs once per reload is not polling
        starts = sorted(w["t0"] for w in self.windows if w["sticky"])
        out = set()
        for path, ts in by.items():
            seg = {}
            for t in ts:
                i = sum(1 for s0 in starts if s0 <= t + 0.05)
                seg.setdefault(i, []).append(t)
            if any(len(v) >= 3 and (steady(v) or _steady_run(sorted(v))) for v in seg.values()):
                out.add(path)
        return out

    def _in_sticky(self, t):
        return any(w["sticky"] and w["t0"] <= t and (w["closed_at"] is None or t <= w["closed_at"]) for w in self.windows)

    def _assign_all(self):
        rows = sorted(self.resolved, key=lambda r: r["_t"])
        polling = self._polling_templates(rows)
        for w in self.windows:
            w["last"] = None
        self.done = []
        for r in rows:
            if r["path"] in polling and r["method"] == "GET":
                w, bg = (None, True)
                r["polling"] = True
                sticky = [x for x in self.windows if x["sticky"] and x["t0"] <= r["_t"] and
                          (x["closed_at"] is None or r["_t"] <= x["closed_at"])]
                if sticky:
                    w, bg = sticky[-1], False
            else:
                w, bg = self._assign(r["_t"])
            r["_cid"] = w["cid"] if w else LOAD_CONTROL
            if bg:
                r["background"] = True
                self.meta.setdefault(LOAD_CONTROL, {"phase": "load", "role": "page", "name": "-",
                                                    "exercised": True, "reason": None, "effect_hint": None})
            self.done.append(r)

    def _resolve(self, e):
        req = e["req"]
        method = getattr(req, "method", "GET")
        u = urlsplit(req.url)
        path_t, qkeys = template_path(u.path + ("?" + u.query if u.query else ""))
        t = e["t_seen"]
        timing = {}
        try:
            timing = req.timing or {}
            st = timing.get("startTime")
            if st and st > 0:
                t = st / 1000.0
        except Exception:
            pass
        rtype = getattr(req, "resource_type", None)
        tele = is_telemetry(path_t, rtype)
        row = {"_t": t, "method": method, "path": path_t, "type": rtype,
               "write": method in WRITE_METHODS and not tele}
        if tele:
            row["telemetry"] = True
        if qkeys:
            row["query_keys"] = qkeys[:CAPS["keys"]]
        ini = self.initiators.get((method, req.url))
        if ini:
            row["initiator"] = ini.pop(0)
        post_json = None
        try:
            pd = req.post_data
            if pd:
                row["req_bytes"] = len(pd.encode("utf-8", "replace"))
                try:
                    post_json = json.loads(pd)
                except Exception:
                    post_json = None
        except Exception:
            pass
        if isinstance(post_json, dict):
            row["req_keys"] = key_shape(post_json)
        if self.shapes and isinstance(post_json, (dict, list)):
            from . import wiring as _wiring
            row["req_shape"] = _wiring.shape(post_json)
        act = lens_action(method, path_t, post_json)
        if act:
            row["lens_action"] = act
        if e["failed"]:
            row["status"] = None
            row["error"] = "aborted" if is_aborted(e["failed"]) else e["failed"]
            return row
        if not e.get("finished"):
            # still in flight (SSE / long poll): never block on it
            row["status"] = None
            row["error"] = "pending"
            return row
        resp = None
        try:
            resp = req.response()
        except Exception:
            resp = None
        if resp is None:
            row["status"] = None
            row["error"] = "no_response"
            return row
        row["status"] = resp.status
        try:
            end = timing.get("responseEnd")
            if end is not None and end >= 0:
                row["ms"] = int(end)
                if row["ms"] >= self.slow_ms:
                    row["slow"] = True
        except Exception:
            pass
        if re.search(r"/:(uuid|id|n|hex)(/|$)", path_t) and method != "DELETE" and 200 <= resp.status < 300 \
                and row.get("type") in API_TYPES and not tele:
            # upgrade 3: kept in memory for the t2 replay only; never serialized
            self.replay.append({"t": t, "method": method, "url": req.url, "path": path_t,
                                "post": (req.post_data if method in WRITE_METHODS else None),
                                "acct": e.get("acct")})
        try:
            sz = req.sizes()
            row["resp_bytes"] = int(sz.get("responseBodySize") or 0)
            if "req_bytes" not in row and sz.get("requestBodySize"):
                row["req_bytes"] = int(sz["requestBodySize"])
        except Exception:
            pass
        try:
            ctype = (resp.headers or {}).get("content-type", "")
        except Exception:
            ctype = ""
        if "json" in ctype and row.get("resp_bytes", 0) <= MAX_BODY:
            try:
                body = resp.body()
                if len(body) <= MAX_BODY:
                    obj = json.loads(body)
                    row["resp_bytes"] = row.get("resp_bytes") or len(body)
                    ks = key_shape(obj)
                    if ks is not None:
                        row["resp_keys"] = ks
                        row["flags"] = flags_of(obj)
                    if self.shapes:
                        from . import wiring as _wiring
                        row["resp_shape"] = _wiring.shape(obj)
                        row["content_type"] = ctype.split(";")[0].strip().lower()[:60]
            except Exception:
                pass
        return row

    # ---------------------------------------------------------------- output
    def build(self):
        """(controls[], endpoints[], actions[], net_summary) for the lens record."""
        self.close_window()
        self.flush()
        self._assign_all()
        per_ctl = OrderedDict((cid, []) for cid in self.meta)
        kept_total = 0
        overflow = 0
        for r in self.done:
            lst = per_ctl.setdefault(r["_cid"], [])
            if len(lst) >= CAPS["per_control"] or kept_total >= CAPS["per_lens"]:
                overflow += 1
                continue
            lst.append(r)
            kept_total += 1
        cids = sorted(per_ctl, key=lambda c: (not c.endswith(":page:-"), list(per_ctl).index(c)))  # page loads first
        ctl_over = max(0, len(cids) - CAPS["controls"])
        cids = cids[:CAPS["controls"]]
        stamp = {k: self.stamp.get(k) for k in ("build_sha", "walked_at") if k in self.stamp}
        controls = []
        console_at = sorted(self.console)
        for cid in cids:
            m = self.meta.get(cid) or {"phase": cid.split(":")[0], "role": "page", "name": "-", "exercised": True,
                                       "reason": None, "effect_hint": None}
            reqs = _aggregate(per_ctl[cid])
            acts = []
            for r in per_ctl[cid]:
                a = r.get("lens_action")
                if a and a not in acts:
                    acts.append(a)
            effect = "request" if reqs else (m.get("effect_hint") or ("none" if m["exercised"] else None))
            row = OrderedDict([("control_id", cid), ("phase", m["phase"]), ("role", m["role"]), ("name", m["name"]),
                               ("exercised", m["exercised"]), ("reason", m["reason"]), ("effect", effect),
                               ("no_call", not reqs), ("requests", reqs), ("lens_actions", acts),
                               ("console_errors", self._console_for(cid, console_at)),
                               ("http_4xx", sorted({"%d %s" % (r["status"], r["path"]) for r in per_ctl[cid]
                                                    if r.get("status") and 400 <= r["status"] < 500 and not r.get("telemetry")})[:10]),
                               ("http_5xx", sorted({"%d %s" % (r["status"], r["path"]) for r in per_ctl[cid]
                                                    if r.get("status") and r["status"] >= 500 and not r.get("telemetry")})[:10]),
                               ("overflow", sum(1 for r in self.done if r["_cid"] == cid) - len(per_ctl[cid]))])
            errs = [e for e in self.errors if self._cid_at(e[0]) == cid]
            viol = [v for v in self.violations if self._cid_at(v[0]) == cid]
            ek = Counter(e[1] for e in errs)
            if errs:
                row["errors"] = OrderedDict((k, ek[k]) for k in ERROR_KINDS if ek.get(k))
                row["error_samples"] = sorted({e[2] for e in errs})[:3]
            slow = [q for q in reqs if q.get("slow")]
            if slow:
                row["slow_calls"] = ["%s %s %dms" % (q["method"], q["path"], q["ms"]) for q in slow][:5]
            lt = [v for v in viol if v[1] == "long_task"]
            fr = [v for v in viol if v[1] == "freeze"]
            if lt:
                row["long_tasks"] = len(lt)
                row["max_long_task_ms"] = max((v[2] or 0) for v in lt)
            if fr:
                row["freeze_ms"] = max(v[2] for v in fr)
            if not reqs and errs and row["exercised"]:
                row["effect"] = "error"  # upgrade 1: a crash after a click is not a dead button
            for k in ("fake_success", "ownership", "evidence", "ax_ms", "readback", "label_data"):
                if m.get(k) is not None:
                    row[k] = m[k]
            row["sid"] = m.get("sid") or stable_id(m["role"], m["name"])
            reasons = []
            if row["http_5xx"]:
                reasons.append("http_5xx")
            if row["http_4xx"]:
                reasons.append("http_4xx")
            if any(q.get("error") and q["error"] not in ("pending", "aborted") and not q.get("telemetry") for q in reqs):
                reasons.append("request_failed")
            if any(k in ek for k in ("exception", "rejection", "boundary", "crash")):
                reasons.append("js_error")
            if ek.get("asset_fail"):
                reasons.append("asset_fail")
            if slow:
                reasons.append("slow_call")
            if lt or fr:
                reasons.append("freeze")
            if m.get("fake_success"):
                reasons.append("fake_success")
            if m.get("ownership"):
                reasons.append("ownership")
            row["broken"] = reasons
            if m.get("reused_from"):
                row["reused_from"] = m["reused_from"]
                if not reqs:
                    # the sweep row mirrors the phase that already clicked it
                    src = next((c for c in controls if c["control_id"] == m["reused_from"]), None)
                    if src:
                        row["effect"] = src["effect"]
            row.update(stamp)
            controls.append(row)
        endpoints, actions = OrderedDict(), OrderedDict()
        for c in controls:
            for q in c["requests"]:
                k = (q["method"], q["path"])
                ep = endpoints.setdefault(k, OrderedDict([("method", q["method"]), ("path", q["path"]), ("statuses", {}),
                                                          ("n", 0), ("write", q["write"]), ("max_ms", None),
                                                          ("controls", [])]))
                sk = str(q["status"]) if q["status"] is not None else (q.get("error") or "failed")
                ep["statuses"][sk] = ep["statuses"].get(sk, 0) + q["n"]
                ep["n"] += q["n"]
                if q.get("ms") is not None:
                    ep["max_ms"] = max(ep["max_ms"] or 0, q["ms"])
                if c["control_id"] not in ep["controls"]:
                    ep["controls"].append(c["control_id"])
                a = q.get("lens_action")
                if a:
                    ak = (a["domain"], a.get("action") or a.get("op"))
                    ac = actions.setdefault(ak, OrderedDict([("domain", a["domain"])] + (
                        [("action", a["action"])] if "action" in a else [("op", a["op"])]) + [("statuses", {}), ("controls", [])]))
                    ac["statuses"][sk] = ac["statuses"].get(sk, 0) + q["n"]
                    if c["control_id"] not in ac["controls"]:
                        ac["controls"].append(c["control_id"])
        eps = []
        for ep in sorted(endpoints.values(), key=lambda e: (e["path"], e["method"])):
            ep.update(stamp)
            eps.append(ep)
        acts = sorted(actions.values(), key=lambda a: (a["domain"], a.get("action") or a.get("op")))
        summary = {"requests_seen": len(self.done), "requests_kept": kept_total, "overflow": overflow,
                   "controls_overflow": ctl_over, "static_assets": self.static,
                   "third_party_hosts": dict(sorted(self.third_party.items()))}
        return controls, eps, acts, summary

    def quick_broken(self, since):
        """Main-flow check right after a click (before flush): reasons this control already
        looks broken. Reads only finished/failed entries; never blocks on in-flight ones."""
        why = set()
        for t, kind, _m in self.errors:
            if t >= since and kind in ("exception", "rejection", "boundary", "crash", "asset_fail"):
                why.add("asset_fail" if kind == "asset_fail" else "js_error")
        writes = []
        for e in self.raw:
            if e["t_seen"] < since:
                continue
            try:
                p_t = template_path(urlsplit(e["req"].url).path)[0]
                tele = is_telemetry(p_t, getattr(e["req"], "resource_type", None))
            except Exception:
                tele = False
            if e["failed"]:
                if not is_aborted(e["failed"]) and not tele:
                    why.add("request_failed")
                continue
            if not e.get("finished"):
                continue
            try:
                st = e["req"].response().status
            except Exception:
                continue
            if tele:
                continue
            try:
                if (e["req"].timing or {}).get("responseEnd", -1) >= self.slow_ms:
                    why.add("slow_call")
            except Exception:
                pass
            if st >= 500:
                why.add("http_5xx")
            elif st >= 400:
                why.add("http_4xx")
            elif e["req"].method in WRITE_METHODS and not tele:
                writes.append(e["req"])
        return why, writes

    def _cid_at(self, t):
        w, _ = self._window_at(t)
        return w["cid"] if w else LOAD_CONTROL

    def _console_for(self, cid, times):
        n = 0
        for t in times:
            w, _ = self._window_at(t)
            if (w["cid"] if w else LOAD_CONTROL) == cid:
                n += 1
        return n

    def _window_at(self, t):
        for w in reversed(self.windows):
            if w["t0"] <= t:
                end = w["closed_at"] if w["sticky"] else min(w["t0"] + WIN_CAP_S, (w["last"] or w["t0"]) + WIN_GAP_S)
                if end is None or t <= end:
                    return w, False
                return None, True
        return None, True


def _steady_run(ts):
    """Three consecutive starts whose two gaps are within 1.5x of each other (and > 0)."""
    for a, b, c in zip(ts, ts[1:], ts[2:]):
        g1, g2 = b - a, c - b
        if g1 > 0 and g2 > 0 and max(g1, g2) / min(g1, g2) <= 1.5:
            return True
    return False


def _scrub(msg, limit=140):
    """Error text for samples: first line, no URLs' query strings, no long tokens."""
    m = (msg or "").splitlines()[0] if msg else ""
    m = re.sub(r"\?[^\s'\"]*", "?…", m)
    m = re.sub(r"[A-Za-z0-9_\-]{24,}", "…", m)
    return m[:limit]


def _aggregate(rows):
    """Collapse identical (method, path, status, action) rows; keep count, max ms, max sizes."""
    out = OrderedDict()
    for r in rows:
        a = r.get("lens_action")
        k = (r["method"], r["path"], r.get("status"), json.dumps(a, sort_keys=True) if a else "")
        if k not in out:
            q = OrderedDict([("method", r["method"]), ("path", r["path"]), ("status", r.get("status")), ("n", 0),
                             ("ms", r.get("ms")), ("type", r.get("type")), ("write", r["write"])])
            for f in ("error", "initiator", "query_keys", "req_keys", "resp_keys", "req_shape", "resp_shape", "content_type", "flags", "lens_action", "background", "polling", "slow", "telemetry"):
                if r.get(f) is not None:
                    q[f] = r[f]
            q["req_bytes"] = r.get("req_bytes", 0)
            q["resp_bytes"] = r.get("resp_bytes", 0)
            out[k] = q
        q = out[k]
        q["n"] += 1
        if r.get("ms") is not None:
            q["ms"] = max(q["ms"] or 0, r["ms"])
        q["req_bytes"] = max(q["req_bytes"], r.get("req_bytes", 0))
        q["resp_bytes"] = max(q["resp_bytes"], r.get("resp_bytes", 0))
    return list(out.values())
