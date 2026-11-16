#!/usr/bin/env python3
"""walker.py cmd_walk wiring for the per-lens replay, with playwright + LensWalk faked out
(this Mac has no playwright; the box runs the real fixture-app selftests). Real: argument
handling, the git fold, the sha gate call, TicketStore-over-fold, Reverifier, ReplayRun, the
ledger + gate, the lens record's `replay` block and the coverage files.
Run: python3 selftest/test_replay_sweep_wiring.py"""
import argparse, json, os, subprocess, sys, tempfile, types, functools

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)

# fake `playwright.sync_api` BEFORE walker.py's cmd_walk imports it
class _Browser:
    def close(self): pass
class _PW:
    class chromium:
        @staticmethod
        def launch(*a, **k): return _Browser()
class _CM:
    def __enter__(self): return _PW()
    def __exit__(self, *a): return False
_pw = types.ModuleType("playwright"); _sa = types.ModuleType("playwright.sync_api"); _sa.sync_playwright = lambda: _CM()
sys.modules.setdefault("playwright", _pw); sys.modules["playwright.sync_api"] = _sa

import walker as W
from concord_walker import lensrecord, sha_gate
from concord_walker.util import load_config, Log
from concord_walker.reverify import Reverifier
from concord_walker.ledger import read_ledger

FAILS = []
SHA = "a" * 40


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (" " + str(extra)[:400] if extra and not cond else ""))
    if not cond:
        FAILS.append(name)


class _Net:
    def build(self): return ([], [], [], {})

class FakeLensWalk:
    instances = []
    def __init__(self, browser, cfg, rec, lens, acct, log, **kw):
        self.slug, self.allow_write, self.findings, self.screens, self.net, self.premap_findings = lens["slug"], False, [], [], _Net(), []
        self.kw = kw
        FakeLensWalk.instances.append(self)
    def run(self):
        self.result = {"slug": self.slug, "url": "u", "account": "t1", "admin": False, "started": "s", "finished": "f", "elapsed_s": 1,
                       "checks": {}, "initial_evidence": "ev/initial.png"}
        return self.result


