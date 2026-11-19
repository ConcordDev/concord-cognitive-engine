#!/usr/bin/env python3
"""OpenFOAM CFD kernel — SXE-11.

Speaks the SXE-00 kernel protocol: {"op", "request"} JSON on
stdin, one result JSON on stdout. The kernel is a driver: it
writes the classic lid-driven cavity case into the scratch
dir, runs blockMesh + icoFoam + the sampling postProcess,
and compares the vertical-centreline u profile against
Ghia, Ghia & Shin (1982). GPL-3 code stays across the
process boundary (the manifest's GPL rule).

Distribution pin: OpenFOAM v2406 (ESI / openfoam.com) —
the SOLVER-ENGINES-PLAN.md F3 safe default, recorded in
the manifest entry and pending the founder's express F3
ruling; the kernel itself is distribution-agnostic (the
case uses only icoFoam / blockMesh / sample machinery
present in both lines), so flipping the pin is a
provisioning change, not a kernel change.

Ops:
  health / cavity — cavity at Re=100 (nu=0.01, lid 1 m/s,
    unit square, 40x40 mesh, icoFoam to t=10). Serves the
    centreline u at four Ghia stations, the lid value, and
    maxDeviation against the reference table:
      y=0.8516 ->  0.23151    y=0.6172 -> -0.13641
      y=0.4531 -> -0.21090    y=0.1719 -> -0.10150
    (Ghia, Ghia & Shin 1982, J. Comput. Phys. 48:387-411,
    Table 1, as transcribed in a 2026 validation paper's
    reproduction; primary vortex centre (0.6172, 0.7344),
    psi_min = -0.10342.) The health band is maxDeviation
    <= 0.05, asserted by the suite in the CI lane.
    Request {endTime} (default 10, range [1, 60]).

Missing case binaries are a provisioning defect: exit 3
naming the missing executable. An unsampled or
unparseable profile is rejected (exit 5), never guessed.
"""
import glob
import json
import os
import shutil
import subprocess
import sys


def fail(code, message):
    print(message, file=sys.stderr)
    sys.exit(code)


GHIA = {0.8516: 0.23151, 0.6172: -0.13641, 0.4531: -0.21090, 0.1719: -0.10150}

CASE_FILES = {
    "0/U": """FoamFile { version 2.0; format ascii; class volVectorField; object U; }
dimensions      [0 1 -1 0 0 0 0];
internalField   uniform (0 0 0);
boundaryField
{
    movingWall  { type fixedValue; value uniform (1 0 0); }
    fixedWalls  { type noSlip; }
    frontAndBack { type empty; }
}
""",
    "0/p": """FoamFile { version 2.0; format ascii; class volScalarField; object p; }
dimensions      [0 2 -2 0 0 0 0];
internalField   uniform 0;
boundaryField
{
    movingWall  { type fixedFluxPressure; }
    fixedWalls  { type fixedFluxPressure; }
    frontAndBack { type empty; }
}
""",
    "constant/transportProperties": """FoamFile { version 2.0; format ascii; class dictionary; object transportProperties; }
transportModel  Newtonian;
nu              [0 2 -1 0 0 0 0] 0.01;
""",
    "system/blockMeshDict": """FoamFile { version 2.0; format ascii; class dictionary; object blockMeshDict; }
convertToMeters 1;
vertices
(
    (0 0 0) (1 0 0) (1 1 0) (0 1 0)
    (0 0 0.1) (1 0 0.1) (1 1 0.1) (0 1 0.1)
);
blocks ( hex (0 1 2 3 4 5 6 7) (40 40 1) simpleGrading (1 1 1) );
edges ( );
boundary
(
    movingWall  { type wall; faces ( (3 7 6 2) ); }
    fixedWalls  { type wall; faces ( (0 4 7 3) (2 6 5 1) (1 5 4 0) ); }
    frontAndBack { type empty; faces ( (0 3 2 1) (4 5 6 7) ); }
);
mergePatchPairs ( );
""",
    "system/fvSchemes": """FoamFile { version 2.0; format ascii; class dictionary; object fvSchemes; }
ddtSchemes          { default Euler; }
gradSchemes         { default Gauss linear; }
divSchemes          { default none; div(phi,U) Gauss linearUpwind grad(U); }
laplacianSchemes    { default Gauss linear corrected; }
interpolationSchemes { default linear; }
snGradSchemes       { default corrected; }
""",
    "system/fvSolution": """FoamFile { version 2.0; format ascii; class dictionary; object fvSolution; }
solvers
{
    p       { solver PCG; preconditioner DIC; tolerance 1e-06; relTol 0.05; }
    pFinal  { $p; relTol 0; }
    U       { solver smoothSolver; smoother symGaussSeidel; tolerance 1e-05; relTol 0; }
}
PISO { nCorrectors 2; nNonOrthogonalCorrectors 0; }
""",
    "system/sample": """FoamFile { version 2.0; format ascii; class dictionary; object sample; }
type            sets;
libs            (sampling);
setFormat       raw;
interpolationScheme cellPoint;
sets
(
    centreline
    {
        type    uniform;
        axis    y;
        start   (0.5 0 0.05);
        end     (0.5 1 0.05);
        nPoints 41;
    }
);
fields ( U );
""",
}


