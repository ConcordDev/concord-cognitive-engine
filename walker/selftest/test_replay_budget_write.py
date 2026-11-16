#!/usr/bin/env python3
"""(b) replay's own per-lens budget and (c) replay honouring --allow-write. Offline: FakeApp driver
(no browser; the browser path is covered by run_selftest_replay_write.py on the box).
Run: python3 selftest/test_replay_budget_write.py"""
import json, os, sys, tempfile, time

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "selftest"))
from concord_walker import repro, safety, coverage as cov
from concord_walker.runstate import LensBudget, ReplayBudget
from concord_walker.reverify import Reverifier
from concord_walker.records import RunRecorder
from concord_walker.util import load_config
import test_replay_hook as H

FAILS = []


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (" " + str(extra)[:400] if extra and not cond else ""))
    if not cond:
        FAILS.append(name)


# ------------------------------------------------------------------ (b) budget
def test_budget_math():
    b = ReplayBudget()
    check("defaults: base 60 + 25/ticket, cap 900", (b.for_lens(0), b.for_lens(2), b.for_lens(10), b.for_lens(500)) == (60, 110, 310, 900), (b.for_lens(2), b.for_lens(500)))
    check("configurable base/per-ticket/cap", ReplayBudget(10, 5, 30).for_lens(3) == 25 and ReplayBudget(10, 5, 30).for_lens(50) == 30)
    check("fixed override wins over the formula", ReplayBudget(override_s=7).for_lens(100) == 7)

    class A: replay_budget_s = None; replay_budget_base_s = 5; replay_budget_per_ticket_s = None; replay_budget_cap_s = None
    cfg = {"thresholds": {"replay_budget_per_ticket_s": 11, "replay_budget_base_s": 99}}
    rb = ReplayBudget.from_config(cfg, A())
    check("CLI flag beats config thresholds; config fills the rest", (rb.base_s, rb.per_ticket_s, rb.cap_s) == (5, 11, 900), vars(rb))
    check("config threshold replay_budget_s is a fixed override", ReplayBudget.from_config({"thresholds": {"replay_budget_s": 33}}).for_lens(9) == 33)


def _mk(n, **kw):
    tickets = [H.tk("FIX-demo-%03d" % i) for i in range(1, n + 1)]
    return tickets, H.runner_for({t["id"]: H.FIXED_RR for t in tickets})


def test_sweep_exhausted_replay_still_runs():
    tickets, runner = _mk(3)
    sweep = LensBudget(240)
    sweep.note("demo", 99999)       # the sweep used its entire budget (and then some)
    sweep.start("demo")
    rr, rv, ledger, rec, tmp = H.setup(tickets, runner)
    rr.budget = sweep
    rr.replay_budget = ReplayBudget()   # replay's own default budget
    rr.replay_lens("demo", H.FakeWalk())
    check("sweep budget exhausted -> replay STILL runs every ticket (own clock)", sorted(runner.calls) == [t["id"] for t in tickets], runner.calls)
    check("the computed replay budget is recorded on the lens replay block", rr.blocks["demo"]["replay_budget_s"] == 60 + 25 * 3, rr.blocks["demo"])


def test_replay_budget_too_small():
    tickets, base_runner = _mk(4)
    calls = []

    def slow(t):
        calls.append(t["id"])
        time.sleep(0.12)
        return H.FIXED_RR
    rr, rv, ledger, rec, tmp = H.setup(tickets, slow)
    rr.replay_budget = ReplayBudget(override_s=0.1)
    rr.replay_lens("demo", H.FakeWalk())
    rows = rr.coverage_rows({"demo"}, {"demo"})
    na = [r for r in rows if r["verdict"] == "NOT_ATTEMPTED"]
    check("replay budget too small: first ticket ran, the rest are NOT_ATTEMPTED", len(calls) == 1 and len(na) == 3, (calls, rows))
    check("reason is R_BUDGET + '(replay budget Ns, k/n done)'", all(r["reason"].startswith(cov.R_BUDGET) and "replay budget 0.1s, 1/4 done" in r["reason"] for r in na), [r["reason"] for r in na])
    check("never silent: the lens replay block lists the skipped tickets with the reason", len(rr.blocks["demo"]["skipped"]) == 3
          and all("replay budget" in v for v in rr.blocks["demo"]["skipped"].values()), rr.blocks["demo"])


