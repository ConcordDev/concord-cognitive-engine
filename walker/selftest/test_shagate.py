#!/usr/bin/env python3
"""SHA-gate hardening selftests: no status row without a /health git sha that matches --expect-sha.
Pure python, no browser/network (fetch injected; CLI refusals via subprocess). Run: python3 selftest/test_shagate.py
"""
import json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
from concord_walker import sha_gate
from concord_walker.ledger import WalkerLedger, read_ledger

FAILS = []
SHA = "a" * 40


def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (" " + extra if extra and not cond else ""))
    if not cond:
        FAILS.append(name)


def pages(health=None, html=""):
    return lambda u: (json.dumps(health) if u.endswith("/health") else html) if (health is not None or not u.endswith("/health")) else (_ for _ in ()).throw(OSError("down"))


def test_gate_paths():
    g = sha_gate.gate(SHA, "https://x", fetch=pages({"buildSha": SHA}))
    check("match full sha passes", g["ok"] and g["live"] == SHA and g["source"] == "health", str(g))
    g = sha_gate.gate(SHA[:8], "https://x", fetch=pages({"buildSha": SHA}))
    check("expect prefix (>=7 hex) of live passes", g["ok"], str(g))
    g = sha_gate.gate(SHA, "https://x", fetch=pages({"buildSha": SHA[:8]}))
    check("live prefix of expect passes", g["ok"], str(g))
    g = sha_gate.gate("b" * 40, "https://x", fetch=pages({"buildSha": SHA}))
    check("mismatch => not ok (dry)", not g["ok"] and "dry" in g["reason"], str(g))
    g = sha_gate.gate(SHA, "https://x", fetch=pages({"ok": True}, '<script src="/_next/static/%s/c.js">' % SHA))
    check("/health missing sha => not ok even if HTML buildId equals expect", not g["ok"] and g["live"] is None, str(g))
    check("html build id reported as frontend_build", g["frontend_build"] == SHA, str(g))
    g = sha_gate.gate("next42", "https://x", fetch=pages({"ok": True}, '{"buildId":"next42"}'))
    check("non-hex expect equal to html buildId => not ok", not g["ok"], str(g))
    g = sha_gate.gate("next42", "https://x", fetch=pages({"buildSha": "next42"}))
    check("non-hex expect + non-hex health => not ok", not g["ok"], str(g))
    g = sha_gate.gate(SHA, "https://x", fetch=pages({"buildSha": "next42"}))
    check("non-hex /health value is ignored", not g["ok"] and g["live"] is None, str(g))
    g = sha_gate.gate(SHA, "https://x", fetch=lambda u: (_ for _ in ()).throw(OSError("down")))
    check("unreachable => not ok", not g["ok"], str(g))
    g = sha_gate.gate("abc12", "https://x", fetch=pages({"buildSha": "abc12" + "0" * 35}))
    check("expect shorter than 7 hex refused", not g["ok"], str(g))
    g = sha_gate.gate("", "https://x", fetch=pages({"buildSha": SHA}))
    check("empty expect => not ok (no more 'no --expect-sha given' pass)", not g["ok"], str(g))


def test_ledger_refuses_unconfirmed_sha():
    d = tempfile.mkdtemp()
    led = WalkerLedger(os.path.join(d, "walker.jsonl"), expect_sha=SHA)
    for bad in (None, "", "unknown", "next42"):
        try:
            led.write(tid="FIX-a-001", status="VERIFIED", live_sha=bad, run_id="r", recipe="m", result="FIXED", evidence_path="", account="t1")
            check("ledger refuses live_sha=%r" % (bad,), False)
        except ValueError:
            check("ledger refuses live_sha=%r" % (bad,), True)
    check("no rows written by refused writes", not os.path.exists(led.path) or read_ledger(led.path) == [])
    led.write(tid="FIX-a-001", status="VERIFIED", live_sha=SHA, run_id="r", recipe="per-ticket", result="FIXED", evidence_path="ev/a.png", account="t1")
    rows = read_ledger(led.path)
    check("confirmed sha => row carries the live sha", len(rows) == 1 and rows[0]["live_sha"] == SHA, str(rows))


def run_cli(*argv):
    p = subprocess.run([sys.executable, os.path.join(HERE, "walker.py")] + list(argv), capture_output=True, text=True, timeout=60)
    return p.returncode, p.stdout + p.stderr


def test_cli_refusals():
    rc, out = run_cli("reverify", "FIX-a-001", "--apply-status")
    check("--apply-status without --expect-sha exits non-zero", rc != 0 and "--expect-sha" in out, out[-300:])
    rc, out = run_cli("reverify", "FIX-a-001", "--apply-status", "--expect-sha", "next42")
    check("--apply-status with non-hex --expect-sha refused", rc != 0 and "hex" in out, out[-300:])
    rc, out = run_cli("reverify", "--from-ci", "--from-repo", ".", "--deploy-sha", "zzzzzzz", "--expect-sha", "zzzzzzz", "--ci-checks", "x.json")
    check("--from-ci with non-hex sha refused", rc != 0 and "hex" in out, out[-300:])
    rc, out = run_cli("reverify", "--from-ci", "--from-repo", ".", "--deploy-sha", SHA, "--ci-checks", "x.json")
    check("--from-ci without --expect-sha refused", rc != 0 and "--expect-sha" in out, out[-300:])


def test_no_unknown_fallback_in_source():
    src = open(os.path.join(HERE, "walker.py")).read()
    check('walker.py has no `or "unknown"` live_sha fallback', 'or "unknown"' not in src)
    check("walker.py has no deploy_sha fallback for live_sha", "live_sha=(live or" not in src)


if __name__ == "__main__":
    for fn in [v for k, v in sorted(globals().items()) if k.startswith("test_")]:
        fn()
    print("\n%d failure(s)" % len(FAILS))
    sys.exit(1 if FAILS else 0)
