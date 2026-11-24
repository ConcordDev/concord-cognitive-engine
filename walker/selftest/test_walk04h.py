#!/usr/bin/env python3
"""WALK-04h selftest (offline, no browser): chat/LLM checks with send budget.
    python3 test_walk04h.py [tree_root]
PASS on the built tree; the WALK-04h cases FAIL on the pristine tree.
"""
import os, sys
ROOT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
RESULTS = []


def case(name, fn):
    try:
        ok, detail = fn()
    except Exception as e:
        ok, detail = False, "%s: %s" % (type(e).__name__, e)
    RESULTS.append((name, ok))
    print("%s %s — %s" % ("PASS" if ok else "FAIL", name, detail))


from concord_walker import reverify as rv
try:
    from concord_walker import chatcheck as cc
except Exception:
    cc = None


def T(title, actual="", expected="", repro=None):
    return {"title": title, "actual": actual, "expected": expected, "repro_steps": repro or []}


case("classify: canned-reply ticket -> chat",
     lambda: (rv.classify(T("Assistant gives the same canned reply to every question")) == "chat",
              "got %r" % rv.classify(T("Assistant gives the same canned reply to every question"))))
case("classify: chat words do not steal an export ticket",
     lambda: (rv.classify(T("Chat export downloads nothing")) == "export",
              "got %r" % rv.classify(T("Chat export downloads nothing"))))
case("classify: chat is a write category (send gate)",
     lambda: ("chat" in rv.WRITE_CATS, "WRITE_CATS=%r" % (rv.WRITE_CATS,)))


def _budget():
    if cc is None:
        return False, "chatcheck absent"
    b = cc.SendBudget({})
    ok = all(b.allow("chat") for _ in range(0))
    for _ in range(20):
        if not b.allow("chat"):
            ok = False
        b.spend("chat")
    stopped = not b.allow("chat")
    p = cc.SendBudget({})
    for _ in range(5):
        p.spend("psyops")
    pcapped = not p.allow("psyops") and p.cap("psyops") == 5 and p.cap("chat") == 20
    iso = cc.SendBudget({})
    iso.spend("lens-a", 20)
    isolated = not iso.allow("lens-a") and iso.allow("lens-b")
    cfgd = cc.SendBudget({"chat_budgets": {"chat": 3}})
    custom = cfgd.cap("chat") == 3
    return (ok and stopped and pcapped and isolated and custom,
            "cap20-stop=%r psyops5=%r isolation=%r cfg-override=%r" % (stopped, pcapped, isolated, custom))
case("SendBudget: caps enforced, per-lens isolation, cfg override", _budget)


def _assess():
    if cc is None:
        return False, "chatcheck absent"
    fixed, _ = cc.assess(["42", "Mars"], [])
    canned, _ = cc.assess(["I am happy to help with that.", "I am happy to help with that."], [])
    herr, _ = cc.assess(["handler_error: brain unreachable", "Mars"], [])
    noreply, _ = cc.assess([None, "Mars"], [])
    exhausted, _ = cc.assess([], [], budget_exhausted=True)
    missing, _ = cc.assess([], [], composer_missing=True)
    fivexx, _ = cc.assess(["42"], [], http_5xx=True)
    toolmiss, _ = cc.assess(["42", "Mars"], [], tool_expected=True, tool_seen=False)
    toolok, _ = cc.assess(["42", "Mars"], [], tool_expected=True, tool_seen=True)
    got = (fixed, canned, herr, noreply, exhausted, missing, fivexx, toolmiss, toolok)
    want = (cc.FIXED, cc.STILL, cc.STILL, cc.STILL, cc.HUMAN, cc.HUMAN, cc.HUMAN, cc.STILL, cc.FIXED)
    return (got == want, "verdicts=%r" % (got,))
case("assess: fixed / canned / handler_error / no-reply / budget / composer / 5xx / tool-surface", _assess)


def _pick():
    if cc is None:
        return False, "chatcheck absent"
    before = ["Welcome to the lens", "[label-1] What is 17 + 25? Answer with just the number."]
    after = before + ["42"]
    hit = cc.pick_reply(before, after, "[label-1] What is 17 + 25? Answer with just the number.")
    none = cc.pick_reply(before, before, "anything")
    return (hit == "42" and none is None, "hit=%r none=%r" % (hit, none))
case("pick_reply: new non-prompt text is the reply; no change -> None", _pick)


def _scope():
    if cc is None:
        return False, "chatcheck absent"
    admin = ["admin", "debug", "psyops", "ops"]
    cases = [
        (cc.scope_check("psyops", "t1", admin) is not None, "psyops under t1 refused"),
        (cc.scope_check("psyops", "t2", admin) is not None, "psyops under t2 refused"),
        (cc.scope_check("psyops", "admin", admin) is None, "psyops under admin proceeds"),
        (cc.scope_check("debug", "admin", admin) is not None, "other admin lenses stay refused"),
        (cc.scope_check("chat", "t1", admin) is None, "normal lens under t1 proceeds"),
        (cc.SendBudget({}).cap("psyops") == 5, "psyops cap is 5 on the admin lane too"),
    ]
    bad = [d for ok, d in cases if not ok]
    return (not bad, "; ".join(d for _, d in cases) if not bad else "FAILED: " + "; ".join(bad))
case("scope_check: psyops is account-shaped (admin only), other admin lenses refused", _scope)


def _no_page_js():
    import re as _re
    if cc is None:
        return False, "chatcheck absent"
    banned = _re.compile(r"\.(evaluate|evaluate_handle|locator|query_selector|query_selector_all|add_init_script|add_script_tag|expose_function|expose_binding|fill|get_by_\w+|wait_for_selector|wait_for_function|route)\(|Runtime\.evaluate|Runtime\.callFunctionOn")
    src = open(os.path.join(ROOT, "concord_walker", "chatcheck.py")).read()
    return (not banned.search(src), "banned-call search clean")
case("chatcheck: no page-JS calls", _no_page_js)

fails = [r for r in RESULTS if not r[1]]
print("\nWALK-04h SELFTEST: %d/%d pass%s" % (len(RESULTS) - len(fails), len(RESULTS),
      (" — FAILURES: " + ", ".join(r[0] for r in fails)) if fails else ""))
sys.exit(1 if fails else 0)
