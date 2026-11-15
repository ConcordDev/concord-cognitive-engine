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

    def start(self, lens):
        self.started.setdefault(lens, time.monotonic())

    def elapsed(self, lens):
        t0 = self.started.get(lens)
        return None if t0 is None else time.monotonic() - t0

    def over(self, lens):
        e = self.elapsed(lens)
        return e is not None and e > self.budget_s


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