def test_replay_error_is_needs_human_not_a_skip():
    tickets = [H.tk("FIX-demo-001")]

    def boom(t):
        raise RuntimeError("module 'x' has no attribute 'y'")
    rr, rv, ledger, rec, tmp = H.setup(tickets, boom)
    rv.run = lambda tid: (_ for _ in ()).throw(AttributeError("module 'concord_walker.safety' has no attribute 'DELETE_BTN'"))
    rr.replay_lens("demo", H.FakeWalk())
    res = rr.results.get("FIX-demo-001")
    check("a replay that raises becomes a NEEDS_HUMAN attempt with the error named (lens never crashes)",
          res and res["verdict"] == "NEEDS_HUMAN" and "AttributeError" in res["notes"], res)


def test_safety_delete_btn_defined():
    check("safety.DELETE_BTN exists and matches delete-button labels only",
          safety.DELETE_BTN.search("Delete") and safety.DELETE_BTN.search("Remove item") and not safety.DELETE_BTN.search("Settings"))
    from concord_walker import formfuzz
    vals, nums = formfuzz.ticket_values("Click 'Delete' then type 'abc' in 'Title'")
    check("formfuzz.ticket_values no longer raises and drops the 'Delete' control label", "Delete" not in vals and "abc" in vals, vals)


def test_closed_page_survives():
    class TargetClosedError(Exception):
        pass
    tickets = [H.tk("FIX-demo-001")]
    state = {"n": 0}

    def flaky(t):
        state["n"] += 1
        if state["n"] == 1:
            raise TargetClosedError("Target page, context or browser has been closed")
        return H.FIXED_RR
    rr, rv, ledger, rec, tmp = H.setup(tickets, flaky)
    out = rv._apply_repro_steps(H.tk("FIX-demo-001"), {"id": "FIX-demo-001", "verdict": "NEEDS_HUMAN", "notes": "", "evidence": []})
    check("a closed page is reopened once and the replay completes", state["n"] == 2 and out["verdict"] == "FIXED", out)
    state["n"] = -10
    def always(t):
        raise TargetClosedError("Target page, context or browser has been closed")
    rv.repro_runner = always
    out = rv._apply_repro_steps(H.tk("FIX-demo-001"), {"id": "FIX-demo-001", "verdict": "NEEDS_HUMAN", "notes": "", "evidence": []})
    check("still closed on the retry -> NEEDS_HUMAN naming TargetClosedError, never a crash or FIXED", out["verdict"] == "NEEDS_HUMAN" and "TargetClosedError" in out["notes"], out)


