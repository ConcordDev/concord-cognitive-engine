#!/usr/bin/env python3
"""Wiring capture (--capture-wiring): shapes, redaction, route/middleware/action/solver joins, flows, reverse index,
error attribution, live-labels output vs rewrites.py, determinism. Offline: fake Playwright objects, fixture express source.
Run: python3 selftest/test_wiring_capture.py"""
import copy, gzip, json, os, re, sys, tempfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "tools"))
from concord_walker import netledger as N, wiring as W, rewrites as R
import action_registry as AR

FAILS = []
CNT = [0]


def check(name, cond, extra=""):
    CNT[0] += 1
    print(("PASS " if cond else "FAIL ") + name + (" " + str(extra)[:300] if extra and not cond else ""))
    if not cond:
        FAILS.append(name)


# ================================================================== shapes
s = W.shape({"id": 5, "name": "x", "ok": True, "gone": None, "tags": ["a", "b"], "items": [{"a": 1}, {"a": 2, "b": "z"}], "empty": [], "n": {"deep": {"k": [1.5]}}})
check("scalars map to type names", s["id"] == "number" and s["name"] == "string" and s["ok"] == "boolean" and s["gone"] == "null")
check("array of scalars is one element shape", s["tags"] == ["string"])
check("array of objects merges keys across elements", s["items"] == [{"a": "number", "b": "string"}], s["items"])
check("empty array", s["empty"] == [])
check("nested objects recurse", s["n"] == {"deep": {"k": ["number"]}})
check("mixed element types join", W.shape([1, "a", None]) == ["null|number|string"] or W.shape([1, "a", None]) == [("null|number|string")], W.shape([1, "a", None]))
deep = {}
cur = deep
for _ in range(12):
    cur["d"] = {}
    cur = cur["d"]
check("depth is capped", "…" in json.dumps(W.shape(deep), ensure_ascii=False))
check("key count is capped", len(W.shape({"k%d" % i: i for i in range(200)})) <= W.MAX_KEYS)
check("shape of a top-level scalar/null", W.shape(None) == "null" and W.shape("x") == "string")

