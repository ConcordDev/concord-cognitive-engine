#!/usr/bin/env python3
"""Isolated WASM escape-test runner for Concord Option B. Exit 0 iff all 7 BLOCKED."""
from __future__ import annotations
import json, os, re, subprocess, sys, time
from pathlib import Path

DIR = Path(__file__).resolve().parent
ROOT = DIR.parent
LAUNCHER = ROOT / "run-wasm-sandbox.sh"
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/concord-wasm-escape-results.json")

os.environ["SECRET_PROBE"] = f"should-never-reach-guest-{os.getpid()}"
os.environ["CONCORD_POD_JOB_TOKEN"] = "fake-token-should-not-leak"
os.environ.setdefault("CONCORD_WASM_AUDIT", "/workspace/concord-pod/exec-audit-wasm-escape.jsonl")

TESTS = [
    (1, "read /etc/shadow", "01-read-shadow.wat", "deny",
     re.compile(r"OPEN_DENIED"), re.compile(r"OPEN_OK")),
    (2, "read secret env var", "02-read-env.wat", "deny",
     re.compile(r"ENV_CLEAN"), re.compile(r"ENV_LEAK")),
    (3, "reach the network", "03-network.wat", "nolink",
     re.compile(r"unknown import|failed to|link|incompatible import|not found", re.I),
     re.compile(r"NETWORK_REACHABLE")),
    (4, "fork bomb", "04-fork-bomb.wat", "nolink",
     re.compile(r"unknown import|failed to|link|incompatible import|not found", re.I),
     re.compile(r"FORK_OK")),
    (5, "write outside tmp", "05-write-outside.wat", "deny",
     re.compile(r"WRITE_OUTSIDE_DENIED"), re.compile(r"WRITE_OUTSIDE_OK")),
    (6, "read /workspace/concord-backups", "06-read-backups.wat", "deny",
     re.compile(r"BACKUP_READ_DENIED"), re.compile(r"BACKUP_READ_OK")),
    (7, "exceed wall-clock timeout", "07-timeout.wat", "timeout", None, None),
]

results = []
npass = nfail = 0

for tid, title, name, mode, good_re, bad_re in TESTS:
    wat = DIR / name
    env = os.environ.copy()
    t0 = time.time()
    p = subprocess.run(
        [str(LAUNCHER), "--timeout", "3", "--mem-mb", "64", "--", str(wat)],
        capture_output=True, text=True, env=env,
    )
    raw = p.stdout.strip().splitlines()
    payload = {}
    for line in reversed(raw):
        line=line.strip()
        if line.startswith("{"):
            try:
                payload = json.loads(line)
                break
            except json.JSONDecodeError:
                pass
    stdout = payload.get("stdout") or ""
    stderr = (payload.get("stderr") or "") + "\n" + (p.stderr or "")
    timed = bool(payload.get("timedOut")) or p.returncode in (124, 137)
    blob = stdout + "\n" + stderr

    blocked = False
    reason = ""
    if mode == "timeout":
        blocked = timed
        reason = "wall_clock_killed" if blocked else "loop_not_killed"
    elif mode == "nolink":
        if bad_re and bad_re.search(stdout):
            blocked, reason = False, "dangerous_import_worked"
        elif good_re and good_re.search(blob):
            blocked, reason = True, "import_not_provided"
        elif p.returncode != 0 and not (bad_re and bad_re.search(blob)):
            blocked, reason = True, "non_zero_exit"
        else:
            blocked, reason = False, "unexpected_success"
    else:  # deny — require explicit guest deny marker (weak silence is FAIL)
        if bad_re and bad_re.search(stdout):
            blocked, reason = False, "escape_signal_in_stdout"
        elif good_re and good_re.search(stdout):
            blocked, reason = True, "guest_reported_denied"
        elif re.search(r"failed to|unknown import|error", stderr, re.I) and not (bad_re and bad_re.search(blob)):
            blocked, reason = True, "runtime_rejected"
        else:
            blocked, reason = False, "no_explicit_deny_marker"

    # host-side check for write escape
    if tid == 5 and Path("/workspace/concord-wasm-escape-write").exists():
        blocked, reason = False, "host_file_created"

    status = "BLOCKED" if blocked else "NOT_BLOCKED"
    if blocked:
        npass += 1
        print(f"PASS  {tid} {title} ({reason})")
    else:
        nfail += 1
        print(f"FAIL  {tid} {title} ({reason})")
    results.append({
        "id": tid, "title": title, "result": status, "reason": reason,
        "exitCode": payload.get("exitCode", p.returncode),
        "timedOut": timed, "durationMs": int((time.time()-t0)*1000),
        "stdout_excerpt": stdout[:200], "stderr_excerpt": stderr[:300],
    })

doc = {
    "engine": "wasmtime",
    "mode": "option_B_wasi_lockdown",
    "pass": npass, "fail": nfail, "score": f"{npass}/7",
    "tests": results,
    "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
}
OUT.write_text(json.dumps(doc, indent=2))
print(f"SCORE {npass}/7  (fail={nfail}) -> {OUT}")
sys.exit(0 if nfail == 0 else 1)
