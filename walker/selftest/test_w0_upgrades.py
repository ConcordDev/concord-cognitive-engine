#!/usr/bin/env python3
"""Walker upgrades (Dutch, Nov 16) end to end on the local fixture app (never prod):
1 per-control JS/asset errors (a crash is not a dead button), 2 write-then-read-back
(fake_success), 3 two-account ownership replay, 4 slow calls + main-thread freeze,
5 stable control ids, 7 failure-only screenshots. (6 run-diff: test_w0_rundiff.py)
Run: python3 selftest/test_w0_upgrades.py"""
import json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
WALKER = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, WALKER)
import fixture_app
from fixture_app import serve, FIXTURE_SHA

FAILS = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (" " + str(extra)[:700] if extra and not cond else ""), flush=True)
    if not cond:
        FAILS.append(name)


srv = serve()
base = "http://127.0.0.1:%d" % srv.server_address[1]
tmp = tempfile.mkdtemp(prefix="walker-upg-")
audit = os.path.join(tmp, "audit")
os.makedirs(os.path.join(audit, "reports")); os.makedirs(os.path.join(audit, "evidence"))
json.dump([{"slug": "upgrades", "url": base + "/lenses/upgrades", "category": "test"}], open(os.path.join(audit, "inventory.json"), "w"))
open(os.path.join(audit, "fix_tickets.jsonl"), "w").close()
cfg = json.load(open(os.path.join(WALKER, "config.json")))
cfg["base_url"] = base
cfg["audit_dir"] = audit
for acct, who in (("t1", "t1"), ("t2", "t2")):
    st = os.path.join(tmp, "%s.json" % acct)
    json.dump({"cookies": [{"name": "fx_user", "value": who, "domain": "127.0.0.1", "path": "/", "expires": -1,
                            "httpOnly": False, "secure": False, "sameSite": "Lax"}], "origins": []}, open(st, "w"))
    cfg["accounts"][acct]["storage_state"] = st
    cfg["accounts"][acct].pop("secrets_file", None)
cfg["write_skip_lenses"] = []
cfg["runs_dir"] = os.path.join(tmp, "runs"); cfg["queue_dir"] = os.path.join(tmp, "queue")
cfg["records_dir"] = os.path.join(tmp, "records")
cfg["thresholds"].update(lens_budget_s=400, settle_ms_judgment=3000, sweep_settle_ms=1800, slow_call_ms=1000,
                         long_task_ms=500, freeze_ms=700, min_mem_available_mb=100)
cfgp = os.path.join(tmp, "config.json"); json.dump(cfg, open(cfgp, "w"))


def walk(*a):
    r = subprocess.run([sys.executable, os.path.join(WALKER, "walker.py"), "--config", cfgp] + list(a),
                       capture_output=True, text=True, timeout=900)
    print("$ walker.py", " ".join(a), "->", r.returncode, flush=True)
    return r


def last_record(slug):
    rd = os.path.join(cfg["runs_dir"], sorted(os.listdir(cfg["runs_dir"]))[-1])
    return json.load(open(os.path.join(rd, "lens-%s.json" % slug))), rd


fixture_app.NOTES[fixture_app.NOTE_ID].update(pinned=False)
r = walk("lens", "upgrades", "--premap", "--dry-run", "--two-account", "--phases", "reach,surface,console")
check("walk exits 0", r.returncode == 0, (r.stdout + r.stderr)[-3000:])
rec, rd = last_record("upgrades")
ctl = {c["name"]: c for c in rec["controls"] if c["phase"] == "sweep"}
pf = rec.get("premap_findings", [])
classes = sorted({f["class"] for f in pf})
print("premap finding classes:", classes)

# 1 errors per control
cw = ctl.get("Crash widget", {})
check("1 crash: exception + boundary attributed to the click", cw.get("errors", {}).get("exception", 0) >= 1 and cw.get("errors", {}).get("boundary", 0) >= 1, cw)
check("1 crash is effect=error, not a dead button", cw.get("effect") == "error" and "js_error" in cw.get("broken", []), cw)
af = ctl.get("Async fail", {})
check("1 unhandled rejection attributed", af.get("errors", {}).get("rejection", 0) + af.get("errors", {}).get("exception", 0) >= 1 and af.get("effect") == "error", af)
bi = ctl.get("Badge icon", {})
check("1 failed asset load attributed", bi.get("errors", {}).get("asset_fail", 0) >= 1 and "asset_fail" in bi.get("broken", []), bi)
idle = ctl.get("Idle button", {})
check("1 control with no effect and no errors stays effect=none (dead), not broken", idle.get("effect") == "none" and not idle.get("broken") and not idle.get("errors"), idle)
check("1 error samples are short and scrubbed", all(len(x) <= 140 for c in rec["controls"] for x in c.get("error_samples", [])))

