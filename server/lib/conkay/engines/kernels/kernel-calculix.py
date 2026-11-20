#!/usr/bin/env python3
"""CalculiX structural FEA kernel — SXE-07.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on
stdin, one result JSON on stdout. The kernel is a driver: it
writes a CalculiX deck into the scratch dir, runs `ccx`, and
parses the .dat results. GPL-2 code stays across the process
boundary (the manifest's GPL rule): nothing of CalculiX is
imported or linked here.

Ops:
  health / tension — single C3D8 element in uniaxial
    tension, the one-element case with an EXACT closed
    form: sigma = P/A, delta = PL/(EA). (Named
    substitution: SOLVER-ENGINES-PLAN.md section 2 words
    the health case as a one-element cantilever, but a
    one-element cantilever has no exact closed form; the
    tension case is the exact one-element reference, and
    the cantilever below is the band-checked case.)
    Canonical numbers: L=0.1 m, A=0.01x0.01 m,
    E=210 GPa, nu=0.3, F=21000 N -> sigma=210 MPa,
    delta=1e-4 m. Serves both FE values beside both exact
    values with maxRelError; the suite asserts < 1e-3.
  cantilever — kernel-generated C3D20 mesh (quadratic
    elements, no shear locking), clamped-free beam under
    a tip resultant; serves {tipDeflection, beamTheory,
    relDeviation} against Euler-Bernoulli PL^3/(3EI).
    Request {length, height, load, e, nu, nx} with
    defaults L=1, H=0.05, P=0.01, E=1e6, nu=0.3, nx=10.

No ccx on PATH is a provisioning defect: exit 3 naming it.
CONKAY_CCX_BIN, when set, names the ccx binary exclusively
(a set-but-missing override is the same provisioning
defect). An unparseable .dat is rejected (exit 5), never
guessed.
"""
import json
import os
import shutil
import subprocess
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


def find_ccx():
    override = os.environ.get("CONKAY_CCX_BIN")
    if override:
        return override if os.path.isfile(override) and os.access(override, os.X_OK) else None
    return shutil.which("ccx") or ("/usr/bin/ccx" if os.path.exists("/usr/bin/ccx") else None)


def run_ccx(job, deck):
    ccx = find_ccx()
    if not ccx:
        fail(3, "ccx executable not found on PATH "
                "(CalculiX is not provisioned for this engine env)")
    scratch = os.environ.get("CONKAY_ENGINE_SCRATCH") or os.getcwd()
    with open(os.path.join(scratch, job + ".inp"), "w") as fh:
        fh.write(deck)
    proc = subprocess.run([ccx, job], cwd=scratch, capture_output=True,
                          text=True, timeout=600)
    dat_path = os.path.join(scratch, job + ".dat")
    if not os.path.exists(dat_path):
        first = next((l.strip() for l in proc.stderr.splitlines() if l.strip()),
                     next((l.strip() for l in proc.stdout.splitlines() if l.strip()),
                          "ccx produced no .dat output"))
        fail(5, "ccx run produced no results file: %s" % first)
    with open(dat_path) as fh:
        return fh.read()


def parse_dat(dat):
    """Return (displacements {node: (u,v,w)}, stresses [(sxx,...)])."""
    disp, stress = {}, []
    mode = None
    for line in dat.splitlines():
        low = line.lower()
        if "displacements" in low:
            mode = "disp"
            continue
        if "stresses" in low:
            mode = "stress"
            continue
        if line.strip().startswith("calculated") or "eigen" in low:
            mode = None
        parts = line.split()
        if mode == "disp" and len(parts) == 4:
            try:
                node = int(parts[0])
                disp[node] = tuple(float(p) for p in parts[1:4])
            except ValueError:
                pass
        elif mode == "stress" and len(parts) == 8:
            try:
                int(parts[0]); int(parts[1])
                stress.append(tuple(float(p) for p in parts[2:8]))
            except ValueError:
                pass
    return disp, stress


TENSION = {
    "L": 0.1, "H": 0.01, "E": 210.0e9, "nu": 0.3, "F": 21000.0,
}


def tension_deck(c):
    L, H, E, nu, F = c["L"], c["H"], c["E"], c["nu"], c["F"]
    q = F / 4.0
    # Boundary shape matters: the back face is fixed in x
    # only (node 1 fully, killing the rigid-body modes), so
    # the element can contract laterally — the exact uniaxial
    # state the closed form describes. Clamping the whole
    # back face (dofs 1-3) strangles the Poisson contraction
    # and the stress field is no longer uniform (measured
    # +-14% across the integration points, delta -8%): the
    # case then fails its own 1e-3 band under a CORRECT ccx.
    # Output goes to the .dat via PRINT cards naming the
    # sets — the FILE cards write the .frd instead, and a
    # set-less PRINT writes nothing on current ccx builds;
    # both leave the parser an empty .dat (exit 5).
    return f"""*HEADING
ConKay SXE-07 tension case - single C3D8 element
*NODE, NSET=NALL
1, 0.0, 0.0, 0.0
2, {L}, 0.0, 0.0
3, {L}, {H}, 0.0
4, 0.0, {H}, 0.0
5, 0.0, 0.0, {H}
6, {L}, 0.0, {H}
7, {L}, {H}, {H}
8, 0.0, {H}, {H}
*ELEMENT, TYPE=C3D8, ELSET=EALL
1, 1, 2, 3, 4, 5, 6, 7, 8
*MATERIAL, NAME=MAT
*ELASTIC
{E}, {nu}
*SOLID SECTION, ELSET=EALL, MATERIAL=MAT
*BOUNDARY
1, 1, 3, 0.0
4, 1, 1, 0.0
5, 1, 1, 0.0
8, 1, 1, 0.0
*STEP
*STATIC
*CLOAD
2, 1, {q}
3, 1, {q}
6, 1, {q}
7, 1, {q}
*NODE PRINT, NSET=NALL
U
*EL PRINT, ELSET=EALL
S
*END STEP
"""


