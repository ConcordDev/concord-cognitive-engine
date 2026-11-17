#!/usr/bin/env python3
"""WALK-06 selftests (GB-1544): the CI-evidence lane, offline.

Fixture git repo + fixture fold + fixture CI payloads. Legs: the checks
verdict matrix · code evidence (ancestor + pin, pin-less, non-ancestor,
missing) · the fold stub carrying fixed_commit (the WALK-06 line in fold.py) ·
the lane end-to-end through a real ledger (a mixed lens/CI batch: the lens
ticket is never stamped) · red / pending / wrong-sha CI leave every row
unmoved · a missing or malformed checks file errors clearly · dry runs write
nothing · the CLI --from-ci path end-to-end.

Run: python3 selftest/test_walk06.py [tree_root]
On the WALK-01-only tree this suite fails at import (ci_verify does not exist).
"""
import json, os, shutil, subprocess, sys, tempfile

ROOT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
PRISTINE_MODULES = os.path.expanduser("~/workspace/b6-walker/pristine/concord_walker")

from concord_walker.fold import fold_from_texts  # noqa: E402
from concord_walker.tickets import TicketStore  # noqa: E402
from concord_walker.ledger import WalkerLedger, read_ledger  # noqa: E402
from concord_walker import ci_verify  # noqa: E402

PASS = []


def check(name, cond, detail=""):
    PASS.append((name, bool(cond)))
    print("%s %s %s" % ("PASS" if cond else "FAIL", name, detail if not cond else ""))


def git(repo, *args, **kw):
    r = subprocess.run(["git", "-C", repo, "-c", "user.email=t@t", "-c", "user.name=t"] + list(args),
                       capture_output=True, text=True)
    if kw.get("check", True) and r.returncode != 0:
        raise RuntimeError("git %s: %s" % (args, r.stderr))
    return r


