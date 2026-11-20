#!/usr/bin/env python3
"""ConKay engine kernel: gmat (SXE-36).

Adapter over NASA's GMAT (Apache-2.0; process-only — the
kernel drives the stock GmatConsole binary). COMPLETION
class: the kernel runs a minimal mission script (Keplerian
spacecraft, SMA 7000 km, propagated 600 s) provisioned by the
lane in CONKAY_GMAT_CASE_DIR, and reads the final state from
the script's own report file. Acceptance is completion plus
the physical envelope: the reported final radius must sit
inside the orbit the script defines ([6000, 8000] km). GMAT's
script dialect is version-sensitive; the lane pins the GMAT
release and the script is verified at first dispatch (named
in the engine doc).

Protocol: one JSON object on stdin {"op": ..., "request": {...}},
one JSON object on stdout. Exit codes: 2 = request out of
envelope, 3 = provisioning defect (binary or case absent),
6 = the engine ran but failed.
"""
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def run_case(request):
    secs = float(request.get("propagateSecs", 600.0))
    if not (60.0 <= secs <= 3600.0):
        fail(2, "propagateSecs out of envelope [60, 3600]")
    binary = shutil.which("GmatConsole") or shutil.which("gmat")
    if not binary:
        fail(3, "gmat console binary (GmatConsole) not found on PATH")
    case_dir = os.environ.get("CONKAY_GMAT_CASE_DIR", "")
    if not case_dir:
        # Standard lane provisioning location.
        case_dir = "/opt/concord-engines/gmat-case"
    script = os.path.join(case_dir, "health.script")
    if not os.path.isfile(script):
        fail(3, "gmat case not provisioned (CONKAY_GMAT_CASE_DIR "
                "with health.script); the lane assembles it at "
                "install")
    # Run from a scratch copy so the requested propagation span
    # can be substituted into the script's ElapsedSecs and the
    # provisioned case is never mutated.
    work = tempfile.mkdtemp(prefix="conkay-gmat-")
    try:
        with open(script, errors="replace") as fh:
            text = fh.read()
        text = re.sub(r"ElapsedSecs\s*=\s*[0-9.]+",
                      "ElapsedSecs = %s" % secs, text, count=1)
        local_script = os.path.join(work, "health.script")
        with open(local_script, "w") as fh:
            fh.write(text)
        report = os.path.join(work, "health_out.txt")
        try:
            ran = subprocess.run([binary, "-r", local_script],
                                 cwd=work, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, timeout=600)
        except subprocess.TimeoutExpired:
            fail(6, "gmat run timed out")
        if not os.path.isfile(report):
            fail(6, "gmat produced no report file (exit %s): %s"
                 % (ran.returncode,
                    ran.stdout.decode("utf-8", "replace")[-200:]))
        rows = []
        with open(report) as fh:
            for line in fh:
                fields = line.replace(",", " ").split()
                try:
                    rows.append([float(f) for f in fields])
                except ValueError:
                    continue
    finally:
        shutil.rmtree(work, ignore_errors=True)
    if not rows or len(rows[-1]) < 3:
        fail(6, "gmat report carried no numeric state rows")
    x, y, z = rows[-1][0], rows[-1][1], rows[-1][2]
    radius = math.sqrt(x * x + y * y + z * z)
    return {
        "finalXKm": x,
        "finalYKm": y,
        "finalZKm": z,
        "radiusKm": radius,
        "converged": bool(6000.0 <= radius <= 8000.0),
    }


def main():
    try:
        spec = json.load(sys.stdin)
    except Exception:
        fail(2, "unparsable request")
    op = spec.get("op")
    request = spec.get("request") or {}
    if op == "health":
        result = run_case({})
    elif op == "propagate":
        result = run_case(request)
    else:
        fail(2, "unknown op: %s" % op)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