def tension():
    c = TENSION
    dat = run_ccx("tension", tension_deck(c))
    disp, stress = parse_dat(dat)
    if 2 not in disp or not stress:
        fail(5, "could not parse ccx .dat output for the tension case")
    delta = disp[2][0]
    sxx = stress[0][0]
    exact_s = c["F"] / (c["H"] * c["H"])
    exact_d = exact_s * c["L"] / c["E"]
    rel = max(abs(sxx - exact_s) / exact_s, abs(delta - exact_d) / exact_d)
    return {"stress": float(sxx), "stressExact": float(exact_s),
            "deflection": float(delta), "deflectionExact": float(exact_d),
            "maxRelError": float(rel), "converged": True}


def cantilever_deck(L, H, E, nu, P, nx):
    """C3D20 structured mesh: nx segments, 1x1 cross-section."""
    nodes = {}
    order = []

    def nid(key, xyz):
        if key not in nodes:
            nodes[key] = len(nodes) + 1
            order.append((nodes[key], xyz))
        return nodes[key]

    corners = [(0.0, 0.0), (H, 0.0), (H, H), (0.0, H)]  # (y, z) A B C D
    dx = L / nx
    for i in range(nx + 1):
        x = i * dx
        for ci, (y, z) in enumerate(corners):
            nid(("c", i, ci), (x, y, z))
        mids = [(H / 2, 0.0), (H, H / 2), (H / 2, H), (0.0, H / 2)]
        for mi, (y, z) in enumerate(mids):
            nid(("m", i, mi), (x, y, z))
    for i in range(nx):
        xm = (i + 0.5) * dx
        for ci, (y, z) in enumerate(corners):
            nid(("x", i, ci), (xm, y, z))
    elements = []
    for i in range(nx):
        c = [nodes[("c", i, k)] for k in range(4)]
        c2 = [nodes[("c", i + 1, k)] for k in range(4)]
        m = [nodes[("m", i, k)] for k in range(4)]
        m2 = [nodes[("m", i + 1, k)] for k in range(4)]
        x = [nodes[("x", i, k)] for k in range(4)]
        elements.append(c + c2 + [m[0], m[1], m[2], m[3],
                                  m2[0], m2[1], m2[2], m2[3],
                                  x[0], x[1], x[2], x[3]])
    lines = ["*HEADING", "ConKay SXE-07 cantilever - C3D20 mesh",
             "*NODE, NSET=NALL"]
    for n, (x, y, z) in sorted(order):
        lines.append(f"{n}, {x}, {y}, {z}")
    lines.append("*ELEMENT, TYPE=C3D20, ELSET=EALL")
    for ei, el in enumerate(elements, 1):
        # ccx takes at most 16 entries per input line; a
        # C3D20 element (id + 20 nodes) wraps to a second
        # line. One 21-entry line is a splitline error and
        # the run produces no output at all.
        entries = [str(ei)] + [str(n) for n in el]
        lines.append(", ".join(entries[:16]))
        lines.append(", ".join(entries[16:]))
    lines += ["*MATERIAL, NAME=MAT", "*ELASTIC", f"{E}, {nu}",
              "*SOLID SECTION, ELSET=EALL, MATERIAL=MAT", "*BOUNDARY"]
    for ci in range(4):
        lines.append(f"{nodes[('c', 0, ci)]}, 1, 3, 0.0")
        lines.append(f"{nodes[('m', 0, ci)]}, 1, 3, 0.0")
    q = P / 4.0
    lines += ["*STEP", "*STATIC", "*CLOAD"]
    tip = []
    for ci in range(4):
        n = nodes[("c", nx, ci)]
        tip.append(n)
        lines.append(f"{n}, 2, {-q}")
    lines += ["*NODE PRINT, NSET=NALL", "U", "*END STEP", ""]
    return "\n".join(lines), tip


def cantilever(req):
    L = float(req.get("length", 1.0))
    H = float(req.get("height", 0.05))
    P = float(req.get("load", 0.01))
    E = float(req.get("e", 1.0e6))
    nu = float(req.get("nu", 0.3))
    nx = int(req.get("nx", 10))
    if not (0.05 <= L <= 100 and 0.001 <= H <= L / 2 and P > 0 and E > 0
            and 0.0 <= nu < 0.5 and 1 <= nx <= 40):
        fail(2, "cantilever request out of range: need 0.05<=length<=100, "
                "0.001<=height<=length/2, load>0, e>0, 0<=nu<0.5, 1<=nx<=40")
    deck, tip = cantilever_deck(L, H, E, nu, P, nx)
    dat = run_ccx("cantilever", deck)
    disp, _ = parse_dat(dat)
    if any(n not in disp for n in tip):
        fail(5, "could not parse ccx .dat output for the cantilever case")
    tip_defl = sum(abs(disp[n][1]) for n in tip) / len(tip)
    I = H ** 4 / 12.0
    theory = P * L ** 3 / (3.0 * E * I)
    return {"tipDeflection": float(tip_defl), "beamTheory": float(theory),
            "relDeviation": float(abs(tip_defl - theory) / theory),
            "converged": True}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "tension"):
        result = tension()
    elif op == "cantilever":
        result = cantilever(request)
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
