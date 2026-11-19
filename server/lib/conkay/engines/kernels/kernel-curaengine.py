#!/usr/bin/env python3
"""CuraEngine slicer kernel — SXE-38 (slicers, CuraEngine half).

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. The kernel is a driver: it generates a
cube STL in the scratch dir, slices it with `CuraEngine slice`
(AGPL-3, UNMODIFIED, separate process — the manifest's F7 rule),
and parses the ";TIME:<seconds>" header from the G-code.

Ops:
  health / slice — request {sizeMm, layerHeightMm, infillPct};
    defaults a 20 mm cube, 0.2 mm layers, 20% infill.

Health semantics (the plan's stored-reference shape): print time
is served beside the stored reference (env
CONKAY_CURAENGINE_REFERENCE_S, recorded by the CI lane's first
verified run). With no reference stored, referenceS/withinBand
are omitted and the run is a completion leg only — the kernel
never invents a reference. With a reference, converged requires
within ±10%.

Missing CuraEngine binary or the printer definition JSON is a
provisioning defect: exit 3 naming it. G-code without a TIME
header is rejected (exit 5), never guessed.
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


def cube_stl(size_mm):
    s = float(size_mm)
    tris = []
    v = [(0, 0, 0), (s, 0, 0), (s, s, 0), (0, s, 0),
         (0, 0, s), (s, 0, s), (s, s, s), (0, s, s)]
    faces = [(0, 3, 2), (0, 2, 1), (4, 5, 6), (4, 6, 7),
             (0, 1, 5), (0, 5, 4), (2, 3, 7), (2, 7, 6),
             (0, 4, 7), (0, 7, 3), (1, 2, 6), (1, 6, 5)]
    out = ["solid cube"]
    for a, b, c in faces:
        out.append("  facet normal 0 0 0")
        out.append("    outer loop")
        for i in (a, b, c):
            out.append("      vertex %r %r %r" % v[i])
        out.append("    endloop")
        out.append("  endfacet")
    out.append("endsolid cube")
    return "\n".join(out) + "\n"


def run_slice(size_mm, layer_h, infill_pct):
    exe = shutil.which("CuraEngine")
    if not exe:
        fail(3, "CuraEngine executable not found on PATH (CuraEngine "
                "is not provisioned for this engine env)")
    defjson = os.environ.get("CONKAY_CURAENGINE_DEFJSON")
    if not defjson or not os.path.exists(defjson):
        fail(3, "printer definition JSON not provisioned "
                "(CONKAY_CURAENGINE_DEFJSON=%r); CuraEngine cannot "
                "slice without its fdmprinter definition" % (defjson,))
    scratch = os.environ.get("CONKAY_ENGINE_SCRATCH") or os.getcwd()
    work = os.path.join(scratch, "curaengine-slice")
    os.makedirs(work, exist_ok=True)
    stl = os.path.join(work, "cube.stl")
    with open(stl, "w") as fh:
        fh.write(cube_stl(size_mm))
    gcode = os.path.join(work, "cube.gcode")
    cmd = [exe, "slice", "-j", defjson,
           "-s", "layer_height=%r" % layer_h,
           "-s", "infill_sparse_density=%r" % infill_pct,
           "-l", stl, "-o", gcode]
    proc = subprocess.run(cmd, cwd=work, capture_output=True, text=True,
                          timeout=600)
    if proc.returncode != 0 or not os.path.exists(gcode):
        first = next((l.strip() for l in (proc.stderr or proc.stdout).splitlines()
                      if l.strip()), "CuraEngine exited %d" % proc.returncode)
        fail(6, "CuraEngine failed: %s" % first)
    time_s, layers = None, 0
    with open(gcode, errors="replace") as fh:
        for line in fh:
            m = re.match(r";TIME:(\d+(?:\.\d+)?)", line)
            if m and time_s is None:
                time_s = float(m.group(1))
            if line.startswith(";LAYER:"):
                layers += 1
            if layers and time_s is not None and line.startswith("G1"):
                pass
    if time_s is None:
        fail(5, "G-code carried no ;TIME: header (garbled output rejected)")
    ref_raw = os.environ.get("CONKAY_CURAENGINE_REFERENCE_S")
    result = {"timeS": time_s, "layers": layers, "converged": True}
    if ref_raw:
        reference = float(ref_raw)
        within = abs(time_s - reference) / reference <= 0.10
        result.update({"referenceS": reference, "withinBand": within,
                       "converged": within})
    return result


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "slice"):
        size_mm = request.get("sizeMm", 20.0)
        layer_h = request.get("layerHeightMm", 0.2)
        infill = request.get("infillPct", 20.0)
        for name, v in (("sizeMm", size_mm), ("layerHeightMm", layer_h)):
            if not isinstance(v, (int, float)) or isinstance(v, bool) or v <= 0:
                fail(2, "%s must be a positive number, got %r" % (name, v))
        if not isinstance(infill, (int, float)) or isinstance(infill, bool) \
                or not (0 <= infill <= 100):
            fail(2, "infillPct must be a number in [0, 100], got %r" % (infill,))
        result = run_slice(float(size_mm), float(layer_h), float(infill))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
