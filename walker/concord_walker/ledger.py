"""WALK-01 (GB-1544): the results ledger. Walker verdicts land ONLY in
records/walker.jsonl, in the union schema shared with the seat record files:
{id, status, ts, live_sha, walker_run_id, recipe, result, evidence_path, account}.

fix_tickets.jsonl is never written by a verdict (newly filed walker tickets are
the one exception, and they keep the existing append_tickets path). A write is a
single line, appended under the store's file lock and fsync'd: a crash mid-write
can tear at most the final line, and every reader in the fold skips unparseable
lines, so the ledger never corrupts.
"""
import json, os
from .util import file_lock, ts_et

FIELDS = ["id", "status", "ts", "live_sha", "walker_run_id", "recipe", "result", "evidence_path", "account"]

# The one place the literal status "VERIFIED" is allowed to be WRITTEN (the static
# scan in selftest/test_replay_gate.py fails on any other write site).
VERIFIED = "VERIFIED"

# The bases a walker replay may stand VERIFIED on. "recipe" (the ledger `recipe`
# field) is one of these — never a keyword-classified check, never "unknown".
#   per-ticket / validation / privacy : Dutch's Nov 15 hand-written recipes (coverage.cap_verdict)
#   repro-steps  : the tester's own hand-written repro_steps, every step mapped AND executed
#                  AND the expected outcome machine-checked (repro.py)
#   ci-evidence  : WALK-06 CI lane (code + CI evidence at the deploy sha)
#   human-review : a person's confirm on the review page (results.human_row)
REPLAY_BASES = ("per-ticket", "validation", "privacy", "repro-steps", "ci-evidence", "human-review")


class VerifyGateError(ValueError):
    """A VERIFIED row that does not satisfy the gate. Never swallowed."""


def verifiable_problems(row, expect_sha=None):
    """Reasons `row` may not stand VERIFIED ([] = ok). expect_sha=None skips only the
    expect-sha equality (the fold, which has no live gate, uses that to check SHAPE)."""
    from .sha_gate import is_hex_sha, sha_matches
    bad = []
    if not str(row.get("walker_run_id") or "").strip():
        bad.append("no walker_run_id")
    live = row.get("live_sha")
    if not is_hex_sha(live):
        bad.append("live_sha %r is not a hex git sha" % (live,))
    if expect_sha is not None or row.get("_require_expect"):
        if not is_hex_sha(expect_sha):
            bad.append("no hex expect sha to gate against (got %r)" % (expect_sha,))
        elif is_hex_sha(live) and not sha_matches(expect_sha, live):
            bad.append("live_sha %s != expect sha %s" % (live, expect_sha))
    if row.get("recipe") not in REPLAY_BASES:
        bad.append("basis %r is not an allowed replay basis (%s)" % (row.get("recipe"), ", ".join(REPLAY_BASES)))
    if not str(row.get("evidence_path") or "").strip():
        bad.append("empty evidence_path")
    return bad


def assert_verifiable(row, expect_sha):
    """The single gate every VERIFIED write goes through. Raises VerifyGateError."""
    bad = verifiable_problems(dict(row, _require_expect=True), expect_sha)
    if bad:
        raise VerifyGateError("VERIFIED refused for %s: %s" % (row.get("id"), "; ".join(bad)))
    return True


def make_row(*, tid, status, live_sha, run_id, recipe, result, evidence_path, account, expect_sha=None, extra=None):
    """Build one union-schema row. status VERIFIED is gated here, so every producer of a
    VERIFIED row (reverify, CI lane, human review) shares one check."""
    row = {"id": tid, "status": status, "ts": ts_et(), "live_sha": live_sha,
           "walker_run_id": run_id, "recipe": recipe, "result": result,
           "evidence_path": evidence_path, "account": account}
    for k, v in (extra or {}).items():
        row.setdefault(k, v)
    if status == VERIFIED:
        assert_verifiable(row, expect_sha)
    return row


class WalkerLedger:
    def __init__(self, path, dry=False, expect_sha=None):
        # expect_sha: the sha the run was told to verify. Every VERIFIED row must carry a
        # live_sha equal to it (assert_verifiable); None => VERIFIED rows are refused.
        self.path, self.dry, self.expect_sha = path, dry, expect_sha
        self.written = 0
        self.suppressed = 0  # verdicts a dry run (or a sha-gate dry) did not write

    def write(self, *, tid, status, live_sha, run_id, recipe, result, evidence_path, account, extra=None):
        if self.dry:
            self.suppressed += 1
            return {"id": tid, "status": status, "ts": ts_et(), "live_sha": live_sha, "walker_run_id": run_id,
                    "recipe": recipe, "result": result, "evidence_path": evidence_path, "account": account}
        row = make_row(tid=tid, status=status, live_sha=live_sha, run_id=run_id, recipe=recipe, result=result,
                       evidence_path=evidence_path, account=account, expect_sha=self.expect_sha, extra=extra)
        from .sha_gate import is_hex_sha
        if not is_hex_sha(live_sha):
            raise ValueError("refusing to write a ledger row without a hex git live_sha (got %r)" % (live_sha,))
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        line = json.dumps(row) + "\n"
        with file_lock(self.path):
            with open(self.path, "a") as f:
                f.write(line)
                f.flush()
                os.fsync(f.fileno())
        self.written += 1
        return row

    def write_verdict(self, res, upd, *, live_sha, run_id, account, walker_version=None):
        """One reverify result + its status_update mapping -> one ledger row.
        upd is None for NEEDS_HUMAN and for FIXED-but-not-claimed (those go to the
        judgment queue, exactly as before): no row is written."""
        if not upd:
            return None
        ev = [e for e in (res.get("evidence") or []) if e]
        basis = res.get("recipe_kind") if res.get("coverage_basis") in ("recipe", "repro-steps") else res.get("coverage_basis")
        extra = {"method": res.get("method") or "", "basis": res.get("coverage_basis") or "keyword",
                 "walker_version": walker_version, "replay": True}
        if res.get("steps") is not None:
            extra["steps"] = res["steps"]
        return self.write(tid=res["id"], status=upd["status"], live_sha=live_sha, run_id=run_id,
                          recipe=basis or "keyword", result=res["verdict"],
                          evidence_path="; ".join(ev), account=account, extra=extra)

    def write_attempt(self, res, prior_status, *, live_sha, run_id, account, walker_version=None):
        """A replay that could not decide (NEEDS_HUMAN, or FIXED on a ticket nobody claimed fixed)
        leaves the status alone but is recorded: one row with NO status (the fleet's rule — a row
        without a status never moves a ticket), result = the verdict. It is what lets a human's
        later VERIFIED be backed by a sha-gated walker replay (fold.py)."""
        ev = [e for e in (res.get("evidence") or []) if e]
        basis = res.get("recipe_kind") if res.get("coverage_basis") in ("recipe", "repro-steps") else res.get("coverage_basis")
        return self.write(tid=res["id"], status=None, live_sha=live_sha, run_id=run_id,
                          recipe=basis or "keyword", result=res["verdict"], evidence_path="; ".join(ev), account=account,
                          extra={"method": res.get("method") or "", "basis": res.get("coverage_basis") or "keyword",
                                 "walker_version": walker_version, "replay": True, "reason": res.get("notes"),
                                 **({"steps": res["steps"]} if res.get("steps") is not None else {})})


def read_ledger(path):
    """Tolerant reader: valid rows only; a torn final line is skipped, never fatal."""
    rows = []
    if not os.path.exists(path):
        return rows
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows
