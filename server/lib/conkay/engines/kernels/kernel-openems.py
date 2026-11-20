#!/usr/bin/env python3
"""openEMS kernel — SXE-17.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. GPL-3 code driven as a separate process
(the kernel imports the openEMS Python bindings inside its own
process only; nothing of openEMS is linked into the server).

Health case: a centre-fed half-wave dipole in free space at the
request frequency, simulated with a coarse (lambda/12) FDTD mesh.
This is a COMPLETION-class case with a finite-value check, named
as such: the kernel requires the run to finish and the lumped
port to yield a finite input impedance at the design frequency;
no closed form exists for a thick-wire FDTD dipole at this mesh,
so the stored-reference shape applies — when the lane has
recorded CONKAY_OPENEMS_REF_R / CONKAY_OPENEMS_REF_X from a
verified run, the kernel also enforces a 15% band around them.

Ops:
  health / dipole-impedance — request {freqGHz} (default 1.0)
    -> {resistanceOhm, reactanceOhm, converged}.

No openEMS bindings in the driver env is a provisioning defect:
exit 3.
"""
import json
import math
import os
import sys
import tempfile


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def run_dipole(freq_ghz):
    try:
        import numpy as np
        from CSXCAD import ContinuousStructure
        from openEMS import openEMS
        from openEMS.physical_constants import C0
    except Exception as e:
        fail(3, "openEMS import failed (%s) - the openEMS driver "
                "env is not provisioned" % e)
    f0 = freq_ghz * 1e9
    lam = C0 / f0
    length = 0.48 * lam          # near-resonant dipole length
    radius = lam / 200.0
    with tempfile.TemporaryDirectory(prefix="conkay-openems-") as td:
        fdtd = openEMS(NrTS=30000, EndCriteria=1e-4)
        fdtd.SetGaussExcite(0, f0 / 2)
        fdtd.SetBoundaryCond(["PML_8"] * 6)
        csx = ContinuousStructure()
        fdtd.SetCSX(csx)
        mesh = csx.GetGrid()
        mesh.SetDeltaUnit(1.0)
        res = lam / 12.0
        for axis in range(3):
            lines = [v * res for v in range(-12, 13)]
            mesh.AddLines(axis, lines)
        mesh.SmoothMeshLines(0, 1.0)
        port = fdtd.AddLumpedPort(1, 50.0, [0, 0, -res / 2],
                                  [0, 0, res / 2], "z", 1.0,
                                  priority=10)
        metal = csx.AddMetal("dipole")
        metal.AddBox([-radius, -radius, -length / 2],
                     [radius, radius, -res / 2], priority=10)
        metal.AddBox([-radius, -radius, res / 2],
                     [radius, radius, length / 2], priority=10)
        fdtd.Run(td, cleanup=True)
        f = np.linspace(f0 * 0.8, f0 * 1.2, 81)
        port.CalcPort(td, f)
        uf = port.uf_tot
        inf = port.if_tot
        idx = int(np.argmin(np.abs(f - f0)))
        if inf[idx] == 0:
            fail(6, "openEMS port current vanished at the design "
                    "frequency - the run did not excite the dipole")
        z = uf[idx] / inf[idx]
        r_ohm, x_ohm = float(z.real), float(z.imag)
    if not (math.isfinite(r_ohm) and math.isfinite(x_ohm)):
        fail(6, "openEMS served a non-finite dipole impedance")
    ok = True
    ref_r, ref_x = os.environ.get("CONKAY_OPENEMS_REF_R"), \
        os.environ.get("CONKAY_OPENEMS_REF_X")
    if ref_r is not None and ref_x is not None:
        ok = (abs(r_ohm - float(ref_r)) <= 0.15 * abs(float(ref_r))
              and abs(x_ohm - float(ref_x)) <= 0.15 * max(1.0, abs(float(ref_x))))
    return {"resistanceOhm": r_ohm, "reactanceOhm": x_ohm,
            "converged": ok}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "dipole-impedance"):
        freq = request.get("freqGHz", 1.0)
        if not isinstance(freq, (int, float)) or not (0.1 <= freq <= 10):
            fail(2, "freqGHz must be a number in [0.1, 10], "
                    "got %r" % (freq,))
        result = run_dipole(float(freq))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
