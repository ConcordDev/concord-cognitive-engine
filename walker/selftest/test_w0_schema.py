#!/usr/bin/env python3
"""MST-W0-01 + walker-issue unit tests (no browser): build stamp states, fix-commit
containment (merge-base, 'unknown' on any doubt), manifest, findings v2, v1 loading,
auth/me retry/backoff, sweep safety, crash classification.
Run: python3 selftest/test_w0_schema.py"""
import json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from concord_walker import lensrecord as LR
from concord_walker import auth as A
from concord_walker import safety as S

FAILS = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (" " + str(extra)[:400] if extra and not cond else ""))
    if not cond:
        FAILS.append(name)


SHA = "495efb7ce243602c55971dec568f6a4b88f71047"


def fetch_ok(url):
    if url.endswith("/health"):
        return json.dumps({"ok": True, "buildSha": SHA})
    return '<script>{"buildId":"bld-77"}</script>'


def fetch_nosha(url):
    if url.endswith("/health"):
        return json.dumps({"ok": True, "buildSha": "main"})
    raise OSError("down")


def test_deploy_stamp():
    d = LR.deploy_stamp("https://x", fetch=fetch_ok)
    check("ok stamp: backend sha + frontend build + walked_at", d["backend_sha"] == SHA and d["frontend_build_id"] == "bld-77"
          and d["sha_status"] == "ok" and d["walked_at"] and d["checked_at"])
    d = LR.deploy_stamp("https://x", fetch=fetch_nosha)
    check("non-hex /health sha -> missing (flagged)", d["backend_sha"] is None and d["sha_status"] == "missing" and d["sha_note"])
    d = LR.deploy_stamp("https://x", fetch=fetch_ok, expect_sha="5ac8728f5")
    check("expect mismatch -> mismatch", d["sha_status"] == "mismatch")
    d = LR.deploy_stamp("https://x", fetch=fetch_ok, previous={"backend_sha": "5ac8728f5aaaa"})
    check("live sha changed mid-run -> drift", d["sha_status"] == "drift")
    check("row_stamp is 12 chars + walked_at", LR.row_stamp({"backend_sha": SHA, "walked_at": "t"}) == {"build_sha": SHA[:12], "walked_at": "t"})
    check("row_stamp of an unstamped deploy keeps None (never a guess)", LR.row_stamp({}) == {"build_sha": None, "walked_at": None})
    ws, dirty = LR.walker_sha(HERE)
    check("walker sha from git", ws is None or len(ws) == 40)
    check("walker sha outside git -> None", LR.walker_sha(tempfile.mkdtemp()) == (None, None))