# ------------------------------------------------------------------ (c) write policy
class FakeApp:
    """A lens with a New-item form, a list whose rows have Delete buttons, and rows the walker did NOT create."""

    def __init__(self, foreign=("someone-elses-row", "qa-walker-demo-t2-abc123-other")):
        self.rows = list(foreign)
        self.title = ""
        self.calls = []
        self.fail_cleanup = False
        self.cleanup_raises = False

    def open(self, t): self.calls.append(("open", t))
    def reload(self): pass
    def press(self, k): self.calls.append(("press", k))

    def _ctl(self):
        c = [("New item", "button"), ("Title", "textbox"), ("Create", "button"), ("Upgrade plan", "button"), ("Delete account", "button"),
             ("Delete", "button"), ("Publish", "button")]
        return [{"name": n, "role": r, "enabled": True, "focused": False, "props": {}} for n, r in c]

    def click(self, name, role=None):
        from concord_walker.matching import fuzzy_match
        hit = fuzzy_match(name, [c["name"] for c in self._ctl()])
        self.calls.append(("click", name, hit))
        if hit == "Create":
            self.rows.append(self.title)
        if hit == "Delete":
            raise AssertionError("an unscoped Delete must never be clicked")
        return hit

    def click_in_row(self, name, label):
        self.calls.append(("click_in_row", name, label))
        if label in self.rows and name == "Delete":
            self.rows.remove(label)
            return "Delete"
        return None

    def type_into(self, name, value):
        self.calls.append(("type", name, value))
        if name == "Title":
            self.title = value
            return True
        return False

    def delete_fixture(self, label):
        if self.cleanup_raises:
            raise RuntimeError("TargetClosedError: page closed")
        if self.fail_cleanup or label not in self.rows:
            return False
        self.rows.remove(label)
        return True

    def tab_names(self): return []
    def snapshot(self): return {"controls": self._ctl(), "texts": list(self.rows), "dialogs": [], "errors": 0, "url": "x"}
    def screenshot(self, n): return "ev/%s.png" % n


def wctx(**kw):
    log = []
    ctx = {"allow_write": True, "admin": False, "write_skip": False, "account": "t1", "label_base": "qa-walker-demo-t1-abc123-fix1",
           "fixtures": lambda: [], "on_fixture": lambda label, state, note="": log.append((label, state))}
    ctx.update(kw)
    return ctx, log


def T(steps, expected="No console errors"):
    return {"id": "FIX-demo-001", "lens": "demo", "repro_steps": steps, "expected": expected, "actual": "x", "title": "t"}


CREATE = ["Open New item > Title > type X > Create"]


def test_write_runs_and_cleans_up():
    app = FakeApp()
    ctx, log = wctx()
    r = repro.run_repro(T(CREATE), app, lens_slug="demo", write=ctx)
    typed = next(c for c in app.calls if c[0] == "type")
    check("under --allow-write the create flow runs: own labelled value typed (not 'X'), Create clicked", typed[2].startswith("qa-walker-demo-t1-") and ("click", "Create", "Create") in app.calls, app.calls)
    check("fixture lifecycle recorded: never_created -> create_clicked -> deleted", [s for _, s in log] == ["never_created", "create_clicked", "deleted"], log)
    check("the created row is cleaned up; pre-existing rows are untouched", app.rows == ["someone-elses-row", "qa-walker-demo-t2-abc123-other"], app.rows)
    check("verdict still comes only from the checked `expected`", r["verdict"] == repro.FIXED and r["fixtures"], r)


def test_cleanup_failure_is_a_leftover_not_a_claim():
    app = FakeApp(); app.fail_cleanup = True
    ctx, log = wctx()
    r = repro.run_repro(T(CREATE), app, lens_slug="demo", write=ctx)
    check("cleanup that cannot find a delete control -> recorded LEFTOVER with a reason", log[-1][1] == "leftover" and r["fixtures"] and "leftover" in r["fixtures"].values(), (log, r.get("fixtures")))
    app = FakeApp(); app.cleanup_raises = True
    ctx, log = wctx()
    r = repro.run_repro(T(CREATE), app, lens_slug="demo", write=ctx)
    check("a closed page during cleanup never crashes the lens; it is a leftover", log[-1][1] == "leftover", log)


def test_refused_without_allow_write():
    app = FakeApp()
    r = repro.run_repro(T(CREATE), app, lens_slug="demo", write=None)
    check("without --allow-write the write step is NEEDS_HUMAN 'write step needs --allow-write'", r["verdict"] == repro.HUMAN and "write step needs --allow-write" in r["notes"], r)
    check("...and nothing was created", app.rows == FakeApp().rows and not any(c[0] == "click" and c[2] == "Create" for c in app.calls), app.calls)
    ctx, _ = wctx(allow_write=False)
    r = repro.run_repro(T(CREATE), FakeApp(), lens_slug="demo", write=ctx)
    check("a write context with allow_write False is the same refusal", r["verdict"] == repro.HUMAN and "needs --allow-write" in r["notes"], r)


