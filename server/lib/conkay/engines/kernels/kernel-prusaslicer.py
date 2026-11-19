#!/usr/bin/env python3
"""PrusaSlicer kernel — SXE-38 (slicers, PrusaSlicer half).

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. The kernel is a driver: it generates a
cube STL in the scratch dir, slices it with the PrusaSlicer CLI
(AGPL-3, UNMODIFIED, separate process — the manifest's F7 rule),
and parses the "; estimated printing time (normal mode) = ..."
footer from the G-code.

Ops:
  health / slice — request {sizeMm, layerHeightMm, infillPct};
    defaults a 20 mm cube, 0.2 mm layers, 20% infill.

Health semantics mirror the CuraEngine kernel: the print time is
served beside the stored reference (env
CONKAY_PRUSASLICER_REFERENCE_S, recorded by the CI lane's first
verified run); with no reference stored, referenceS/withinBand
are omitted and the run is a completion leg only. With a
reference, converged requires within ±10%.

Missing prusa-slicer binary is a provisioning defect: exit 3
naming it. G-code without a time footer is rejected (exit 5).
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


def parse_time_footer(text):
    m = re.search(r"estimated printing time \(normal mode\) = "
                  r"(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?", text)
    if not m or not any(m.groups()):
        return None
    h, mi, s = (int(g) if g else 0 for g in m.groups())
    return h * 3600 + mi * 60 + s


def run_slice(size_mm, layer_h, infill_pct):
    exe = shutil.which("prusa-slicer") or shutil.which("PrusaSlicer")
    if not exe:
        fail(3, "prusa-slicer executable not found on PATH "
                "(PrusaSlicer is not provisioned for this engine env)")
    scratch = os.environ.get("CONKAY_ENGINE_SCRATCH") or os.getcwd()
    work = os.path.join(scratch, "prusaslicer-slice")
    os.makedirs(work, exist_ok=True)
    stl = os.path.join(work, "cube.stl")
    with open(stl, "w") as fh:
        fh.write(cube_stl(size_mm))
    gcode = os.path.join(work, "cube.gcode")
    cmd = [exe, "--export-gcode", "--output", gcode,
           "--layer-height", "%r" % layer_h,
           "--fill-density", "%r%%" % infill_pct,
           "--perimeters", "2", stl]
    proc = subprocess.run(cmd, cwd=work, capture_output=True, text=True,
                          timeout=600)
    if proc.returncode != 0 or not os.path.exists(gcode):
        first = next((l.strip() for l in (proc.stderr or proc.stdout).splitlines()
                      if l.strip()), "prusa-slicer exited %d" % proc.returncode)
        fail(6, "prusa-slicer failed: %s" % first)
    with open(gcode, errors="replace") as fh:
        text = fh.read()
    time_s = parse_time_footer(text)
    if time_s is None:
        fail(5, "G-code carried no estimated-printing-time footer "
                "(garbled output rejected)")
    layers = text.count(";LAYER_CHANGE")
    ref_raw = os.environ.get("CONKAY_PRUSASLICER_REFERENCE_S")
    result = {"timeS": float(time_s), "layers": layers, "converged": True}
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
