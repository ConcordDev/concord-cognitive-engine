"""Robustness for a long capture walk (precapture item 7). Orchestration only: the per-lens work is the injected
`run_one(lens, ctx, deadline)`; the browser is the injected `new_context()`; time is the injected `clock`/`sleep`;
the build sha is the injected `fetch_sha()` (polls /health buildSha). So every behaviour is testable with fakes.

Per-lens states (results + summary):
  DONE              run_one finished and reported DONE
  PARTIAL           ran, but some steps/checks could not be evaluated (UNVERIFIED) - never counted as a pass
  PENDING_CAPTURE   the lens needs live labels the capture walk has not produced yet
  SKIPPED_UNSAFE    admin / payment / write-skip lens: never walked
  CRASHED           browser/page crash (new context created, walk continues) or navigation failed twice
  TIMEOUT           per-lens budget exceeded
  RATE_LIMITED      429s survived bounded backoff
  DEPLOY_DETECTED   /health buildSha changed mid-walk: the lens in flight is DISCARDED and the walk STOPS
Resume: lenses whose last journal state is done/skipped are skipped (idempotent); CRASHED/TIMEOUT/RATE_LIMITED retry.
A resumed walk whose live sha differs from the sha its finished lenses were walked on stops at once (no mixing builds).
"""
import time
from .runstate import Journal

DONE, PARTIAL, PENDING, UNSAFE = "DONE", "PARTIAL", "PENDING_CAPTURE", "SKIPPED_UNSAFE"
CRASHED, TIMEOUT, RATE_LIMITED, DEPLOY = "CRASHED", "TIMEOUT", "RATE_LIMITED", "DEPLOY_DETECTED"
STATES = (DONE, PARTIAL, PENDING, UNSAFE, CRASHED, TIMEOUT, RATE_LIMITED, DEPLOY)
FINISHED_STATES = (DONE, PARTIAL, PENDING, UNSAFE)       # journaled "done": resume skips these


class PageCrash(Exception):
    """The browser/page crashed (Playwright 'Target crashed' / closed)."""


class NavFlaky(Exception):
    """A navigation failed in a way worth ONE retry (net::ERR_*, goto timeout)."""


class RateLimited(Exception):
    def __init__(self, retry_after=None):
        Exception.__init__(self, "429")
        self.retry_after = retry_after


class LensTimeout(Exception):
    pass


class Deadline:
    def __init__(self, clock, budget_s):
        self.clock, self.budget_s = clock, budget_s
        self.t0 = clock()

    def elapsed(self):
        return self.clock() - self.t0

    def check(self):
        """run_one calls this between steps: a synchronous browser call cannot be pre-empted, so the budget is cooperative."""
        if self.elapsed() > self.budget_s:
            raise LensTimeout("lens budget %.0fs exceeded" % self.budget_s)


def backoff_delay(attempt, retry_after=None, base=2.0, cap=60.0):
    """Bounded exponential (2,4,8,... capped); a server Retry-After wins but is capped too. attempt starts at 0."""
    if retry_after is not None:
        try:
            return max(0.0, min(cap, float(retry_after)))
        except (TypeError, ValueError):
            pass
    return min(cap, base * (2 ** attempt))


