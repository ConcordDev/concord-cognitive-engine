"""WALK-01 (GB-1544): the ticket fold — the walker's ingest is the union of the
branch's audit/fix-list/fix_tickets.jsonl and every audit/fix-list/records/*.jsonl
seat file at a pinned sha, never the main file alone.

Discipline (the fleet's own, CB-0414/0418): union, last row per id wins; a seat
row supersedes the main file's status for its id; ids that exist only in seat
records are real tickets (records-only) and must be seen. Statuses normalise to
upper case ("open" -> "OPEN"). Ids that are not lens tickets (HV- / SB- / IDLE- /
GB- / BR- and any records-only id with no lens) route to the CI-evidence lane
(WALK-06) — the walker never opens lens None.
"""
import json, os, re, subprocess

MAIN_PATH = "audit/fix-list/fix_tickets.jsonl"
RECORDS_DIR = "audit/fix-list/records"
NON_LENS_PREFIXES = ("HV-", "HV60-", "SB-", "IDLE-", "GB-", "BR-")


class FoldError(Exception):
    pass


def norm_status(s):
    return str(s or "OPEN").strip().upper()


def _rows(text):
    for line in (text or "").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            d = json.loads(line)
        except json.JSONDecodeError:
            continue  # a torn final line never poisons the fold
        if isinstance(d, dict) and d.get("id"):
            yield d


def parse_main(text):
    """The main file's own folding, exactly as TicketStore.reload has always done it:
    base rows keyed by id (first wins), typed/later rows collected as updates."""
    base, updates = {}, {}
    for d in _rows(text):
        if d.get("status"):
            d["status"] = norm_status(d["status"])
        if d.get("type"):
            updates.setdefault(d["id"], []).append(d)
        elif d["id"] not in base:
            base[d["id"]] = d
        else:
            updates.setdefault(d["id"], []).append(d)
    return base, updates


def apply_records(base, updates, records):
    """Seat record rows, applied in sorted filename order (deterministic):
    a row for a known id becomes a status update; a row for an unknown id
    becomes a records-only stub ticket so the id is seen and routed."""
    for name in sorted(records):
        for d in _rows(records[name]):
            row = {"type": "record", "id": d["id"], "status": norm_status(d["status"]) if d.get("status") else None,
                   "fixed_commit": d.get("fixed_commit"), "fixed_by": d.get("fixed_by"),
                   "fix_note": d.get("fix_note"), "root_cause_group": d.get("root_cause_group"),
                   "ts": d.get("ts"), "_record_file": name, "_raw": d}
            if d["id"] in base:
                updates.setdefault(d["id"], []).append(row)
            else:
                # WALK-06: the stub keeps the row's fixed_commit/fixed_by — for a
                # records-only id that commit is the CI lane's code evidence.
                base[d["id"]] = {"id": d["id"], "lens": d.get("lens"), "status": row["status"] or "OPEN",
                                 "title": d.get("fix_note") or "", "_records_only": True,
                                 "_record_file": name, "_raw": d,
                                 "fixed_commit": d.get("fixed_commit"), "fixed_by": d.get("fixed_by")}
    return base, updates


def lane_of(ticket):
    """'ci' for non-lens code tickets (WALK-06 verifies them by CI evidence at the
    deploy sha); 'lens' for everything the walker can open in a browser."""
    if not ticket:
        return "ci"
    tid = ticket.get("id") or ""
    if ticket.get("_records_only") and not ticket.get("lens"):
        return "ci"
    if tid.startswith(NON_LENS_PREFIXES):
        return "ci"
    if not ticket.get("lens"):
        return "ci"
    return "lens"


WALKER_FILE = "walker.jsonl"
HUMAN_FILE = "human.jsonl"
FPV = "FIXED_PENDING_VERIFY"


