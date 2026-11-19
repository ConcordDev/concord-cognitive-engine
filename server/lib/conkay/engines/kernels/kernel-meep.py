#!/usr/bin/env python3
"""Meep FDTD kernel — SXE-18 (Meep half).

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. Health case (the plan's): 1-D
Fabry-Perot transmission through a dielectric slab vs the
transfer-matrix result, both at normal incidence. The kernel runs
Meep (GPL-2, child process) with a broadband Gaussian pulse and
flux monitors, and computes the TMM spectrum independently in
numpy for the identical stack (air | slab n, thickness d | air);
agreement band 0.03 absolute in T at the sampled frequencies.

Ops:
  health / fabry-perot — request {slabIndex, slabThickness,
    resolution}; defaults n=1.5, d=0.5 (Meep units), res=50.

No meep in the driver env is a provisioning defect: exit 3
naming the import.
"""
import json
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def tmm_transmission(freqs, n_slab, d):
    import numpy as np
    out = []
    for f in freqs:
        lam = 1.0 / f
        k0 = 2.0 * np.pi / lam
        delta = n_slab * k0 * d
        m11 = np.cos(delta)
        m12 = 1j * np.sin(delta) / n_slab
        m21 = 1j * n_slab * np.sin(delta)
        m22 = np.cos(delta)
        t = 2.0 / (m11 + m12 + m21 + m22)
        out.append(abs(t) ** 2)
    return out


def run_fp(n_slab, d, resolution):
    try:
        import meep as mp
        import numpy as np
    except Exception as e:
        fail(3, "meep import failed (%s) - the meep driver env is "
                "not provisioned" % e)
    sx = 20.0
    cell = mp.Vector3(sx, 0, 0)
    pml = [mp.PML(2.0, direction=mp.X)]
    fcen, df = 0.30, 0.25
    source = [mp.Source(mp.GaussianSource(fcen, fwidth=df),
                        component=mp.Ez, center=mp.Vector3(-0.4 * sx, 0, 0))]
    geometry = [mp.Block(mp.Vector3(d, mp.inf, mp.inf),
                         center=mp.Vector3(0, 0, 0),
                         material=mp.Medium(index=n_slab))]
    sim = mp.Simulation(cell_size=cell, boundary_layers=pml,
                        geometry=geometry, sources=source,
                        resolution=resolution, dimensions=1)
    nfreq = 9
    tran = sim.add_flux(fcen, df, nfreq,
                        mp.FluxRegion(center=mp.Vector3(0.4 * sx, 0, 0)))
    sim.run(until_after_sources=mp.stop_when_fields_decayed(
        50, mp.Ez, mp.Vector3(0.4 * sx, 0, 0), 1e-4))
    t_slab = np.array(mp.get_fluxes(tran))
    freqs = np.array(mp.get_flux_freqs(tran))
    sim.reset_meep()
    sim2 = mp.Simulation(cell_size=cell, boundary_layers=pml,
                         geometry=[], sources=source,
                         resolution=resolution, dimensions=1)
    tran2 = sim2.add_flux(fcen, df, nfreq,
                          mp.FluxRegion(center=mp.Vector3(0.4 * sx, 0, 0)))
    sim2.run(until_after_sources=mp.stop_when_fields_decayed(
        50, mp.Ez, mp.Vector3(0.4 * sx, 0, 0), 1e-4))
    t_ref = np.array(mp.get_fluxes(tran2))
    t_meep = t_slab / t_ref
    t_tmm = tmm_transmission(freqs, n_slab, d)
    diffs = [abs(float(a) - float(b)) for a, b in zip(t_meep, t_tmm)]
    mid = len(diffs) // 2
    return {"tMeepMid": float(t_meep[mid]), "tTmmMid": float(t_tmm[mid]),
            "maxAbsDiff": max(diffs),
            "converged": max(diffs) < 0.03}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "fabry-perot"):
        n_slab = request.get("slabIndex", 1.5)
        d = request.get("slabThickness", 0.5)
        res = request.get("resolution", 50)
        for name, v in (("slabIndex", n_slab), ("slabThickness", d),
                        ("resolution", res)):
            if not isinstance(v, (int, float)) or isinstance(v, bool) or v <= 0:
                fail(2, "%s must be a positive number, got %r" % (name, v))
        result = run_fp(float(n_slab), float(d), int(res))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
