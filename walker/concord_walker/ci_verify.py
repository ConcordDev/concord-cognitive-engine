"""WALK-06 (GB-1544): the CI-evidence lane. Non-lens code tickets (HV- / SB- /
IDLE- / GB- rows and records-only ids with no lens — fold.lane_of's "ci" lane)
cannot be walked in a browser; they verify by evidence at the deploy sha:

  1. the ticket's folded status is FIXED_PENDING_VERIFY (the walker's standing
     rule — only claimed fixes can verify);
  2. CODE evidence: the fix's fixed_commit exists in the repo, is an ancestor
     of the deploy sha, and its diff carries a pin (a test file — the fleet's
     every-fix-carries-a-pin discipline);
  3. CI evidence: a checks payload produced on the run host for exactly the
     expect sha ({sha, runs: [{name, status, conclusion, html_url}]}) where
     every run completed, at least one succeeded, and none failed.

All three -> a VERIFIED row in records/walker.jsonl through WALK-01's
WalkerLedger (recipe "ci-evidence", live_sha = the deploy sha, evidence_path =
the CI run URL + the fix commit). Anything else leaves the row UNMOVED —
reported, never stamped. The wrong sha cannot stamp VERIFIED by construction:
the payload's sha must equal the expect sha, and rows carry that same sha.
This lane is offline: no browser, no session, no network. Its VERIFIED rows still go through the
single gate (ledger.assert_verifiable): hex live_sha == the expect sha, a run id, basis
"ci-evidence", non-empty evidence (CI URL + fix commit). The CI lane never claims the LIVE site
runs the sha (no /health read) — it records the deploy sha its code + CI evidence prove.
"""
import json, os, re, subprocess
from .ledger import VERIFIED

PIN_PATH = re.compile(r"(^|/)(tests?|__tests__)/|\.test\.[jt]sx?$|(^|/)test_[^/]+\.py$|_test\.py$")
FAIL_CONCLUSIONS = ("failure", "timed_out", "cancelled", "action_required", "startup_failure")


class CiError(Exception):
    pass


def load_checks(path):
    if not path:
        raise CiError("--ci-checks <file> is required for --from-ci")
    if not os.path.exists(path):
        raise CiError("CI checks file not found: %s" % path)
    try:
        with open(path) as f:
            data = json.load(f)
    except Exception as e:
        raise CiError("CI checks file %s is not valid JSON: %s" % (path, e))
    if not isinstance(data, dict) or not data.get("sha") or not isinstance(data.get("runs"), list):
        raise CiError("CI checks file %s must carry {sha, runs[...]}" % path)
    return data


def checks_verdict(checks, expect_sha):
    """(state, url): green | red | pending | wrong_sha. Green is strict: the
    payload is for the expect sha, every run completed, >= 1 success, 0 fails."""
    if str(checks.get("sha") or "").strip() != str(expect_sha or "").strip():
        return "wrong_sha", None
    runs = checks.get("runs") or []
    if not runs:
        return "pending", None
    if any(r.get("status") != "completed" for r in runs):
        return "pending", None
    failed = [r for r in runs if r.get("conclusion") in FAIL_CONCLUSIONS]
    if failed:
        return "red", failed[0].get("html_url")
    ok = [r for r in runs if r.get("conclusion") == "success"]
    if ok:
        return "green", ok[0].get("html_url")
    return "pending", None


def _git(repo, *args):
    return subprocess.run(["git", "-C", repo] + list(args), capture_output=True, text=True)


def code_evidence(repo, fixed_commit, deploy_sha):
    """(ok, reason, pin_files): the fix commit is in the deploy sha's history
    and carries a test pin in its own diff."""
    if not fixed_commit:
        return False, "no fixed_commit on the ticket's record", []
    c = _git(repo, "rev-parse", "--verify", "--quiet", str(fixed_commit) + "^{commit}")
    if c.returncode != 0:
        return False, "fixed_commit %s is not in the repo" % fixed_commit, []
    full = c.stdout.strip()
    if _git(repo, "merge-base", "--is-ancestor", full, deploy_sha).returncode != 0:
        return False, "fixed_commit %s is not an ancestor of the deploy sha" % full[:12], []
    d = _git(repo, "diff-tree", "--root", "--no-commit-id", "--name-only", "-r", full)
    files = [ln for ln in d.stdout.splitlines() if ln.strip()]
    pins = [f for f in files if PIN_PATH.search(f)]
    if not pins:
        return False, "fix commit %s carries no pin (no test file in its diff)" % full[:12], []
    return True, "fix %s in the deploy history, pin(s): %s" % (full[:12], ", ".join(pins[:3])), pins


def fixed_commit_of(ticket):
    if not ticket:
        return None
    if ticket.get("fixed_commit"):
        return ticket["fixed_commit"]
    for u in reversed(ticket.get("_updates") or []):
        if u.get("type") == "record" and u.get("fixed_commit"):
            return u["fixed_commit"]
    return None


def verify_ticket(store, repo, tid, deploy_sha, checks_state):
    """One id -> a result dict. verdict VERIFIED only when lane, prior status,
    CI and code evidence all hold; LENS_LANE for lens tickets (never opened,
    never stamped); UNMOVED with a reason otherwise."""
    res = {"id": tid, "method": "ci-evidence", "verdict": "UNMOVED", "reason": None, "evidence": []}
    t = store.get(tid)
    if t is None:
        res["reason"] = "unknown ticket id"
        return res
    if store.lane(tid) != "ci":
        res["verdict"] = "LENS_LANE"
        res["reason"] = "lens ticket — the CI lane never opens or stamps it"
        return res
    prior = store.status(tid)
    res["prior_status"] = prior
    if prior != "FIXED_PENDING_VERIFY":
        res["reason"] = "prior status %s — only FIXED_PENDING_VERIFY verifies" % prior
        return res
    state, url = checks_state
    if state != "green":
        res["reason"] = "CI %s at the expect sha" % state
        return res
    ok, why, _pins = code_evidence(repo, fixed_commit_of(t), deploy_sha)
    if not ok:
        res["reason"] = why
        return res
    res["verdict"] = "VERIFIED"
    res["reason"] = why
    res["evidence"] = [e for e in (url, "commit %s" % fixed_commit_of(t)) if e]
    return res


def run_ci_lane(*, store, repo, deploy_sha, expect_sha, checks, ids, ledger=None, run_id_str="", account="ci-lane"):
    """Verify ids in order; VERIFIED results write through the ledger (which
    itself honours dry runs). Returns the result dicts."""
    state = checks_verdict(checks, expect_sha)
    if ledger is not None and getattr(ledger, "expect_sha", None) is None:
        ledger.expect_sha = expect_sha  # the CI payload was matched to exactly this sha above
    results = []
    for tid in ids:
        res = verify_ticket(store, repo, tid, deploy_sha, state)
        if res["verdict"] == "VERIFIED" and ledger is not None:
            ledger.write(tid=tid, status=VERIFIED, live_sha=deploy_sha, run_id=run_id_str,
                         recipe="ci-evidence", result="VERIFIED",
                         evidence_path="; ".join(res["evidence"]), account=account)
        results.append(res)
    return results