class LongWalk:
    def __init__(self, lenses, run_one, new_context, run_dir, fetch_sha, *, clock=time.monotonic, sleep=time.sleep,
                 lens_budget_s=240, max_rate_attempts=4, unsafe=lambda lens: False, log=lambda *a: None, close_context=None):
        self.lenses, self.run_one, self.new_context, self.fetch_sha = list(lenses), run_one, new_context, fetch_sha
        self.clock, self.sleep, self.budget, self.max_rate, self.unsafe, self.log = clock, sleep, lens_budget_s, max_rate_attempts, unsafe, log
        self.close_context = close_context or (lambda ctx: None)
        self.journal = Journal(run_dir)
        self.results, self.status, self.stop_reason, self.sha = {}, "RUNNING", None, None

    # -- build sha guard
    def _sha(self):
        for _ in range(2):
            try:
                s = self.fetch_sha()
            except Exception:
                s = None
            if s:
                return s
        return None

    def _journal_sha(self):
        for r in self.journal.rows:
            d = r.get("detail") or ""
            if "sha=" in d:
                return d.split("sha=", 1)[1].split()[0]
        return None

    def _stop(self, status, reason):
        self.status, self.stop_reason = status, reason
        self.log("STOP %s: %s" % (status, reason))

    def run(self):
        self.sha = self._sha()
        if not self.sha:
            self._stop("STOPPED_UNVERIFIED", "cannot read /health buildSha at start - will not walk a build it cannot identify")
            return self.summary()
        prev = self._journal_sha()
        if prev and prev != self.sha:
            self._stop("STOPPED_DEPLOY", "resume refused: finished lenses were walked on build %s but /health reports %s" % (prev[:12], self.sha[:12]))
            self.results["*"] = {"state": DEPLOY, "reason": self.stop_reason}
            return self.summary()
        done = self.journal.finished_ids()
        prior = {r["id"]: r.get("detail", "") for r in self.journal.rows}
        ctx = self.new_context()
        try:
            for lens in self.lenses:
                if lens in done:
                    st = (prior.get(lens, "").split("state=", 1) + [""])[1].split()[0] if "state=" in prior.get(lens, "") else DONE
                    self.results[lens] = {"state": st or DONE, "reason": "resumed: finished earlier in this run", "resumed": True}
                    continue
                now = self._sha()
                if now is None:
                    self._stop("STOPPED_UNVERIFIED", "cannot read /health buildSha before %s (twice)" % lens)
                    break
                if now != self.sha:
                    self.results[lens] = {"state": DEPLOY, "reason": "buildSha %s -> %s before the lens started" % (self.sha[:12], now[:12])}
                    self._stop("STOPPED_DEPLOY", self.results[lens]["reason"])
                    break
                if self.unsafe(lens):
                    self._record(lens, UNSAFE, "admin/payment/write-skip lens is never walked", 0.0)
                    continue
                ctx, res = self._walk_lens(lens, ctx)
                after = self._sha()
                if after is None:            # cannot prove no deploy happened during the lens: not trusted, not journaled done
                    self.results[lens] = {"state": PARTIAL, "reason": "buildSha unreadable after %s: result not trusted" % lens}
                    self.journal.record("lens", lens, "failed", "state=%s sha=%s unreadable-after" % (PARTIAL, self.sha))
                    self._stop("STOPPED_UNVERIFIED", "cannot read /health buildSha after %s (twice)" % lens)
                    break
                if after != self.sha:        # discard: a lens that straddled a deploy mixes two builds
                    self.results[lens] = {"state": DEPLOY, "reason": "buildSha changed while %s was being walked (%s -> %s); its result is discarded" % (lens, self.sha[:12], (after or "unreadable")[:12])}
                    self.journal.record("lens", lens, "failed", "state=%s sha=%s" % (DEPLOY, self.sha))
                    self._stop("STOPPED_DEPLOY", self.results[lens]["reason"])
                    break
                self._record(lens, res["state"], res.get("reason", ""), res.get("elapsed", 0.0), attempts=res.get("attempts", 1))
        finally:
            try:
                self.close_context(ctx)
            except Exception:
                pass
        if self.status == "RUNNING":
            self.status = "COMPLETE"
        return self.summary()

    def _record(self, lens, state, reason, elapsed, attempts=1):
        self.results[lens] = {"state": state, "reason": reason, "elapsed": round(elapsed, 3), "attempts": attempts}
        self.journal.record("lens", lens, "done" if state in FINISHED_STATES else "failed", "state=%s sha=%s %s" % (state, self.sha, (reason or "")[:80]))

    def _walk_lens(self, lens, ctx):
        nav_retried, rate_n, t0 = False, 0, self.clock()
        while True:
            dl = Deadline(self.clock, self.budget)
            try:
                out = self.run_one(lens, ctx, dl) or {}
                st = out.get("state") or DONE
                if st not in (DONE, PARTIAL, PENDING):
                    st, out = PARTIAL, dict(out, reason="run_one returned unknown state %r" % (out.get("state"),))
                if dl.elapsed() > self.budget:
                    return ctx, {"state": TIMEOUT, "reason": "finished after %.0fs, over the %.0fs budget: result not trusted" % (dl.elapsed(), self.budget), "elapsed": dl.elapsed()}
                return ctx, dict(out, state=st, elapsed=self.clock() - t0, attempts=1 + int(nav_retried) + rate_n)
            except LensTimeout as e:
                return ctx, {"state": TIMEOUT, "reason": str(e), "elapsed": self.clock() - t0}
            except PageCrash as e:
                try:
                    self.close_context(ctx)
                except Exception:
                    pass
                ctx = self.new_context()
                return ctx, {"state": CRASHED, "reason": "browser/page crashed (%s); fresh context created, walk continues" % (str(e)[:60] or "crash"), "elapsed": self.clock() - t0}
            except NavFlaky as e:
                if not nav_retried:
                    nav_retried = True
                    continue
                return ctx, {"state": CRASHED, "reason": "navigation failed twice (%s)" % (str(e)[:60]), "elapsed": self.clock() - t0, "attempts": 2}
            except RateLimited as e:
                if rate_n + 1 >= self.max_rate:
                    return ctx, {"state": RATE_LIMITED, "reason": "429 persisted through %d bounded-backoff attempt(s)" % self.max_rate, "elapsed": self.clock() - t0, "attempts": self.max_rate}
                self.sleep(backoff_delay(rate_n, e.retry_after))
                rate_n += 1
                continue
            except Exception as e:           # an unexpected run_one bug must not kill a long walk
                return ctx, {"state": CRASHED, "reason": "unexpected %s: %s" % (type(e).__name__, str(e)[:80]), "elapsed": self.clock() - t0}

    def summary(self):
        counts = {s: 0 for s in STATES}
        for r in self.results.values():
            counts[r["state"]] = counts.get(r["state"], 0) + 1
        return {"status": self.status, "stop_reason": self.stop_reason, "build_sha": self.sha, "counts": counts,
                "lenses": {k: v for k, v in self.results.items()}, "total": len(self.lenses),
                "not_walked": [l for l in self.lenses if l not in self.results]}