class Fold:
    """The folded ticket view. VERIFIED is never taken on a row's word: a VERIFIED that is not
    backed by a sha-gated walker replay row (records/walker.jsonl, ledger.verifiable_problems
    clean) folds as FIXED_PENDING_VERIFY and is listed in `unbacked` (counts()['unbacked_verified']).
    A PR merge or a seat can therefore, at most, set FIXED_PENDING_VERIFY."""

    def __init__(self, base, updates, sha=None, walker_rows=None):
        self.base, self.updates, self.sha = base, updates, sha
        self._walker = {}
        for d in (walker_rows or []):
            self._walker.setdefault(d["id"], []).append(d)
        self.unbacked = set()

    def _walker_shaped(self, tid):
        from .ledger import verifiable_problems
        return [r for r in self._walker.get(tid, []) if not verifiable_problems(r)]

    def _verified_backed(self, tid, u):
        """u: the update (or base) row claiming VERIFIED. True iff a walker replay backs it."""
        from .ledger import verifiable_problems
        src = (u or {}).get("_record_file")
        shaped = self._walker_shaped(tid)
        if src == WALKER_FILE:
            return not verifiable_problems((u or {}).get("_raw") or {})
        if src == HUMAN_FILE:
            # a person's confirm: needs its own gate shape AND a sha-gated walker replay that
            # fixed it or handed it to the tester (never one that saw it still failing)
            return (not verifiable_problems((u or {}).get("_raw") or {})
                    and any(r.get("result") in ("FIXED", "NEEDS_HUMAN") or r.get("status") == "VERIFIED" for r in shaped))
        return any(r.get("status") == "VERIFIED" for r in shaped)

    def _eff(self, tid, row):
        s = norm_status(row.get("status"))
        if s == "VERIFIED" and not self._verified_backed(tid, row):
            self.unbacked.add(tid)
            return FPV
        return s

    def status(self, tid):
        t = self.base.get(tid)
        if not t:
            return None
        st = self._eff(tid, t) if t.get("status") else None
        for u in self.updates.get(tid, []):
            if u.get("status"):
                st = self._eff(tid, u)
        return norm_status(st)

    def ids_with_status(self, status):
        want = norm_status(status)
        return [tid for tid in self.base if self.status(tid) == want]

    def ci_ids(self):
        return [tid for tid, t in self.base.items() if lane_of(t) == "ci"]

    def counts(self):
        by = {}
        for tid in self.base:
            by[self.status(tid)] = by.get(self.status(tid), 0) + 1
        return {"total": len(self.base), "by_status": by, "unbacked_verified": len(self.unbacked),
                "records_only": sum(1 for t in self.base.values() if t.get("_records_only")),
                "ci_lane": len(self.ci_ids())}

    def canonical_text(self):
        """One line per ticket: the base row with its folded status — the snapshot a
        run keeps so its ingest is auditable after the fact."""
        out = []
        for tid in sorted(self.base):
            t = dict(self.base[tid])
            t["status"] = self.status(tid)
            out.append(json.dumps(t))
        return "\n".join(out) + "\n"


def fold_from_texts(main_text, records, sha=None):
    if records is None:
        raise FoldError("records dir missing: the fold requires %s/*.jsonl — refusing to read the main file alone" % RECORDS_DIR)
    base, updates = parse_main(main_text)
    base, updates = apply_records(base, updates, records)
    return Fold(base, updates, sha=sha, walker_rows=list(_rows(records.get(WALKER_FILE, ""))))


def _git_show(repo, sha, path):
    r = subprocess.run(["git", "-C", repo, "show", "%s:%s" % (sha, path)],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise FoldError("git show %s:%s failed: %s" % (sha, path, r.stderr.strip()[:200]))
    return r.stdout


def extract_from_git(repo, sha):
    """Read the fold sources at the pinned sha from a local clone of the public repo.
    Raises FoldError, clearly, when the records dir is absent at that sha."""
    main_text = _git_show(repo, sha, MAIN_PATH)
    r = subprocess.run(["git", "-C", repo, "ls-tree", "--name-only", sha, RECORDS_DIR + "/"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise FoldError("git ls-tree %s at %s failed: %s" % (RECORDS_DIR, sha, r.stderr.strip()[:200]))
    names = [n for n in r.stdout.split() if n.endswith(".jsonl")]
    if not names:
        raise FoldError("records dir %s missing or empty at %s — refusing to fold the main file alone" % (RECORDS_DIR, sha))
    records = {}
    for n in names:
        records[os.path.basename(n)] = _git_show(repo, sha, n)
    return fold_from_texts(main_text, records, sha=sha)
