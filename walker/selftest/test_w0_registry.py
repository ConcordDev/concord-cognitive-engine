#!/usr/bin/env python3
"""MST-W0-04 tests: registry snapshot (git + dir modes), route normalization, and the
false-positive-safe classes. Pure python + git, no browser.
Run: python3 selftest/test_w0_registry.py"""
import json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "tools"))
from concord_walker import routematch as RM
import action_registry as AR
import unused_actions as UA

FAILS = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (" " + str(extra)[:600] if extra and not cond else ""))
    if not cond:
        FAILS.append(name)


FILES = {
    "server/server.js": '''
import createNotesRouter from "./routes/notes.js";
import { createWidgetsRouter } from "./routes/widgets.js";
import registerSystemRoutes from "./routes/system.js";
import { registerGuidanceEndpoints } from "./guidance.js";
import { r as shadow } from "./lib/shadow.js";
registerSystemRoutes(app, {});
registerGuidanceEndpoints(app, db);
app.use("/api/notes", createNotesRouter({ db }));
app.get("/api/dtus/:id(\\\\d+)", h);
app.post("/api/lens/run", h);
app.get("/api/files/*", h);
app.get("/api/opt/:a?", h);
app.all("/api/*", notFound);
app.get(`/api/tpl/${PREFIX}/x`, h);
app.get("/api/auth/me", h);
// app.get("/api/commented-out", h);

registerLensAction("chem", "equilibrium", fn);
''',
    "server/routes/notes.js": '''export default function createNotesRouter() { const router = express.Router();
  router.get("/:id", h); router.patch("/:id", h); return router; }''',
    "server/routes/widgets.js": '''export function createWidgetsRouter() { const router = express.Router();
  router.get("/widgets/:wid/parts", h); return router; }  // mounted at runtime elsewhere''',
    "server/guidance.js": '''export function registerGuidanceEndpoints(app, db) {
  app.get("/api/guidance/first-win", h); registerLensAction("guidance", "suggestions", f); }''',
    "server/lib/generator.js": '''const tpl = `
  app.get('/api/auth/me', h);
  app.get('/api/generated-only', h);`;''',
    "server/lib/shadow.js": '''export function r(app) { app.get("/api/auth/me", h); }''',
    "server/tests/fake.test.js": '''app.get("/api/only-in-tests", h);''',
    "server/routes/system.js": '''export default function registerSystemRoutes(app) { app.get("/health", h); }''',
    "server/domains/chem.js": '''export default function registerChemActions(registerLensAction) {
  const registerCalc = (name, fn) => registerLensAction("chem", name, fn);
  registerCalc("balanceReaction", f);
  registerCalc("calc-molarity", f);
  registerLensAction("chem", "analyze", f);
}''',
    "server/domains/engineering.js": '''export default function r(registerLensAction) {
  registerLensAction("engineering", "beamStudy", f); registerLensAction("engineering", "beamStudy-get", f); }''',
    "server/lib/receipts/declarations.js": '''registerDeclaration("chem", "equilibrium", {
  certifiable: true, solver: {} });''',
    "concord-frontend/app/(marketing)/about/page.tsx": "export default function P(){}",
    "concord-frontend/app/lenses/[slug]/page.tsx": "export default function P(){}",
    "concord-frontend/app/lenses/chem/page.tsx": "lensRun('chem', 'balanceReaction', {}); lensRun<{a: string}>('chem', 'calc-molarity', {})",
    "concord-frontend/app/docs/[...path]/page.tsx": "export default function P(){}",
    "concord-frontend/app/@modal/(..)photo/[id]/page.tsx": "export default function P(){}",
    "concord-frontend/app/api/hooks/[[...rest]]/route.ts": "export async function POST(){}",
    "concord-frontend/components/conkay/workspace/useConKayWorkspace.ts":
        "lensRun('engineering', 'beamStudy', {}); lensRun({ domain: 'engineering', action: `beamStudy-${op}` })",
    "concord-frontend/app/lenses/chem/page.test.tsx": "lensRun('chem', 'equilibrium', {})",
}


def make_tree():
    d = tempfile.mkdtemp(prefix="reg-src-")
    for p, t in FILES.items():
        full = os.path.join(d, p)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        open(full, "w").write(t)
    return d