# ------------------------------------------------------------------ sweep wiring (walker.py cmd_walk)
class DeployGuard:
    """No-deploy guard for the sweep. `fetch_sha()` -> the live /health buildSha (hex) or None; injected, so fakes test it.
    start(): records the sha the walk runs against; refuses a resume onto a different build (prior_sha = the sha the run's
    finished lenses were walked on). check(): called before and after each lens; returns a reason string when the walk must
    STOP (DEPLOY_DETECTED), else None. With no readable sha at start the guard is OFF (logged) - the existing sha_status
    stamping still records `missing` on every row; once a sha is known, an unreadable one later is NOT trusted."""

    def __init__(self, fetch_sha, log=lambda *a: None):
        self.fetch_sha, self.log, self.sha, self.active = fetch_sha, log, None, False

    def _read(self):
        for _ in range(2):
            try:
                s = self.fetch_sha()
            except Exception:
                s = None
            if s:
                return s
        return None

    def start(self, prior_sha=None, known=None):
        """-> (ok, reason). `known`: a sha the caller already read this instant (avoids a second poll)."""
        self.sha = known or self._read()
        if not self.sha:
            self.log("deploy guard OFF: /health reports no buildSha at start")
            return True, None
        self.active = True
        if prior_sha and prior_sha != self.sha:
            return False, "resume refused: this run was started on build %s but /health reports %s now - a run never mixes builds" % (prior_sha[:12], self.sha[:12])
        return True, None

    def check(self, lens, known=None, phase="before"):
        if not self.active:
            return None
        now = known or self._read()
        if now is None:
            return "cannot read /health buildSha %s %s (twice): cannot prove no deploy happened" % (phase, lens)
        if now != self.sha:
            return "buildSha changed %s %s: %s -> %s" % (phase, lens, self.sha[:12], now[:12])
        return None


def lens_state(res, gate=False):
    """Per-lens result state for the manifest + SUMMARY. Never DONE for a lens whose checks errored/were partial."""
    if gate:
        return UNSAFE
    checks = (res or {}).get("checks") or {}
    blk = (res or {}).get("replay") or {}
    decided = (blk.get("counts") or {}).get("FIXED", 0) + (blk.get("counts") or {}).get("STILL_FAILING", 0)
    if blk.get("pending_capture") and not decided:
        return PENDING
    if any((v or {}).get("status") in ("ERROR", "PARTIAL") for v in checks.values()):
        return PARTIAL
    return DONE


def state_for_exception(e):
    n, t = type(e).__name__, str(e)
    if "429" in t or "rate" in t.lower() and "limit" in t.lower():
        return RATE_LIMITED
    if "Timeout" in n or "timeout" in t.lower()[:80]:
        return TIMEOUT
    return CRASHED
