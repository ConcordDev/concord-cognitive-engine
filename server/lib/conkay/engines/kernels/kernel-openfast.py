#!/usr/bin/env python3
"""ConKay engine kernel: openfast (SXE-37).

Adapter over OpenFAST (Apache-2.0; process-only — the kernel
drives the stock openfast binary). COMPLETION class: the
kernel runs a provisioned OpenFAST case (the lane assembles
the r-test AWT_YFree_WTurb case into CONKAY_OPENFAST_CASE_DIR)
and reads the final time from the case's own output file.
Acceptance is completion: the run reaches at least 90% of the
deck's TMax with a finite output table. The `run` op may
shorten TMax on a scratch copy of the case.

Protocol: one JSON object on stdin {"op": ..., "request": {...}},
one JSON object on stdout. Exit codes: 2 = request out of
envelope, 3 = provisioning defect (binary or case absent),
6 = the engine ran but failed.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def deck_tmax(fst_path):
    with open(fst_path, errors="replace") as fh:
        for line in fh:
            if "TMax" in line:
                fields = line.split()
                try:
                    return float(fields[0])
                except (ValueError, IndexError):
                    continue
    return None


def run_case(request):
    tmax_req = request.get("tMaxS")
    if tmax_req is not None:
        tmax_req = float(tmax_req)
        if not (1.0 <= tmax_req <= 120.0):
            fail(2, "tMaxS out of envelope [1, 120]")
    binary = shutil.which("openfast")
    if not binary:
        fail(3, "openfast binary not found on PATH")
    case_dir = os.environ.get("CONKAY_OPENFAST_CASE_DIR", "")
    if not case_dir:
        # Standard lane provisioning location.
        case_dir = "/opt/concord-engines/openfast-case"
    if not os.path.isdir(case_dir):
        fail(3, "openfast case not provisioned "
                "(CONKAY_OPENFAST_CASE_DIR); the lane assembles "
                "the r-test case at install")
    fsts = [f for f in os.listdir(case_dir) if f.endswith(".fst")]
    if not fsts:
        fail(3, "no .fst deck in the provisioned case dir")
    work = tempfile.mkdtemp(prefix="conkay-openfast-")
    try:
        scratch = os.path.join(work, "case")
        shutil.copytree(case_dir, scratch)
        fst_name = sorted(fsts)[0]
        fst_path = os.path.join(scratch, fst_name)
        tmax = deck_tmax(fst_path)
        if tmax_req is not None:
            with open(fst_path, errors="replace") as fh:
                text = fh.read()
            text = re.sub(r"(?m)^(\s*)[0-9.]+(\s+TMax\b)",
                          lambda m: "%s%s%s" % (m.group(1), tmax_req,
                                                m.group(2)),
                          text, count=1)
            with open(fst_path, "w") as fh:
                fh.write(text)
            tmax = tmax_req
        if tmax is None:
            fail(6, "could not read TMax from the deck")
        ran = subprocess.run([binary, fst_name], cwd=scratch,
                             stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, timeout=1500)
        out_path = os.path.join(scratch,
                                fst_name[:-4] + ".out")
        if not os.path.isfile(out_path):
            fail(6, "openfast produced no output file (exit %s): %s"
                 % (ran.returncode,
                    ran.stdout.decode("utf-8", "replace")[-200:]))
        final_time = None
        with open(out_path, errors="replace") as fh:
            for line in fh:
                fields = line.split()
                if not fields:
                    continue
                try:
                    final_time = float(fields[0])
                except ValueError:
                    continue
        if final_time is None:
            fail(6, "openfast output carried no numeric rows")
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return {
        "finalTimeS": final_time,
        "deckTMaxS": tmax,
        "converged": bool(final_time >= 0.9 * tmax),
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
    elif op == "run":
        result = run_case(request)
    else:
        fail(2, "unknown op: %s" % op)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