# 2 write-then-read-back
pin = ctl.get("Pin note", {})
check("2 PATCH that persists: readback=persisted, no fake_success", pin.get("readback") == "persisted" and not pin.get("fake_success"), pin)
star = ctl.get("Star note", {})
check("2 POST 200 that does not persist: fake_success", star.get("fake_success") is True and star.get("readback") == "lost after reload" and "fake_success" in star.get("broken", []), star)
check("2 fake_success premap finding with evidence + build stamp",
      any(f["class"] == "fake_success" and f["control_id"] == star.get("control_id") and f["evidence"] and f["build_sha"] == FIXTURE_SHA[:12] for f in pf), pf)
check("2 persisted write: no fake-success image (only ownership evidence)", not any("fail-Pin" in e for e in pin.get("evidence", [])), pin)

# 3 two-account
ta = rec.get("two_account", {})
calls = {(c["method"], c["path"]): c for c in ta.get("calls", [])}
check("3 replay ran as t2", ta.get("status") == "FAIL" and ta.get("replayed", 0) >= 3, ta)
check("3 t2 reading t1's unguarded note = OWNERSHIP_FAIL", calls.get(("GET", "/api/notes/:uuid"), {}).get("verdict") == "OWNERSHIP_FAIL", calls)
check("3 guarded note refuses t2 (404) = PASS", calls.get(("GET", "/api/secure-notes/:uuid"), {}).get("verdict") == "PASS", calls)
check("3 t2 write on t1's note = OWNERSHIP_FAIL", calls.get(("PATCH", "/api/notes/:uuid"), {}).get("verdict") == "OWNERSHIP_FAIL", calls)
check("3 ownership findings recorded on the right control", any(f["class"] == "ownership" for f in pf) and ctl.get("Open note", {}).get("ownership"), ctl.get("Open note"))
check("3 never DELETE", not any(p.startswith("DELETE") for p in fixture_app.POSTS))
raw = open(os.path.join(rd, "lens-upgrades.json")).read()
check("3 raw object ids / bodies never written", fixture_app.NOTE_ID not in raw and "t1 private note" not in raw and '"pinned": true' not in raw)
check("3 credentials never in output", "fx_user" not in raw and "password" not in (r.stdout + r.stderr).lower())

# false-positive controls found on the 2026-11-16 live run
om = ctl.get("Open menu", {})
check("FP telemetry: menu that only fires POST /api/metrics/vitals is not fake_success / not a write",
      om.get("exercised") and not om.get("fake_success") and "fake_success" not in om.get("broken", [])
      and all(not q.get("write") for q in om.get("requests", []) if q.get("telemetry"))
      and any(q.get("telemetry") for q in om.get("requests", [])), om)
check("FP telemetry: no fake_success finding on the menu", not any(f["class"] == "fake_success" and f["control_id"] == om.get("control_id") for f in pf))
pl = ctl.get("Prefetch link", {})
check("FP aborted: a client-cancelled fetch is 'aborted', not request_failed",
      pl.get("exercised") and "request_failed" not in pl.get("broken", []) and any(q.get("error") == "aborted" for q in pl.get("requests", [])), pl)
check("FP public: an object a signed-out visitor can also read is PUBLIC, not ownership",
      calls.get(("GET", "/api/public-notes/:uuid"), {}).get("verdict") == "PUBLIC"
      and calls.get(("GET", "/api/public-notes/:uuid"), {}).get("anon_status") == 200 and ta.get("public", 0) >= 1, calls)
check("FP public: signed-in-only object stays OWNERSHIP_FAIL (anon got 401)",
      calls.get(("GET", "/api/notes/:uuid"), {}).get("anon_status") == 401, calls)
check("FP public: no ownership finding for the public read", not any(f["class"] == "ownership" and "public-notes" in f["title"] for f in pf))
check("FP telemetry never replayed as t2", ("POST", "/api/metrics/vitals") not in calls)
check("FP scoped: a route that answers with the caller's own data is SCOPED, not ownership",
      calls.get(("GET", "/api/memory/:uuid"), {}).get("verdict") == "SCOPED"
      and calls.get(("GET", "/api/memory/:uuid"), {}).get("same_as_t1") is False, calls)
check("FP scoped: an empty payload for t2 is EMPTY, not ownership",
      calls.get(("GET", "/api/drafts/:uuid"), {}).get("verdict") == "EMPTY", calls)
check("FP scoped: the real leak (t2 gets t1's exact note) stays OWNERSHIP_FAIL",
      calls.get(("GET", "/api/notes/:uuid"), {}).get("verdict") == "OWNERSHIP_FAIL"
      and calls.get(("GET", "/api/notes/:uuid"), {}).get("same_as_t1") is True, calls)
mr = calls.get(("GET", "/api/ct/merit/:uuid"), {})
check("intended public: merit (allowlisted, identical non-empty) is PUBLIC_INTENDED, not OWNERSHIP_FAIL",
      mr.get("verdict") == "PUBLIC_INTENDED" and mr.get("same_as_t1") is True and (mr.get("intended_public") or {}).get("decided_by") == "Dutch", mr)
