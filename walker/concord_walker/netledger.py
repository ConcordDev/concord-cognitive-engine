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
import json, re, time
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


def control_id(phase, role, name):
    slug = _SLUG.sub("-", (name or "").lower()).strip("-")[:48] or "-"
    return "%s:%s:%s" % (phase, role or "page", slug)


class NetLedger:
    def __init__(self, base_url, clock=time.time, stamp=None):
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
        self.resolved = []         # resolved rows, attributed in build()

    # ---------------------------------------------------------------- windows
    def open_window(self, phase, role, name, sticky=False, cid=None):
        cid = cid or control_id(phase, role, name)
        if cid not in self.meta:
            self.meta[cid] = {"phase": phase, "role": role or "page", "name": name or "-",
                              "exercised": True, "reason": None, "effect_hint": None}
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
        return cid

    def set_effect(self, cid, effect):
        if cid in self.meta:
            self.meta[cid]["effect_hint"] = effect

    def _assign(self, t):
        """Window for a request that started at epoch t (seconds)."""
        for w in reversed(self.windows):
            if w["t0"] > t + 0.05:
                continue
            if w["sticky"]:
                if w["closed_at"] is None or t <= w["closed_at"]:
                    return w, False
                return None, True
            anchor = w["last"] if w["last"] is not None else w["t0"]
            if t - w["t0"] <= WIN_CAP_S and t - anchor <= WIN_GAP_S:
                w["last"] = max(t, w["last"] or t)
                return w, False
            return None, True
        return None, True

    # ---------------------------------------------------------------- hooks
    def attach(self, page):
        page.on("request", self._on_request)
        page.on("requestfinished", self._on_finished)
        page.on("requestfailed", self._on_failed)
        page.on("console", self._on_console)

    def watch_initiators(self, cdp_session):
        try:
            cdp_session.send("Network.enable")
            cdp_session.on("Network.requestWillBeSent", self._on_cdp_request)
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
        except Exception:
            pass

    def _on_request(self, req):
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
            return
        e = {"req": req, "t_seen": self.clock(), "failed": None, "finished": False}
        self.raw.append(e)
        self._live[id(req)] = e

    def _on_finished(self, req):
        e = self._live.pop(id(req), None)
        if e is not None:
            e["finished"] = True

    def _on_failed(self, req):
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

        out = set()
        for path, ts in by.items():
            in_load = [t for t in ts if self._in_sticky(t)]
            if (len(in_load) >= 3 and steady(in_load)) or (len(ts) >= 4 and steady(ts)):
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
        row = {"_t": t, "method": method, "path": path_t, "type": getattr(req, "resource_type", None),
               "write": method in WRITE_METHODS}
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
        act = lens_action(method, path_t, post_json)
        if act:
            row["lens_action"] = act
        if e["failed"]:
            row["status"] = None
            row["error"] = e["failed"]
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
        except Exception:
            pass
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
                                                    if r.get("status") and 400 <= r["status"] < 500})[:10]),
                               ("http_5xx", sorted({"%d %s" % (r["status"], r["path"]) for r in per_ctl[cid]
                                                    if r.get("status") and r["status"] >= 500})[:10]),
                               ("overflow", sum(1 for r in self.done if r["_cid"] == cid) - len(per_ctl[cid]))])
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


def _aggregate(rows):
    """Collapse identical (method, path, status, action) rows; keep count, max ms, max sizes."""
    out = OrderedDict()
    for r in rows:
        a = r.get("lens_action")
        k = (r["method"], r["path"], r.get("status"), json.dumps(a, sort_keys=True) if a else "")
        if k not in out:
            q = OrderedDict([("method", r["method"]), ("path", r["path"]), ("status", r.get("status")), ("n", 0),
                             ("ms", r.get("ms")), ("type", r.get("type")), ("write", r["write"])])
            for f in ("error", "initiator", "query_keys", "req_keys", "resp_keys", "flags", "lens_action", "background", "polling"):
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
