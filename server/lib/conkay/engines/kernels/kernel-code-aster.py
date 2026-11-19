#!/usr/bin/env python3
"""Code_Aster structural kernel — SXE-08 (container engine).

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on stdin,
one result JSON on stdout. The kernel is a driver: it writes a
single-HEXA8 uniaxial tension case (ASTER mesh format + .comm),
runs it with the Code_Aster runner (GPL-3, separate process — in
production this driver env lives in the Code_Aster container),
parses the printed DEPL field from the .resu, and serves the tip
displacement beside the exact closed form delta = PL/(EA) (band
1e-3). This is the SSLV-family linear shape reduced to the case
with an exact reference, the same substitution shape as SXE-07's
CalculiX tension case, and it is named as such in the engine doc.

Ops:
  health / tension — request {lengthM, areaM2, ePa, forceN};
    defaults L=1 m, A=1e-4 m^2, E=210 GPa, F=21000 N
    -> delta = 1e-3 m exactly.

No Code_Aster runner on PATH is a provisioning defect: exit 3
naming it. A .resu with no parseable displacement is rejected
(exit 5), never guessed.
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


MESH = """TITRE
  one HEXA8 element, unit cross-section bar along X
FINSF
COOR_NOEUD
  N1  0.0 0.0 0.0
  N2  0.0 %(H)r 0.0
  N3  0.0 %(H)r %(H)r
  N4  0.0 0.0 %(H)r
  N5  %(L)r 0.0 0.0
  N6  %(L)r %(H)r 0.0
  N7  %(L)r %(H)r %(H)r
  N8  %(L)r 0.0 %(H)r
FIN_NOEUD
HEXA8
  E1  N1 N2 N3 N4 N5 N6 N7 N8
FIN_HEXA8
GROUP_MA
  BAR  E1
FIN_GROUP_MA
GROUP_NO
  FIX  N1 N2 N3 N4
  LOAD  N5 N6 N7 N8
FIN_GROUP_NO
FIN
"""

COMM = """DEBUT()
mesh = LIRE_MAILLAGE(FORMAT='ASTER', UNITE=20)
model = AFFE_MODELE(MAILLAGE=mesh,
                    AFFE=_F(TOUT='OUI', PHENOMENE='MECANIQUE',
                            MODELISATION='3D'))
mat = DEFI_MATERIAU(ELAS=_F(E=%(E)r, NU=0.3))
matf = AFFE_MATERIAU(MAILLAGE=mesh, AFFE=_F(TOUT='OUI', MATER=mat))
fix = AFFE_CHAR_MECA(MODELE=model,
                     DDL_IMPOSED=_F(GROUP_NO='FIX', DX=0.0, DY=0.0, DZ=0.0))
load = AFFE_CHAR_MECA(MODELE=model,
                      FORCE_NODALE=_F(GROUP_NO='LOAD', FX=%(FPER)r))
res = MECA_STATIQUE(MODELE=model, CHAM_MATER=matf,
                    EXCIT=(_F(CHARGE=fix), _F(CHARGE=load)),
                    SOLVEUR=_F(METHODE='MUMPS'))
IMPR_RESU(FORMAT='RESULTAT', UNITE=21,
          RESU=_F(RESULTAT=res, NOM_CHAM='DEPL'))
FIN()
"""

EXPORT = """P actions make_etude
P comm F comm D 1
P mmed F mail D 20
P resu F resu R 21
P mess F mess R 6
F libr %(WORK)s/case.comm D 1
F libr %(WORK)s/case.mail D 20
F libr %(WORK)s/case.resu R 21
F libr %(WORK)s/case.mess R 6
"""


def run_tension(length_m, area_m2, e_pa, force_n):
    runner = shutil.which("run_aster") or shutil.which("codeaster")
    if not runner:
        fail(3, "Code_Aster runner (run_aster / codeaster) not found "
                "on PATH - the Code_Aster container env is not "
                "provisioned")
    import math
    h = math.sqrt(area_m2)
    scratch = os.environ.get("CONKAY_ENGINE_SCRATCH") or os.getcwd()
    work = os.path.join(scratch, "codeaster-tension")
    os.makedirs(work, exist_ok=True)
    with open(os.path.join(work, "case.mail"), "w") as fh:
        fh.write(MESH % {"L": length_m, "H": h})
    with open(os.path.join(work, "case.comm"), "w") as fh:
        fh.write(COMM % {"E": e_pa, "FPER": force_n / 4.0})
    with open(os.path.join(work, "export"), "w") as fh:
        fh.write(EXPORT % {"WORK": work})
    cmd = [runner, os.path.join(work, "export")] \
        if os.path.basename(runner) == "run_aster" \
        else [runner, "run", os.path.join(work, "export")]
    proc = subprocess.run(cmd, cwd=work, capture_output=True, text=True,
                          timeout=1800)
    resu = os.path.join(work, "case.resu")
    if proc.returncode != 0 or not os.path.exists(resu):
        first = next((l.strip() for l in (proc.stdout + proc.stderr).splitlines()
                      if l.strip()), "Code_Aster exited %d" % proc.returncode)
        fail(6, "Code_Aster failed: %s" % first)
    with open(resu, errors="replace") as fh:
        text = fh.read()
    dxs = [float(x) for x in re.findall(
        r"\bN[5-8]\b\s+(-?\d+\.\d+(?:[Ee][-+]?\d+)?)\s+"
        r"(-?\d+\.\d+(?:[Ee][-+]?\d+)?)\s+"
        r"(-?\d+\.\d+(?:[Ee][-+]?\d+)?)", text) for x in [x[0]]]
    if not dxs:
        fail(5, "Code_Aster .resu carried no parseable DEPL rows for "
                "the loaded face (garbled output rejected)")
    delta = sum(dxs) / len(dxs)
    expected = force_n * length_m / (e_pa * area_m2)
    rel = abs(delta - expected) / expected if expected else abs(delta)
    return {"tipDisplacement": delta, "expectedDisplacement": expected,
            "relError": rel, "converged": rel < 1e-3}


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "tension"):
        length_m = request.get("lengthM", 1.0)
        area_m2 = request.get("areaM2", 1e-4)
        e_pa = request.get("ePa", 210e9)
        force_n = request.get("forceN", 21000.0)
        for name, v in (("lengthM", length_m), ("areaM2", area_m2),
                        ("ePa", e_pa), ("forceN", force_n)):
            if not isinstance(v, (int, float)) or isinstance(v, bool) or v <= 0:
                fail(2, "%s must be a positive number, got %r" % (name, v))
        result = run_tension(float(length_m), float(area_m2),
                             float(e_pa), float(force_n))
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