def _repo():
    r = tempfile.mkdtemp()
    run = lambda *a: subprocess.run(["git", "-C", r] + list(a), capture_output=True, text=True, check=True).stdout.strip()
    run("init", "-q")
    for i in range(3):
        open(os.path.join(r, "f"), "w").write(str(i))
        run("add", "f")
        run("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c%d" % i)
    shas = run("log", "--format=%H").split()
    run("checkout", "-q", "-b", "side", shas[2])
    open(os.path.join(r, "g"), "w").write("x")
    run("add", "g")
    run("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "side")
    side = run("rev-parse", "HEAD")
    return r, shas[0], shas[2], side


def test_contains_commit():
    r, head, first, side = _repo()
    check("fix ancestor of build -> True", LR.contains_commit(r, head, first) is True)
    check("fix on another branch -> False", LR.contains_commit(r, head, side) is False)
    check("no repo -> unknown", LR.contains_commit(None, head, first) == "unknown")
    check("non-hex -> unknown", LR.contains_commit(r, "main", first) == "unknown")
    check("object git does not have -> unknown", LR.contains_commit(r, head, "f" * 40) == "unknown")
    check("git error -> unknown", LR.contains_commit(r, head, first, runner=lambda *a, **k: (_ for _ in ()).throw(OSError("x"))) == "unknown")
    v = LR.build_verdict(r, {"backend_sha": head, "sha_status": "ok"}, first)
    check("verdict line: CONTAINS", "CONTAINS fix commit" in v and head[:12] in v, v)
    v = LR.build_verdict(r, {"backend_sha": head, "sha_status": "ok"}, side)
    check("verdict line: does NOT contain", "does NOT contain" in v, v)
    v = LR.build_verdict(None, {"backend_sha": head}, first)
    check("verdict line: UNKNOWN without repo", "UNKNOWN" in v, v)
    v = LR.build_verdict(r, {"backend_sha": None}, first)
    check("unstamped build never treated as current", "UNKNOWN build" in v, v)
    v = LR.build_verdict(r, {"backend_sha": head, "sha_status": "drift", "sha_note": "x"}, None)
    check("flag carried in the verdict", "[build stamp drift" in v, v)


def test_manifest_and_findings():
    d = tempfile.mkdtemp()
    m = LR.Manifest(d, "r1", 3)
    m.lens("a", "walked", deploy={"backend_sha": SHA, "walked_at": "t", "sha_status": "ok"}, checks_not_run=["export"])
    m.lens("b", "aborted", reason="auth/me 503")
    m2 = LR.Manifest(d, "r1", 3)
    check("manifest survives a restart (resume)", m2.walked_slugs() == {"a"} and m2.data.get("resumes") == 1)
    check("manifest rows carry stamp + not-run checks", m2.data["lenses"][0]["build_sha"] == SHA[:12] and m2.data["lenses"][0]["checks_not_run"] == ["export"])
    m2.lens("b", "walked")
    check("a re-walked lens replaces its row", [l["status"] for l in m2.data["lenses"] if l["slug"] == "b"] == ["walked"] and m2.counts() == (2, 3))
    check("other run id starts fresh", LR.Manifest(d, "r2", 1).data["lenses"] == [])
    f = {"lens": "chem", "check": "escape", "severity": "low", "title": "Escape doesn't close the 'Expand Chat sub-lenses' menu/panel",
         "suspected_area": "chem/overlay keyboard", "evidence": ["e.png"]}
    out = LR.findings_v2([(f, "FIX-chem-001", "new")], ["chem"], {"backend_sha": SHA, "walked_at": "t"})
    check("finding v2: id, signature from root_causes, stamp", out[0]["id"] == "FIX-chem-001" and out[0]["signature"] == "escape.sub_lens_expand_menu"
          and out[0]["build_sha"] == SHA[:12] and out[0]["evidence"] == ["e.png"])
    p = os.path.join(d, "lens-x.json")
    open(p, "w").write("[1,2]")
    try:
        LR.load_lens_record(p)
        check("non-object record refused", False)
    except ValueError:
        check("non-object record refused", True)
    check("shot kinds", [LR.shot_kind(n) for n in ("desktop-initial", "open-x", "after-escape-x", "m390-full", "fail-x", "tab-x")]
          == ["initial", "open", "after_escape", "m390", "failure", "mid_task"])


class FakeCtx:
    def __init__(self, seq):
        self.seq = list(seq)
        self.request = self

    def get(self, url, timeout=None):
        st = self.seq.pop(0)
        if st is None:
            raise OSError("no response")
        me = self

        class R:
            status = st

            def json(self_inner):
                return {"ok": st == 200, "user": {"username": "concord-zukoqa", "role": "member"}}
        return R()


def test_auth_retry():
    cfg = {"base_url": "https://x", "thresholds": {"auth_retry_backoff_s": [1, 2, 3]},
           "accounts": {"t1": {"username": "concord-zukoqa", "expected_roles": ["member"]}}}
    slept = []
    me = A.whoami_with_retry(FakeCtx([None, 503, 200]), cfg, sleep=slept.append)
    check("transient None/503 retried with backoff, then OK", me["ok"] and slept == [1, 2])
    slept = []
    me = A.whoami_with_retry(FakeCtx([401, 200]), cfg, sleep=slept.append)
    check("401 is a real answer: no retry", not me["ok"] and slept == [])
    slept = []
    me = A.whoami_with_retry(FakeCtx([None, None, None, None]), cfg, sleep=slept.append)
    check("gives up after the backoff list", not me["ok"] and slept == [1, 2, 3])
    try:
        A.assert_account(FakeCtx([502, 502, 502, 502]), dict(cfg, thresholds={"auth_retry_backoff_s": [0, 0, 0]}), "t1", "x")
        check("persistent 502 still aborts", False)
    except A.AccountMismatch:
        check("persistent 502 still aborts", True)


def test_sweep_safety_and_crash():
    ok = [("Run calc", False), ("Balance a reaction", False), ("Elements", False), ("Expand Chat sub-lenses", False), ("Search", False)]
    bad = [("Delete all", "destructive"), ("Reset", "destructive"), ("Publish or share this content", "unsafe"), ("Pay now", "unsafe"),
           ("Sign out", "unsafe"), ("Switch theme. Currently Dark", "unsafe"), ("Notifications (30 unread)", "unsafe"), ("Approve", "unsafe"),
           ("Run all jobs", "unsafe"), ("Create item", "unsafe"), ("Withdraw", "unsafe"), ("Mint", "unsafe"), ("", "unsafe")]
    check("sweep-safe names clickable", all(S.sweep_decision(n)[0] for n, _ in ok), [n for n, _ in ok if not S.sweep_decision(n)[0]])
    check("unsafe names refused with the right reason", all(S.sweep_decision(n) == (False, r) for n, r in bad),
          [(n, S.sweep_decision(n)) for n, r in bad if S.sweep_decision(n) != (False, r)])
    check("admin lens clicks nothing new", S.sweep_decision("Elements", admin=True) == (False, "admin_only"))
    check("write-skip lens refuses compute verbs", S.sweep_decision("Run calc", read_only=True) == (False, "write_skip_lens")
          and S.sweep_decision("Elements", read_only=True)[0])
    sys.path.insert(0, HERE)
    import importlib
    W = importlib.import_module("walker")

    class Error(Exception):
        pass
    check("browser crash recognised", W._is_browser_crash(Error("Target page, context or browser has been closed")))
    check("ordinary error is not a crash", not W._is_browser_crash(ValueError("Target closed")) and not W._is_browser_crash(Error("timeout")))


if __name__ == "__main__":
    for fn in [v for k, v in sorted(globals().items()) if k.startswith("test_")]:
        fn()
    print("\n%d failure(s)" % len(FAILS))
    sys.exit(1 if FAILS else 0)
