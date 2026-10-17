# server/lib/conkay/em/meep_kernel.py
#
# The FDTD electromagnetics kernel on MIT Meep: one JSON request on stdin, one
# JSON result on stdout (the cad/*.py protocol; run through
# cad/kernel-queue.js runPythonKernel, so it is a child process and never
# blocks the event loop).
#
# op "stack1d": normal-incidence reflectance R(f) and transmittance T(f) of a
# 1-D layer stack between two half-spaces, Meep units (length a, frequency
# c/a). Two runs, as in the Meep tutorials: a normalisation run in the
# incident medium alone (incident flux, and the incident fields that are
# subtracted from the reflection monitor), then the structure run.
#
#   request = {
#     op: "stack1d",
#     nIncident: 1,            # half-space the source sits in
#     layers: [{ n, thickness }],  # left to right, starting at z = 0
#     nSubstrate: 1,           # half-space after the last layer (into the PML)
#     fcen, df, nfreq,         # Gaussian pulse centre / width, monitor frequencies
#     resolution,              # pixels per unit length
#     pml: 1.0, pad: 2.0, decay: 1e-9, timeoutS
#   }
#   -> { ok, freqs, R, T, incidentFlux, resolution, meepVersion, elapsedS }
#
# Lossless, non-dispersive media only. Errors come back as
# { "ok": false, "error": "..." }.

import json
import os
import sys
import time

try:
    os.nice(15)  # never compete with the server for the CPU
except Exception:  # noqa: BLE001
    pass
os.environ.setdefault("OMP_NUM_THREADS", "1")

# Meep's C++ layer writes progress (e.g. "Elapsed run time", even at exit) to
# fd 1. Keep a private copy of stdout for the one JSON line and point fd 1 at
# stderr, so the protocol stream carries nothing else.
sys.stdout.flush()
_JSON_OUT = os.fdopen(os.dup(1), "w")
os.dup2(2, 1)

try:
    import meep as mp
    import numpy as np
except Exception as _e:  # noqa: BLE001 - reported as JSON
    mp = None
    _IMPORT_ERROR = f"meep import failed: {type(_e).__name__}: {_e}"
else:
    _IMPORT_ERROR = None
    try:
        mp.verbosity(0)
    except Exception:  # noqa: BLE001
        pass


def fail(msg):
    return {"ok": False, "error": msg}


def stack1d(q):
    n_inc = float(q.get("nIncident", 1.0))
    n_sub = float(q.get("nSubstrate", 1.0))
    layers = q.get("layers") or []
    for L in layers:
        if not (float(L["n"]) > 0 and float(L["thickness"]) > 0):
            return fail("every layer needs n > 0 and thickness > 0")
    res = int(q["resolution"])
    fcen, df, nf = float(q["fcen"]), float(q["df"]), int(q.get("nfreq", 50))
    dpml, pad = float(q.get("pml", 1.0)), float(q.get("pad", 2.0))
    decay = float(q.get("decay", 1e-9))
    total = sum(float(L["thickness"]) for L in layers)
    # z: [-pad-dpml, total+pad+dpml]; structure from 0 to total
    z0, z1 = -pad - dpml, total + pad + dpml
    sz = z1 - z0
    zc = 0.5 * (z0 + z1)
    cell = mp.Vector3(0, 0, sz)
    src_z = z0 + dpml + 0.25 * pad
    refl_z = z0 + dpml + 0.6 * pad
    tran_z = total + 0.5 * pad
    src = [mp.Source(mp.GaussianSource(fcen, fwidth=df), component=mp.Ex, center=mp.Vector3(0, 0, src_z - zc))]
    big = 10 * sz

    def run(geom, default_index, load=None):
        sim = mp.Simulation(cell_size=cell, resolution=res, boundary_layers=[mp.PML(dpml)], sources=src,
                            geometry=geom, dimensions=1, default_material=mp.Medium(index=default_index))
        fr = sim.add_flux(fcen, df, nf, mp.FluxRegion(center=mp.Vector3(0, 0, refl_z - zc)))
        ft = sim.add_flux(fcen, df, nf, mp.FluxRegion(center=mp.Vector3(0, 0, tran_z - zc)))
        if load is not None:
            sim.load_minus_flux_data(fr, load)
        sim.run(until_after_sources=mp.stop_when_fields_decayed(50, mp.Ex, mp.Vector3(0, 0, tran_z - zc), decay))
        return sim, fr, ft

    # normalisation: incident medium everywhere
    sim, fr, ft = run([], n_inc)
    inc_data = sim.get_flux_data(fr)
    inc = np.array(mp.get_fluxes(fr))
    freqs = np.array(mp.get_flux_freqs(fr))
    sim.reset_meep()

    geom = []
    z = 0.0
    for L in layers:
        t = float(L["thickness"])
        geom.append(mp.Block(mp.Vector3(mp.inf, mp.inf, t), center=mp.Vector3(0, 0, z + t / 2 - zc), material=mp.Medium(index=float(L["n"]))))
        z += t
    if n_sub != n_inc:
        geom.append(mp.Block(mp.Vector3(mp.inf, mp.inf, big), center=mp.Vector3(0, 0, total + big / 2 - zc), material=mp.Medium(index=n_sub)))
    # incident half-space left of z=0 is the default material
    sim, fr, ft = run(geom, n_inc, load=inc_data)
    R = -np.array(mp.get_fluxes(fr)) / inc
    T = np.array(mp.get_fluxes(ft)) / inc
    return {"ok": True, "freqs": freqs.tolist(), "R": R.tolist(), "T": T.tolist(),
            "incidentFlux": inc.tolist(), "resolution": res}


def _emit(r):
    sys.stdout.flush()
    _JSON_OUT.write(json.dumps(r) + "\n")
    _JSON_OUT.flush()


def main():
    t0 = time.time()
    try:
        q = json.loads(sys.stdin.read() or "{}")
    except Exception as e:  # noqa: BLE001
        _emit(fail(f"bad request JSON: {e}"))
        return
    if _IMPORT_ERROR:
        _emit(fail(_IMPORT_ERROR))
        return
    op = q.get("op")
    try:
        if op == "stack1d":
            r = stack1d(q)
        else:
            r = fail(f"unknown op {op!r}")
    except Exception as e:  # noqa: BLE001
        r = fail(f"meep run failed: {type(e).__name__}: {e}")
    if r.get("ok"):
        r["meepVersion"] = getattr(mp, "__version__", None)
        r["elapsedS"] = time.time() - t0
    _emit(r)


if __name__ == "__main__":
    main()