def test_normalization():
    check("express :id(regex) -> :p", RM.express_pattern("/api/dtus/:id(\\d+)") == "/api/dtus/:p")
    check("express optional / catch-all / {param} / ${x}",
          RM.express_pattern("/a/:x?/*") == "/a/:p?/*" and RM.express_pattern("/a/{id}") == "/a/:p"
          and RM.express_pattern("/a/${P}/b") == "/a/:p/b" and RM.express_pattern("/f/:path*") == "/f/**")
    check("next: group + parallel + intercepting stripped", RM.next_pattern("/(marketing)/@modal/(..)photo/[id]") == "/photo/:p")
    check("next: catch-all + optional catch-all", RM.next_pattern("/docs/[...p]") == "/docs/*" and RM.next_pattern("/h/[[...r]]") == "/h/**")
    check("templated id never equals a literal", not RM.pattern_match("/api/lens/run", "/api/lens/:uuid"))
    check("param matches literal and templated", RM.pattern_match("/api/lens/:p", "/api/lens/chem") and RM.pattern_match("/api/lens/:p", "/api/lens/:uuid"))
    check("* needs >=1 segment, ** allows 0", not RM.pattern_match("/docs/*", "/docs") and RM.pattern_match("/h/**", "/h"))
    check("runtime mount = suffix match only when flagged", RM.pattern_match("/widgets/:p/parts", "/api/v2/widgets/:n/parts", runtime=True)
          and not RM.pattern_match("/widgets/:p/parts", "/api/v2/widgets/:n/parts"))
    check("runtime suffix needs a literal segment (bare /:id never claims a path)",
          not RM.pattern_match("/:p", "/api/guidance/first-win", runtime=True) and not RM.pattern_match("/:p/:p", "/api/x/y", runtime=True))
    check("status_ok: 2xx/3xx/pending ok; 4xx/5xx/None/failed not",
          all(RM.status_ok(s) for s in (200, 204, "304", "pending", "aborted", "net::ERR_ABORTED")) and not any(RM.status_ok(s) for s in (404, 405, 500, None, "failed", "net::ERR_FAILED")))


def _registry(tree_src):
    return AR.build(AR.DirTree(tree_src), "a" * 40)


