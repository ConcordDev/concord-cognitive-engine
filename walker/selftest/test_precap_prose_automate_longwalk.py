"""Pre-capture items 5-7: prose classification, human-only automation, long-walk robustness. Offline; fakes for browser/clock/sha."""
import io, json, os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import pytest
from concord_walker import precap as P, automate as A, longwalk as L, repro


# ----------------------------------------------------------------- 5. prose classification
@pytest.mark.parametrize("seg,state,cat", [
    ("See evidence/agents-retest/phase1-desktop-20261109.md", "needs_post_capture_rewrite", "evidence_pointer"),
    ("Sign in as zuko_qa_t1", "needs_post_capture_rewrite", "tester_context"),
    ("abc", "needs_post_capture_rewrite", "bare_value"),
    ("Open task detail", "pending_capture", "generic_open_target"),
    ("create Water goal 8", "pending_capture", "create_fill_flow"),
    ("leave prompt empty / dismiss", "pending_capture", "bad_input_value"),
    ("Schema > Registry with entries > look for search", "pending_capture", "named_control_path"),
    ("if the dialog is open", "needs_post_capture_rewrite", "conditional_or_guard"),
    ("Hang a work with image 'not-a-url", "needs_post_capture_rewrite", "fragment"),
    ("blue sky thinking about nothing at all really", "needs_post_capture_rewrite", "no_actionable_verb"),
])
def test_prose_rule_table(seg, state, cat):
    r = P.classify_part(seg)
    assert (r["state"], r["category"]) == (state, cat), r


def test_classification_is_deterministic_and_never_an_action():
    segs = ["Open task detail", "abc", "create X", "wibble wobble"]
    assert [P.classify_part(s) for s in segs] == [P.classify_part(s) for s in segs]
    for s in segs:
        assert set(P.classify_part(s)) == {"state", "category", "why"}      # a state + reason, never a guessed sub-step


def test_unmapped_parts_carry_state_from_expand_step():
    e = repro.expand_step("blue sky thinking about nothing", "a")
    assert not e["mapped"] and e["parts"][0]["state"] in ("pending_capture", "needs_post_capture_rewrite") and e["parts"][0]["category"]
    assert e["substeps"] == []


def test_pending_capture_is_not_counted_as_mapped():
    import tools.mapped_rate as MR
    st, cat = MR.step_state("create Water goal 8", "a")
    assert st == "pending_capture" and not MR.step_mapped("create Water goal 8", "a")


# ----------------------------------------------------------------- 6. lighthouse
def LHR(perf=0.95, a11y=0.92, cls=0.05, final="https://x/lenses/a"):
    return {"finalUrl": final, "categories": {"performance": {"score": perf}, "accessibility": {"score": a11y}},
            "audits": {"cumulative-layout-shift": {"numericValue": cls}}}


def test_thresholds_parsed_from_ticket_text():
    th = A.lighthouse_thresholds("Performance and a11y 90+; CLS under 0.1; Lighthouse desktop")
    assert th["categories"] == {"performance": 90, "accessibility": 90} and th["metrics"] == {"cumulative-layout-shift": 0.1} and th["form_factor"] == "desktop"
    assert A.lighthouse_thresholds("Labels, AA contrast, ordered headings")["categories"] == {}


def test_lighthouse_pass_fail_and_no_threshold():
    th = A.lighthouse_thresholds("Performance and a11y 90+; CLS under 0.1")
    assert A.check_lighthouse(LHR(), th)[0] == "PASS"
    assert A.check_lighthouse(LHR(perf=0.5), th)[0] == "FAIL"
    assert A.check_lighthouse(LHR(cls=0.4), th)[0] == "FAIL"
    st, why = A.check_lighthouse(LHR(), A.lighthouse_thresholds("Labels and AA contrast"))
    assert st == "UNVERIFIED" and "no numeric threshold" in why


def test_lighthouse_fails_closed():
    th = A.lighthouse_thresholds("a11y 90+")
    assert A.check_lighthouse(None, th)[0] == "UNVERIFIED"
    assert A.check_lighthouse(LHR(final="https://x/login"), th, "/lenses/a")[0] == "UNVERIFIED"      # landed on sign-in
    assert A.check_lighthouse({"categories": {"performance": {"score": 1}}, "audits": {}}, th)[0] == "UNVERIFIED"   # category missing
    r = A.run_lighthouse("https://x/", which=lambda n: None, env={})
    assert r["state"] == "unverified" and "not installed" in r["reason"]