def commit_file(repo, path, text, msg):
    full = os.path.join(repo, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w") as f:
        f.write(text)
    git(repo, "add", path)
    git(repo, "commit", "-qm", msg)
    return git(repo, "rev-parse", "HEAD").stdout.strip()


def build_repo(tmp):
    repo = os.path.join(tmp, "repo")
    os.makedirs(repo)
    git(repo, "init", "-q")
    base = commit_file(repo, "README.md", "base\n", "base")
    sha_a = commit_file(repo, "server/tests/fix-a.test.js", "// pin\n", "fix A (with pin)")
    commit_file(repo, "server/lib/a.js", "// fix A code\n", "fix A code")  # same fix, code leg
    # NOTE: the pin and the code ride separate commits here only to keep the
    # fixture small; code_evidence reads the records' fixed_commit (sha_a).
    sha_b = commit_file(repo, "server/lib/b.js", "// fix B, no pin\n", "fix B (no pin)")
    deploy = commit_file(repo, "README2.md", "deploy\n", "deploy")
    git(repo, "checkout", "-q", "-b", "orphan", base)
    sha_c = commit_file(repo, "server/tests/fix-c.test.js", "// pin\n", "fix C (orphan)")
    git(repo, "checkout", "-q", "master" if git(repo, "branch", "--list", "master").stdout.strip() else "main")
    return repo, sha_a, sha_b, sha_c, deploy


def main():
    tmp = tempfile.mkdtemp(prefix="walk06-")
    try:
        repo, sha_a, sha_b, sha_c, deploy = build_repo(tmp)

        main_text = json.dumps({"id": "FIX-demo-001", "lens": "demo", "status": "OPEN", "title": "demo lens ticket"}) + "\n"
        records = {"b6.jsonl": "\n".join([
            json.dumps({"id": "HV-100", "status": "FIXED_PENDING_VERIFY", "fixed_commit": sha_a, "fixed_by": "B6"}),
            json.dumps({"id": "SB-200", "status": "FIXED_PENDING_VERIFY", "fixed_commit": sha_b, "fixed_by": "B2"}),
            json.dumps({"id": "GB-300", "status": "FIXED_PENDING_VERIFY", "fixed_commit": sha_c, "fixed_by": "B9"}),
            json.dumps({"id": "IDLE-400", "status": "OPEN", "fixed_by": "B3"}),
            json.dumps({"id": "FIX-demo-001", "status": "FIXED_PENDING_VERIFY", "fixed_commit": sha_a, "fixed_by": "B6"}),
        ]) + "\n"}
        fold = fold_from_texts(main_text, records, sha=deploy)
        audit = os.path.join(tmp, "audit")
        os.makedirs(audit)
        store = TicketStore(audit, fold=fold)

        # the fold stub carries the records-only row's fixed_commit (WALK-06 line)
        check("fold stub keeps fixed_commit", fold.base["HV-100"].get("fixed_commit") == sha_a)
        check("ci lane set", set(fold.ci_ids()) == {"HV-100", "SB-200", "GB-300", "IDLE-400"}, str(fold.ci_ids()))

        green = {"sha": deploy, "runs": [{"name": "ci", "status": "completed", "conclusion": "success", "html_url": "https://ci.example/run/1"}]}
        red = {"sha": deploy, "runs": [{"name": "ci", "status": "completed", "conclusion": "failure", "html_url": "https://ci.example/run/2"}]}
        pend = {"sha": deploy, "runs": [{"name": "ci", "status": "in_progress", "conclusion": None}]}
        check("checks green", ci_verify.checks_verdict(green, deploy) == ("green", "https://ci.example/run/1"))
        check("checks red", ci_verify.checks_verdict(red, deploy)[0] == "red")
        check("checks pending", ci_verify.checks_verdict(pend, deploy)[0] == "pending")
        check("checks wrong sha", ci_verify.checks_verdict(green, "0" * 40)[0] == "wrong_sha")
        check("checks no runs pending", ci_verify.checks_verdict({"sha": deploy, "runs": []}, deploy)[0] == "pending")

        ok, why, pins = ci_verify.code_evidence(repo, sha_a, deploy)
        check("code evidence: ancestor + pin", ok and pins == ["server/tests/fix-a.test.js"], why)
        check("code evidence: pin-less unmoved", ci_verify.code_evidence(repo, sha_b, deploy)[0] is False)
        check("code evidence: non-ancestor unmoved", ci_verify.code_evidence(repo, sha_c, deploy)[0] is False)
        check("code evidence: missing commit unmoved", ci_verify.code_evidence(repo, "f" * 40, deploy)[0] is False)
        check("code evidence: no commit unmoved", ci_verify.code_evidence(repo, None, deploy)[0] is False)

        # end-to-end through a real ledger, mixed batch
        led_path = os.path.join(tmp, "records", "walker.jsonl")
        ledger = WalkerLedger(led_path)
        batch = ["HV-100", "SB-200", "GB-300", "IDLE-400", "FIX-demo-001"]
        results = ci_verify.run_ci_lane(store=store, repo=repo, deploy_sha=deploy, expect_sha=deploy,
                                        checks=green, ids=batch, ledger=ledger, run_id_str="test-run")
        by_id = {r["id"]: r for r in results}
        check("green: HV-100 VERIFIED", by_id["HV-100"]["verdict"] == "VERIFIED", str(by_id["HV-100"]))
        check("green: pin-less unmoved", by_id["SB-200"]["verdict"] == "UNMOVED")
        check("green: non-ancestor unmoved", by_id["GB-300"]["verdict"] == "UNMOVED")
        check("green: non-FPV unmoved", by_id["IDLE-400"]["verdict"] == "UNMOVED")
        check("green: lens ticket routed, never stamped", by_id["FIX-demo-001"]["verdict"] == "LENS_LANE")
        rows = read_ledger(led_path)
        check("ledger: exactly one row", len(rows) == 1, str(rows))
        if rows:
            r0 = rows[0]
            check("ledger row shape", r0["id"] == "HV-100" and r0["status"] == "VERIFIED"
                  and r0["live_sha"] == deploy and r0["recipe"] == "ci-evidence"
                  and "ci.example/run/1" in r0["evidence_path"] and sha_a in r0["evidence_path"]
                  and r0["account"] == "ci-lane" and r0["walker_run_id"] == "test-run", str(r0))

        for name, payload in (("red", red), ("pending", pend), ("wrong-sha", {"sha": "0" * 40, "runs": green["runs"]})):
            led2 = WalkerLedger(os.path.join(tmp, "records-%s" % name, "walker.jsonl"))
            res2 = ci_verify.run_ci_lane(store=store, repo=repo, deploy_sha=deploy, expect_sha=deploy,
                                         checks=payload, ids=batch, ledger=led2, run_id_str="t")
            check("%s CI: nothing verifies, nothing written" % name,
                  all(r["verdict"] != "VERIFIED" for r in res2) and led2.written == 0)

        # dry ledger: a green run suppresses
        led3 = WalkerLedger(os.path.join(tmp, "records-dry", "walker.jsonl"), dry=True)
        ci_verify.run_ci_lane(store=store, repo=repo, deploy_sha=deploy, expect_sha=deploy,
                              checks=green, ids=["HV-100"], ledger=led3, run_id_str="t")
        check("dry run suppresses the row", led3.suppressed == 1 and not os.path.exists(led3.path))

        # checks loading errors are clear
        for name, path, blob in (("missing file", os.path.join(tmp, "nope.json"), None),
                                 ("malformed", os.path.join(tmp, "bad.json"), "{nope"),
                                 ("no runs key", os.path.join(tmp, "noruns.json"), json.dumps({"sha": deploy}))):
            if blob is not None:
                with open(path, "w") as f:
                    f.write(blob)
            try:
                ci_verify.load_checks(path)
                check("load_checks %s errors" % name, False)
            except ci_verify.CiError:
                check("load_checks %s errors" % name, True)

        cli_leg(tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    failed = [n for n, ok in PASS if not ok]
    print("\n%d/%d passed" % (len(PASS) - len(failed), len(PASS)))
    if failed:
        print("FAILED:", failed)
        return 1
    return 0


def cli_leg(tmp):
    """Assemble a complete walker tree (this delta + the pristine copies of the
    modules B2's seed omits — imported only) and drive --from-ci end-to-end."""
    tree = os.path.join(tmp, "wcli")
    shutil.copytree(ROOT, tree, ignore=shutil.ignore_patterns("__pycache__"))
    pkg = os.path.join(tree, "concord_walker")
    for mod in ("auth.py", "checks.py", "cdp.py", "colors.py"):
        src = os.path.join(PRISTINE_MODULES, mod)
        if os.path.exists(src) and not os.path.exists(os.path.join(pkg, mod)):
            shutil.copy2(src, os.path.join(pkg, mod))

    repo = os.path.join(tmp, "clirepo")
    os.makedirs(repo)
    git(repo, "init", "-q")
    commit_file(repo, "audit/fix-list/fix_tickets.jsonl", "", "audit base")
    fix = commit_file(repo, "server/tests/cli-pin.test.js", "// pin\n", "the fix + pin")
    rec = json.dumps({"id": "HV-900", "status": "FIXED_PENDING_VERIFY", "fixed_commit": fix, "fixed_by": "B6"}) + "\n"
    deploy = commit_file(repo, "audit/fix-list/records/b6.jsonl", rec, "records")

    audit = os.path.join(tmp, "cliaudit")
    os.makedirs(audit)
    records_dir = os.path.join(tmp, "clirecords")
    cfg = {"base_url": "http://127.0.0.1:9", "audit_dir": audit,
           "runs_dir": os.path.join(tmp, "cliruns"), "records_dir": records_dir,
           "accounts": {}, "thresholds": {}}
    cfg_path = os.path.join(tree, "config.json")
    with open(cfg_path, "w") as f:
        json.dump(cfg, f)
    checks_path = os.path.join(tmp, "checks.json")
    with open(checks_path, "w") as f:
        json.dump({"sha": deploy, "runs": [{"name": "ci", "status": "completed",
                                            "conclusion": "success", "html_url": "https://ci.example/run/9"}]}, f)

    def run_cli(*extra):
        return subprocess.run([sys.executable, os.path.join(tree, "walker.py"), "--config", cfg_path,
                               "reverify", "--from-ci", "--from-repo", repo, "--deploy-sha", deploy,
                               "--expect-sha", deploy, "--ci-checks", checks_path] + list(extra),
                              capture_output=True, text=True, cwd=tree)

    r = run_cli()
    check("CLI --from-ci exits clean", r.returncode == 0, r.stderr[-400:] + r.stdout[-400:])
    rows = read_ledger(os.path.join(records_dir, "walker.jsonl"))
    check("CLI wrote the VERIFIED row", len(rows) == 1 and rows[0]["id"] == "HV-900"
          and rows[0]["status"] == "VERIFIED" and rows[0]["live_sha"] == deploy, str(rows))
    r2 = run_cli("--dry-run")
    rows2 = read_ledger(os.path.join(records_dir, "walker.jsonl"))
    check("CLI dry run adds no row", r2.returncode == 0 and len(rows2) == 1, r2.stderr[-200:])


if __name__ == "__main__":
    sys.exit(main())
