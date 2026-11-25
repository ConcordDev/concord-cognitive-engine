#!/usr/bin/env python3
"""WALK-04d offline selftest — no browser, no network, no live walker.

Builds a throwaway concord_walker package (pristine util + the slice's
vision.py) and exercises the vision judge with fake clients:

- disabled judge -> None (the pre-upgrade NEEDS_HUMAN path stands);
- confident match -> FIXED, confident mismatch -> STILL_FAILING, each with
  pair + confidence + model id + cap accounting and a ledger line;
- the SAME ticket flips STILL -> FIXED when the after-screenshot changes
  from defect-bearing to clean (the buggy/fixed pair);
- low confidence / UNCERTAIN -> NEEDS_HUMAN with a draft verdict attached;
- cap reached -> no further client calls, remaining rows Partial (HUMAN);
- judge client raising -> NEEDS_HUMAN, nothing escapes;
- no screenshot pair -> None and the client is never called;
- spot-check-demoted category -> NEEDS_HUMAN without a call;
- sampler determinism (same seed, same selection) and the >5%
  disagreement demotion rule;
- the package no-page-JS grep stays green over vision.py.
"""
import base64, json, os, re, shutil, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
WALKER = os.path.dirname(HERE)
sys.path.insert(0, WALKER)
from concord_walker.vision import (VisionJudge, sample_spotcheck,  # noqa: E402
                                   evaluate_spotcheck, wants_visual)

results = {}
tmp = tempfile.mkdtemp(prefix="walker-vision-selftest-")
audit = os.path.join(tmp, "audit")
os.makedirs(os.path.join(audit, "evidence"))
run_dir = os.path.join(tmp, "runs", "selftest")
os.makedirs(run_dir)


class FakeRec:
    rid = "selftest"
    run_dir = run_dir


def log(*a):
    pass


CFG = {"audit_dir": audit, "vision_judge": {"enabled": True, "model": "fake-vision-1",
                                            "cap_per_run": 300, "confidence_threshold": 0.8}}
TICKET = {"id": "FIX-demo-900", "lens": "demo", "title": "Header badge clipped at 390",
          "expected": "badge fully visible, no clipping", "actual": "badge cut off on the right",
          "status": "FIXED_PENDING_VERIFY"}


def pair_provider_factory(after_bytes):
    def provide(t):
        d = os.path.join(audit, "evidence", "demo", "walker-selftest")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "before.png"), "wb") as f:
            f.write(b"ARRIVAL")
        with open(os.path.join(d, "after.png"), "wb") as f:
            f.write(after_bytes)
        return ["evidence/demo/walker-selftest/before.png",
                "evidence/demo/walker-selftest/after.png"]
    return provide


CLEAN = pair_provider_factory(b"CLEAN")
DEFECT = pair_provider_factory(b"DEFECT still visible")


def match_client(images, prompt):
    return {"verdict": "MATCHES_EXPECTED", "confidence": 0.95, "rationale": "looks right", "model": "fake-vision-1"}


def defect_aware_client(images, prompt):
    after = base64.b64decode(images[1])
    if b"DEFECT" in after:
        return {"verdict": "DOES_NOT_MATCH", "confidence": 0.97, "rationale": "defect present", "model": "fake-vision-1"}
    return {"verdict": "MATCHES_EXPECTED", "confidence": 0.96, "rationale": "defect gone", "model": "fake-vision-1"}


def low_conf_client(images, prompt):
    return {"verdict": "MATCHES_EXPECTED", "confidence": 0.4, "rationale": "maybe", "model": "fake-vision-1"}


def uncertain_client(images, prompt):
    return {"verdict": "UNCERTAIN", "confidence": 0.9, "rationale": "cannot tell", "model": "fake-vision-1"}


def boom_client(images, prompt):
    raise RuntimeError("endpoint down")


# 1) disabled -> None (pristine parity)
cfg_off = {"audit_dir": audit, "vision_judge": {"enabled": False}}
j = VisionJudge(cfg_off, FakeRec(), log)
results["disabled_returns_none"] = j.judge_ticket(None, TICKET, "overflow390", pair_provider=CLEAN) is None

# 2) confident match -> FIXED with the full acceptance fields
j = VisionJudge(CFG, FakeRec(), log, client=match_client)
r = j.judge_ticket(None, TICKET, "overflow390", pair_provider=CLEAN)
results["confident_match_fixed"] = (r["verdict"] == "FIXED" and r["vision"]["confidence"] == 0.95
                                     and r["vision"]["model"] == "fake-vision-1" and len(r["evidence"]) == 2
                                     and j.accounting() == {"calls": 1, "cap": 300, "judged": 1,
                                                            "partial_due_to_cap": 0, "remaining": 299,
                                                            "queued_calls": 1, "retries": 0, "max_in_flight": 1})
