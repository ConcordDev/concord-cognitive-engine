"""Per-lens replay inside the sweep (replay-original-tickets).

The ultimate lens walker was meant to sit ON TOP of the original lens-walk tickets: the
general sweep finds new things, AND every OPEN / FIXED_PENDING_VERIFY ticket for the lens
is replayed. Before this module the sweep started from an empty ticket list and replayed
nothing; `reverify` had never run against prod.

ReplayRun is created once per sweep (cmd_walk). For each lens, after the sweep's own
LensWalk finished, replay_lens() replays that lens's tickets with the existing Reverifier,
re-using that LensWalk as the smoke (adopt_walk — the lens is never walked a second time).

  FIXED          -> VERIFIED   (prior FIXED_PENDING_VERIFY only; basis = hand-written recipe or
                                the tester's own repro_steps; gated by ledger.assert_verifiable)
  STILL_FAILING  -> REOPENED   (prior FPV/VERIFIED) / stays OPEN
  NEEDS_HUMAN    -> the needs-tester queue (+ an attempt row that leaves the status alone)
Rows go to records/walker.jsonl ONLY, and only when the sha gate passed (live_sha is set);
otherwise the ledger is dry and nothing is written. Every in-scope ticket gets exactly one
coverage row with a reason, whatever happened to it.
"""
import json, os, time
from . import coverage as cov
from .auth import AccountMismatch
from .ledger import VerifyGateError
from .reverify import status_update, HUMAN, FIXED, STILL
from .runstate import ReplayBudget


