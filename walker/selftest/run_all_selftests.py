#!/usr/bin/env python3
"""D3 / U18 selftest alignment: ONE aggregator for the whole walker selftest estate.

Runs every selftest/test_*.py and selftest/run_*.py (except this file) as its own
subprocess from the walker/ directory, with a per-file timeout, and prints one
common result line per file plus a single PASS/FAIL roll-up. Exit 0 only when
every file exits 0. Writes selftest-results.json (name, rc, seconds, kind, tail)
to --out (default: ./selftest-results.json).

Kinds: "browser" = uses Playwright / a fixture app (playwright in name, a run_*
runner, or imports sync_playwright); "unit" = browser-free.
"""
import argparse, json, os, subprocess, sys, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
WALKER = HERE.parent

def kind_of(p: Path) -> str:
    if "playwright" in p.name or p.name.startswith("run_"):
        return "browser"
    try:
        return "browser" if "sync_playwright" in p.read_text(errors="ignore") else "unit"
    except Exception:
        return "unit"

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--timeout", type=int, default=600)
    ap.add_argument("--only-kind", choices=["unit", "browser"])
    ap.add_argument("--out", default="selftest-results.json")
    ap.add_argument("--logs", default=None, help="dir for per-file logs")
    a = ap.parse_args()
    files = sorted(p for p in HERE.glob("test_*.py")) + sorted(
        p for p in HERE.glob("run_*.py") if p.name != Path(__file__).name)
    logs = Path(a.logs) if a.logs else None
    if logs: logs.mkdir(parents=True, exist_ok=True)
    rows, fails = [], 0
    for p in files:
        k = kind_of(p)
        if a.only_kind and k != a.only_kind:
            continue
        t0 = time.time()
        try:
            src = p.read_text(errors="ignore")
            cmd = ([sys.executable, "-m", "pytest", "-q", str(p)] if "import pytest" in src
                   else [sys.executable, str(p)] + ([str(WALKER)] if "sys.argv[1]" in src else []))
            r = subprocess.run(cmd, cwd=str(WALKER), capture_output=True,
                               text=True, timeout=a.timeout, env={**os.environ, "PYTHONPATH": str(WALKER)})
            rc, out = r.returncode, (r.stdout or "") + (r.stderr or "")
        except subprocess.TimeoutExpired as e:
            rc, out = 124, f"TIMEOUT after {a.timeout}s\n" + str(e.stdout or "")
        dt = round(time.time() - t0, 1)
        if logs: (logs / f"{p.stem}.log").write_text(out)
        tail = "\n".join(out.strip().splitlines()[-3:])
        ok = rc == 0
        fails += 0 if ok else 1
        rows.append({"name": p.stem, "kind": k, "rc": rc, "seconds": dt, "ok": ok, "tail": tail})
        print(f"{'PASS' if ok else 'FAIL'} {k:7s} {p.stem} rc={rc} {dt}s", flush=True)
    Path(a.out).write_text(json.dumps({"total": len(rows), "failed": fails, "rows": rows}, indent=1))
    print(f"SELFTEST ESTATE: {len(rows) - fails}/{len(rows)} files PASS, {fails} FAIL -> {'PASS' if fails == 0 else 'FAIL'}")
    return 0 if fails == 0 else 1

if __name__ == "__main__":
    sys.exit(main())