class _P:
    def __init__(self, rc, out): self.returncode, self.stdout = rc, out


def test_run_lighthouse_with_fake_runner():
    which = lambda n: "/bin/" + n if n == "lighthouse" else None
    ok = A.run_lighthouse("https://x/lenses/a", "desktop", runner=lambda c, to: _P(0, json.dumps(LHR())), which=which, env={})
    assert ok["state"] == "ok" and ok["lhr"]["categories"]
    assert A.run_lighthouse("u", runner=lambda c, to: _P(1, ""), which=which, env={})["state"] == "unverified"
    assert A.run_lighthouse("u", runner=lambda c, to: _P(0, "not json"), which=which, env={})["state"] == "unverified"
    def boom(c, to): raise TimeoutError()
    r = A.run_lighthouse("u", runner=boom, which=which, env={})
    assert r["state"] == "unverified" and "TimeoutError" in r["reason"]
    # npx is used only when the box opts in
    assert A.find_lighthouse(lambda n: "/bin/npx" if n == "npx" else None, {}) is None
    assert A.find_lighthouse(lambda n: "/bin/npx" if n == "npx" else None, {"CONCORD_WALKER_ALLOW_NPX": "1"})[-1] == "lighthouse"


def test_dispatch_lighthouse_end_to_end_and_missing_capability():
    t = {"repro_steps": "Lighthouse desktop on /lenses/a", "expected": "Performance and a11y 90+"}
    assert A.dispatch("lighthouse", t, {})["state"] == "UNVERIFIED"
    env = {"lighthouse": lambda ff: {"state": "ok", "lhr": LHR()}, "requested_path": "/lenses/a"}
    assert A.dispatch("lighthouse", t, env)["state"] == "PASS"
    env["lighthouse"] = lambda ff: {"state": "unverified", "reason": "lighthouse CLI is not installed"}
    assert A.dispatch("lighthouse", t, env)["state"] == "UNVERIFIED"


# ----------------------------------------------------------------- 6. cross-account
def AB(owner=(200, True), other=(404, False), anon=(401, None), modify=None, create_ok=True):
    f = lambda v: (lambda p, m: {"status": v[0], "contains": v[1]})
    d = dict(create=(lambda: {"path": "/api/x/1", "marker": "qa-walker-1"}) if create_ok else (lambda: None), fetch_owner=f(owner), fetch_other=f(other), fetch_anon=f(anon))
    if modify is not None:
        d["modify_other"] = lambda p, m: {"status": modify}
    return d


def test_ab_isolation_pass_and_denials():
    assert A.ab_isolation(**AB())[0] == "PASS"
    assert A.ab_isolation(**AB(other=(200, False), anon=(200, False)))[0] == "PASS"       # empty read counts as isolated
    assert A.ab_isolation(**AB(other=(403, None), anon=(403, None), modify=403))[0] == "PASS"


def test_ab_isolation_leaks_fail():
    assert A.ab_isolation(**AB(other=(200, True)))[0] == "FAIL"
    assert A.ab_isolation(**AB(anon=(200, True)))[0] == "FAIL"
    assert A.ab_isolation(**AB(modify=200))[0] == "FAIL"


def test_ab_isolation_unverified_cases():
    assert A.ab_isolation(**AB(create_ok=False))[0] == "UNVERIFIED"
    assert A.ab_isolation(**AB(owner=(404, False)))[0] == "UNVERIFIED"            # owner cannot read own item: nothing to isolate
    assert A.ab_isolation(**AB(other=(500, None)))[0] == "UNVERIFIED"              # a 500 is not a denial
    assert A.ab_isolation(**AB(other=(200, None)))[0] == "UNVERIFIED"
    assert A.ab_isolation(**AB(anon=(500, None)))[0] == "UNVERIFIED"
    d = AB(); d["create"] = lambda: (_ for _ in ()).throw(RuntimeError("x"))
    assert A.ab_isolation(**d)[0] == "UNVERIFIED"


# ----------------------------------------------------------------- 6. visual
PIL = pytest.importorskip("PIL.Image")


def png(color, size=(80, 60)):
    from PIL import Image
    b = io.BytesIO(); Image.new("RGB", size, color).save(b, "PNG"); return b.getvalue()


