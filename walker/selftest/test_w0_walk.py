#!/usr/bin/env python3
"""MST-W0-01/02/03 + walker-issue fixes, end to end on the local fixture app
(never prod): schema v2 + build stamp + manifest, per-control endpoint ledger,
premap sweep, auth/me retry, WALK ABORTED + resume, 502 nav retry.
Run: python3 selftest/test_w0_walk.py   (needs the walker venv: playwright + chrome)"""
import glob, json, os, re, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
WALKER = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, WALKER)
import fixture_app
from fixture_app import serve, FIXTURE_SHA

FAILS = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (" " + str(extra)[:600] if extra and not cond else ""), flush=True)
    if not cond:
        FAILS.append(name)


srv = serve()
base = "http://127.0.0.1:%d" % srv.server_address[1]
tmp = tempfile.mkdtemp(prefix="walker-w0-")
audit = os.path.join(tmp, "audit")
os.makedirs(os.path.join(audit, "reports")); os.makedirs(os.path.join(audit, "evidence"))
json.dump([{"slug": s, "url": base + "/lenses/" + s, "category": "test"} for s in ("premap", "demo", "flaky", "chat")],
          open(os.path.join(audit, "inventory.json"), "w"))
open(os.path.join(audit, "fix_tickets.jsonl"), "w").close()
cfg = json.load(open(os.path.join(WALKER, "config.json")))
cfg["base_url"] = base
cfg["audit_dir"] = audit
st = os.path.join(tmp, "t1.json"); json.dump({"cookies": [], "origins": []}, open(st, "w"))
cfg["accounts"]["t1"]["storage_state"] = st
cfg["accounts"]["t1"].pop("secrets_file", None)
cfg["write_skip_lenses"] = ["chat"]
cfg["runs_dir"] = os.path.join(tmp, "runs"); cfg["queue_dir"] = os.path.join(tmp, "queue")
cfg["records_dir"] = os.path.join(tmp, "records")
cfg["thresholds"].update(lens_budget_s=400, auth_retry_backoff_s=[0.2, 0.2, 0.2], gateway_backoff_s=0.2,
                         settle_ms_judgment=3000, sweep_settle_ms=1500, min_mem_available_mb=100)
cfgp = os.path.join(tmp, "config.json"); json.dump(cfg, open(cfgp, "w"))


def walk(*a):
    r = subprocess.run([sys.executable, os.path.join(WALKER, "walker.py"), "--config", cfgp] + list(a) + (["--no-replay"] if a and a[0] in ("lens", "sweep") else []),
                       capture_output=True, text=True, timeout=900)
    print("$ walker.py", " ".join(a), "->", r.returncode, flush=True)
    return r


def runs():
    return sorted(os.listdir(cfg["runs_dir"]))


# ------------------------------------------------------------ W0-01/02/03 premap walk
fixture_app.AUTH["drop_next"] = 2  # two auth/me blips: the retry must absorb them
r = walk("lens", "premap", "--premap", "--dry-run", "--phases", "reach,surface,tabs,openers,console", "--expect-sha", FIXTURE_SHA)
out = r.stdout + r.stderr
check("premap walk exits 0", r.returncode == 0, out[-3000:])
check("auth/me blips retried, not aborted", "auth/me transient failure" in out and "ABORT" not in out, out[-2000:])
check("WALK DONE line carries walked/total", re.search(r"WALK DONE run \S+: walked 1/1 lenses", out) is not None, out[-800:])
rid = runs()[-1]
rd = os.path.join(cfg["runs_dir"], rid)
rec = json.load(open(os.path.join(rd, "lens-premap.json")))
raw = open(os.path.join(rd, "lens-premap.json")).read()
v1 = ("slug", "url", "account", "admin", "started", "finished", "elapsed_s", "checks", "timing_desktop",
      "initial_evidence", "surface", "console", "budget", "new_tickets", "duplicates")
check("W0-01 v1 keys unchanged", all(k in rec for k in v1), [k for k in v1 if k not in rec])
check("W0-01 schema_version 2", rec.get("schema_version") == 2)
d = rec.get("deploy") or {}
check("W0-01 deploy.backend_sha = fixture /health buildSha", d.get("backend_sha") == FIXTURE_SHA, d)
check("W0-01 sha_status ok when it matches --expect-sha", d.get("sha_status") == "ok", d)
check("W0-01 deploy has walker_sha/base_url/checked_at/walked_at",
      d.get("base_url") == base and d.get("checked_at") and d.get("walked_at") and "walker_sha" in d, d)
