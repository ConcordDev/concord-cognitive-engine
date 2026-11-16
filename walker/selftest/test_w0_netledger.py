#!/usr/bin/env python3
"""MST-W0-02 unit tests: path templating, key shapes, redaction, lens actions,
window attribution, polling, caps. Pure python (fake request objects), no browser.
Run: python3 selftest/test_w0_netledger.py"""
import json, os, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from concord_walker import netledger as N

FAILS = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (" " + str(extra) if extra and not cond else ""))
    if not cond:
        FAILS.append(name)


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


class Resp:
    def __init__(self, status, body=None, ctype="application/json"):
        self.status, self._body, self.headers = status, body, {"content-type": ctype}

    def body(self):
        if isinstance(self._body, Exception):
            raise self._body
        return (json.dumps(self._body) if not isinstance(self._body, (bytes, str)) else self._body).encode() \
            if not isinstance(self._body, bytes) else self._body


class Req:
    def __init__(self, url, method="GET", rtype="fetch", post=None, resp=None, start=None, failure=None):
        self.url, self.method, self.resource_type, self.post_data = url, method, rtype, post
        self._resp, self.failure = resp, failure
        self.timing = {"startTime": start * 1000 if start else -1, "responseEnd": 42}

    def response(self):
        return self._resp

    def sizes(self):
        return {"requestBodySize": len(self.post_data or ""), "responseBodySize": 17}


BASE = "https://concord-os.org"


def fire(L, req, finished=True):
    L._on_request(req)
    if req.failure:
        L._on_failed(req)
    elif finished:
        L._on_finished(req)


def test_templating():
    t, k = N.template_path("/api/dtus/123/items/550e8400-e29b-41d4-a716-446655440000/deadbeefcafe12?b=2&a=secret")
    check("numeric/uuid/hex segments templated", t == "/api/dtus/:n/items/:uuid/:hex", t)
    check("query string -> sorted key list only", k == ["a", "b"], k)
    t2, _ = N.template_path("/api/users/zukotest10101358/profile")
    check("long mixed letter+digit segment -> :id (no usernames)", t2 == "/api/users/:id/profile", t2)
    t3, _ = N.template_path("/api/lens/chem")
    check("plain words kept", t3 == "/api/lens/chem", t3)
    check("short mixed token kept (not an id)", N.template_segment("v2") == "v2")
    check("very long segment -> :long", N.template_segment("x" * 41) == ":long")


def test_key_shapes_and_flags():
    ks = N.key_shape({"domain": "chem", "n": 1, "ok": True, "o": {}, "a": [], "z": None})
    check("type tags s n b o a null", ks == {"a": "a", "domain": "s", "n": "n", "o": "o", "ok": "b", "z": "null"}, ks)
    check("non-object -> None", N.key_shape([1, 2]) is None)
    big = {"k%02d" % i: i for i in range(60)}
    check("<=40 keys", len(N.key_shape(big)) == 40)
    f = N.flags_of({"ok": True, "result": {"signed": False, "signingReason": "x", "value": 3}})
    check("flags: ok/signed bools + presence only", f == {"ok": True, "signed": False, "has_receiptId": False, "has_signingReason": True}, f)
    f2 = N.flags_of({"ok": "yes", "receiptId": "r-1"})
    check("non-bool ok is dropped; receiptId presence only", f2 == {"has_receiptId": True, "has_signingReason": False}, f2)


def test_lens_action():
    check("POST /api/lens/run -> domain/action",
          N.lens_action("POST", "/api/lens/run", {"domain": "chem", "action": "equilibrium", "input": {}}) == {"domain": "chem", "action": "equilibrium"})
    check("bad action token rejected", N.lens_action("POST", "/api/lens/run", {"domain": "chem", "action": "Drop Table;"}) is None)
    check("camelCase action kept", N.lens_action("POST", "/api/lens/run", {"domain": "engineering", "action": "beamStudy"}) == {"domain": "engineering", "action": "beamStudy"})
    check("non-string domain rejected", N.lens_action("POST", "/api/lens/run", {"domain": 3, "action": "x"}) is None)
    check("GET /api/lens/:domain -> list", N.lens_action("GET", "/api/lens/chem", None) == {"domain": "chem", "op": "list"})
    check("GET /api/lens/:domain/:id -> get", N.lens_action("GET", "/api/lens/chem/:uuid", None) == {"domain": "chem", "op": "get"})
    check("GET other api -> None", N.lens_action("GET", "/api/dtus", None) is None)


