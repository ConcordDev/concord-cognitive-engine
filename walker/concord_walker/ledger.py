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


class WalkerLedger:
    def __init__(self, path, dry=False):
        self.path, self.dry = path, dry
        self.written = 0
        self.suppressed = 0  # verdicts a dry run (or a sha-gate dry) did not write

    def write(self, *, tid, status, live_sha, run_id, recipe, result, evidence_path, account):
        row = {"id": tid, "status": status, "ts": ts_et(), "live_sha": live_sha,
               "walker_run_id": run_id, "recipe": recipe, "result": result,
               "evidence_path": evidence_path, "account": account}
        if self.dry:
            self.suppressed += 1
            return row
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        line = json.dumps(row) + "\n"
        with file_lock(self.path):
            with open(self.path, "a") as f:
                f.write(line)
                f.flush()
                os.fsync(f.fileno())
        self.written += 1
        return row

    def write_verdict(self, res, upd, *, live_sha, run_id, account):
        """One reverify result + its status_update mapping -> one ledger row.
        upd is None for NEEDS_HUMAN and for FIXED-but-not-claimed (those go to the
        judgment queue, exactly as before): no row is written."""
        if not upd:
            return None
        ev = [e for e in (res.get("evidence") or []) if e]
        return self.write(tid=res["id"], status=upd["status"], live_sha=live_sha, run_id=run_id,
                          recipe=res.get("method") or "", result=res["verdict"],
                          evidence_path="; ".join(ev), account=account)


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