def test_theme_surface_check():
    assert A.theme_surface_check(png((250, 250, 250)), "light")[0] == "PASS"
    assert A.theme_surface_check(png((10, 10, 10)), "light")[0] == "FAIL"
    assert A.theme_surface_check(png((10, 10, 10)), "dark")[0] == "PASS"
    assert A.theme_surface_check(png((128, 128, 128)), "light")[0] == "UNVERIFIED"      # mixed: a human decides
    assert A.theme_surface_check(b"not a png", "light")[0] == "UNVERIFIED"
    assert A.diff_ratio(b"x", b"y") is None


def test_baseline_diff_first_sight_is_unverified_then_pass_and_fail():
    with tempfile.TemporaryDirectory() as d:
        key = A.baseline_key("abc123", (390, 844), "docs", "home")
        assert A.baseline_diff(d, key, png((255, 255, 255)))[0] == "UNVERIFIED"         # a baseline alone proves nothing
        assert A.baseline_diff(d, key, png((255, 255, 255)))[0] == "PASS"
        assert A.baseline_diff(d, key, png((0, 0, 0)))[0] == "FAIL"
        assert A.baseline_diff(d, key, png((255, 255, 255), (81, 60)))[0] == "FAIL"     # size change = changed layout


def test_layout_boxes_overlap_viewport_visibility():
    ok = [{"name": "a", "x": 0, "y": 0, "w": 100, "h": 40, "visible": True}, {"name": "b", "x": 0, "y": 50, "w": 100, "h": 40, "visible": True}]
    assert A.layout_boxes(ok, 390, 844)[0] == "PASS"
    assert A.layout_boxes([ok[0], dict(ok[1], y=10)], 390, 844)[0] == "FAIL"
    assert A.layout_boxes([dict(ok[0], x=350)], 390, 844)[0] == "FAIL"
    assert A.layout_boxes([dict(ok[0], visible=False)], 390, 844)[0] == "FAIL"
    assert A.layout_boxes([], 390, 844)[0] == "UNVERIFIED"


def test_human_only_routing_and_exact_reasons():
    assert A.classify_human_only("lighthouse")["route"] == "lighthouse"
    assert A.classify_human_only("cross_account")["route"] == "cross_account"
    assert A.classify_human_only("visual", expected="Light palette")["route"] == "visual"
    r = A.classify_human_only("visual", note="readability is a visual judgement", expected="Readable")
    assert r["route"] == "human" and "visual judgement" in r["why"]
    r = A.classify_human_only("code_read")
    assert r["route"] == "human" and "code" in r["why"]
    assert A.dispatch("human", {}, {"why": "needs a person"}) == {"state": "NEEDS_HUMAN", "reason": "needs a person"}


# ----------------------------------------------------------------- 7. long walk
class Clock:
    def __init__(self): self.t = 0.0
    def __call__(self): return self.t
    def sleep(self, s): self.t += s; self.slept.append(s)
    slept = None


def mk(lenses, run_one, shas=("S1",), unsafe=lambda l: False, budget=100, rd=None, **kw):
    c = Clock(); c.slept = []
    it = iter(shas); last = {"v": shas[0]}
    def fetch():
        try: last["v"] = next(it)
        except StopIteration: pass
        return last["v"]
    ctxs = []
    def newc(): ctxs.append(object()); return ctxs[-1]
    rd = rd or tempfile.mkdtemp()
    w = L.LongWalk(lenses, run_one, newc, rd, fetch, clock=c, sleep=c.sleep, lens_budget_s=budget, unsafe=unsafe, **kw)
    return w, c, ctxs, rd


def test_clean_walk_complete_and_states_in_summary():
    w, c, ctxs, _ = mk(["a", "b", "c"], lambda l, ctx, dl: {"state": {"a": "DONE", "b": "PARTIAL", "c": "PENDING_CAPTURE"}[l]}, shas=("S1",) * 20)
    s = w.run()
    assert s["status"] == "COMPLETE" and s["counts"]["DONE"] == 1 and s["counts"]["PARTIAL"] == 1 and s["counts"]["PENDING_CAPTURE"] == 1 and not s["not_walked"]


def test_crash_makes_new_context_marks_crashed_and_walk_continues():
    seen = []
    def run_one(l, ctx, dl):
        seen.append((l, ctx))
        if l == "b": raise L.PageCrash("Target crashed")
        return {"state": "DONE"}
    w, c, ctxs, _ = mk(["a", "b", "c"], run_one, shas=("S1",) * 20)
    s = w.run()
    assert s["lenses"]["b"]["state"] == "CRASHED" and s["lenses"]["a"]["state"] == "DONE" and s["lenses"]["c"]["state"] == "DONE"
    assert len(ctxs) == 2 and seen[2][1] is ctxs[1] and seen[0][1] is ctxs[0]      # c ran on the NEW context


