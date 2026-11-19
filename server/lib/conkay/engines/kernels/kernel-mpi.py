#!/usr/bin/env python3
"""MPI lane kernel — SXE-39 (ConKay solver catalogue, Wave 2).

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. This kernel is the launcher lane every
parallel engine rides: it runs a small mpi4py worker under mpirun
and verifies the launcher honoured the requested rank count and
that the reduction is arithmetically exact before serving it.

Ops:
  health      — reduce-sum at np=2 (total must be exactly 3).
  reduce-sum  — request {np}: ranks 0..np-1 contribute (rank + 1);
                the MPI SUM reduction must equal np(np+1)/2 exactly.

Honesty discipline:
  - np above the manifest cap (8, the entry's footprint.threads)
    is refused before anything spawns (exit 2, cap named).
  - No mpirun on PATH is a provisioning defect, reported as a
    failure naming mpirun (exit 3) — never a fabricated result.
    (The engine_unavailable leg lives one level up: when the
    driver env itself is unprovisioned, the framework never
    spawns this kernel at all.)
  - A launcher that starts fewer ranks than requested, or a
    reduction that fails the closed-form check, is rejected
    (exits 4 / 5) — garbled parallel output is never served.
"""
import json
import os
import shutil
import subprocess
import sys

NP_CAP = 8  # mirrors the manifest entry's footprint.threads


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


WORKER = '''
import json
from mpi4py import MPI

comm = MPI.COMM_WORLD
rank = comm.Get_rank()
size = comm.Get_size()
total = comm.reduce(rank + 1, op=MPI.SUM, root=0)
if rank == 0:
    print(json.dumps({"size": size, "total": total}))
'''


def run_reduce(np_):
    mpirun = shutil.which("mpirun") or shutil.which("mpiexec")
    if not mpirun:
        fail(3, "mpirun executable not found on PATH "
                "(OpenMPI is not provisioned for this engine env)")
    scratch = os.environ.get("CONKAY_ENGINE_SCRATCH") or os.getcwd()
    worker_path = os.path.join(scratch, "mpi-reduce-worker.py")
    with open(worker_path, "w") as fh:
        fh.write(WORKER)
    cmd = [mpirun, "-np", str(np_), "--oversubscribe"]
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        cmd.append("--allow-run-as-root")
    cmd += [sys.executable, worker_path]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        first = next((l.strip() for l in proc.stderr.splitlines() if l.strip()),
                     "mpirun exited %d" % proc.returncode)
        fail(6, "mpirun failed: %s" % first)
    lines = [l for l in proc.stdout.splitlines() if l.strip().startswith("{")]
    if not lines:
        fail(5, "mpi worker produced no result line (garbled output rejected)")
    try:
        got = json.loads(lines[-1])
    except ValueError:
        fail(5, "mpi worker result was not valid JSON (garbled output rejected)")
    size, total = got.get("size"), got.get("total")
    if size != np_:
        fail(4, "launcher honoured np=%s of the requested np=%d "
                "(rank count mismatch)" % (size, np_))
    expected = np_ * (np_ + 1) // 2
    if total != expected:
        fail(5, "reduction integrity check failed: total %r != closed-form "
                "%d for np=%d" % (total, expected, np_))
    return {"np": size, "total": total, "expectedTotal": expected,
            "converged": True}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op == "health":
        result = run_reduce(2)
    elif op == "reduce-sum":
        np_ = request.get("np", 2)
        if not isinstance(np_, int) or isinstance(np_, bool) or np_ < 1:
            fail(2, "np must be a positive integer, got %r" % (np_,))
        if np_ > NP_CAP:
            fail(2, "np=%d exceeds the manifest cap of %d ranks "
                    "(SXE-39 lane cap)" % (np_, NP_CAP))
        result = run_reduce(np_)
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
