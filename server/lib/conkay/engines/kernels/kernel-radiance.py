#!/usr/bin/env python3
"""ConKay engine kernel: radiance (SXE-33).

Adapter over the Radiance ray-tracer (its own licence;
process-only). The kernel builds a one-object scene — a glow
sphere of known radiance — compiles it with oconv, and traces
a single ray into it with rtrace. A ray that strikes a glow
source returns exactly the source's radiance, so this is a
value check, not a completion check: the served radiance must
equal the scene's glow value.

Protocol: one JSON object on stdin {"op": ..., "request": {...}},
one JSON object on stdout. Exit codes: 2 = request out of
envelope, 3 = provisioning defect (binaries absent), 6 = the
engine ran but failed.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def trace(request):
    intensity = float(request.get("intensity", 1.0))
    if not (0.1 <= intensity <= 10.0):
        fail(2, "intensity out of envelope [0.1, 10]")
    oconv = shutil.which("oconv")
    rtrace = shutil.which("rtrace")
    if not oconv or not rtrace:
        fail(3, "radiance binaries (oconv/rtrace) not found on PATH")
    scene = (
        "void glow src\n0\n0\n3 {i} {i} {i}\n"
        "src sphere ball\n0\n0\n4 0 0 0 5\n"
    ).format(i=intensity)
    work = tempfile.mkdtemp(prefix="conkay-radiance-")
    try:
        rad_path = os.path.join(work, "scene.rad")
        oct_path = os.path.join(work, "scene.oct")
        with open(rad_path, "w") as fh:
            fh.write(scene)
        with open(oct_path, "wb") as fh:
            built = subprocess.run([oconv, rad_path],
                                   stdout=fh,
                                   stderr=subprocess.PIPE, timeout=120)
        if built.returncode != 0:
            fail(6, "oconv failed: %s"
                 % built.stderr.decode("utf-8", "replace")[:200])
        ray = "0 0 -20 0 0 1\n"
        traced = subprocess.run(
            [rtrace, "-h", "-ab", "0", oct_path],
            input=ray.encode(), stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, timeout=120)
        if traced.returncode != 0:
            fail(6, "rtrace failed: %s"
                 % traced.stderr.decode("utf-8", "replace")[:200])
        fields = traced.stdout.decode("utf-8", "replace").split()
        if len(fields) < 3:
            fail(6, "rtrace served no radiance triplet")
        try:
            rgb = [float(fields[0]), float(fields[1]), float(fields[2])]
        except ValueError:
            fail(6, "rtrace served non-numeric radiance")
    finally:
        shutil.rmtree(work, ignore_errors=True)
    value = sum(rgb) / 3.0
    rel = abs(value - intensity) / intensity
    return {
        "radiance": value,
        "expectedRadiance": intensity,
        "relError": rel,
        "converged": bool(rel <= 0.01),
    }


def main():
    try:
        spec = json.load(sys.stdin)
    except Exception:
        fail(2, "unparsable request")
    op = spec.get("op")
    request = spec.get("request") or {}
    if op == "health":
        result = trace({})
    elif op == "trace":
        result = trace(request)
    else:
        fail(2, "unknown op: %s" % op)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