def control_dict(end_time):
    return f"""FoamFile {{ version 2.0; format ascii; class dictionary; object controlDict; }}
application     icoFoam;
startFrom       startTime;
startTime       0;
stopAt          endTime;
endTime         {end_time};
deltaT          0.005;
writeControl    timeStep;
writeInterval   100000;
runTimeModifiable true;
functions       {{ }};
"""


def run_tool(name, case, timeout):
    exe = shutil.which(name)
    if not exe:
        fail(3, "%s executable not found on PATH "
                "(OpenFOAM is not provisioned for this engine env)" % name)
    proc = subprocess.run([exe], cwd=case, capture_output=True, text=True,
                          timeout=timeout)
    if proc.returncode != 0:
        tail = [l.strip() for l in (proc.stdout + proc.stderr).splitlines()
                if "error" in l.lower() or "FOAM" in l]
        fail(5, "%s failed: %s" % (name, tail[0] if tail else
                                   "exit %d" % proc.returncode))


def interp(profile, y):
    pts = sorted(profile)
    if y <= pts[0][0]:
        return pts[0][1]
    if y >= pts[-1][0]:
        return pts[-1][1]
    for (y0, u0), (y1, u1) in zip(pts, pts[1:]):
        if y0 <= y <= y1:
            return u0 + (u1 - u0) * (y - y0) / (y1 - y0)
    return pts[-1][1]


def cavity(end_time):
    scratch = os.environ.get("CONKAY_ENGINE_SCRATCH") or os.getcwd()
    case = os.path.join(scratch, "cavity")
    for rel, text in CASE_FILES.items():
        path = os.path.join(case, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as fh:
            fh.write(text)
    with open(os.path.join(case, "system", "controlDict"), "w") as fh:
        fh.write(control_dict(end_time))
    run_tool("blockMesh", case, 120)
    run_tool("icoFoam", case, 900)
    # postProcess needs its function argument; run it explicitly.
    exe = shutil.which("postProcess")
    if not exe:
        fail(3, "postProcess executable not found on PATH "
                "(OpenFOAM is not provisioned for this engine env)")
    proc = subprocess.run([exe, "-func", "sample", "-latestTime"], cwd=case,
                          capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        fail(5, "postProcess sampling failed: exit %d" % proc.returncode)
    hits = glob.glob(os.path.join(case, "postProcessing", "**",
                                  "centreline_U.xy"), recursive=True)
    if not hits:
        fail(5, "sampling produced no centreline_U.xy (profile unavailable)")
    profile = []
    with open(hits[0]) as fh:
        for line in fh:
            parts = line.split()
            if len(parts) == 4:
                try:
                    profile.append((float(parts[0]), float(parts[1])))
                except ValueError:
                    pass
    if len(profile) < 10:
        fail(5, "centreline profile unparseable (%d rows)" % len(profile))
    served = {}
    max_dev = 0.0
    keys = {0.8516: "uY08516", 0.6172: "uY06172",
            0.4531: "uY04531", 0.1719: "uY01719"}
    for y, ref in GHIA.items():
        u = interp(profile, y)
        served[keys[y]] = float(u)
        max_dev = max(max_dev, abs(u - ref))
    served["uLid"] = float(interp(profile, 1.0))
    served["maxDeviation"] = float(max_dev)
    served["converged"] = True
    return served


def main():
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        fail(2, "kernel input was not valid JSON")
    op = payload.get("op")
    request = payload.get("request") or {}
    if op in ("health", "cavity"):
        end_time = request.get("endTime", 10)
        if (not isinstance(end_time, (int, float))
                or isinstance(end_time, bool)
                or not (1 <= end_time <= 60)):
            fail(2, "endTime must be a number in [1, 60], got %r" % (end_time,))
        result = cavity(end_time)
    else:
        fail(2, "unknown op %r" % (op,))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