def test_create_needs_a_labelled_value_first():
    app = FakeApp()
    ctx, log = wctx()
    r = repro.run_repro(T(["Open New item > Create"]), app, lens_slug="demo", write=ctx)
    check("a bare Create with no own labelled value entered first is refused (would not act on a walker fixture)",
          r["verdict"] == repro.HUMAN and "no own labelled" in r["notes"] and app.rows == FakeApp().rows, r)


def test_delete_policy():
    app = FakeApp()
    ctx, _ = wctx()
    r = repro.run_repro(T(["Open New item > Delete"]), app, lens_slug="demo", write=ctx)
    check("delete of a row the walker did not create is refused (no live walker fixture)",
          r["verdict"] == repro.HUMAN and "delete refused" in r["notes"] and app.rows == FakeApp().rows, r)
    app = FakeApp(); app.rows.append("qa-walker-demo-t1-abc123-mine")
    ctx, _ = wctx(fixtures=lambda: ["qa-walker-demo-t1-abc123-mine"])
    r = repro.run_repro(T(["Open New item > Delete"], "No console errors"), app, lens_slug="demo", write=ctx)
    check("with a walker fixture a plain Delete is clicked ROW-SCOPED to that fixture only",
          ("click_in_row", "Delete", "qa-walker-demo-t1-abc123-mine") in app.calls and "qa-walker-demo-t1-abc123-mine" not in app.rows
          and "someone-elses-row" in app.rows and r["verdict"] == repro.FIXED, (app.calls, app.rows, r["notes"]))
    app = FakeApp()
    ctx, _ = wctx(fixtures=lambda: ["qa-walker-demo-t1-abc123-mine"])
    r = repro.run_repro(T(["Open New item > Delete"]), app, lens_slug="demo", write=ctx)
    check("if the fixture row is not on the page the scoped delete is refused, never an unscoped click", r["verdict"] == repro.HUMAN and "scoped" in r["notes"], r)


def test_never_even_with_allow_write():
    for step, word in (("Open New item > Upgrade plan", "Upgrade plan"), ("Open New item > Delete account", "Delete account"), ("Open New item > Publish", "Publish")):
        app = FakeApp()
        ctx, _ = wctx(fixtures=lambda: ["qa-walker-demo-t1-abc123-mine"])
        r = repro.run_repro(T([step]), app, lens_slug="demo", write=ctx)
        check("--allow-write still refuses %r" % word, r["verdict"] == repro.HUMAN and not any(c[0] == "click" and c[1] == word for c in app.calls), (r["notes"], app.calls))
    for name in ("Pay now", "Billing", "Transfer funds", "Grant admin role", "Delete account", "Send to everyone", "Share", "Sign out"):
        ok, why, kind = safety.write_step_decision(name, allow_write=True, fixture_labels=["qa-walker-x"])
        check("write_step_decision refuses %r with --allow-write" % name, not ok, (why, kind))
    ok, why, kind = safety.write_step_decision("Save view", allow_write=True)
    check("a plain create/edit verb is allowed with --allow-write", ok and kind == "create")
    ok, why, kind = safety.write_step_decision("Save view", allow_write=False)
    check("...and refused without it", not ok and "needs --allow-write" in why)


def test_admin_and_write_skip_stay_read_only():
    for key in ("admin", "write_skip"):
        app = FakeApp()
        ctx, _ = wctx(**{key: True})
        r = repro.run_repro(T(CREATE), app, lens_slug="demo", write=ctx, allow_fill=False)
        check("%s lens: replay stays look-only (fill refused, nothing created)" % key, r["verdict"] == repro.HUMAN and app.rows == FakeApp().rows and not any(c[0] == "type" for c in app.calls), r)
        app = FakeApp()
        ctx, _ = wctx(**{key: True})
        r = repro.run_repro(T(["Open New item > Create"]), app, lens_slug="demo", write=ctx)
        check("%s lens: a write click is refused even if fill were allowed" % key, r["verdict"] == repro.HUMAN and "look-only" in r["notes"] or "read-only" in r["notes"], r)