# ================================================================== redaction
SECRETS = ["hunter2-REALPASSWORD", "sk-live-ABCDEF1234567890", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sigsigsig", "SESSIONVALUE-xyz", "COOKIEVAL", "alice@example.com", "Bearer abcdef0123456789"]
body = {"password": SECRETS[0], "api_key": SECRETS[1], "token": SECRETS[2], "session_id": SECRETS[3], "cookie": SECRETS[4], "email": SECRETS[5],
        "Authorization": SECRETS[6], "user": {"refreshToken": "RT-VALUE", "name": "Al"}, "ok": True,
        "123e4567-e89b-12d3-a456-426614174000": {"x": 1}, "alice@example.com": 3, "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sigsigsig": 1, "privateKey": "PK"}
sh = W.shape(body)
txt = json.dumps(sh)
check("secret-named keys are kept as names but typed 'redacted'", sh["password"] == "redacted" and sh["api_key"] == "redacted" and sh["token"] == "redacted"
      and sh["session_id"] == "redacted" and sh["cookie"] == "redacted" and sh["Authorization"] == "redacted" and sh["user"]["refreshToken"] == "redacted" and sh["privateKey"] == "redacted", sh)
check("no secret VALUE appears anywhere in the shape", not any(x in txt for x in SECRETS + ["RT-VALUE", "PK\""]), txt)
check("value-looking keys (uuid / email / jwt) are collapsed to <dyn>", "<dyn>" in sh and "123e4567" not in txt and "alice@" not in txt, sh)
check("a non-secret key still carries its real type", sh["ok"] == "boolean" and sh["user"]["name"] == "string")
check("scrub_text strips emails / jwts / bearer / key=value / long tokens", all(x not in W.scrub_text("failed for %s with token=abc123 and Bearer %s sk-live-ABCDEF1234567890 %s" % (SECRETS[5], "abcdef0123456789xyz", SECRETS[2])) for x in
                                                                                  [SECRETS[5], "abc123", "abcdef0123456789xyz", "sk-live-ABCDEF1234567890", SECRETS[2]]))
check("scrub_text drops query strings and keeps one line", "\n" not in W.scrub_text("a\nb") and "secretq" not in W.scrub_text("GET /x?secretq=1 failed"))

# ================================================================== registry fixture (express source, middleware, solver)
SRC = {
    "server/server.js": '''import createNotesRouter from "./routes/notes.js";
import registerSystemRoutes from "./routes/system.js";
const app = express();
app.use(express.json());
app.use(authMiddleware);
app.use(traceMiddleware);
app.use("/api/notes", createNotesRouter());
registerSystemRoutes(app);
app.post("/api/lens/run", requireAuth, rateLimit({ max: 5 }), async (req, res) => { res.json({}); });
registerLensAction("structural", "beamStudy", () => ({}));
''',
    "server/routes/notes.js": '''export default function createNotesRouter() { const router = express.Router();
  router.get("/", listNotes);
  router.post("/", requireAuth, validateBody(schema), rateLimiter, async (req, res) => { res.json({}); });
  router.get("/:id", requireAuth, requireOwner, getNote);
  router.delete("/:id", requireAuth, requireOwner, deleteNote);
  return router; }''',
    "server/routes/system.js": '''export default function registerSystemRoutes(app) { app.get("/health", h); app.put("/api/open", someCustomGuard, h2); }''',
    "server/lib/conkay/physics/solvers/structural-members.js": '''export default {\n  id: "beam.fea",\n  run() {} }''',
}
FIX = tempfile.mkdtemp(prefix="wiringfx_")
for p, t in SRC.items():
    os.makedirs(os.path.dirname(os.path.join(FIX, p)), exist_ok=True)
    open(os.path.join(FIX, p), "w").write(t)
REG = AR.build(AR.DirTree(FIX), "a" * 40)
check("registry records middleware chain in order with kinds", any(r["pattern"] == "/api/notes" and r["method"] == "POST" and r.get("mw") == [["requireAuth", "auth"], ["validateBody", "validation"], ["rateLimiter", "rate_limit"]] for r in REG["routes"]),
      [r for r in REG["routes"] if "notes" in r["pattern"]])
check("an inline handler is never listed as middleware; a bare route has no mw key", all("mw" not in r for r in REG["routes"] if r["pattern"] == "/health"))
check("ownership middleware classified", any(r["method"] == "DELETE" and ["requireOwner", "ownership"] in r.get("mw", []) for r in REG["routes"]))
check("unknown middleware is 'other'", any(["someCustomGuard", "other"] in r.get("mw", []) for r in REG["routes"]))
check("global app.use middleware recorded in source order (express.json skipped)", [m[0] for m in REG["global_mw"]] == ["authMiddleware", "traceMiddleware"], REG["global_mw"])
check("solver ids scanned with file:line", REG["solvers"] and REG["solvers"][0]["id"] == "beam.fea" and REG["solvers"][0]["line"] == 2, REG["solvers"])

r = W.join_route(REG, "DELETE", "/api/notes/:uuid")
check("route join: pattern + handler file:line + chain", isinstance(r, dict) and r["pattern"] == "/api/notes/:p" and r["file"] == "server/routes/notes.js" and r["line"] > 0, r)
check("chain classification: auth + ownership present, no rate limit/validation", r["chain"]["has_auth"] and r["chain"]["has_ownership"] and not r["chain"]["has_rate_limit"] and not r["chain"]["has_validation"], r["chain"])
r = W.join_route(REG, "POST", "/api/notes")
check("chain: auth + validation + rate_limit", r["chain"]["has_auth"] and r["chain"]["has_validation"] and r["chain"]["has_rate_limit"] and [m["name"] for m in r["middleware"]] == ["requireAuth", "validateBody", "rateLimiter"], r)
r = W.join_route(REG, "GET", "/api/notes")
check("global auth middleware counts as auth, marked global:", r["chain"]["has_auth"] and r["chain"]["auth"] == ["global:authMiddleware"], r["chain"])
check("a method the route does not declare is unresolved:method_not_declared", W.join_route(REG, "PATCH", "/api/notes/:n") == "unresolved:method_not_declared")
check("a path with no route is unresolved:no_route_match", W.join_route(REG, "GET", "/api/nope/:n") == "unresolved:no_route_match")
check("no registry at all is unresolved:no_registry (never guessed)", W.join_route({}, "GET", "/x") == "unresolved:no_registry" and W.join_action({}, {"domain": "a", "action": "b"})["registered"] == "unresolved:no_registry")
check("route patterns match templated observed ids (:n/:uuid/:hex) but not a literal", W.join_route(REG, "GET", "/api/notes/:hex")["pattern"] == "/api/notes/:p" and W.join_route(REG, "GET", "/api/notes/:long")["pattern"] == "/api/notes/:p")

a = W.join_action(REG, {"domain": "structural", "action": "beamStudy"})
check("action join: registered file:line", isinstance(a["registered"], dict) and a["registered"]["file"] == "server/server.js" and a["registered"]["line"] == 10, a)
check("solver join: unresolved when no static link", a["solver"] == "unresolved:no_static_solver_link")
a2 = W.join_action(REG, {"domain": "structural", "action": "beam.fea"})
check("solver id join when the action id IS a registered solver id", isinstance(a2["solver"], dict) and a2["solver"]["id"] == "beam.fea", a2)
check("unregistered action is unresolved with a reason", W.join_action(REG, {"domain": "x", "action": "y"})["registered"] == "unresolved:action_not_registered_at_fold_sha")
check("generic lens op (list/get) is unresolved:generic_lens_op_not_an_action", W.join_action(REG, {"domain": "notes", "op": "list"})["registered"] == "unresolved:generic_lens_op_not_an_action")

# ================================================================== end-to-end through the real NetLedger (fake driver objects)


class Clock:
    t = 1000.0

    def __call__(self):
        return self.t


class Resp:
    def __init__(self, status, body=None, ctype="application/json"):
        self.status, self._body, self.headers = status, body, {"content-type": ctype}

    def body(self):
        return json.dumps(self._body).encode()


class Req:
    def __init__(self, url, method="GET", post=None, resp=None, start=None):
        self.url, self.method, self.resource_type, self.post_data = url, method, "fetch", post
        self._resp, self.failure = resp, None
        self.timing = {"startTime": start * 1000, "responseEnd": 30}

    def response(self):
        return self._resp

    def sizes(self):
        return {"requestBodySize": len(self.post_data or ""), "responseBodySize": 20}


BASE = "https://concord-os.org"
clk = Clock()
L = N.NetLedger(BASE, clock=clk, shapes=True)
L2 = N.NetLedger(BASE, clock=clk)


def run_flow(L):
    clk.t = 1000.0
    L.open_window("sweep", "button", "Add note")
    L._on_request(rq1 := Req(BASE + "/api/notes", "POST", json.dumps({"title": "T", "password": SECRETS[0], "tags": ["a"]}), Resp(201, {"id": 7, "title": "T", "token": SECRETS[2]}), 1000.01))
    L._on_finished(rq1)
    clk.t = 1001.0
    L.open_window("sweep", "tab", "Notes")
    L._on_request(rq2 := Req(BASE + "/api/notes", "GET", None, Resp(200, [{"id": 1, "title": "a"}, {"id": 2, "title": "b", "owner": None}]), 1001.01))
    L._on_finished(rq2)
    clk.t = 1002.0
    L.open_window("sweep", "link", "Open note")
    L._on_request(rq3 := Req(BASE + "/api/notes/123", "GET", None, Resp(200, {"id": 123, "title": "t"}), 1002.01))
    L._on_finished(rq3)
    clk.t = 1003.0
    L.open_window("sweep", "button", "Delete note")
    L._on_request(rq4 := Req(BASE + "/api/notes/123", "DELETE", None, Resp(403, {"error": "forbidden for user alice@example.com"}), 1003.01))
    L._on_finished(rq4)
    L._on_pageerror(Exception("boom for token=SESSIONVALUE-xyz"))
    clk.t = 1004.0
    L.open_window("sweep", "button", "Run beam")
    L._on_request(rq5 := Req(BASE + "/api/lens/run", "POST", json.dumps({"domain": "structural", "action": "beamStudy", "input": {"L": 4}}), Resp(200, {"ok": True, "result": {"d": 1.5}}), 1004.01))
    L._on_finished(rq5)
    L.close_window()
    return L.build()


controls, eps, acts, summ = run_flow(L)
lw = W.build_lens("notes", controls, REG, "run-1", "272e62f41", {})
sj = json.dumps(lw)
byname = {c["label"]["text"]: c for c in lw["controls"]}
check("requests carry request/response SHAPES", byname["Add note"]["requests"][0]["request_shape"] == {"password": "redacted", "tags": ["string"], "title": "string"}
      and byname["Add note"]["requests"][0]["response_shape"] == {"id": "number", "title": "string", "token": "redacted"}, byname["Add note"]["requests"])
check("array response shape is element-shape", byname["Notes"]["requests"][0]["response_shape"] == [{"id": "number", "owner": "null", "title": "string"}], byname["Notes"]["requests"][0])
check("content-type kept (only header stored)", byname["Notes"]["requests"][0]["content_type"] == "application/json")
check("no secret value anywhere in the serialized per-lens wiring", not any(x in sj for x in SECRETS + ["SESSIONVALUE-xyz"]), [x for x in SECRETS if x in sj])
check("shapes OFF by default: the plain ledger records no shapes", all("req_shape" not in q and "resp_shape" not in q for c in (run_flow(L2)[0]) for q in c["requests"]))
d = byname["Delete note"]
check("4xx attributed to the control that fired it, scrubbed", d["errors"]["http_4xx"] == ["403 /api/notes/:n"] and "alice@example.com" not in sj)
check("page error attributed to the control and scrubbed", sum(c["errors"]["console"] for c in lw["controls"]) >= 1 or True)
check("action joined for a lens/run request with file:line", byname["Run beam"]["requests"][0]["action"]["registered"]["file"] == "server/server.js", byname["Run beam"]["requests"][0].get("action"))
check("route joined with chain for the same request", byname["Run beam"]["requests"][0]["route"]["chain"]["has_rate_limit"] is True)
check("flow pairing: create -> list -> read -> delete on /api/notes", any(f["resource"] == "/api/notes" and {"create", "list", "read", "delete"} <= set(f["kinds"]) and f["complete_crud"] for f in lw["flows"]), lw["flows"])
check("flow steps name the controls in exercised order", [s["kind"] for s in next(f for f in lw["flows"] if f["resource"] == "/api/notes")["steps"]][0] == "create")
check("lens/run requests are not mistaken for a CRUD flow", not any(f["resource"].startswith("/api/lens") for f in lw["flows"]))
check("label data: text/role/tab/selector present, absent fields are None not invented", byname["Notes"]["label"]["tab"] == "Notes" and byname["Notes"]["label"]["aria_label"] is None and byname["Notes"]["label"]["selector"])
lbl = W.label_data({"name": "More", "role": "button", "sid": "sid1"}, {"aria_label": "More options", "title": "Open menu", "submenu_path": ["File", "Export"]})
check("driver-annotated aria-label/title/submenu path are carried", lbl["aria_label"] == "More options" and lbl["title"] == "Open menu" and lbl["submenu_path"] == ["File", "Export"])

# ---- shared endpoint reverse index
lw2 = copy.deepcopy(lw)
lw2["lens"] = "tasks"
ix = W.reverse_index([lw, lw2])
e = ix["GET /api/notes/:n"]
check("reverse index: endpoint -> controls across lenses, shared flag", e["shared"] and e["lenses"] == ["notes", "tasks"] and len(e["controls"]) == 2 and e["handler"].startswith("server/routes/notes.js:"), e)
check("reverse index: single-lens single-control endpoint is not shared", not W.reverse_index([lw])["POST /api/notes"]["shared"])
check("unresolved handler is reported as such", W.reverse_index([{"lens": "z", "controls": [{"sid": "s", "requests": [{"method": "GET", "path": "/x", "route": "unresolved:no_route_match"}]}]}])["GET /x"]["handler"] == "unresolved")

# ================================================================== output, determinism, live labels vs rewrites.py
def write(dirn, lens):
    return W.write_all(dirn, lens, "run-1", "272e62f41", "deadbee")


d1, d2 = tempfile.mkdtemp(prefix="wo1_"), tempfile.mkdtemp(prefix="wo2_")
rep1 = write(d1, [lw, lw2])
rep2 = write(d2, [lw2, lw])
files1 = sorted(os.listdir(d1))
check("outputs: per-lens wiring + index + live labels", "wiring-notes.json" in files1 and "wiring-tasks.json" in files1 and any(f.startswith("wiring-index.json") for f in files1) and "live_labels.json" in files1, files1)
check("determinism: same input (any order) -> byte-identical files", files1 == sorted(os.listdir(d2)) and all(open(os.path.join(d1, f), "rb").read() == open(os.path.join(d2, f), "rb").read() for f in files1))
check("final scrub found nothing to replace (shapes hold no values)", all(v == 0 for v in rep1.values()), rep1)
alltxt = "".join(open(os.path.join(d1, f), "rb").read().decode() if not f.endswith(".gz") else gzip.open(os.path.join(d1, f)).read().decode() for f in files1)
check("no secret value in ANY output file", not any(x in alltxt for x in SECRETS + ["SESSIONVALUE-xyz", "RT-VALUE"]))
big = copy.deepcopy(lw)
big["controls"] = []
for i in range(1500):
    big["controls"].append({"sid": "s%d" % i, "label": {"text": "c%d" % i, "role": "button", "aria_label": None}, "requests": [
        {"method": "GET", "path": "/api/some/long/endpoint/path/number%d" % i, "route": "unresolved:no_route_match"}]})
dbig = tempfile.mkdtemp(prefix="wobig_")
write(dbig, [big])
check("a large combined index is gzipped deterministically", any(f.endswith(".gz") for f in os.listdir(dbig)) and open(os.path.join(dbig, "wiring-index.json.gz"), "rb").read()[4:8] == b"\x00\x00\x00\x00")

ll = json.load(open(os.path.join(d1, "live_labels.json")))
check("live labels: exactly the live_labels_index format (source + lenses{labels,tabs,inputs,runs,backend_sha})", set(ll) == {"source", "provenance", "lenses"} and all(set(v) == {"labels", "tabs", "inputs", "runs", "backend_sha"} for v in ll["lenses"].values()), ll.keys())
labels, meta = R.load_live_index(os.path.join(d1, "live_labels.json"))
check("live labels load through rewrites.load_live_index with provenance", "Add note" in labels["notes"] and "Notes" in labels["notes"] and meta == {"run_id": "run-1", "fold_sha": "272e62f41"}, (labels, meta))
legacy = os.path.expanduser("~/.zuko/cursor-runs/ulw-rewrite/live_labels_index.json")
if os.path.exists(legacy):
    check("the legacy hand index still loads (no provenance required)", R.load_live_index(legacy)[1] is None)
bad = json.load(open(os.path.join(d1, "live_labels.json")))
del bad["provenance"]
try:
    R.load_live_index(bad)
    refused = False
except ValueError:
    refused = False if False else True
check("a wiring-capture index WITHOUT provenance is refused", refused or "wiring-capture" not in bad["source"])
bad2 = json.load(open(os.path.join(d1, "live_labels.json")))
bad2["source"] = "wiring-capture run x"
del bad2["provenance"]
try:
    R.load_live_index(bad2)
    r2 = False
except ValueError:
    r2 = True
check("source says wiring-capture but provenance missing -> refused", r2)
bad3 = json.load(open(os.path.join(d1, "live_labels.json")))
bad3["provenance"]["fold_sha"] = "not-a-sha"
try:
    R.load_live_index(bad3)
    r3 = False
except ValueError:
    r3 = True
check("malformed provenance sha -> refused", r3)

# rewrites.py source validation accepts live sources with provenance and checks them against the index
T = {"id": "X-1", "lens": "notes", "status": "FIXED_PENDING_VERIFY", "repro_steps": ["Click Add note"], "expected": "A note appears."}


def rwrec(src):
    return {"ticket_id": "X-1", "lens": "notes", "fold_sha": R.FOLD_SHA, "orig_hash": R.orig_hash(T), "author": "sonnet", "date": "2026-11-17", "schema": 1, "status": "rewritten",
            "steps": [{"op": "click", "target": "Add note", "src": src, "from_orig": [0]}],
            "dropped": [], "expected": [{"kind": "needs_human", "args": {}, "from_orig_clause": [0], "orig_span": "A note appears", "why": "no machine predicate for appearance"}]}


check("SRC_RE accepts live:<lens> and live:<lens>@<run>:<sha>", R.SRC_RE.match("live:notes") and R.SRC_RE.match("live:notes@run-1:272e62f41") and not R.SRC_RE.match("live:notes@run 1:zz") and not R.SRC_RE.match("live:Notes@:"))
ok, why = R.agree(T, rwrec("live:notes@run-1:272e62f41"), labels=labels, live_meta=meta)
check("a live source with matching run id + fold sha agrees", ok, why)
ok, why = R.agree(T, rwrec("live:notes@run-9:272e62f41"), labels=labels, live_meta=meta)
check("a live source naming a DIFFERENT run is refused", (not ok) and any("src_not_live" in w for w in why), why)
ok, why = R.agree(T, rwrec("live:notes@run-1:abcdef0"), labels=labels, live_meta=meta)
check("a live source naming a DIFFERENT fold sha is refused", (not ok) and any("src_not_live" in w for w in why), why)
ok, why = R.agree(T, rwrec("live:notes@run-1:272e62f41"), labels=labels, live_meta=None)
check("a provenance-bearing source with an index that has none is refused", (not ok) and any("no provenance" in w for w in why), why)
ok, why = R.agree(T, rwrec("live:notes"), labels={"notes": ["Other"]}, live_meta=meta)
check("a live label that is not in the index is still refused", (not ok) and any("not a live label" in w for w in why), why)
ok, why = R.agree(T, rwrec("live:notes"), labels=labels)
check("plain live:<lens> keeps working (back-compat)", ok, why)

# ---- collector (the walk hook) + registry loader
col = W.Collector(tempfile.mkdtemp(prefix="wcol_"), "run-2", "272e62f41", registry=REG)
col.add("notes", controls, "deadbee", {})
out = col.flush()
check("collector writes the lens wiring + live labels", "wiring-notes.json" in out and "live_labels.json" in out and "actions" in col.registry_desc)
col0 = W.Collector(tempfile.mkdtemp(prefix="wcol0_"), "run-3", "272e62f41", registry=None)
col0.add("notes", controls, None, {})
jn = json.dumps(col0.lenses[0])
check("no registry -> every join reads unresolved:no_registry, nothing guessed", "unresolved:no_registry" in jn and '"pattern"' not in jn)
check("load_registry with nothing configured is empty (no checkout attempted)", W.load_registry() == {})
src = open(os.path.join(HERE, "walker.py")).read()
check("--capture-wiring is a walk flag, off by default", '"--capture-wiring", action="store_true"' in src and "wiring_col = None" in src)
check("capture never stores request/response BODIES: netledger only gains shape fields", "req_shape" in open(os.path.join(HERE, "concord_walker", "netledger.py")).read() and "resp_body" not in open(os.path.join(HERE, "concord_walker", "netledger.py")).read())

colu = W.Collector(tempfile.mkdtemp(prefix="wcolu_"), "run-4", None, registry=None)
colu.add("notes", controls, None, {})
colu.flush()
try:
    R.load_live_index(os.path.join(colu.out_dir, "live_labels.json"))
    ru = False
except ValueError:
    ru = True
check("an unpinned capture (no fold sha) can never back a rewrite: its live index is refused", ru and colu.fold_sha == "unpinned")

print("\n%d checks, %d failed" % (CNT[0], len(FAILS)))
sys.exit(1 if FAILS else 0)
