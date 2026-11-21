#!/usr/bin/env python3
"""GB-1579 unit tests: the ULW v3 call-recording fix.

(1) NetLedger keeps successful (2xx, non-refused) POST/PUT/PATCH writes on
collection routes (POST /api/<domain>) and /api/lens/run on the in-memory
write_calls list, beside replay — feeding the trust legs + durability via
leg_calls(), while replay itself (two-account + the isolation probe's
inputs) is unchanged. DELETEs are never recorded; refused 2xx bodies are
not kept; the writer account's own-context calls carry their account tag;
recorded bodies never reach the serialized record.

(2) core_verbs: every core_verb block carries http_status + a scrubbed
error reason (error_reason: error/message text only, id-shaped tokens and
long values stripped — no values, no ids).

Pure python (fake request objects), no browser.
Run: python3 selftest/test_gb1579_call_recording.py"""
import json, os, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from concord_walker import netledger as N
from concord_walker import core_verbs as cv
from concord_walker import trust_probes as tp
from concord_walker import durability as dur

FAILS = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + ((" :: " + str(extra)) if (extra and not cond) else ""))
    if not cond:
        FAILS.append(name)


class Clock:
    def __init__(self):
        self.t = 2000.0

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
UUID = "550e8400-e29b-41d4-a716-446655440000"


def fire(L, req, acct=None, start=2000.0):
    req.timing = {"startTime": start * 1000, "responseEnd": 42}
    L._on_request(req, acct)
    if req.failure:
        L._on_failed(req)
    else:
        L._on_finished(req)
    L.flush()


def ledger():
    return N.NetLedger(BASE, clock=Clock())


def test_collection_and_lens_run_writes_recorded():
    L = ledger()
    fire(L, Req(BASE + "/api/graph", "POST", post=json.dumps({"title": "hello"}),
                resp=Resp(201, {"ok": True, "id": "g1"})), start=2000.1)
    check("collection POST 201 kept in write_calls", len(L.write_calls) == 1, L.write_calls)
    check("collection POST not in replay", len(L.replay) == 0, L.replay)
    e = L.write_calls[0]
    check("entry shape (method/path/post)", e["method"] == "POST" and e["path"] == "/api/graph"
          and json.loads(e["post"]) == {"title": "hello"}, e)
    fire(L, Req(BASE + "/api/lens/run", "POST",
                post=json.dumps({"domain": "graph", "action": "createNode", "args": {"title": "x"}}),
                resp=Resp(200, {"ok": True})), start=2000.2)
    check("lens/run POST kept in write_calls", len(L.write_calls) == 2
          and L.write_calls[1]["path"] == "/api/lens/run", L.write_calls)
    fire(L, Req(BASE + "/api/board/settings", "PUT", post=json.dumps({"name": "b"}),
                resp=Resp(200, {"ok": True})), start=2000.3)
    check("collection PUT kept", len(L.write_calls) == 3, L.write_calls)
    fire(L, Req(BASE + "/api/graph", "GET", resp=Resp(200, {"items": []})), start=2000.4)
    check("collection GET kept nowhere", len(L.write_calls) == 3 and len(L.replay) == 0,
          (L.write_calls, L.replay))


def test_refused_failed_and_delete_never_recorded():
    L = ledger()
    fire(L, Req(BASE + "/api/graph", "POST", post="{}", resp=Resp(200, {"ok": False, "error": "denied"})),
         start=2000.1)
    check("2xx ok:false body not recorded", not L.write_calls and not L.replay, L.write_calls)
    fire(L, Req(BASE + "/api/graph", "POST", post="{}", resp=Resp(200, {"error": "boom"})), start=2000.2)
    check("2xx error-key body not recorded", not L.write_calls, L.write_calls)
    fire(L, Req(BASE + "/api/graph", "POST", post="{}", resp=Resp(422, {"error": "invalid"})), start=2000.3)
    check("non-2xx not recorded", not L.write_calls, L.write_calls)
    fire(L, Req(BASE + "/api/graph/" + UUID, "DELETE", resp=Resp(200, {"ok": True})), start=2000.4)
    check("DELETE never recorded", not L.write_calls and not L.replay, (L.write_calls, L.replay))
    fire(L, Req(BASE + "/api/metrics/vitals", "POST", post="{}", resp=Resp(200, {"ok": True})), start=2000.5)
    check("telemetry POST not recorded", not L.write_calls, L.write_calls)


def test_object_calls_unchanged_and_no_double_feed():
    L = ledger()
    fire(L, Req(BASE + "/api/graph/" + UUID, "GET", resp=Resp(200, {"id": UUID})), start=2000.1)
    check("object GET in replay as today", len(L.replay) == 1 and not L.write_calls,
          (L.replay, L.write_calls))
    fire(L, Req(BASE + "/api/graph/" + UUID + "/share", "POST", post="{}",
                resp=Resp(200, {"ok": True})), start=2000.2)
    check("object POST in replay only (no double feed)", len(L.replay) == 2 and not L.write_calls,
          (L.replay, L.write_calls))
    fire(L, Req(BASE + "/api/graph", "POST", post=json.dumps({"title": "t"}),
                resp=Resp(201, {"ok": True})), start=2000.3)
    check("leg_calls is the union", len(L.leg_calls()) == 3
          and len(L.replay) == 2 and len(L.write_calls) == 1,
          (len(L.leg_calls()), len(L.replay), len(L.write_calls)))