def test_unexpected_exception_does_not_kill_walk():
    w, *_ = mk(["a", "b"], lambda l, ctx, dl: (_ for _ in ()).throw(ValueError("bug")) if l == "a" else {"state": "DONE"}, shas=("S1",) * 20)
    s = w.run()
    assert s["lenses"]["a"]["state"] == "CRASHED" and "ValueError" in s["lenses"]["a"]["reason"] and s["lenses"]["b"]["state"] == "DONE"


def test_navigation_retried_exactly_once():
    calls = {"n": 0}
    def flaky(l, ctx, dl):
        calls["n"] += 1
        if calls["n"] == 1: raise L.NavFlaky("net::ERR_TIMED_OUT")
        return {"state": "DONE"}
    w, *_ = mk(["a"], flaky, shas=("S1",) * 9)
    s = w.run()
    assert s["lenses"]["a"]["state"] == "DONE" and calls["n"] == 2
    calls["n"] = 0
    w, *_ = mk(["a"], lambda l, ctx, dl: (calls.__setitem__("n", calls["n"] + 1), (_ for _ in ()).throw(L.NavFlaky("x")))[1], shas=("S1",) * 9)
    s = w.run()
    assert s["lenses"]["a"]["state"] == "CRASHED" and calls["n"] == 2 and "twice" in s["lenses"]["a"]["reason"]


def test_rate_limit_backoff_bounded_exponential_and_retry_after():
    assert [L.backoff_delay(i) for i in range(6)] == [2, 4, 8, 16, 32, 60]
    assert L.backoff_delay(0, retry_after="7") == 7 and L.backoff_delay(0, retry_after=9999) == 60 and L.backoff_delay(1, retry_after="junk") == 4
    n = {"c": 0}
    def run_one(l, ctx, dl):
        n["c"] += 1
        if n["c"] <= 2: raise L.RateLimited(retry_after=5 if n["c"] == 1 else None)
        return {"state": "DONE"}
    w, c, *_ = mk(["a"], run_one, shas=("S1",) * 9)
    s = w.run()
    assert s["lenses"]["a"]["state"] == "DONE" and c.slept == [5, 4]
    w, c, *_ = mk(["a"], lambda l, ctx, dl: (_ for _ in ()).throw(L.RateLimited()), shas=("S1",) * 9, max_rate_attempts=3)
    s = w.run()
    assert s["lenses"]["a"]["state"] == "RATE_LIMITED" and c.slept == [2, 4]


def test_timeout_cooperative_and_post_hoc():
    def slow(l, ctx, dl):
        dl.clock.t += 500
        dl.check()
        return {"state": "DONE"}
    w, *_ = mk(["a", "b"], lambda l, ctx, dl: slow(l, ctx, dl) if l == "a" else {"state": "DONE"}, shas=("S1",) * 9, budget=100)
    s = w.run()
    assert s["lenses"]["a"]["state"] == "TIMEOUT" and s["lenses"]["b"]["state"] == "DONE"
    def late(l, ctx, dl):
        dl.clock.t += 500
        return {"state": "DONE"}                       # never calls check(): still not trusted
    w, *_ = mk(["a"], late, shas=("S1",) * 9, budget=100)
    assert w.run()["lenses"]["a"]["state"] == "TIMEOUT"


def test_deploy_detected_between_lenses_stops_and_walks_nothing_more():
    ran = []
    w, *_ = mk(["a", "b", "c"], lambda l, ctx, dl: ran.append(l) or {"state": "DONE"}, shas=("S1", "S1", "S1", "S2"))
    s = w.run()
    assert s["status"] == "STOPPED_DEPLOY" and ran == ["a"] and s["lenses"]["b"]["state"] == "DEPLOY_DETECTED" and "c" in s["not_walked"]


def test_deploy_mid_lens_discards_that_lens():
    ran = []
    w, *_ = mk(["a", "b"], lambda l, ctx, dl: ran.append(l) or {"state": "DONE"}, shas=("S1", "S1", "S2"))
    s = w.run()
    assert s["status"] == "STOPPED_DEPLOY" and s["lenses"]["a"]["state"] == "DEPLOY_DETECTED" and "discarded" in s["lenses"]["a"]["reason"] and ran == ["a"]