ledger = [json.loads(l) for l in open(os.path.join(run_dir, "vision.jsonl"))]
results["ledger_line"] = (len(ledger) == 1 and ledger[0]["ticket_id"] == "FIX-demo-900"
                          and ledger[0]["verdict"] == "FIXED" and ledger[0]["pair"] == r["evidence"])

# 3) buggy/fixed pair: same ticket, defect after-shot -> STILL; clean -> FIXED
j = VisionJudge(CFG, FakeRec(), log, client=defect_aware_client)
r_bad = j.judge_ticket(None, TICKET, "overflow390", pair_provider=DEFECT)
r_good = j.judge_ticket(None, TICKET, "overflow390", pair_provider=CLEAN)
results["defect_pair_still"] = r_bad["verdict"] == "STILL_FAILING"
results["fixed_pair_fixed"] = r_good["verdict"] == "FIXED"

# 4) low confidence -> HUMAN with draft; UNCERTAIN -> HUMAN
j = VisionJudge(CFG, FakeRec(), log, client=low_conf_client)
r = j.judge_ticket(None, TICKET, "overflow390", pair_provider=CLEAN)
results["low_conf_human_with_draft"] = r["verdict"] == "NEEDS_HUMAN" and r["vision"]["draft_verdict"] == "FIXED"
j = VisionJudge(CFG, FakeRec(), log, client=uncertain_client)
r = j.judge_ticket(None, TICKET, "overflow390", pair_provider=CLEAN)
results["uncertain_human"] = r["verdict"] == "NEEDS_HUMAN" and r["vision"]["draft_verdict"] is None

# 5) cap: cap=1 -> second row Partial, client called exactly once
calls = {"n": 0}
def counting_client(images, prompt):
    calls["n"] += 1
    return match_client(images, prompt)
cfg_cap = {"audit_dir": audit, "vision_judge": {"enabled": True, "model": "fake-vision-1",
                                                "cap_per_run": 1, "confidence_threshold": 0.8}}
j = VisionJudge(cfg_cap, FakeRec(), log, client=counting_client)
r1 = j.judge_ticket(None, TICKET, "overflow390", pair_provider=CLEAN)
r2 = j.judge_ticket(None, dict(TICKET, id="FIX-demo-901"), "overflow390", pair_provider=CLEAN)
results["cap_stops_calls"] = (r1["verdict"] == "FIXED" and r2["verdict"] == "NEEDS_HUMAN"
                              and r2["vision"]["cap_reached"] is True and calls["n"] == 1
                              and len(r2["evidence"]) == 2 and j.accounting()["partial_due_to_cap"] == 1)

# 6) client raises -> HUMAN, nothing escapes, attempt counted
j = VisionJudge(CFG, FakeRec(), log, client=boom_client)
r = j.judge_ticket(None, TICKET, "overflow390", pair_provider=CLEAN)
results["client_error_human"] = r["verdict"] == "NEEDS_HUMAN" and j.accounting()["calls"] == 1

# 7) no pair -> None, client never called
calls["n"] = 0
j = VisionJudge(CFG, FakeRec(), log, client=counting_client)
r = j.judge_ticket(None, TICKET, "overflow390", pair_provider=lambda t: [None, None])
results["no_pair_no_call"] = r is None and calls["n"] == 0

# 8) demoted category -> HUMAN without a call
calls["n"] = 0
j = VisionJudge(CFG, FakeRec(), log, client=counting_client, demoted_categories={"overflow390"})
r = j.judge_ticket(None, TICKET, "overflow390", pair_provider=CLEAN)
results["demoted_category_human"] = r["verdict"] == "NEEDS_HUMAN" and calls["n"] == 0

# 9) sampler determinism + rate
ids = ["FIX-x-%03d" % i for i in range(200)]
s1 = sample_spotcheck(ids, rate=0.10, seed=1544)
s2 = sample_spotcheck(ids, rate=0.10, seed=1544)
s3 = sample_spotcheck(ids, rate=0.10, seed=99)
results["sampler_deterministic"] = s1 == s2 and len(s1) == 20 and s1 != s3

# 10) spot-check evaluation: 1/10 disagreements demotes; 0/20 does not
judged = [{"ticket_id": "t%d" % i, "category": "visual", "verdict": "FIXED"} for i in range(10)]
human = [{"ticket_id": "t%d" % i, "verdict": "FIXED"} for i in range(10)]
human[3]["verdict"] = "STILL_FAILING"
ev = evaluate_spotcheck(judged, human)
results["demote_above_5pct"] = ev["demoted_categories"] == ["visual"] and ev["per_category"]["visual"]["rate"] == 0.1
judged2 = [{"ticket_id": "u%d" % i, "category": "layout", "verdict": "FIXED"} for i in range(20)]
human2 = [{"ticket_id": "u%d" % i, "verdict": "FIXED"} for i in range(20)]
results["no_demote_when_agreeing"] = evaluate_spotcheck(judged2, human2)["demoted_categories"] == []

# 11) wants_visual routing words
results["wants_visual"] = wants_visual(TICKET) and not wants_visual(
    {"title": "Export button does nothing", "actual": "no file", "expected": "file downloads", "repro_steps": ""})