def test_registry_scan():
    src = make_tree()
    reg = _registry(src)
    acts = {(a["domain"], a["action"]): a for a in reg["actions"]}
    check("direct + helper-wrapped actions found", {("chem", "equilibrium"), ("chem", "balanceReaction"), ("chem", "calc-molarity"),
                                                   ("chem", "analyze"), ("engineering", "beamStudy")} <= set(acts), sorted(acts))
    check("receipt classes PRODUCT / NEAR / LLM / NONE",
          acts[("chem", "equilibrium")]["receipt_class"] == "PRODUCT" and acts[("chem", "balanceReaction")]["receipt_class"] == "NEAR"
          and acts[("chem", "analyze")]["receipt_class"] == "LLM" and acts[("engineering", "beamStudy")]["receipt_class"] == "NONE")
    check("fe_callers incl. generics + object form + template prefix",
          acts[("chem", "calc-molarity")]["fe_callers"] and acts[("engineering", "beamStudy-get")]["fe_callers"]
          and all("conkay" in f for f in acts[("engineering", "beamStudy")]["fe_callers"]))
    check("test files are not callers", not acts[("chem", "equilibrium")]["fe_callers"])
    pats = {(r["method"], r["pattern"], r["mount"]) for r in reg["routes"]}
    check("router mounted with its app.use prefix", ("GET", "/api/notes/:p", "/api/notes") in pats, sorted(pats))
    check("router with no visible mount -> runtime", ("GET", "/widgets/:p/parts", "runtime") in pats)
    check("register(app) file routes are absolute", ("GET", "/health", "") in pats)
    check("next page/api routes normalized", ("GET", "/about", "") in pats and ("GET", "/photo/:p", "") in pats and ("POST", "/api/hooks/**", "") in pats)
    # git mode gives the same result (git show / ls-tree only)
    repo = tempfile.mkdtemp(prefix="reg-git-")
    subprocess.run(["git", "init", "-q", repo], check=True)
    subprocess.run(["cp", "-r", src + "/.", repo], check=True)
    subprocess.run(["git", "-C", repo, "add", "-A"], check=True)
    subprocess.run(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "x"], check=True)
    sha = subprocess.run(["git", "-C", repo, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    open(os.path.join(repo, "server/domains/chem.js"), "w").write("// worktree edit must not be read\n")
    g = AR.build(AR.GitTree(repo, sha), sha)
    check("git mode reads the sha, not the worktree", len(g["actions"]) == len(reg["actions"]) and g["routes"] == reg["routes"])
    out = tempfile.mkdtemp()
    p = AR.write(g, out)
    check("registry written gzipped, deterministic, <= 200 KB", p.endswith(".json.gz") and os.path.getsize(p) < 200 * 1024
          and open(p, "rb").read() == open(AR.write(g, out), "rb").read())
    check("bad sha refused", _raises(lambda: AR.main(["--src", src, "--sha", "nothex!", "--out", out])))
    return reg


def _raises(fn):
    try:
        fn()
    except SystemExit:
        return True
    return False


def _rec(slug, calls, sha="a" * 12, v=2):
    controls = {}
    for cid, method, path, status, typ in calls:
        controls.setdefault(cid, {"control_id": cid, "sid": "c_" + cid[-6:], "requests": []})["requests"].append(
            {"method": method, "path": path, "status": status, "n": 1, "type": typ})
    return {"slug": slug, "schema_version": v, "deploy": {"backend_sha": sha, "walked_at": "2026-11-16T08:00:00-0500"},
            "controls": list(controls.values())}


def test_fp_classes():
    reg = _registry(make_tree())
    calls = [
        ("sweep:button:a", "GET", "/api/notes/:uuid", 200, "fetch"),          # router param, mounted prefix
        ("sweep:button:b", "GET", "/api/files/a/b/c", 200, "fetch"),          # catch-all
        ("load:page:-", "GET", "/about", 200, "document"),                    # next route group
        ("sweep:button:c", "GET", "/api/v2/widgets/:n/parts", 200, "fetch"),  # runtime-mounted prefix
        ("sweep:button:d", "GET", "/docs/x/y", 200, "document"),              # next catch-all
        ("sweep:button:e", "GET", "/api/opt", 200, "fetch"),                  # optional param
        ("sweep:button:f", "GET", "/api/tpl/v9/x", 200, "fetch"),             # template literal prefix
        ("sweep:button:g", "GET", "/api/never/declared", 200, "fetch"),       # unknown but 2xx
        ("sweep:button:h", "GET", "/api/gone/:n", 404, "fetch"),              # TRUE missing
        ("sweep:button:i", "GET", "/api/ghost", None, "fetch"),               # network fail, undeclared
        ("sweep:button:j", "GET", "/api/dtus/:n", 500, "fetch"),              # declared but failing
        ("sweep:button:k", "DELETE", "/api/notes/:uuid", 405, "fetch"),       # declared path, wrong method, 405
        ("sweep:button:l", "POST", "/api/lens/run", 200, "fetch"),
        ("sweep:button:m", "GET", "/api/guidance/first-win", 503, "fetch"),   # registrar outside routes/: declared, failing
        ("sweep:button:n", "GET", "/api/only-in-tests", 404, "fetch"),        # tests are not the app
    ]
    d = UA.diff(reg, {"t": ("x", _rec("t", calls))})
    cls = {r["control_id"]: r["class"] for r in d["lenses"]["t"]["calls"]}
    for cid in ("a", "b", "c", "e", "f", "l"):
        check("2xx on a declared %s route is matched_ok (never real_missing)" % cid, cls["sweep:button:" + cid] == "matched_ok", cls)
    check("route group page 2xx matched_ok", cls["load:page:-"] == "matched_ok", cls)
    check("registrar outside server/routes is scanned (503 there = matched_failing, not real_missing)", cls["sweep:button:m"] == "matched_failing", cls)
    check("routes declared only in tests do not count", cls["sweep:button:n"] == "real_missing", cls)
    check("route in a comment is not a route", not any(r["pattern"] == "/api/commented-out" for r in reg["routes"]))
    check("file not reachable from server.js (code generator) is not scanned", not any(r["pattern"] == "/api/generated-only" for r in reg["routes"]))
    me = [r for r in reg["routes"] if r["pattern"] == "/api/auth/me"]
    check("duplicate route attributed to server.js before lib files", len(me) == 1 and me[0]["file"] == "server/server.js", me)
    check("lens action registered outside domains/ is scanned", any(a["domain"] == "guidance" and a["action"] == "suggestions" for a in reg["actions"]))
    check("next catch-all page 2xx matched_ok", cls["sweep:button:d"] == "matched_ok", cls)
    check("undeclared + 2xx = unmatched_but_ok (noise)", cls["sweep:button:g"] == "unmatched_but_ok")
    check("undeclared + 404 = real_missing", cls["sweep:button:h"] == "real_missing")
    check("undeclared + network fail = real_missing", cls["sweep:button:i"] == "real_missing")
    check("declared + 500 = matched_failing", cls["sweep:button:j"] == "matched_failing")
    k = next(r for r in d["lenses"]["t"]["calls"] if r["control_id"] == "sweep:button:k")
    check("declared path, wrong method, 405 = real_missing with a note", k["class"] == "real_missing" and "not DELETE" in (k.get("note") or ""), k)
    defects = {r["control_id"] for r in d["lenses"]["t"]["defects"]}
    check("defects = real_missing + matched_failing only", defects == {"sweep:button:h", "sweep:button:i", "sweep:button:j", "sweep:button:k", "sweep:button:m", "sweep:button:n"}, defects)
    check("noise never in defects", "sweep:button:g" not in defects and [r["control_id"] for r in d["lenses"]["t"]["noise"]] == ["sweep:button:g"])
    check("unused_route counted (declared, never observed)", d["totals"]["unused_route"] > 0 and any("/health" in u for u in d["unused_routes_sample"]))
    check("catch-all 404 handler excluded from matching", not any(r["route"] == "ALL /api/*" for r in d["lenses"]["t"]["calls"]))
    check("rows carry build stamp", all(r["build_sha"] == "a" * 12 and r["walked_at"] for r in d["lenses"]["t"]["calls"]))
    check("build_match same when registry sha == record sha", d["lenses"]["t"]["build_match"] == "same")
    d2 = UA.diff(reg, {"t": ("x", _rec("t", calls, sha="b" * 12)), "u": ("y", {"slug": "u", "schema_version": 1, "v1": True, "deploy": {},
                                                                              "console": {"http_5xx": ["503 /api/notes/123"]}})})
    check("different build flagged, unstamped flagged", d2["lenses"]["t"]["build_match"] == "differs" and d2["lenses"]["u"]["build_match"] == "unknown"
          and d2["build_mismatch_lenses"] == ["t", "u"])
    u = d2["lenses"]["u"]
    check("v1 record: console 5xx classified, note says no endpoint data", u["calls"][0]["class"] == "matched_failing" and "v1 record" in u["note"])


def test_actions_diff():
    reg = _registry(make_tree())
    rec = _rec("chem", [])
    rec["controls"] = [{"control_id": "sweep:button:bal", "sid": "c_1", "requests": [
        {"method": "POST", "path": "/api/lens/run", "status": 200, "n": 1, "lens_action": {"domain": "chem", "action": "balanceReaction"}},
        {"method": "POST", "path": "/api/lens/run", "status": 404, "n": 1, "lens_action": {"domain": "chem", "action": "nope"}},
        {"method": "POST", "path": "/api/lens/run", "status": 200, "n": 1, "lens_action": {"domain": "chem", "action": "dyn"}}]}]
    d = UA.diff(reg, {"chem": ("p", rec)})
    l = d["lenses"]["chem"]
    a = {r["action"]: r["class"] for r in l["actions_observed"]}
    check("registered action 2xx matched_ok; unregistered 404 real_missing; unregistered 2xx noise",
          a == {"balanceReaction": "matched_ok", "nope": "real_missing", "dyn": "unmatched_but_ok"}, a)
    check("registered_not_observed lists the lens's other actions", set(l["registered_not_observed"]["actions"]) == {"equilibrium", "calc-molarity", "analyze"})
    check("no_fe_caller (UNSURFACED)", set(l["no_fe_caller"]["actions"]) == {"equilibrium", "analyze"}, l["no_fe_caller"])
    d2 = UA.diff(reg, {"engineering": ("p", _rec("engineering", []))})
    check("caller_in_other_lens (beamStudy only called from components/conkay)",
          "beamStudy" in d2["lenses"]["engineering"]["caller_in_other_lens"]["actions"], d2["lenses"]["engineering"]["caller_in_other_lens"])


def test_cli_end_to_end():
    src = make_tree()
    out = tempfile.mkdtemp()
    AR.main(["--src", src, "--sha", "c" * 40, "--out", out])
    run = tempfile.mkdtemp()
    json.dump(_rec("t", [("sweep:button:h", "GET", "/api/gone/:n", 404, "fetch")], sha="c" * 12), open(os.path.join(run, "lens-t.json"), "w"))
    UA.main(["--registry", os.path.join(out, "actions-cccccccccccc.json.gz"), "--run", run])
    d = json.load(open(os.path.join(run, "registry-diff.json")))
    md = open(os.path.join(run, "registry-diff.md")).read()
    check("CLI writes json + md with the defect", d["defects_total"] == 1 and "real_missing" in md)


if __name__ == "__main__":
    for fn in [v for k, v in sorted(globals().items()) if k.startswith("test_")]:
        fn()
    print("\n%d failure(s)" % len(FAILS))
    sys.exit(1 if FAILS else 0)
