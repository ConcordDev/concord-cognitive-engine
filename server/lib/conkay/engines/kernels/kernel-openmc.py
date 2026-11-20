#!/usr/bin/env python3
"""OpenMC kernel — SXE-30.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. Health case (the plan's): the Godiva
bare sphere (HEU-MET-FAST-001 — a 93.7% enriched U-235 metal
sphere, radius 8.7407 cm) must come back critical: k_eff within
0.015 of 1.0, the ICSBEP benchmark value the case is defined by,
with the run's own statistics. The general op takes the batch /
particle counts by the same route (defaults are lane-sized:
20 batches x 2000 particles).

The ENDF/B-VIII.0 cross sections are environment data:
OPENMC_CROSS_SECTIONS must point at the provisioned library's
cross_sections.xml. Absent library is a provisioning defect:
exit 3 — the kernel never fabricates a k_eff.

Ops:
  health / godiva — request {batches, particles}
    -> {keff, keffStd, expectedKeff, converged}.

No openmc in the driver env is a provisioning defect: exit 3.
"""
import json
import os
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def run_godiva(batches, particles):
    try:
        import openmc
    except Exception as e:
        fail(3, "openmc import failed (%s) - the openmc driver "
                "env is not provisioned" % e)
    if not os.environ.get("OPENMC_CROSS_SECTIONS"):
        fail(3, "OPENMC_CROSS_SECTIONS is not set - the "
                "ENDF/B-VIII.0 library is not provisioned for "
                "this engine env")
    scratch = os.environ.get("CONKAY_ENGINE_SCRATCH") or os.getcwd()
    work = os.path.join(scratch, "openmc-godiva")
    os.makedirs(work, exist_ok=True)
    os.chdir(work)
    u235 = openmc.Material(name="HEU metal")
    u235.set_density("g/cm3", 18.74)
    u235.add_nuclide("U235", 0.9371, "ao")
    u235.add_nuclide("U238", 0.0527, "ao")
    u235.add_nuclide("U234", 0.0102, "ao")
    materials = openmc.Materials([u235])
    sphere = openmc.Sphere(r=8.7407, boundary_type="vacuum")
    cell = openmc.Cell(fill=u235, region=-sphere)
    geometry = openmc.Geometry([cell])
    settings = openmc.Settings()
    settings.batches = batches
    settings.inactive = 5
    settings.particles = particles
    settings.run_mode = "eigenvalue"
    settings.source = openmc.IndependentSource(
        space=openmc.stats.Point((0, 0, 0)))
    model = openmc.Model(geometry, materials, settings)
    statepoint_path = model.run()
    with openmc.StatePoint(statepoint_path) as sp:
        keff = sp.keff
    value = float(keff.nominal_value)
    std = float(keff.std_dev)
    ok = abs(value - 1.0) <= 0.015
    return {"keff": value, "keffStd": std, "expectedKeff": 1.0,
            "converged": ok}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "godiva"):
        batches = request.get("batches", 20)
        particles = request.get("particles", 2000)
        for name, val in (("batches", batches), ("particles", particles)):
            if not isinstance(val, int) or isinstance(val, bool) or val < 10:
                fail(2, "%s must be an integer >= 10, got %r" % (name, val))
        result = run_godiva(batches, particles)
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
