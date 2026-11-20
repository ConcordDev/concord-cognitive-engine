#!/usr/bin/env python3
"""AERMOD kernel — SXE-35.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. The kernel drives the stock aermod
binary (US EPA public domain, separate process) on an embedded
minimal case: one elevated point source, flat terrain, a small
polar receptor grid, and one day of synthetic hourly meteorology
(.SFC/.PFL written by the kernel in AERMET format).

Health is a COMPLETION-class case, named as such in the engine
doc: AERMOD must complete the run and its output must carry a
finite, positive maximum 1-hour concentration. Value-vs-reference
is the stored-reference shape: the lane records the verified
maximum into CONKAY_AERMOD_REF_CONC and the kernel then enforces
a 10% band. No number is invented here.

Ops:
  health / plume — request {}
    -> {maxConcUgM3, converged} (+ reference/withinBand when set).

Missing aermod is a provisioning defect: exit 3. Output with no
parseable concentration table is rejected (exit 5).
"""
import json
import math
import os
import re
import shutil
import subprocess
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


RUNSTREAM = """CO STARTING
CO TITLEONE  ConKay AERMOD health case - single point source
CO MODELOPT  CONC FLAT
CO AVERTIME  1
CO POLLUTID  SO2
CO FLAGPOLE  0.0
CO RUNORNOT  RUN
CO FINISHED
SO STARTING
SO ELEVUNIT  METERS
SO LOCATION  SRC1 POINT 0.0 0.0 0.0
SO SRCPARAM  SRC1 %EMISSION% 30.0 300.0 5.0 3.0
SO SRCGROUP  ALL
SO FINISHED
RE STARTING
RE ELEVUNIT  METERS
RE POLRGRID  GRD1 STA
RE POLRGRID  GRD1 DIST 100.0 200.0 500.0
RE POLRGRID  GRD1 DDIR 0.0 45.0 90.0 135.0 180.0 225.0 270.0 315.0
RE POLRGRID  GRD1 END
RE FINISHED
ME STARTING
ME SURFFILE  health.sfc
ME PROFFILE  health.pfl
ME SURFDATA  99999 2025
ME UAIRDATA  99999 2025
ME STARTEND  2025 1 1 2025 1 1
ME FINISHED
OU STARTING
OU RECTABLE  ALLAVE FIRST
OU FINISHED
"""


def sfc_lines():
    lines = []
    for hour in range(1, 25):
        # year mo dy jday hr: sensible heat, u*, w*, theta grad,
        # PBL heights, L, z0, Bowen, albedo, wind spd/dir, ref
        # heights, temp, precip code/rate, RH, pressure, cloud.
        lines.append(
            "25 1 1 1 %2d  -10.0 0.300 0.500 0.005 0.010 500. 800. "
            "-50.0 0.10 1.00 1.00 3.00 180. 10.0 10.0 275.0 0 0.00 "
            "60. 1013. 5" % hour)
    return "\n".join(lines) + "\n"


def pfl_lines():
    lines = []
    for hour in range(1, 25):
        lines.append("25 1 1 %2d 1 10.0 0 3.00 180.0 275.0 0.5 274.0 0.5"
                     % hour)
    return "\n".join(lines) + "\n"


def run_plume(emission_rate=1.0):
    aermod = shutil.which("aermod")
    if not aermod:
        fail(3, "aermod executable not found on PATH (AERMOD is "
                "not provisioned for this engine env)")
    scratch = os.environ.get("CONKAY_ENGINE_SCRATCH") or os.getcwd()
    work = os.path.join(scratch, "aermod-health")
    os.makedirs(work, exist_ok=True)
    with open(os.path.join(work, "aermod.inp"), "w") as fh:
        fh.write(RUNSTREAM.replace("%EMISSION%",
                                   repr(float(emission_rate))))
    with open(os.path.join(work, "health.sfc"), "w") as fh:
        fh.write(sfc_lines())
    with open(os.path.join(work, "health.pfl"), "w") as fh:
        fh.write(pfl_lines())
    proc = subprocess.run([aermod], cwd=work, capture_output=True,
                          text=True, timeout=1800,
                          stdin=subprocess.DEVNULL)
    out_path = os.path.join(work, "aermod.out")
    text = ""
    if os.path.exists(out_path):
        with open(out_path, errors="replace") as fh:
            text = fh.read()
    combined = text + proc.stdout + proc.stderr
    if "AERMOD Finishes Successfully" not in combined \
            and proc.returncode != 0:
        fail(6, "aermod failed (exit %d)" % proc.returncode)
    values = [float(tok) for tok in
              re.findall(r"\b(\d+\.\d+E[+-]\d+)\b", text)]
    values = [v for v in values if math.isfinite(v) and v > 0]
    if not values:
        fail(5, "aermod output carried no concentration values "
                "(garbled output rejected)")
    max_conc = max(values)
    result = {"maxConcUgM3": max_conc, "converged": True}
    ref_raw = os.environ.get("CONKAY_AERMOD_REF_CONC")
    if ref_raw:
        reference = float(ref_raw)
        within = abs(max_conc - reference) / reference <= 0.10
        result.update({"reference": reference, "withinBand": within,
                       "converged": within})
    return result


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op == "health":
        result = run_plume()
    elif op == "plume":
        rate = request.get("emissionRate", 1.0)
        if not isinstance(rate, (int, float)) \
                or isinstance(rate, bool) or rate <= 0:
            fail(2, "emissionRate must be a positive number, "
                    "got %r" % (rate,))
        result = run_plume(float(rate))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