def test_cross_account_stays_on_own_data():
    tmp = tempfile.mkdtemp()
    cfg = load_config(None)
    cfg["runs_dir"], cfg["queue_dir"], cfg["audit_dir"] = [os.path.join(tmp, x) for x in ("runs", "queue", "audit")]
    cfg["write_skip_lenses"] = ["chat"]
    rec = RunRecorder(cfg, "run-x", dry=True)
    inv = [{"slug": "demo", "url": "https://x/lenses/demo", "name": "Demo"}, {"slug": "admin", "url": "https://x/lenses/admin"}]
    rv = Reverifier(None, cfg, rec, None, lambda *a: None, inv, allow_write=True)
    rec.fixture("qa-walker-demo-t2-aaaaaa-x", "demo", "create_clicked")      # t2's row
    rec.fixture("qa-walker-demo-t1-bbbbbb-y", "demo", "create_clicked")      # t1's row
    rec.fixture("qa-walker-demo-t1-cccccc-z", "demo", "deleted")             # already gone
    rec.fixture("qa-walker-other-t1-dddddd-w", "other", "create_clicked")    # another lens
    t = {"id": "FIX-demo-001", "lens": "demo"}
    ctx = rv._write_ctx(t, "t1", False, False)
    check("t1's replay may delete only t1's own live fixtures on this lens (never t2's, never deleted, never another lens)",
          ctx["fixtures"]() == ["qa-walker-demo-t1-bbbbbb-y"], ctx["fixtures"]())
    check("fixture labels for new rows carry the account + run id + ticket", ctx["label_base"].startswith("qa-walker-demo-t1-") and "fixdemo001" in ctx["label_base"].replace("-", ""), ctx["label_base"])
    check("admin lens -> no write ctx", rv._write_ctx(t, "admin", True, True) is None)
    check("write-skip lens -> no write ctx", rv._write_ctx(t, "t1", False, True) is None)
    rv.allow_write = False
    check("no --allow-write -> no write ctx", rv._write_ctx(t, "t1", False, False) is None)
    # the label an own create types is what cleanup removes, and a t2 row of the same lens survives
    app = FakeApp(foreign=("qa-walker-demo-t2-aaaaaa-x",))
    rv.allow_write = True
    ctx = rv._write_ctx(t, "t1", False, False)
    r = repro.run_repro(T(CREATE), app, lens_slug="demo", write=ctx)
    check("cross-account: own row created+removed, the t2 row survives", app.rows == ["qa-walker-demo-t2-aaaaaa-x"] and r["verdict"] == repro.FIXED, (app.rows, r["notes"]))
    check("fixtures were recorded in the run's fixtures.jsonl lifecycle", any(l["state"] == "deleted" and "-t1-" in l["label"] for l in rec.fixtures.values()), rec.fixtures)


def test_verified_gate_untouched():
    from concord_walker import ledger
    check("the single VERIFIED gate still exists", hasattr(ledger, "assert_verifiable") and hasattr(ledger, "VerifyGateError"))


if __name__ == "__main__":
    for fn in (test_budget_math, test_sweep_exhausted_replay_still_runs, test_replay_budget_too_small, test_replay_error_is_needs_human_not_a_skip,
               test_safety_delete_btn_defined, test_closed_page_survives, test_write_runs_and_cleans_up, test_cleanup_failure_is_a_leftover_not_a_claim,
               test_refused_without_allow_write, test_create_needs_a_labelled_value_first, test_delete_policy, test_never_even_with_allow_write,
               test_admin_and_write_skip_stay_read_only, test_cross_account_stays_on_own_data, test_verified_gate_untouched):
        fn()
    print("\n%d failure(s)" % len(FAILS))
    sys.exit(1 if FAILS else 0)