class ReplayRun:
    def __init__(self, rv, store, ledger, *, live_sha, run_id, walker_version, run_dir, tester, log, budget=None, no_replay=False, replay_budget=None):
        self.rv, self.store, self.ledger = rv, store, ledger
        self.live_sha, self.run_id, self.walker_version = live_sha, run_id, walker_version
        self.run_dir, self.tester, self.log, self.budget = run_dir, tester, log, budget
        self.no_replay = no_replay
        # Replay has its OWN per-lens budget; its clock starts when replay starts, never from the sweep's
        # spent time. A legacy `budget` (LensBudget) with no explicit replay_budget is read as a fixed
        # per-lens replay allowance (its budget_s), still on replay's own clock.
        self.replay_budget = replay_budget or (ReplayBudget(override_s=budget.budget_s) if budget is not None else ReplayBudget())
        # tickets filed by THIS run (the sweep's own new findings) are never replayed
        self.baseline = set(store.base)
        self.results, self.skipped, self.blocks = {}, {}, {}

    # ------------------------------------------------------------ scope
    def lens_tids(self, slug):
        return [tid for tid, t in self.store.base.items()
                if tid in self.baseline and t.get("lens") == slug and self.store.lane(tid) == "lens" and self.store.status(tid) in cov.SCOPE_STATUSES]

    @staticmethod
    def _over_budget(budget_s, t0):
        return (time.monotonic() - t0) > budget_s

    # ------------------------------------------------------------ one lens
    def replay_lens(self, slug, lw, *, admin_gate=False):
        """Replay `slug`'s tickets on the sweep's finished LensWalk `lw`. Returns the `replay`
        block for the lens record. admin_gate: the sweep only ran the non-admin gate check."""
        tids = self.lens_tids(slug)
        block = {"live_sha": self.live_sha, "dry": getattr(self.ledger, "dry", True), "tickets": len(tids), "counts": {}, "ids": {},
                 "skipped": {}, "second_walks": 0}
        if self.no_replay:
            for tid in tids:
                self.skipped[tid] = cov.R_NO_REPLAY
            block["skipped"] = {t: cov.R_NO_REPLAY for t in tids}
            self.blocks[slug] = block
            return block
        if admin_gate:
            for tid in tids:
                self.skipped[tid] = cov.R_ADMIN
            block["skipped"] = {t: cov.R_ADMIN for t in tids}
            self.blocks[slug] = block
            return block
        self.rv.adopt_walk(slug, lw)
        walks_before = self.rv.live_walk_count
        budget_s = self.replay_budget.for_lens(len(tids))
        block["replay_budget_s"] = budget_s
        self.log("  replay %s: %d ticket(s), replay budget %ss (separate from the sweep's)" % (slug, len(tids), budget_s))
        t0 = time.monotonic()  # replay's own clock
        done = 0
        for tid in tids:
            if self._over_budget(budget_s, t0):
                self.skipped[tid] = cov.R_BUDGET + " (replay budget %ss, %d/%d done)" % (budget_s, done, len(tids))
                block["skipped"][tid] = self.skipped[tid]
                continue
            try:
                res = self.rv.run(tid)
            except AccountMismatch:
                raise
            except Exception as e:
                # never crash the lens, never lose the ticket: it becomes a NEEDS_HUMAN attempt naming the error
                t = self.store.get(tid) or {}
                res = {"id": tid, "lens": t.get("lens", slug), "verdict": HUMAN, "method": "none",
                       "prior_status": t.get("status") or "OPEN", "evidence": [],
                       "notes": "replay errored: %s: %s" % (type(e).__name__, str(e)[:160])}
                self.log("  replay %s errored: %s" % (tid, res["notes"]))
            self._record(res)
            self.results[tid] = res
            done += 1
            block["counts"][res["verdict"]] = block["counts"].get(res["verdict"], 0) + 1
            block["ids"].setdefault(res["verdict"], []).append(tid)
            if "PENDING_CAPTURE" in str(res.get("notes") or ""):
                block["pending_capture"] = block.get("pending_capture", 0) + 1
        block["second_walks"] = self.rv.live_walk_count - walks_before
        self.blocks[slug] = block
        self.log("  replay %s: %s%s" % (slug, block["counts"] or "-", (" skipped %d" % len(block["skipped"])) if block["skipped"] else ""))
        return block

    def _record(self, res):
        with open(os.path.join(self.run_dir, "reverify.jsonl"), "a") as f:
            f.write(json.dumps(res) + "\n")
        acct = "admin" if res.get("lens") in self.rv.cfg.get("admin_lenses", []) else "t1"
        kw = dict(live_sha=self.live_sha, run_id=self.run_id, account=acct, walker_version=self.walker_version)
        upd = status_update(self.store, res, self.tester)
        try:
            if upd:
                self.ledger.write_verdict(res, upd, **kw)
            else:
                if res["verdict"] == FIXED:
                    self.rv.rec.judgment(res.get("lens"), "fixed_not_claimed",
                                         "%s no longer reproduces but no builder marked it FIXED_PENDING_VERIFY; close?" % res["id"],
                                         res.get("evidence"), ticket_id=res["id"])
                self.ledger.write_attempt(res, str(res.get("prior_status") or "OPEN").upper(), **kw)
        except VerifyGateError as e:
            # never silent, never stamped: the gate refused, so the ticket goes to a human
            res["verdict"] = HUMAN
            res["notes"] = "VERIFIED refused by the gate: %s" % str(e)[:200]
            self.rv.rec.judgment(res.get("lens"), "reverify", "%s: %s" % (res["id"], res["notes"]), res.get("evidence"), ticket_id=res["id"])
            self.ledger.write_attempt(res, str(res.get("prior_status") or "OPEN").upper(), **kw)

    # ------------------------------------------------------------ coverage
    def coverage_rows(self, inv_slugs, walked_slugs, resumed=()):
        """One row for EVERY in-scope ticket in the fold (not only the lenses walked)."""
        scope = [(tid, self.store.get(tid)) for tid in self.store.base if tid in self.baseline]
        skipped = dict(self.skipped)
        for tid, t in scope:
            if t is None or str(t.get("status") or "").upper() not in cov.SCOPE_STATUSES or tid in self.results or tid in skipped:
                continue
            lens = t.get("lens")
            if self.store.lane(tid) == "ci":
                skipped[tid] = cov.R_CI
            elif lens not in inv_slugs:
                skipped[tid] = cov.R_NOT_IN_INV + (" (%s)" % lens if lens else " (ticket has no lens)")
            elif self.no_replay:
                skipped[tid] = cov.R_NO_REPLAY
            elif lens in resumed:
                skipped[tid] = cov.R_RESUMED
            elif lens not in walked_slugs:
                skipped[tid] = cov.R_NOT_WALKED + " (%s)" % lens
        return cov.build_rows(scope, self.results, skipped)
