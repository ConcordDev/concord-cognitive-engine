#!/usr/bin/env python3
"""ConKay engine kernel: energyplus (SXE-37).

Adapter over EnergyPlus (BSD-3-style licence; process-only —
the kernel drives the stock energyplus binary). The plan's
health case for this row is that the shipped example
1ZoneUncontrolled runs: COMPLETION class. The kernel runs the
example IDF from the provisioned install
(CONKAY_ENERGYPLUS_DIR, holding the binary, ExampleFiles/,
and WeatherData/) against the install's Chicago TMY3 weather
file on a scratch copy, and accepts when the run's own error
file reports "EnergyPlus Completed Successfully" and the
output data file carries a real time series.

Protocol: one JSON object on stdin {"op": ..., "request": {...}},
one JSON object on stdout. Exit codes: 2 = request out of
envelope, 3 = provisioning defect (install pieces absent),
6 = the engine ran but failed.
"""
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def run_case(request):
    idf_name = str(request.get("idfName", "1ZoneUncontrolled.idf"))
    if "/" in idf_name or ".." in idf_name or not idf_name.endswith(".idf"):
        fail(2, "idfName must be a bare .idf file name")
    root = os.environ.get("CONKAY_ENERGYPLUS_DIR", "")
    if not root:
        # Standard lane provisioning location.
        root = "/opt/concord-engines/energyplus"
    binary = os.path.join(root, "energyplus")
    idf_src = os.path.join(root, "ExampleFiles", idf_name)
    if not os.path.isfile(binary):
        fail(3, "energyplus install not provisioned "
                "(CONKAY_ENERGYPLUS_DIR with the energyplus "
                "binary); the lane installs the pinned release")
    if not os.path.isfile(idf_src):
        fail(3, "example IDF not found in the install: %s" % idf_name)
    epws = sorted(glob.glob(os.path.join(
        root, "WeatherData", "USA_IL_Chicago*.epw")))
    if not epws:
        fail(3, "Chicago TMY3 weather file not found in the "
                "install's WeatherData")
    work = tempfile.mkdtemp(prefix="conkay-energyplus-")
    try:
        out_dir = os.path.join(work, "out")
        os.makedirs(out_dir)
        idf_path = os.path.join(work, idf_name)
        shutil.copyfile(idf_src, idf_path)
        ran = subprocess.run(
            [binary, "-w", epws[0], "-d", out_dir, idf_path],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=1200)
        err_path = os.path.join(out_dir, "eplusout.err")
        eso_path = os.path.join(out_dir, "eplusout.eso")
        if not os.path.isfile(err_path):
            fail(6, "energyplus produced no error file (exit %s): %s"
                 % (ran.returncode,
                    ran.stdout.decode("utf-8", "replace")[-200:]))
        with open(err_path, errors="replace") as fh:
            err_text = fh.read()
        err_lines = err_text.count("\n") + 1
        eso_lines = 0
        if os.path.isfile(eso_path):
            with open(eso_path, errors="replace") as fh:
                eso_lines = sum(1 for _line in fh)
        completed = "EnergyPlus Completed Successfully" in err_text
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return {
        "errLines": err_lines,
        "esoLines": eso_lines,
        "converged": bool(completed and eso_lines > 100),
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