check("W0-01 screenshots[] with kinds", rec.get("screenshots") and rec["screenshots"][0]["kind"] == "initial"
      and all(s["kind"] in ("initial", "open", "after_escape", "m390", "mid_task", "failure") for s in rec["screenshots"]), rec.get("screenshots"))
check("W0-01 findings[] carry id/signature/check/severity/area/evidence + build stamp",
      isinstance(rec.get("findings"), list) and all(set(("id", "signature", "check", "severity", "area", "evidence", "build_sha", "walked_at")) <= set(f) for f in rec["findings"])
      and all(f["build_sha"] == FIXTURE_SHA[:12] for f in rec["findings"]), rec.get("findings"))
man = json.load(open(os.path.join(rd, "walk-manifest.json")))
check("W0-01 walk-manifest.json lists the lens as walked with a build stamp",
      man["state"] == "done" and man["lenses"][0]["slug"] == "premap" and man["lenses"][0]["status"] == "walked"
      and man["lenses"][0]["build_sha"] == FIXTURE_SHA[:12], man)
ctl = {c["control_id"]: c for c in rec.get("controls", [])}
run = ctl.get("sweep:button:run-calc")
check("W0-02 'Run calc' records POST /api/lens/run fixture.calc 200",
      run and any(q["method"] == "POST" and q["path"] == "/api/lens/run" and q["status"] == 200 for q in run["requests"])
      and run["lens_actions"] == [{"domain": "fixture", "action": "calc"}], run)
rq = next((q for q in (run or {}).get("requests", []) if q["path"] == "/api/lens/run"), {})
check("W0-02 req_keys {domain,action,input}", rq.get("req_keys") == {"action": "s", "domain": "s", "input": "o"}, rq)
check("W0-02 flags signed=false + has_signingReason", rq.get("flags", {}).get("signed") is False and rq.get("flags", {}).get("has_signingReason") is True, rq)
check("W0-02 latency + sizes + write recorded", rq.get("ms") is not None and rq.get("req_bytes", 0) > 0 and rq.get("resp_bytes", 0) > 0 and rq.get("write") is True, rq)
ls = ctl.get("sweep:button:load-stats")
check("W0-02 500 endpoint under that control's http_5xx", ls and ls["http_5xx"] == ["500 /api/boom"], ls)
tab = ctl.get("tab:tab:details")
check("W0-02 tab click -> GET /api/lens/fixture/:uuid (op get)",
      tab and any(q["path"] == "/api/lens/fixture/:uuid" and q.get("lens_action") == {"domain": "fixture", "op": "get"} for q in tab["requests"]), tab)
load = ctl.get("load:page:-")
check("W0-02 load control has the lens list call (query keys only)",
      load and any(q["path"] == "/api/lens/fixture" and q.get("query_keys") == ["cursor", "limit"] for q in load["requests"]), load)
check("W0-02 polling stays on load:page:-, not on clicks",
      all(q["path"] != "/api/poll" for c in rec["controls"] if c["control_id"] != "load:page:-" for q in c["requests"])
      and any(q["path"] == "/api/poll" for q in load["requests"]))
check("W0-02 nothing from bodies/values stored", all(x not in raw for x in ("do-not-store-me", "private row value", "abc\"", "missing_declaration")))
check("W0-02 endpoints[] and actions[] rollups", any(e["path"] == "/api/lens/run" for e in rec.get("endpoints", []))
      and any(a.get("action") == "calc" for a in rec.get("actions", [])))
check("W0-02 every control/endpoint row stamped with build", all(x.get("build_sha") == FIXTURE_SHA[:12] for x in rec["controls"] + rec["endpoints"]))
dead = ctl.get("sweep:button:dead-button")
check("W0-03 dead button: exercised, effect none, no call", dead and dead["exercised"] and dead["effect"] == "none" and dead["no_call"], dead)
tips = ctl.get("sweep:button:show-tips")
check("W0-03 UI-only control: effect ax_change, no call", tips and tips["effect"] == "ax_change" and tips["no_call"], tips)
da = ctl.get("sweep:button:delete-all")
check("W0-03 'Delete all' not clicked: exercised=false reason=destructive", da and da["exercised"] is False and da["reason"] == "destructive", da)
check("W0-03 destructive endpoint never hit", not any("del=all" in p for p in fixture_app.POSTS), fixture_app.POSTS)
lk = ctl.get("sweep:button:locked")
check("W0-03 disabled control: reason disabled", lk and lk["exercised"] is False and lk["reason"] == "disabled", lk)
reused = ctl.get("sweep:tab:details")
check("W0-03 tab already clicked by the tabs phase is reused, not clicked twice", reused and reused.get("reused_from") == "tab:tab:details", reused)
names = set(rec["surface"]["button_names"]) | set(rec["surface"]["tab_names"])
swept = {c["name"] for c in rec["controls"] if c["phase"] == "sweep"}
check("W0-03 100% of named controls accounted (exercised or reason)", names <= swept, names - swept)
check("W0-03 every sweep row: exercised or a reason",
      all(c["exercised"] or c["reason"] for c in rec["controls"] if c["phase"] == "sweep"))