def git(repo, *a):
    subprocess.run(["git", "-C", repo] + list(a), check=True, capture_output=True,
                   env=dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t"))


def make_repo(tmp):
    repo = os.path.join(tmp, "repo")
    os.makedirs(os.path.join(repo, "audit/fix-list/records"))
    rows = [{"id": "FIX-demo-001", "lens": "demo", "status": "FIXED_PENDING_VERIFY", "title": "Row selection never updates",
             "repro_steps": ["Open the demo lens", "Click 'Row'"], "expected": "Row is selected", "actual": "x"},
            {"id": "FIX-demo-002", "lens": "demo", "status": "OPEN", "title": "Row selection never updates",
             "repro_steps": ["Attempt to select a row"], "expected": "Row is selected", "actual": "x"},
            {"id": "FIX-zzz-001", "lens": "notwalked", "status": "OPEN", "title": "x", "repro_steps": ["x"]}]
    open(os.path.join(repo, "audit/fix-list/fix_tickets.jsonl"), "w").write("\n".join(json.dumps(r) for r in rows) + "\n")
    open(os.path.join(repo, "audit/fix-list/records/b2.jsonl"), "w").write(json.dumps({"id": "HV-77", "status": "FIXED_PENDING_VERIFY"}) + "\n")
    git(repo, "init", "-q"); git(repo, "add", "-A"); git(repo, "commit", "-q", "-m", "fold")
    return repo, subprocess.run(["git", "-C", repo, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()


def ns(**kw):
    d = dict(allow_write=False, admin=False, dry_run=False, no_auth=False, phases=None, base_url=None, premap=False, premap_budget_s=None,
             expect_sha=None, two_account=False, resume=None, auto_resume=2, only=None, category=None, start_from=None, limit=None,
             from_repo=None, deploy_sha=None, no_replay=False)
    d.update(kw)
    return argparse.Namespace(**d)


def run_walk(args, tmp, health_ok=True):
    cfg = load_config(None)
    cfg["runs_dir"], cfg["queue_dir"], cfg["audit_dir"], cfg["records_dir"] = [os.path.join(tmp, x) for x in ("runs", "queue", "audit", "records")]
    os.makedirs(cfg["audit_dir"], exist_ok=True)
    open(os.path.join(cfg["audit_dir"], "fix_tickets.jsonl"), "w").close()
    cfg["base_url"] = "http://127.0.0.1:9"
    inv = [{"slug": "demo", "url": "http://127.0.0.1:9/lenses/demo", "category": "x"}]
    json.dump(inv, open(os.path.join(cfg["audit_dir"], "inventory.json"), "w"))
    W.LensWalk, W.has_session, W.wait_for_memory = FakeLensWalk, (lambda *a: True), (lambda *a: True)
    fetch = lambda u: json.dumps({"buildSha": SHA}) if u.endswith("/health") and health_ok else json.dumps({}) if u.endswith("/health") else ""
    lensrecord.deploy_stamp = functools.partial(lensrecord.deploy_stamp, fetch=fetch)
    real_gate = sha_gate.gate
    sha_gate.gate = lambda e, b, fetch=fetch: real_gate(e, b, fetch=fetch)
    FakeLensWalk.instances.clear()
    try:
        W.cmd_walk(args, cfg, Log(quiet=True))
    finally:
        sha_gate.gate = real_gate
    runs = os.path.join(cfg["runs_dir"])
    run_dir = os.path.join(runs, sorted(os.listdir(runs))[-1])
    return cfg, run_dir


def fake_repro(self, t):
    steps = [{"n": 1, "raw": "Open the demo lens", "action": "open", "mapped": True, "executed": True, "result": "opened"}]
    if t["id"] == "FIX-demo-001":
        return {"verdict": "FIXED", "steps": steps, "evidence": ["ev/final.png"], "notes": "ok", "expected": {"state": "pass", "clauses": []}}
    return {"verdict": "NEEDS_HUMAN", "steps": steps, "evidence": [], "notes": "step 1 not mapped: 'Attempt to select a row'"}


def main():
    Reverifier._run_repro_live = fake_repro
    tmp = tempfile.mkdtemp()
    repo, sha = make_repo(tmp)
    # 1. a live sweep without --from-repo is refused
    try:
        run_walk(ns(only="demo"), tempfile.mkdtemp())
        check("live sweep without --from-repo/--deploy-sha is refused", False)
    except SystemExit as e:
        check("live sweep without --from-repo/--deploy-sha is refused", "--from-repo" in str(e) and "--no-replay" in str(e), e)
    # 2. gated sweep: replay on, sha gate passes
    cfg, rd = run_walk(ns(only="demo", from_repo=repo, deploy_sha=sha, expect_sha=SHA), tmp)
    rec = json.load(open(os.path.join(rd, "lens-demo.json")))
    blk = rec.get("replay") or {}
    check("lens record has a replay block with counts + ids", blk.get("counts") == {"FIXED": 1, "NEEDS_HUMAN": 1} and blk["ids"]["FIXED"] == ["FIX-demo-001"], blk)
    check("replay reused the sweep's walk: exactly one LensWalk for the lens", len(FakeLensWalk.instances) == 1 and blk.get("second_walks") == 0)
    rows = read_ledger(os.path.join(cfg["records_dir"], "walker.jsonl"))
    check("the sha-gated sweep wrote one VERIFIED row (basis repro-steps) + one status-less attempt row",
          [(r["id"], r["status"], r["recipe"]) for r in rows] == [("FIX-demo-001", "VERIFIED", "repro-steps"), ("FIX-demo-002", None, "repro-steps")]
          or sorted((r["id"], r["status"]) for r in rows) == [("FIX-demo-001", "VERIFIED"), ("FIX-demo-002", None)], rows)
    covj = json.load(open(os.path.join(rd, "reverify_coverage.json")))
    cr = {r["id"]: r for r in covj["rows"]}
    check("coverage: every in-scope ticket in the fold has exactly one row with a reason (incl. records-only CI id + unwalked lens)",
          sorted(cr) == ["FIX-demo-001", "FIX-demo-002", "FIX-zzz-001", "HV-77"] and all(r["reason"].strip() for r in covj["rows"]), sorted(cr))
    check("coverage: unwalked lens + CI lane reasons", cr["HV-77"]["reason"].startswith("routed to the CI lane") and cr["FIX-zzz-001"]["reason"].startswith("lens not in inventory"), cr)
    check("fold snapshot kept in the run dir", os.path.exists(os.path.join(rd, "canonical.jsonl")))
    # 3. sha gate fails (health reports no sha): replay runs, 0 rows written
    tmp2 = tempfile.mkdtemp()
    cfg2, rd2 = run_walk(ns(only="demo", from_repo=repo, deploy_sha=sha, expect_sha=SHA), tmp2, health_ok=False)
    rec2 = json.load(open(os.path.join(rd2, "lens-demo.json")))
    check("sha mismatch: replay still computed verdicts but wrote 0 ledger rows",
          rec2["replay"]["dry"] is True and rec2["replay"]["counts"].get("FIXED") == 1 and read_ledger(os.path.join(cfg2["records_dir"], "walker.jsonl")) == [])
    # 4. no --expect-sha: also dry
    tmp3 = tempfile.mkdtemp()
    cfg3, rd3 = run_walk(ns(only="demo", from_repo=repo, deploy_sha=sha), tmp3)
    check("no --expect-sha: dry, 0 rows", read_ledger(os.path.join(cfg3["records_dir"], "walker.jsonl")) == [])
    # 5. --no-replay: no verdicts, every ticket a 'replay disabled' row
    tmp4 = tempfile.mkdtemp()
    cfg4, rd4 = run_walk(ns(only="demo", no_replay=True), tmp4)
    c4 = json.load(open(os.path.join(rd4, "reverify_coverage.json")))
    r4 = json.load(open(os.path.join(rd4, "lens-demo.json")))
    check("--no-replay: sweep runs, nothing replayed, no ledger, no fold snapshot",
          read_ledger(os.path.join(cfg4["records_dir"], "walker.jsonl")) == [] and r4["replay"]["counts"] == {}
          and not os.path.exists(os.path.join(rd4, "canonical.jsonl")), r4.get("replay"))
    check("--no-replay still writes a coverage file (every ticket the legacy store can see would read 'replay disabled')",
          c4["meta"]["no_replay"] is True and all(r["reason"] == "replay disabled for this run (--no-replay)" for r in c4["rows"]), c4["meta"])
    print("\n%d failure(s)" % len(FAILS))
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