def test_attribution_and_redaction():
    c = Clock()
    L = N.NetLedger(BASE, clock=c, stamp={"build_sha": "495efb7ce243", "walked_at": "2026-11-16T08:00:00-0500"})
    L.open_window("load", "page", "-", sticky=True, cid=N.LOAD_CONTROL)
    fire(L, Req(BASE + "/lenses/chem", rtype="document", resp=Resp(200, "<html>", "text/html"), start=1000.1))
    fire(L, Req(BASE + "/api/lens/chem?limit=5&cursor=SECRETCURSOR", resp=Resp(200, {"items": [{"title": "PRIVATE"}]}), start=1000.2))
    fire(L, Req(BASE + "/_next/static/chunk.js", rtype="script", resp=Resp(200, "", "text/js"), start=1000.3))
    fire(L, Req("https://fonts.example.com/x.woff", rtype="font", start=1000.3))
    c.t = 1002.0
    L.close_window()
    c.t = 1010.0
    cid = L.open_window("sweep", "button", "Balance a reaction")
    body = json.dumps({"domain": "chem", "action": "balanceReaction", "input": {"eq": "TOPSECRET-H2+O2"}})
    fire(L, Req(BASE + "/api/lens/run", "POST", post=body,
                resp=Resp(200, {"ok": True, "result": {"signed": False, "signingReason": "missing_declaration", "eq": "TOPSECRET"}}), start=1010.2))
    fire(L, Req(BASE + "/api/boom", resp=Resp(500, {"error": "x"}), start=1011.0))
    fire(L, Req(BASE + "/api/never", start=1011.2, failure="net::ERR_FAILED"))
    fire(L, Req(BASE + "/api/late", resp=Resp(200, {}), start=1014.0))  # > 1.5 s after the last: background
    c.t = 1020.0
    dead = L.open_window("sweep", "button", "Dead button")
    L.set_effect(dead, "none")
    L.note_control("sweep", "button", "Delete all", False, reason="destructive")
    controls, eps, acts, summ = L.build()
    by = {x["control_id"]: x for x in controls}
    bal = by.get(cid)
    check("sweep control row exists", bal is not None, list(by))
    paths = sorted((q["method"], q["path"], q["status"]) for q in bal["requests"])
    check("lens-run, 500 and failed attributed to the click", paths == [("GET", "/api/boom", 500), ("GET", "/api/never", None), ("POST", "/api/lens/run", 200)], paths)
    run = next(q for q in bal["requests"] if q["path"] == "/api/lens/run")
    check("req_keys shape only", run["req_keys"] == {"action": "s", "domain": "s", "input": "o"}, run.get("req_keys"))
    check("write flag on POST", run["write"] is True)
    check("lens action recorded on the control", bal["lens_actions"] == [{"domain": "chem", "action": "balanceReaction"}], bal["lens_actions"])
    check("5xx listed per control", bal["http_5xx"] == ["500 /api/boom"], bal["http_5xx"])
    check("failed request recorded with error, no status", any(q.get("error") == "net::ERR_FAILED" for q in bal["requests"]))
    check("effect=request when calls were made", bal["effect"] == "request" and bal["no_call"] is False)
    load = by[N.LOAD_CONTROL]
    check("late request falls to load:page:- as background",
          any(q["path"] == "/api/late" and q.get("background") for q in load["requests"]), load["requests"])
    lq = next(q for q in load["requests"] if q["path"] == "/api/lens/chem")
    check("query values never stored (keys only)", lq["query_keys"] == ["cursor", "limit"])
    check("GET /api/lens/chem -> list action", lq.get("lens_action") == {"domain": "chem", "op": "list"})
    check("dead control: no_call + effect none", by[dead]["no_call"] and by[dead]["effect"] == "none")
    da = by["sweep:button:delete-all"]
    check("skipped control keeps reason and exercised=false", da["exercised"] is False and da["reason"] == "destructive")
    blob = json.dumps([controls, eps, acts, summ])
    check("no body/value leaks", all(x not in blob for x in ("TOPSECRET", "PRIVATE", "SECRETCURSOR", "missing_declaration")))
    check("third-party counted by host only", summ["third_party_hosts"] == {"fonts.example.com": 1} and "x.woff" not in blob)
    check("static assets counted, not listed", summ["static_assets"] == 1 and "chunk.js" not in blob)
    check("endpoints rollup carries statuses + controls",
          any(e["path"] == "/api/lens/run" and e["statuses"] == {"200": 1} and cid in e["controls"] for e in eps))
    check("actions rollup", acts and acts[0]["domain"] == "chem" and any(a.get("action") == "balanceReaction" for a in acts))
    check("build stamp on every control and endpoint row",
          all(x.get("build_sha") == "495efb7ce243" and x.get("walked_at") for x in controls + eps))