check("W0-03 premap_sweep check marked", rec["checks"].get("premap_sweep", {}).get("status") == "PASS", rec["checks"].get("premap_sweep"))
check("W0-03 no tickets filed from premap data", not os.path.exists(os.path.join(rd, "new_tickets.jsonl")) or
      not any("dead" in l.lower() for l in open(os.path.join(rd, "new_tickets.jsonl"))))
size = os.path.getsize(os.path.join(rd, "lens-premap.json"))
check("lens record within 60 KB target", size <= 60 * 1024, size)

# write-skip lens: compute verbs refused
r = walk("lens", "chat", "--premap", "--dry-run", "--phases", "reach,surface")
rc = json.load(open(os.path.join(cfg["runs_dir"], runs()[-1], "lens-chat.json")))
send = next((c for c in rc["controls"] if c["name"] == "Send"), None)
check("W0-03 write-skip lens: Send stays unclicked (disabled/unsafe)", send and send["exercised"] is False, send)

# ------------------------------------------------------------ 502 retry
fixture_app.GATEWAY["flaky_502"] = 1
r = walk("lens", "flaky", "--dry-run", "--phases", "reach")
rf = json.load(open(os.path.join(cfg["runs_dir"], runs()[-1], "lens-flaky.json")))
check("502 on load is retried, lens reaches PASS", rf["checks"]["reach_desktop"]["status"] == "PASS" and "gateway 502" in r.stdout + r.stderr, rf["checks"]["reach_desktop"])
fixture_app.GATEWAY["flaky_502"] = 10
r = walk("lens", "flaky", "--dry-run", "--phases", "reach")
rf = json.load(open(os.path.join(cfg["runs_dir"], runs()[-1], "lens-flaky.json")))
check("persistent 502 still FAILS after the retries (not hidden)", rf["checks"]["reach_desktop"]["status"] == "FAIL", rf["checks"]["reach_desktop"])
fixture_app.GATEWAY["flaky_502"] = 0

# ------------------------------------------------------------ WALK ABORTED + resume
fixture_app.AUTH["status"] = 503
r = walk("sweep", "--only", "flaky,premap", "--dry-run", "--phases", "reach")
out = r.stdout + r.stderr
check("auth/me down for good: exit code 3 (not 0)", r.returncode == 3, r.returncode)
check("prints WALK ABORTED with walked/total, never WALK DONE",
      re.search(r"WALK ABORTED run \S+ at flaky: walked 0/2 lenses", out) is not None and "WALK DONE" not in out, out[-1500:])
arid = runs()[-1]
am = json.load(open(os.path.join(cfg["runs_dir"], arid, "walk-manifest.json")))
check("manifest says aborted + lens aborted with reason", am["state"] == "aborted" and am["lenses"][0]["status"] == "aborted"
      and "503" in am["lenses"][0]["reason"], am)
fixture_app.AUTH["status"] = None
r = walk("sweep", "--only", "flaky,premap", "--dry-run", "--phases", "reach", "--resume", arid)
out = r.stdout + r.stderr
check("resume walks the rest and says WALK DONE 2/2", r.returncode == 0 and re.search(r"WALK DONE run %s: walked 2/2" % arid, out), out[-1500:])
r = walk("sweep", "--only", "flaky,premap", "--dry-run", "--phases", "reach", "--resume", arid)
out = r.stdout + r.stderr
check("second resume re-walks nothing", "already walked, skipping" in out and "lens flaky as" not in out and "WALK DONE" in out, out[-1500:])

# v1 readability
from concord_walker.lensrecord import load_lens_record
v1p = os.path.join(tmp, "lens-old.json")
json.dump({"slug": "old", "checks": {}, "initial_evidence": "evidence/old/x.png"}, open(v1p, "w"))
o = load_lens_record(v1p)
check("v1 record still loads (schema 1, flagged unstamped)", o["schema_version"] == 1 and o["v1"] and o["deploy"]["sha_status"] == "missing"
      and o["screenshots"] == [{"path": "evidence/old/x.png", "kind": "initial"}])
check("v2 record loads unchanged", load_lens_record(os.path.join(rd, "lens-premap.json"))["schema_version"] == 2)

srv.shutdown()
print("\n%d failure(s)  (tmp: %s)" % (len(FAILS), tmp))
sys.exit(1 if FAILS else 0)