# 13) GB-1581 item 2: the queue serializes calls (one in flight) and retries once
import threading, time as _time
from concord_walker.vision import JudgeQueue, HttpVisionClient, rejudge_saved_pairs, load_saved_pairs

_inflight = {"now": 0, "max": 0}


def slow_client(images, prompt):
    _inflight["now"] += 1
    _inflight["max"] = max(_inflight["max"], _inflight["now"])
    _time.sleep(0.05)
    _inflight["now"] -= 1
    return {"verdict": "MATCHES_EXPECTED", "confidence": 0.9, "rationale": "ok", "model": "fake-vision-1"}


q = JudgeQueue()
threads = [threading.Thread(target=q.call, args=(slow_client, [], "p")) for _ in range(6)]
[t.start() for t in threads]
[t.join() for t in threads]
results["queue_one_in_flight"] = _inflight["max"] == 1 and q.max_in_flight == 1 and q.queued_calls == 6

_flaky = {"n": 0}


def flaky_client(images, prompt):
    _flaky["n"] += 1
    if _flaky["n"] == 1:
        raise TimeoutError("judge timed out")
    return {"verdict": "MATCHES_EXPECTED", "confidence": 0.95, "rationale": "second try", "model": "fake-vision-1"}


j = VisionJudge(CFG, FakeRec(), log, client=flaky_client)
r = j.judge_ticket(None, TICKET, "overflow390", pair_provider=CLEAN)
results["queue_retries_once"] = r["verdict"] == "FIXED" and j.queue.retries == 1 and _flaky["n"] == 2

j = VisionJudge(CFG, FakeRec(), log, client=boom_client)
r = j.judge_ticket(None, TICKET, "overflow390", pair_provider=CLEAN)
results["queue_retry_exhausted_is_human"] = r["verdict"] == "NEEDS_HUMAN" and j.queue.retries == 1

# 14) GB-1581 item 2: the judge timeout defaults to 180 s (client + config path)
results["timeout_default_180"] = HttpVisionClient("http://x", "k", "m").timeout_s == 180
cfg_url = {"audit_dir": audit, "vision_judge": {"enabled": True, "model": "fake-vision-1",
                                                "url": "http://127.0.0.1:9/v1", "api_key": "k"}}
j = VisionJudge(cfg_url, FakeRec(), log)
results["timeout_config_default_180"] = j.client is not None and j.client.timeout_s == 180

# 15) GB-1581 item 2: offline re-judge over a saved pair decides the waiting row
rj_dir = os.path.join(tmp, "runs", "rejudge")
os.makedirs(rj_dir)
pair = CLEAN(TICKET)
saved = [
    {"ticket_id": "FIX-demo-900", "lens": "demo", "category": "overflow390", "verdict": "NEEDS_HUMAN",
     "pair": pair, "note": "judge error: TimeoutError"},
    {"ticket_id": "FIX-demo-901", "lens": "demo", "category": "overflow390", "verdict": "FIXED",
     "pair": pair, "note": "decided"},
]
with open(os.path.join(rj_dir, "vision.jsonl"), "w") as f:
    for row in saved:
        f.write(json.dumps(row) + "\n")
results["saved_pairs_load"] = len(load_saved_pairs(rj_dir)) == 2
summary = rejudge_saved_pairs(CFG, rj_dir, {"FIX-demo-900": TICKET, "FIX-demo-901": dict(TICKET, id="FIX-demo-901")},
                              log, client=match_client)
results["rejudge_decides_waiting_row"] = (summary["rejudged"] == 1 and summary["verdicts"] == {"FIXED": 1}
                                           and summary["skipped_verdict"] == 1)
out_rows = [json.loads(l) for l in open(os.path.join(rj_dir, "vision-rejudge.jsonl"))]
results["rejudge_writes_outcomes"] = any(r.get("ticket_id") == "FIX-demo-900" and r.get("verdict") == "FIXED"
                                          and r.get("prior_vision_verdict") == "NEEDS_HUMAN" for r in out_rows)
results["rejudge_leaves_original_alone"] = len(open(os.path.join(rj_dir, "vision.jsonl")).readlines()) == 2

# 12) no page JS in vision.py (the package selftest grep)
banned = re.compile(r"\.(evaluate|evaluate_handle|locator|query_selector|query_selector_all|add_init_script|add_script_tag|expose_function|expose_binding|fill|get_by_\w+|wait_for_selector|wait_for_function|route)\(|Runtime\.evaluate|Runtime\.callFunctionOn")
src = open(os.path.join(WALKER, "concord_walker", "vision.py")).read()
results["no_page_js_calls"] = not banned.search(src)

ok = all(results.values())
print(json.dumps(results, indent=1))
print("VISION SELFTEST", "PASS" if ok else "FAIL", "(tmp:", tmp + ")")
sys.exit(0 if ok else 1)