def test_polling_and_pending():
    c = Clock()
    L = N.NetLedger(BASE, clock=c)
    L.open_window("load", "page", "-", sticky=True, cid=N.LOAD_CONTROL)
    for i in range(4):
        fire(L, Req(BASE + "/api/poll", resp=Resp(200, {}), start=1000.0 + i * 0.7))
    c.t = 1003.0
    L.close_window()
    c.t = 1005.0
    cid = L.open_window("sweep", "button", "Run calc")
    fire(L, Req(BASE + "/api/poll", resp=Resp(200, {}), start=1005.1))
    fire(L, Req(BASE + "/api/lens/run", "POST", post='{"domain":"x","action":"y"}', resp=Resp(200, {}), start=1005.2))
    fire(L, Req(BASE + "/api/stream", rtype="eventsource", start=1005.3), finished=False)
    controls, eps, _, _ = L.build()
    by = {x["control_id"]: x for x in controls}
    check("steady poll stays on load:page:- even inside a click window",
          [q["path"] for q in by[cid]["requests"] if q["path"] == "/api/poll"] == [], by[cid]["requests"])
    check("poll rows tagged polling", any(q.get("polling") for q in by[N.LOAD_CONTROL]["requests"]))
    st = next(q for q in by[cid]["requests"] if q["path"] == "/api/stream")
    check("in-flight request never blocks: recorded pending", st["status"] is None and st["error"] == "pending", st)


def test_caps():
    c = Clock()
    L = N.NetLedger(BASE, clock=c)
    for k in range(130):
        c.t = 2000.0 + k * 10
        L.open_window("sweep", "button", "b%d" % k)
    c.t = 1500.0
    L.open_window("load", "page", "-", sticky=True, cid=N.LOAD_CONTROL)
    for i in range(70):
        fire(L, Req(BASE + "/api/x/%d" % i, method="POST", resp=Resp(200, {}), start=1500.0 + i * 0.01))
    L.close_window()
    controls, _, _, summ = L.build()
    load = next(x for x in controls if x["control_id"] == N.LOAD_CONTROL)
    check("<=60 requests per control, overflow counted", sum(q["n"] for q in load["requests"]) == 60 and load["overflow"] == 10,
          (sum(q["n"] for q in load["requests"]), load["overflow"]))
    check("<=120 controls (page load kept first), overflow counted", len(controls) == 120 and controls[0]["control_id"] == N.LOAD_CONTROL and summ["controls_overflow"] == 11, (len(controls), summ["controls_overflow"]))
    check("lens overflow in summary", summ["overflow"] == 10)


def test_bad_bodies_never_crash():
    c = Clock()
    L = N.NetLedger(BASE, clock=c)
    L.open_window("sweep", "button", "x")
    fire(L, Req(BASE + "/api/a", "POST", post="not json{", resp=Resp(200, ValueError("gone")), start=1000.1))
    fire(L, Req(BASE + "/api/b", resp=Resp(200, b"\xff\xfe", "application/json"), start=1000.2))
    fire(L, Req(BASE + "/api/c", resp=None, start=1000.3))
    controls, _, _, _ = L.build()
    rows = {q["path"]: q for q in controls[0]["requests"]}
    check("unparseable post body: recorded without req_keys", "req_keys" not in rows["/api/a"] and rows["/api/a"]["status"] == 200)
    check("unreadable body: no resp_keys, still recorded", "resp_keys" not in rows["/api/b"])
    check("finished but no response object: no_response", rows["/api/c"]["error"] == "no_response")



def test_fp_telemetry_and_aborted():
    from concord_walker import netledger as NLm
    check("telemetry paths recognised", all(NLm.is_telemetry(p) for p in ("/api/metrics/vitals", "/api/telemetry", "/api/analytics/track",
                                                                           "/api/track", "/api/client-errors", "/api/heartbeat", "/api/presence/ping")))
    check("beacon/ping resource types are telemetry", NLm.is_telemetry("/x", "beacon") and NLm.is_telemetry("/x", "ping"))
    check("real API paths are not telemetry", not any(NLm.is_telemetry(p) for p in ("/api/notes/:uuid", "/api/lens/run", "/api/metricsx",
                                                                                     "/api/economy/balance", "/api/events/paginated")))
    check("client cancels are aborted, real failures are not", NLm.is_aborted("net::ERR_ABORTED") and NLm.is_aborted("aborted")
          and not NLm.is_aborted("net::ERR_CONNECTION_RESET") and not NLm.is_aborted(None))

if __name__ == "__main__":
    for fn in [v for k, v in sorted(globals().items()) if k.startswith("test_")]:
        fn()
    print("\n%d failure(s)" % len(FAILS))
    sys.exit(1 if FAILS else 0)
