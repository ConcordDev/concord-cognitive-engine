"""WALK-05 (GB-1544): run state — the per-run journal, resume, heartbeat,
per-lens time budget, and a run lock that can tell stale from live.

Journal: runs/<id>/journal.jsonl, one line per ticket/lens step
{step, id, state, ts, detail}; state in done|failed|skipped. Appends are
single-line, locked, fsync'd (the ledger's pattern): a kill mid-run loses at
most the step in flight, never a finished line. --resume reads the journal
back: finished = done|skipped (never re-run); failed steps retry.
"""
import json, os, socket, time
from .util import file_lock, ts_et

FINISHED = ("done", "skipped")


def _append_line(path, rec):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    line = json.dumps(rec) + "\n"
    with file_lock(path):
        with open(path, "a") as f:
            f.write(line)
            f.flush()
            os.fsync(f.fileno())


def read_journal(path):
    """Tolerant reader: valid rows only; a torn final line is skipped."""
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


class Journal:
    def __init__(self, run_dir):
        self.path = os.path.join(run_dir, "journal.jsonl")
        self.rows = read_journal(self.path)  # resume: prior state is loaded, never lost

    def record(self, step, ident, state, detail=""):
        rec = {"step": step, "id": ident, "state": state, "ts": ts_et(), "detail": detail}
        _append_line(self.path, rec)
        self.rows.append(rec)
        return rec

    def finished_ids(self):
        """Last state per id wins; an id is finished when its last state is done|skipped."""
        last = {}
        for r in self.rows:
            last[r["id"]] = r["state"]
        return {i for i, s in last.items() if s in FINISHED}

    def remaining(self, ids):
        fin = self.finished_ids()
        return [i for i in ids if i not in fin]


class Heartbeat:
    def __init__(self, run_dir):
        self.path = os.path.join(run_dir, "heartbeat")

    def beat(self, note=""):
        tmp = self.path + ".tmp"
        with open(tmp, "w") as f:
            f.write(json.dumps({"ts": ts_et(), "epoch": time.time(), "pid": os.getpid(), "note": note}))
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, self.path)  # atomic: a reader never sees a torn heartbeat

    def age_s(self):
        try:
            with open(self.path) as f:
                return time.time() - float(json.load(f)["epoch"])
        except Exception:
            return None


class LensBudget:
    """Per-lens wall-clock budget: check(lens) is False once the lens is over."""

    def __init__(self, budget_s):
        self.budget_s = budget_s
        self.started = {}
        self.spent_map = {}

    def start(self, lens):
        self.started.setdefault(lens, time.monotonic())

    def elapsed(self, lens):
        t0 = self.started.get(lens)
        return None if t0 is None else time.monotonic() - t0

    def over(self, lens):
        e = self.elapsed(lens)
        return e is not None and e > self.budget_s

    def note(self, lens, seconds):
        """Accumulate a finished walk's elapsed seconds (the checks.py
        LensWalk hook calls this at walk end, so the per-lens budget is
        cumulative across every walk of the lens in the run)."""
        self.spent_map[lens] = self.spent_map.get(lens, 0.0) + max(0.0, float(seconds))

    def spent(self, lens):
        return self.spent_map.get(lens, 0.0)


class ReplayBudget:
    """Per-lens time budget for the REPLAY of original tickets, separate from the sweep's budget.

    for_lens(n) = min(cap_s, max(override_s, base_s + per_ticket_s * n)): the configured
    replay_budget_s override is a per-lens FLOOR, never a flat total (GB-1581 item 5c — Walk 2's
    flat 180 s override starved 501 tickets in 94 lenses: a lens with many tickets scales by the
    formula past the floor, capped). Replay's clock starts when replay starts (ReplayRun), so a
    sweep that used its whole 240 s never starves replay."""
    DEFAULT_BASE_S, DEFAULT_PER_TICKET_S, DEFAULT_CAP_S = 60, 25, 900

    def __init__(self, base_s=None, per_ticket_s=None, cap_s=None, override_s=None):
        self.base_s = self.DEFAULT_BASE_S if base_s is None else base_s
        self.per_ticket_s = self.DEFAULT_PER_TICKET_S if per_ticket_s is None else per_ticket_s
        self.cap_s = self.DEFAULT_CAP_S if cap_s is None else cap_s
        self.override_s = override_s

    @classmethod
    def from_config(cls, cfg, args=None):
        th = (cfg or {}).get("thresholds", {}) or {}
        pick = lambda a, k: (getattr(args, a, None) if args is not None and getattr(args, a, None) is not None else th.get(k))
        return cls(base_s=pick("replay_budget_base_s", "replay_budget_base_s"),
                   per_ticket_s=pick("replay_budget_per_ticket_s", "replay_budget_per_ticket_s"),
                   cap_s=pick("replay_budget_cap_s", "replay_budget_cap_s"),
                   override_s=pick("replay_budget_s", "replay_budget_s"))

    def for_lens(self, n_tickets):
        scaled = self.base_s + self.per_ticket_s * max(0, n_tickets)
        if self.override_s is not None:
            if self.override_s <= 0:
                # A non-positive override is an exhausted/disabled budget
                # (e.g. --replay-budget-s 0), not a floor to scale up from.
                return min(self.cap_s, self.override_s)
            scaled = max(scaled, self.override_s)
        return min(self.cap_s, scaled)


def _pid_alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except (ProcessLookupError, ValueError):
        return False
    except PermissionError:
        return True  # exists, owned by someone else


class RunLock:
    """One walker at a time. The lock file carries {pid, host, started, epoch}:
    a live holder is respected (named in the refusal); a dead pid or a lock
    older than stale_after_s with no live pid is STALE — taken over, loudly."""

    def __init__(self, path, stale_after_s=6 * 3600, log=None):
        self.path, self.stale_after_s = path, stale_after_s
        self.log = log or (lambda *a: None)
        self.took_over_stale = None

    def _read(self):
        try:
            with open(self.path) as f:
                d = json.load(f)
            return d if isinstance(d, dict) else {"pid": int(str(d).strip() or 0)}
        except Exception:
            return None

    def __enter__(self):
        if os.path.exists(self.path):
            d = self._read() or {}
            pid = d.get("pid")
            age = time.time() - float(d.get("epoch") or 0)
            if pid and _pid_alive(pid):
                raise SystemExit("walker run.lock held by live pid %d on %s (started %s); respect it (another run is in flight)"
                                 % (pid, d.get("host", "?"), d.get("started", "?")))
            self.took_over_stale = d
            self.log("run.lock STALE (pid %s, age %.0fs, host %s) — taking over" % (pid, age, d.get("host", "?")))
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w") as f:
            f.write(json.dumps({"pid": os.getpid(), "host": socket.gethostname(),
                                "started": ts_et(), "epoch": time.time()}))
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, self.path)
        return self

    def __exit__(self, *a):
        try:
            os.remove(self.path)
        except OSError:
            pass
