#!/usr/bin/env python3
"""WarpX kernel — SXE-31 (plasma stack, WarpX CPU leg).

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. Health case (the plan's): Langmuir
oscillation frequency in a 1-D PIC run vs omega_p. The kernel
writes a minimal WarpX inputs file (cold electrons with a
sinusoidal density perturbation on a uniform ion background,
periodic boundaries), runs the `warpx.1d` executable (BSD-3-LBNL,
separate process), reads the FieldEnergy reduced-diagnostic CSV
(field energy oscillates at 2*omega_p), takes the FFT peak, and
serves omega_measured = pi * f_peak beside the closed-form
omega_p = sqrt(n e^2 / (eps0 m_e)) (band 10%: grid + finite-run
frequency resolution).

Ops:
  health / langmuir — request {densityM3, nSteps};
    defaults n = 1e18 m^-3, 4000 steps.

No warpx.1d on PATH is a provisioning defect: exit 3 naming it.
A run with no parseable FieldEnergy CSV is rejected (exit 5).
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


INPUTS = """# 1-D Langmuir oscillation (ConKay SXE-31 health)
max_step = %(STEPS)d
amr.n_cell = 128
amr.max_grid_size = 128
amr.blocking_factor = 128
geometry.dims = 1
geometry.prob_lo = 0.0
geometry.prob_hi = %(L)r
boundary.field_lo = periodic
boundary.field_hi = periodic
boundary.particle_lo = periodic
boundary.particle_hi = periodic
warpx.serialize_initial_conditions = 1
warpx.use_filter = 0
algo.particle_shape = 1
particles.species_names = electrons ions
electrons.charge = -q_e
electrons.mass = m_e
electrons.injection_style = "NRandomPerCell"
electrons.num_particles_per_cell = 64
electrons.density = %(DENSFN)s
electrons.momentum_distribution_type = "at_rest"
ions.charge = q_e
ions.mass = m_p
ions.injection_style = "NRandomPerCell"
ions.num_particles_per_cell = 8
ions.density = %(N0)r
ions.momentum_distribution_type = "at_rest"
warpx.reduced_diags_names = EF
EF.type = FieldEnergy
EF.intervals = 10
EF.path = diags/reducedEF/
"""


def run_langmuir(n0, n_steps):
    exe = find_tool("warpx.1d") or find_tool("warpx")
    if not exe:
        fail(3, "warpx executable (warpx.1d) not found on PATH "
                "(WarpX is not provisioned for this engine env)")
    e, eps0, m_e = 1.602176634e-19, 8.8541878128e-12, 9.1093837015e-31
    omega_p = math.sqrt(n0 * e * e / (eps0 * m_e))
    c = 299792458.0
    skin = c / omega_p
    length = 20.0 * skin
    dt = 0.05 / omega_p
    dens_fn = '"%r * (1.0 + 0.1 * sin(2 * pi * x / %r))"' % (n0, length)
    scratch = os.environ.get("CONKAY_ENGINE_SCRATCH") or os.getcwd()
    work = os.path.join(scratch, "warpx-langmuir")
    os.makedirs(work, exist_ok=True)
    with open(os.path.join(work, "inputs"), "w") as fh:
        fh.write(INPUTS % {"STEPS": int(n_steps), "L": length,
                           "DENSFN": dens_fn, "N0": n0})
    proc = subprocess.run([exe, "inputs"], cwd=work, capture_output=True,
                          text=True, timeout=3600)
    csvs = glob.glob(os.path.join(work, "diags", "reducedEF", "*.csv")) \
        or glob.glob(os.path.join(work, "**", "*.csv"), recursive=True)
    if proc.returncode != 0 or not csvs:
        first = next((l.strip() for l in (proc.stdout + proc.stderr).splitlines()
                      if l.strip()), "warpx exited %d" % proc.returncode)
        fail(6, "WarpX failed: %s" % first)
    rows = []
    with open(csvs[0]) as fh:
        for row in csv.reader(fh):
            try:
                rows.append((float(row[0]), float(row[1])))
            except (ValueError, IndexError):
                continue
    if len(rows) < 64:
        fail(5, "FieldEnergy CSV held %d numeric rows (garbled output "
                "rejected)" % len(rows))
    import numpy as np
    steps = np.array([r[0] for r in rows])
    energy = np.array([r[1] for r in rows])
    times = steps * dt
    energy = energy - energy.mean()
    spec = np.abs(np.fft.rfft(energy))
    freqs = np.fft.rfftfreq(len(energy), d=(times[1] - times[0]))
    peak = 1 + int(np.argmax(spec[1:]))
    f_peak = float(freqs[peak])
    omega_meas = math.pi * f_peak  # field energy oscillates at 2*omega_p
    rel = abs(omega_meas - omega_p) / omega_p
    return {"omegaP": omega_meas, "expectedOmegaP": omega_p,
            "relError": rel, "converged": rel <= 0.10}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "langmuir"):
        n0 = request.get("densityM3", 1e18)
        n_steps = request.get("nSteps", 4000)
        for name, v in (("densityM3", n0), ("nSteps", n_steps)):
            if not isinstance(v, (int, float)) or isinstance(v, bool) or v <= 0:
                fail(2, "%s must be a positive number, got %r" % (name, v))
        result = run_langmuir(float(n0), int(n_steps))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
