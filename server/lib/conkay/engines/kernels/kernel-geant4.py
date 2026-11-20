#!/usr/bin/env python3
"""Geant4 kernel — SXE-30 (reduced library leg).

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. Geant4 ships no scriptable binary: the
lane builds the toolkit's own basic example B1 (the canonical
first example) against the reduced library and provisions the
resulting binary at CONKAY_GEANT4_B1. The kernel runs B1 with its
shipped macro (run2.mac shape: 1000 events of 6 MeV gammas into
the two-volume geometry) and parses the cumulated dose B1 prints
for its scoring volume.

Value-vs-reference (the stored-reference shape, as with Elmer):
the dose depends on the exact library build, so the lane records
the verified value into CONKAY_GEANT4_REF_DOSE on its first
verified run and the kernel then enforces a 10% band. Without a
stored reference the run is a completion leg; no number is
invented here.

Ops:
  health / b1 — request {}
    -> {doseMicroGy, converged} (+ reference/withinBand when set).

No provisioned B1 binary is a provisioning defect: exit 3.
Output with no parseable dose line is rejected (exit 5).
"""
import json
import math
import os
import re
import subprocess
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


MACRO = """/run/initialize
/gun/particle gamma
/gun/energy 6 MeV
/run/beamOn %EVENTS%
"""


def run_b1(events=1000):
    binary = os.environ.get("CONKAY_GEANT4_B1")
    if not binary or not os.path.exists(binary):
        fail(3, "CONKAY_GEANT4_B1=%r does not name a provisioned "
                "exampleB1 binary (the Geant4 reduced-library "
                "build is not provisioned for this engine env)"
                % (binary,))
    scratch = os.environ.get("CONKAY_ENGINE_SCRATCH") or os.getcwd()
    work = os.path.join(scratch, "geant4-b1")
    os.makedirs(work, exist_ok=True)
    macro_path = os.path.join(work, "conkay.mac")
    with open(macro_path, "w") as fh:
        fh.write(MACRO.replace("%EVENTS%", str(int(events))))
    proc = subprocess.run([binary, macro_path], cwd=work,
                          capture_output=True, text=True, timeout=1800)
    out = proc.stdout + proc.stderr
    if proc.returncode != 0:
        fail(6, "exampleB1 failed (exit %d)" % proc.returncode)
    m = re.findall(r"Cumulated dose per run, in scoring volume:\s*"
                   r"(-?\d+(?:\.\d+)?(?:[Ee][-+]?\d+)?)\s*microGy", out)
    if not m:
        fail(5, "exampleB1 output carried no cumulated dose line "
                "(garbled output rejected)")
    dose = float(m[-1])
    if not math.isfinite(dose) or dose <= 0:
        fail(5, "exampleB1 served a non-positive dose (rejected)")
    result = {"doseMicroGy": dose, "converged": True}
    ref_raw = os.environ.get("CONKAY_GEANT4_REF_DOSE")
    if ref_raw:
        reference = float(ref_raw)
        within = abs(dose - reference) / reference <= 0.10
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
        result = run_b1()
    elif op == "b1":
        events = request.get("events", 1000)
        if not isinstance(events, int) or isinstance(events, bool) \
                or events < 1:
            fail(2, "events must be a positive integer, got %r"
                    % (events,))
        result = run_b1(events)
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
