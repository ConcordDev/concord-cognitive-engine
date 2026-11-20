#!/usr/bin/env python3
"""SPECFEM kernel — SXE-35.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. The kernel drives a provisioned
SPECFEM2D build (GPL-3, separate process) on the example case the
lane names: CONKAY_SPECFEM_EXAMPLE points at an example directory
(as shipped in the SPECFEM2D examples tree, e.g. the Tape2007 or
homogeneous half-space case) whose DATA/Par_file the lane has
prepared, with the built binaries (xmeshfem2D, xspecfem2D) on
PATH or in the example's bin expectation.

Health is a COMPLETION-class case, named as such in the engine
doc: the mesher and solver must both complete and the solver's
seismogram output must hold finite, non-zero traces. There is no
honest closed form for a shipped heterogeneous example, and this
kernel invents none; the served values are the trace count and
the maximum absolute amplitude of the first trace.

Ops:
  health / example — request {}
    -> {traces, maxAmplitude, converged}.

Missing binaries or example is a provisioning defect: exit 3.
A run with no parseable seismogram is rejected (exit 5).
"""
import glob
import json
import math
import os
import shutil
import subprocess
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def run_example(timeout_s=3600):
    for tool in ("xmeshfem2D", "xspecfem2D"):
        if not shutil.which(tool):
            fail(3, "%s executable not found on PATH (SPECFEM2D "
                    "is not provisioned for this engine env)" % tool)
    example = os.environ.get("CONKAY_SPECFEM_EXAMPLE")
    if not example or not os.path.exists(
            os.path.join(example, "DATA", "Par_file")):
        fail(3, "CONKAY_SPECFEM_EXAMPLE=%r does not name a "
                "provisioned SPECFEM2D example with DATA/Par_file"
                % (example,))
    scratch = os.environ.get("CONKAY_ENGINE_SCRATCH") or os.getcwd()
    work = os.path.join(scratch, "specfem-example")
    if os.path.exists(work):
        shutil.rmtree(work)
    shutil.copytree(example, work)
    out_dir = os.path.join(work, "OUTPUT_FILES")
    os.makedirs(out_dir, exist_ok=True)
    mesh = subprocess.run(["xmeshfem2D"], cwd=work,
                          capture_output=True, text=True, timeout=1800)
    if mesh.returncode != 0:
        fail(6, "xmeshfem2D failed (exit %d)" % mesh.returncode)
    solve = subprocess.run(["xspecfem2D"], cwd=work,
                           capture_output=True, text=True,
                           timeout=int(timeout_s))
    if solve.returncode != 0:
        fail(6, "xspecfem2D failed (exit %d)" % solve.returncode)
    traces = sorted(glob.glob(os.path.join(out_dir, "*.sem*")) +
                    glob.glob(os.path.join(work, "**", "*.sem*"),
                              recursive=True))
    if not traces:
        fail(5, "SPECFEM run produced no seismogram files "
                "(garbled output rejected)")
    max_amp = 0.0
    with open(traces[0], errors="replace") as fh:
        for line in fh:
            parts = line.split()
            if len(parts) >= 2:
                try:
                    v = float(parts[1])
                except ValueError:
                    continue
                if math.isfinite(v):
                    max_amp = max(max_amp, abs(v))
    if max_amp <= 0:
        fail(5, "first seismogram trace is empty or zero "
                "(garbled output rejected)")
    return {"traces": len(traces), "maxAmplitude": max_amp,
            "converged": True}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op == "health":
        result = run_example()
    elif op == "example":
        timeout_s = request.get("timeoutS", 3600)
        if not isinstance(timeout_s, int) \
                or isinstance(timeout_s, bool) or timeout_s < 60:
            fail(2, "timeoutS must be an integer >= 60, got %r"
                    % (timeout_s,))
        result = run_example(timeout_s)
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
