#!/usr/bin/env python3
"""OpenQuake kernel — SXE-35.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. OpenQuake is AGPL-3: the entry is
registered unmodified: true and the kernel only ever invokes the
stock `oq` CLI as a separate process.

Health case (the plan's "each engine's own first tutorial"
shape): the engine's shipped classical-hazard demo named by
CONKAY_OQ_DEMO (a directory holding job.ini — the lane provisions
the demos tree and names the smallest classical demo). The run
must complete through the oq engine and export a hazard-curves
CSV; the kernel serves the curve count and the maximum PoE.
Value-vs-reference is the stored-reference shape: the lane
records the verified max PoE into CONKAY_OQ_REF_POE and the
kernel then enforces a 10% band. No demo dir is a provisioning
defect: exit 3; no number is invented here.

Ops:
  health / hazard — request {}
    -> {curves, maxPoe, converged} (+ reference/withinBand when
       the env reference is set).

Missing oq is a provisioning defect: exit 3.
"""
import csv
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


def find_tool(name):
    """PATH first, then the sibling of the running interpreter —
    the SXE-00 env-provisioning shape: a tool installed into the
    kernel's own driver env (a pip/conda console entry point)
    sits beside its python even when the ambient PATH does not
    carry the env's bin (first-live correction, 2026-11-19)."""
    exe = shutil.which(name)
    if exe:
        return exe
    sibling = os.path.join(
        os.path.dirname(os.path.abspath(sys.executable)), name)
    if os.path.isfile(sibling) and os.access(sibling, os.X_OK):
        return sibling
    return None


def run_hazard(job_ini="job.ini"):
    oq = find_tool("oq")
    if not oq:
        fail(3, "oq executable not found on PATH (OpenQuake is "
                "not provisioned for this engine env)")
    demo = os.environ.get("CONKAY_OQ_DEMO")
    if not demo or not os.path.exists(os.path.join(demo, job_ini)):
        fail(3, "CONKAY_OQ_DEMO=%r does not name a provisioned "
                "OpenQuake demo directory holding %s" % (demo, job_ini))
    scratch = os.environ.get("CONKAY_ENGINE_SCRATCH") or os.getcwd()
    work = os.path.join(scratch, "oq-hazard")
    os.makedirs(work, exist_ok=True)
    run = subprocess.run([oq, "engine", "--run",
                          os.path.join(demo, job_ini)],
                         cwd=work, capture_output=True, text=True,
                         timeout=3600)
    if run.returncode != 0:
        fail(6, "oq engine --run failed (exit %d)" % run.returncode)
    ls = subprocess.run([oq, "engine", "--list-outputs"],
                        cwd=work, capture_output=True, text=True,
                        timeout=300)
    calc_ids = [tok for tok in ls.stdout.split() if tok.isdigit()]
    if not calc_ids:
        fail(5, "oq listed no completed calculation (garbled "
                "output rejected)")
    calc_id = calc_ids[-1]
    exp = subprocess.run([oq, "engine", "--export-outputs",
                          calc_id, work],
                         cwd=work, capture_output=True, text=True,
                         timeout=600)
    if exp.returncode != 0:
        fail(6, "oq export failed (exit %d)" % exp.returncode)
    curve_files = glob.glob(os.path.join(work, "**", "hazard_curve*.csv"),
                            recursive=True) + \
        glob.glob(os.path.join(work, "**", "hcurves*.csv"), recursive=True)
    if not curve_files:
        fail(5, "oq export carried no hazard curve CSV (garbled "
                "output rejected)")
    poes = []
    with open(curve_files[0], newline="") as fh:
        for row in csv.reader(fh):
            for tok in row:
                try:
                    v = float(tok)
                except ValueError:
                    continue
                if 0.0 < v <= 1.0:
                    poes.append(v)
    if not poes:
        fail(5, "hazard curve CSV carried no PoE values (garbled "
                "output rejected)")
    max_poe = max(poes)
    if not math.isfinite(max_poe):
        fail(5, "hazard curve served a non-finite PoE (rejected)")
    result = {"curves": len(curve_files), "maxPoe": max_poe,
              "converged": True}
    ref_raw = os.environ.get("CONKAY_OQ_REF_POE")
    if ref_raw:
        reference = float(ref_raw)
        within = abs(max_poe - reference) / reference <= 0.10
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
        result = run_hazard()
    elif op == "hazard":
        job_ini = request.get("jobIni", "job.ini")
        if not isinstance(job_ini, str) or not job_ini \
                or os.path.basename(job_ini) != job_ini:
            fail(2, "jobIni must be a bare filename inside the "
                    "demo directory, got %r" % (job_ini,))
        result = run_hazard(job_ini)
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