def test_unreadable_sha_fails_closed():
    w, *_ = mk(["a"], lambda l, ctx, dl: {"state": "DONE"}, shas=(None,))
    s = w.run()
    assert s["status"] == "STOPPED_UNVERIFIED" and s["lenses"] == {} and s["not_walked"] == ["a"]
    w, *_ = mk(["a", "b"], lambda l, ctx, dl: {"state": "DONE"}, shas=("S1", "S1", None, None, None, None))
    s = w.run()
    assert s["status"] == "STOPPED_UNVERIFIED" and "b" in s["not_walked"]


def test_unsafe_lens_is_skipped_never_walked():
    ran = []
    w, *_ = mk(["a", "admin"], lambda l, ctx, dl: ran.append(l) or {"state": "DONE"}, shas=("S1",) * 9, unsafe=lambda l: l == "admin")
    s = w.run()
    assert ran == ["a"] and s["lenses"]["admin"]["state"] == "SKIPPED_UNSAFE"


def test_resume_skips_finished_retries_failed_idempotent():
    rd = tempfile.mkdtemp()
    ran, crashed = [], {"b": True}
    def run_one(l, ctx, dl):
        ran.append(l)
        if l == "b" and crashed.pop("b", None): raise L.PageCrash("x")
        return {"state": "DONE"}
    w, *_ = mk(["a", "b", "c"], run_one, shas=("S1",) * 20, rd=rd)
    w.run()
    assert ran == ["a", "b", "c"]
    ran.clear()
    w2, *_ = mk(["a", "b", "c"], run_one, shas=("S1",) * 20, rd=rd)
    s = w2.run()
    assert ran == ["b"] and s["lenses"]["a"].get("resumed") and s["lenses"]["b"]["state"] == "DONE"        # only the CRASHED lens re-ran
    ran.clear()
    w3, *_ = mk(["a", "b", "c"], run_one, shas=("S1",) * 20, rd=rd)
    w3.run()
    assert ran == []                                                                                    # idempotent


def test_resume_on_a_different_build_refuses_to_mix():
    rd = tempfile.mkdtemp()
    w, *_ = mk(["a"], lambda l, ctx, dl: {"state": "DONE"}, shas=("S1",) * 9, rd=rd)
    w.run()
    ran = []
    w2, *_ = mk(["a", "b"], lambda l, ctx, dl: ran.append(l) or {"state": "DONE"}, shas=("S2",) * 9, rd=rd)
    s = w2.run()
    assert s["status"] == "STOPPED_DEPLOY" and ran == [] and "resume refused" in s["stop_reason"]


# ----------------------------------------------------------------- rewrite-marker migration (needs_human -> keep when the original now maps)
def test_rewrite_migration_converts_only_what_now_maps_and_is_idempotent():
    import importlib.util, types
    spec = importlib.util.spec_from_file_location("rmk", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools", "rewrite_migrate_keep.py"))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    t_ok = {"id": "T1", "lens": "a", "repro_steps": ["Tab x10, Esc"], "expected": "No new console errors"}
    t_bad = {"id": "T2", "lens": "a", "repro_steps": ["blue sky thinking about nothing"], "expected": "It feels smooth"}
    fold = types.SimpleNamespace(base={"T1": t_ok, "T2": t_bad})
    rec = lambda tid, c: {"ticket_id": tid, "lens": "a", "status": "rewritten", "steps": [{"from_orig": [0], "op": "needs_human_step", "src": "text", "why": "was unmappable"}],
                          "expected": [{"kind": "needs_human", "from_orig_clause": [0], "orig_span": c, "args": {}, "why": "no predicate"}]}
    d = tempfile.mkdtemp()
    with open(os.path.join(d, "batch-001.jsonl"), "w") as f:
        f.write(json.dumps(rec("T1", "No new console errors")) + "\n" + json.dumps(rec("T2", "It feels smooth")) + "\n")
    ch = m.migrate(fold, d)
    rows = [json.loads(l) for l in open(os.path.join(d, "batch-001.jsonl"))]
    assert sorted(set(ch)) == ["T1"]
    assert rows[0]["steps"][0]["op"] == "keep" and rows[0]["expected"][0]["kind"] == "keep" and "migrated_from" in rows[0]["steps"][0]
    assert rows[1]["steps"][0]["op"] == "needs_human_step" and rows[1]["expected"][0]["kind"] == "needs_human"     # still unmappable: untouched
    assert m.migrate(fold, d) == []                                                                              # idempotent
