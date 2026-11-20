#!/usr/bin/env python3
"""EPA SWMM kernel (via the stock binary) — SXE-35.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. The kernel drives the stock runswmm
binary (US EPA public domain, separate process) on an embedded
minimal network: one 1-hectare, 100%-impervious subcatchment with
zero depression storage draining to a free outfall, under a
25 mm / 1 h design storm. With no losses in the input, the
outfall volume must match the analytic rainfall volume
(0.025 m x 10,000 m^2 = 250 m^3) within 15% — the band covers
SWMM's runoff discretisation; the kernel computes the analytic
value itself. The volume is read from the report's Outfall
Loading Summary (10^6 ltr = 1000 m^3 units converted in-kernel).

Ops:
  health / runoff — request {rainMm} (default 25)
    -> {outfallVolumeM3, expectedVolumeM3, relError, converged}.

Missing runswmm is a provisioning defect: exit 3. A report with
no parseable outfall row is rejected (exit 5).
"""
import json
import os
import re
import shutil
import subprocess
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


INP = """[TITLE]
ConKay SWMM health case - single impervious catchment

[OPTIONS]
FLOW_UNITS           LPS
INFILTRATION         HORTON
FLOW_ROUTING         DYNWAVE
START_DATE           01/01/2025
START_TIME           00:00:00
END_DATE             01/01/2025
END_TIME             06:00:00
REPORT_STEP          00:05:00
WET_STEP             00:05:00
DRY_STEP             01:00:00
ROUTING_STEP         30

[RAINGAGES]
;;Name           Format    Interval SCF      Source
RG1              INTENSITY 1:00     1.0      TIMESERIES TS1

[SUBCATCHMENTS]
;;Name           RainGage         Outlet           Area     %Imperv  Width    %Slope   N-Imperv D-Imperv
S1               RG1              OUT1             1.0      100      100.0    0.5      0.011    0.0

[SUBAREAS]
;;Subcatchment   N-Imperv     N-Perv       S-Imperv     S-Perv       PctZero    RouteTo
S1               0.011        0.011        0.0          0.0          100        OUTLET

[OUTFALLS]
;;Name           Elevation  Type       Stage Data       Gated
OUT1             0.0        FREE                        NO

[TIMESERIES]
;;Name           Date       Time       Value
TS1                         00:00      %RAIN%
TS1                         01:00      %RAIN%
TS1                         02:00      0.0

[REPORT]
INPUT      NO
CONTROLS   NO
SUBCATCHMENTS ALL
NODES ALL
LINKS ALL
"""


def run_runoff(rain_mm):
    swmm = shutil.which("runswmm")
    if not swmm:
        fail(3, "runswmm executable not found on PATH (EPA SWMM "
                "is not provisioned for this engine env)")
    scratch = os.environ.get("CONKAY_ENGINE_SCRATCH") or os.getcwd()
    work = os.path.join(scratch, "swmm-health")
    os.makedirs(work, exist_ok=True)
    inp_path = os.path.join(work, "health.inp")
    rpt_path = os.path.join(work, "health.rpt")
    out_path = os.path.join(work, "health.out")
    with open(inp_path, "w") as fh:
        fh.write(INP.replace("%RAIN%", repr(float(rain_mm))))
    proc = subprocess.run([swmm, inp_path, rpt_path, out_path],
                          capture_output=True, text=True, timeout=900)
    if proc.returncode != 0 or not os.path.exists(rpt_path):
        fail(6, "runswmm failed (exit %d)" % proc.returncode)
    with open(rpt_path, errors="replace") as fh:
        report = fh.read()
    if "ERROR" in report:
        fail(6, "SWMM reported an ERROR in its report file")
    m = re.search(r"Outfall Loading Summary.*?OUT1\s+[\d.]+\s+[\d.]+\s+"
                  r"[\d.]+\s+(\d+\.\d+)", report, re.DOTALL)
    if not m:
        fail(5, "SWMM report carried no outfall loading row "
                "(garbled output rejected)")
    volume_m3 = float(m.group(1)) * 1000.0
    expected = rain_mm / 1000.0 * 10000.0
    rel = abs(volume_m3 - expected) / expected
    return {"outfallVolumeM3": volume_m3,
            "expectedVolumeM3": expected, "relError": rel,
            "converged": rel <= 0.15}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "runoff"):
        rain_mm = request.get("rainMm", 25.0)
        if not isinstance(rain_mm, (int, float)) \
                or isinstance(rain_mm, bool) or rain_mm <= 0:
            fail(2, "rainMm must be a positive number, got %r"
                    % (rain_mm,))
        result = run_runoff(float(rain_mm))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