def test_writer_context_and_serialization_discipline():
    L = ledger()
    label = "WL1579-FIXTURE-LABEL"
    fire(L, Req(BASE + "/api/graph", "POST", post=json.dumps({"title": label}),
                resp=Resp(201, {"ok": True, "id": "g9"})), acct="t2", start=2000.1)
    check("writer-context create recorded", len(L.write_calls) == 1, L.write_calls)
    check("entry carries the writer account tag", L.write_calls[0]["acct"] == "t2", L.write_calls[0])
    check("body kept in memory for the legs", json.loads(L.write_calls[0]["post"])["title"] == label)
    L.open_window("load", "page", "-", sticky=True, cid=N.LOAD_CONTROL)
    blob = json.dumps(L.build())
    check("recorded body never serialized", label not in blob and "g9" not in blob, blob[:200])


def test_legs_consume_the_union():
    create = {"method": "POST", "path": "/api/graph", "url": BASE + "/api/graph",
              "post": json.dumps({"title": "fixture-1", "userId": "user-t2"}), "acct": "t2", "t": 1}
    obj_put = {"method": "PUT", "path": "/api/graph/:uuid", "url": BASE + "/api/graph/" + UUID,
               "post": json.dumps({"title": "renamed"}), "acct": "t2", "t": 2}
    calls = [create, obj_put]
    m = tp.mutation_plan(calls, owner_acct="t2", walk_acct="t2")
    deletes = [a for a in m if a["kind"] == "delete"]
    check("delete attempt derives once the collection create is recorded",
          len(deletes) == 1 and deletes[0]["path"] == "/api/graph/:uuid", m)
    s = tp.spoof_plan(calls, owner_acct="t2", walk_acct="t2")
    check("spoof attempt from a collection write's actor field",
          len(s) == 1 and s[0]["field"] == "userId", s)
    cands = dur.pick_write_calls(calls, cap=3, fixture_label=None)
    check("durability candidate from the collection create",
          any(c["path"] == "/api/graph" and c["field"] == "title" for c in cands), cands)
    plan = dur.probe_plan(cands)
    check("durability plan runs on the union", plan["run"] is True, plan)


def test_core_verb_block_carries_status_and_reason():
    spec = {"status": "confirmed", "verb": "make a graph",
            "action": {"domain": "graph", "name": "create"}, "visibility": "private"}
    blk = cv.core_verb_block(spec, "CORE_VERB_PASS", "ok", drive="performed",
                             http_status=200, error=None)
    check("performed block carries status, no error",
          blk["http_status"] == 200 and blk["error"] is None, blk)
    blk = cv.core_verb_block(spec, "CORE_VERB_FAIL", "bad", drive="failed",
                             http_status=500, error="server exploded")
    check("failed block carries status + reason",
          blk["http_status"] == 500 and blk["error"] == "server exploded", blk)
    blk = cv.core_verb_block(spec, "CORE_VERB_UNSPECIFIED", "not run")
    check("not-run block still carries both keys",
          blk["http_status"] is None and blk["error"] is None, blk)
    check("classify_drive unchanged (performed)",
          cv.classify_drive(200, {"ok": True}) == "performed")
    check("classify_drive unchanged (transport)",
          cv.classify_drive(None, None) == "inconclusive")


def test_error_reason_scrubbing():
    r = cv.error_reason({"error": "DTU %s not found" % UUID})
    check("uuid stripped from reason", r is not None and UUID not in r and "not found" in r, r)
    r = cv.error_reason({"error": {"message": "quota 123456 exceeded for wallet"}})
    check("error-object message used, long number stripped",
          r is not None and "123456" not in r and "quota" in r, r)
    r = cv.error_reason({"ok": False, "message": "title is required"})
    check("refused body's message used", r == "title is required", r)
    check("success body carries no reason", cv.error_reason({"ok": True, "id": "x"}) is None)
    check("message on a non-refused body ignored", cv.error_reason({"message": "Saved"}) is None)
    check("non-dict body -> None", cv.error_reason(None) is None and cv.error_reason("x") is None)
    r = cv.error_reason({"error": "token abcdef0123456789abcdef01 rejected"})
    check("hex token stripped", r is not None and "abcdef0123456789abcdef01" not in r, r)
    r = cv.error_reason({"error": "x" * 300})
    check("reason capped at 120 chars", r is not None and len(r) <= 120, len(r or ""))


if __name__ == "__main__":
    for fn in [v for k, v in sorted(globals().items()) if k.startswith("test_")]:
        fn()
    print("\n%d failure(s)" % len(FAILS))
    sys.exit(1 if FAILS else 0)