check("intended public: no ownership finding for merit", not any(f["class"] == "ownership" and "/ct/merit/" in f["title"] for f in pf))
check("intended public: counted in two_account.public_intended", ta.get("public_intended") == 1, ta)
check("intended public: a non-listed identical non-empty payload (notes) is still OWNERSHIP_FAIL",
      calls.get(("GET", "/api/notes/:uuid"), {}).get("verdict") == "OWNERSHIP_FAIL" and any(f["class"] == "ownership" and "/api/notes/" in f["title"] for f in pf))
cm = calls.get(("GET", "/api/chat/memory/:uuid"), {})
check("FP contentless: identical zeroed chat-memory body (counts 0, topics [], '0/N') is EMPTY, not ownership",
      cm.get("verdict") == "EMPTY" and cm.get("same_as_t1") is True and cm.get("t1_contentless") is True
      and (cm.get("t2_shape") or {}).get("nonempty") == 0 and (cm.get("t2_shape") or {}).get("leaves", 0) >= 6, cm)
nt = calls.get(("GET", "/api/notes/:uuid"), {})
check("FP contentless: identical NON-zero payload (real leak) stays OWNERSHIP_FAIL with t1_contentless False",
      nt.get("verdict") == "OWNERSHIP_FAIL" and nt.get("same_as_t1") is True and nt.get("t1_contentless") is False
      and (nt.get("t2_shape") or {}).get("nonempty", 0) > 0, nt)
check("FP contentless: no ownership finding for chat memory", not any(f["class"] == "ownership" and "/chat/memory/" in f["title"] for f in pf))
check("shape stats store counts only (no values)",
      all(set((c.get(k) or {}).keys()) <= {"leaves", "nonempty"} for c in calls.values() for k in ("t1_shape", "t2_shape")))
check("FP scoped: no ownership finding for memory/drafts", not any(f["class"] == "ownership" and ("/memory/" in f["title"] or "/drafts/" in f["title"]) for f in pf))
bm = ctl.get("Bookmark", {})
check("FP toast: a write whose only visible change is a role=status toast is unverifiable, not fake_success",
      bm.get("exercised") and not bm.get("fake_success") and "fake_success" not in bm.get("broken", [])
      and (bm.get("readback") or "").startswith("unverifiable"), bm)

# 4 speed + freeze
sr = ctl.get("Slow stats", {})
check("4 call over the slow budget flagged", sr.get("slow_calls") and "slow_call" in sr.get("broken", []), sr)
hc = ctl.get("Heavy chart", {})
check("4 main-thread freeze flagged", "freeze" in hc.get("broken", []) and (hc.get("freeze_ms", 0) >= 700 or hc.get("long_tasks", 0) >= 1), hc)

# 5 stable ids
check("5 every control carries a sid", all(c.get("sid", "").startswith("c_") and len(c["sid"]) == 14 for c in rec["controls"]))
from concord_walker.netledger import stable_id, norm_name
check("5 sid ignores whitespace + number churn", stable_id("button", "Notifications (30  unread)") == stable_id("button", " notifications (2 unread) "))
check("5 sid differs by role and by container path", stable_id("button", "Save") != stable_id("tab", "Save")
      and stable_id("button", "Save", ("dialog:edit",)) != stable_id("button", "Save", ("main:",)))
r2 = walk("lens", "upgrades", "--premap", "--dry-run", "--phases", "reach,surface")
rec2, _ = last_record("upgrades")
s1 = {c["name"]: c["sid"] for c in rec["controls"] if c["phase"] == "sweep"}
s2 = {c["name"]: c["sid"] for c in rec2["controls"] if c["phase"] == "sweep"}
check("5 sids identical across runs", s1 == s2 and len(s1) >= 8, (s1, s2))
check("5 premap findings carry the sid", all(f.get("sid") for f in pf if f["class"] != "ownership" or f.get("sid")))

# 7 failure-only screenshots
fails = [s for s in rec["screenshots"] if s["kind"] == "failure"]
broken_ctl = [c for c in rec["controls"] if c["phase"] == "sweep" and c.get("broken")]
check("7 one failure image per broken control", all(c.get("evidence") for c in broken_ctl) and
      all(len(c["evidence"]) == 1 for c in broken_ctl), [(c["name"], c.get("evidence"), c.get("broken")) for c in broken_ctl if len(c.get("evidence") or []) != 1])
check("7 no failure image for healthy controls", not idle.get("evidence") and not any(c.get("evidence") for c in rec["controls"] if c["phase"] == "sweep" and not c.get("broken")))
check("7 failure images exist on disk", all(os.path.exists(os.path.join(audit, s["path"])) for s in fails) and fails, fails)

# opt-in: without --two-account nothing is replayed
check("3 two-account is opt-in", "two_account" not in rec2)
srv.shutdown()
print("counts:", json.dumps({k: sum(1 for f in pf if f["class"] == k) for k in classes}))
print("\n%d failure(s)  (tmp: %s)" % (len(FAILS), tmp))
sys.exit(1 if FAILS else 0)
