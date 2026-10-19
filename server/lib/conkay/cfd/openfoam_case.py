#!/usr/bin/env python3
# server/lib/conkay/cfd/openfoam_case.py
#
# Writes an OpenFOAM 12 external-aero case (foamRun, incompressibleFluid, steady SIMPLE; optional transient DDES overlay,
# k-omega SST, wall functions, snappyHexMesh with 3 layers, moving ground). Stdlib only.
#
# Request (JSON on stdin):
#   { "preset": "ahmed" | "car5m", "outDir": "...", "nproc": int, "endTime": int,
#     "aref": m2 (car5m only), "lref": m (car5m only),
#     "refinement": "coarse" | "medium" (default) | "fine",
#     "turbulence": "rans" (default) | "ddes",
#     "flowThroughsDiscard": number > 0, "flowThroughsAverage": number > 0, "cflTarget": 0 < number <= 2
#       (the last three only with turbulence "ddes"; defaults in DES_DEFAULTS).
#     refinement and turbulence combine: a "ddes" request on "fine" uses that level's cell size. }
# Reply (JSON on stdout): { ok, preset, files: { path: sha256 }, caseSha256 } or { ok: false, error }.
#
# The templates are the ones the recorded runs were made with (docs/CONKAY-AERO-CFD.md);
# caseSha256 is the hash of the written files, so a run can be matched to its exact case.
#
# Flow: 40 m/s (the Lienhart & Becker / ERCOFTAC 082 speed), nu 1.5e-5 -> Re_L 2.78e6 on the
# Ahmed body. Ahmed's 0.285 total was measured at Re_L 4.29e6 (60 m/s); stated, not adjusted.
# Inlet turbulence: intensity 0.5 %, length scale 0.1 m.
import hashlib, json, math, os, re, sys

U = 40.0; NU = 1.5e-5

PRESETS = {
    # Ahmed body, 25 deg slant: ahmed.geo (L 1.044, W 0.389, H 0.288, clearance 0.05), nose at x = 0.
    "ahmed": {
        "name": "ahmed",
        "forces": [('total', '("ahmed.*")'), ('nose', '(ahmed_nose)'), ('slant', '(ahmed_slant)'),
                   ('base', '(ahmed_base)'), ('rest', '(ahmed_rest)')],
        "block": "vertices ((-2 -1 0) (6 -1 0) (6 1 0) (-2 1 0) (-2 -1 1.4) (6 -1 1.4) (6 1 1.4) (-2 1 1.4));\nblocks (hex (0 1 2 3 4 5 6 7) (@CELLS@) simpleGrading (1 1 1));",
        "boxes": '''    box2 { type searchableBox; min (-0.6 -0.6 0); max (3.5 0.6 0.8); }
    box3 { type searchableBox; min (-0.25 -0.35 0); max (2.2 0.35 0.55); }
    box4 { type searchableBox; min (-0.1 -0.25 0); max (1.6 0.25 0.42); }''',
        "extraRegions": "",
        "cells": (80, 20, 14), "extent": (8.0, 2.0, 1.4),
        "insidePoint": "(3.1 0.81 1.01)",
        # body must lie inside box4 (the finest volume box): nose at 0, length 1.044
        "fits": {"min": (-0.1, -0.25, 0.0), "max": (1.6, 0.25, 0.42)},
    },
    # A road-car body about 5.2 m long, 1.94 m wide, 1.28 m tall, nose near x = 0.1 (ConKay cad.body frame).
    "car5m": {
        "name": "car",
        "forces": [('total', '("car.*")')],
        "block": "vertices ((-8 -6 0) (26 -6 0) (26 6 0) (-8 6 0) (-8 -6 6) (26 -6 6) (26 6 6) (-8 6 6));\nblocks (hex (0 1 2 3 4 5 6 7) (@CELLS@) simpleGrading (1 1 1));",
        "boxes": '''    box2 { type searchableBox; min (-2 -2.5 0); max (14 2.5 3); }
    box3 { type searchableBox; min (-0.8 -1.6 0); max (9 1.6 2.2); }
    box4 { type searchableBox; min (-0.3 -1.25 0); max (7.5 1.25 1.7); }
    box5 { type searchableBox; min (0 -1.05 0); max (5.5 1.05 0.25); }''',
        "extraRegions": "        box5 { mode inside; level 5; }\n",
        "cells": (85, 30, 15), "extent": (34.0, 12.0, 6.0),
        "insidePoint": "(20.1 5.01 5.01)",
        "fits": {"min": (-0.3, -1.25, 0.0), "max": (7.5, 1.25, 1.7)},
    },
}


# Mesh density. Every blockMesh axis count is scaled by R_STEP**{-1,0,+1} and the snappy refinement
# levels are left alone, so every cell size in the domain (background, boxes, surface, layers via
# relativeSizes) scales by the same factor R_STEP: a constant, geometrically similar refinement
# ratio r = sqrt(2) = 1.414 > 1.3 (Celik et al. 2008, Step 2). A ratio of 2 would be one snappy
# level, but then three grids span a factor 4 and the fine one is 8x the cells of the medium
# (~45 M cells for the Ahmed case); sqrt(2) gives about 2.83x cells per step. Axis counts are
# rounded to integers, so the realised ratio differs a little per axis; blockCells reports the
# counts and the study uses the realised cell counts, not the nominal r.
R_STEP = 2 ** 0.5
REFINEMENTS = {"coarse": -1, "medium": 0, "fine": 1}


def block_cells(P, refinement):
    k = REFINEMENTS[refinement]
    return tuple(max(2, int(round(n * R_STEP ** k))) for n in P["cells"])


def H(cls, obj, loc):
    return f'FoamFile\n{{\n    format ascii;\n    class {cls};\n    location "{loc}";\n    object {obj};\n}}\n'


def build(P, NPROC, ENDT, AREF, LREF, REF="medium"):
    N = P["name"]
    cells = block_cells(P, REF)
    # maxLocalCells is per rank; the fine grid is ~2.8x the medium cell count, so its cap scales too
    max_local = 2000000 if REF != "fine" else 6000000
    I = 0.005; k = 1.5*(I*U)**2; omega = k**0.5/(0.09**0.25*0.1)
    files = {}
    files['system/controlDict'] = H('dictionary', 'controlDict', 'system') + f'''
application foamRun;
solver incompressibleFluid;
startFrom latestTime; startTime 0; stopAt endTime; endTime {ENDT}; deltaT 1;
writeControl timeStep; writeInterval 500; purgeWrite 2; writeFormat binary;
writePrecision 8; writeCompression off; timeFormat general; timePrecision 6;
runTimeModifiable true;
functions
{{
'''
    for name, pats in P["forces"]:
        files['system/controlDict'] += f'''    fc_{name}
    {{
        type forceCoeffs; libs ("libforces.so"); writeControl timeStep; writeInterval 1;
        patches {pats}; rho rhoInf; rhoInf 1; log {'true' if name=='total' else 'false'};
        magUInf {U}; lRef {LREF}; Aref {AREF:.6f};
        CofR (0 0 0); liftDir (0 0 1); dragDir (1 0 0); pitchAxis (0 1 0);
    }}
'''
    files['system/controlDict'] += '''    yPlus { type yPlus; libs ("libfieldFunctionObjects.so"); writeControl writeTime; }
}
'''
    files['system/blockMeshDict'] = H('dictionary', 'blockMeshDict', 'system') + f'''
convertToMeters 1;
{P["block"].replace("@CELLS@", " ".join(str(c) for c in cells))}
boundary
(
    inlet  {{ type patch; faces ((0 4 7 3)); }}
    outlet {{ type patch; faces ((2 6 5 1)); }}
    ground {{ type wall; faces ((0 3 2 1)); }}
    top    {{ type symmetryPlane; faces ((4 5 6 7)); }}
    sideL  {{ type symmetryPlane; faces ((3 7 6 2)); }}
    sideR  {{ type symmetryPlane; faces ((1 5 4 0)); }}
);
'''
    files['system/surfaceFeaturesDict'] = H('dictionary', 'surfaceFeaturesDict', 'system') + f'''
surfaces ("{N}.stl");
includedAngle 150;
writeObj no;
'''
    files['system/snappyHexMeshDict'] = H('dictionary', 'snappyHexMeshDict', 'system') + f'''
castellatedMesh true; snap true; addLayers true;
geometry
{{
    {N} {{ type triSurfaceMesh; file "{N}.stl"; }}
{P["boxes"]}
}}
castellatedMeshControls
{{
    maxLocalCells {max_local}; maxGlobalCells 40000000; minRefinementCells 10;
    maxLoadUnbalance 0.10; nCellsBetweenLevels 3;
    features ( {{ file "{N}.eMesh"; level 6; }} );
    refinementSurfaces {{ {N} {{ level (6 6); }} }}
    resolveFeatureAngle 30;
    refinementRegions
    {{
        box2 {{ mode inside; level 2; }}
        box3 {{ mode inside; level 3; }}
        box4 {{ mode inside; level 4; }}
{P["extraRegions"]}    }}
    insidePoint {P["insidePoint"]};
    allowFreeStandingZoneFaces false;
}}
snapControls
{{
    nSmoothPatch 3; tolerance 2.0; nSolveIter 50; nRelaxIter 5;
    nFeatureSnapIter 10; implicitFeatureSnap false; explicitFeatureSnap true; multiRegionFeatureSnap true;
}}
addLayersControls
{{
    relativeSizes true;
    layers {{ "{N}.*" {{ nSurfaceLayers 3; }} }}
    expansionRatio 1.2; finalLayerThickness 0.4; minThickness 0.1; nGrow 0;
    featureAngle 120; slipFeatureAngle 30; nRelaxIter 3; nSmoothSurfaceNormals 1;
    nSmoothNormals 3; nSmoothThickness 10; maxFaceThicknessRatio 0.5;
    maxThicknessToMedialRatio 0.3; minMedianAxisAngle 90; nBufferCellsNoExtrude 0; nLayerIter 50;
}}
meshQualityControls
{{
    maxNonOrtho 65; maxBoundarySkewness 20; maxInternalSkewness 4; maxConcave 80;
    minFlatness 0.5; minVol 1e-13; minTetQuality 1e-15; minTwist 0.02; minDeterminant 0.001;
    minFaceWeight 0.05; minVolRatio 0.01; nSmoothScale 4; errorReduction 0.75;
}}
mergeTolerance 1e-6;
'''
    files['system/decomposeParDict'] = H('dictionary', 'decomposeParDict', 'system') + f'numberOfSubdomains {NPROC};\nmethod scotch;\n'
    files['system/fvSchemes'] = H('dictionary', 'fvSchemes', 'system') + '''
ddtSchemes { default steadyState; }
gradSchemes { default Gauss linear; grad(U) cellLimited Gauss linear 1; }
divSchemes
{
    default none;
    div(phi,U) bounded Gauss linearUpwind grad(U);
    div(phi,k) bounded Gauss upwind;
    div(phi,omega) bounded Gauss upwind;
    div((nuEff*dev2(T(grad(U))))) Gauss linear;
}
laplacianSchemes { default Gauss linear corrected; }
interpolationSchemes { default linear; }
snGradSchemes { default corrected; }
wallDist { method meshWave; }
'''
    files['system/fvSolution'] = H('dictionary', 'fvSolution', 'system') + '''
solvers
{
    p { solver GAMG; smoother GaussSeidel; tolerance 1e-7; relTol 0.1; }
    Phi { $p; }
    "(U|k|omega)" { solver smoothSolver; smoother symGaussSeidel; tolerance 1e-8; relTol 0.1; nSweeps 1; }
}
SIMPLE
{
    nNonOrthogonalCorrectors 0; consistent yes;
    residualControl { p 1e-5; U 1e-6; "(k|omega)" 1e-6; }
}
potentialFlow { nNonOrthogonalCorrectors 10; }
relaxationFactors { equations { U 0.9; ".*" 0.7; } }
'''
    files['constant/physicalProperties'] = H('dictionary', 'physicalProperties', 'constant') + f'viscosityModel constant;\nnu [0 2 -1 0 0 0 0] {NU};\n'
    files['constant/momentumTransport'] = H('dictionary', 'momentumTransport', 'constant') + 'simulationType RAS;\nRAS { model kOmegaSST; turbulence on; printCoeffs on; }\n'

    def field(name, cls, dims, internal, inlet, outlet, ground, body):
        s = H(cls, name, '0') + f'dimensions {dims};\ninternalField {internal};\nboundaryField\n{{\n'
        s += f'    inlet {{ {inlet} }}\n    outlet {{ {outlet} }}\n    ground {{ {ground} }}\n    "{N}.*" {{ {body} }}\n'
        # processor patches need an entry or the decomposed fields cannot be read
        s += '    "(top|side.*)" { type symmetryPlane; }\n    "proc.*" { type processor; }\n}\n'
        return s
    uv = f'uniform ({U} 0 0)'
    files['0/U'] = field('U', 'volVectorField', '[0 1 -1 0 0 0 0]', uv, f'type fixedValue; value {uv};',
        f'type inletOutlet; inletValue uniform (0 0 0); value {uv};', f'type movingWallVelocity; value {uv};', 'type noSlip;')
    files['0/p'] = field('p', 'volScalarField', '[0 2 -2 0 0 0 0]', 'uniform 0', 'type zeroGradient;',
        'type fixedValue; value uniform 0;', 'type zeroGradient;', 'type zeroGradient;')
    files['0/k'] = field('k', 'volScalarField', '[0 2 -2 0 0 0 0]', f'uniform {k:.6g}', f'type fixedValue; value uniform {k:.6g};',
        f'type inletOutlet; inletValue uniform {k:.6g}; value uniform {k:.6g};',
        f'type kqRWallFunction; value uniform {k:.6g};', f'type kqRWallFunction; value uniform {k:.6g};')
    files['0/omega'] = field('omega', 'volScalarField', '[0 0 -1 0 0 0 0]', f'uniform {omega:.6g}', f'type fixedValue; value uniform {omega:.6g};',
        f'type inletOutlet; inletValue uniform {omega:.6g}; value uniform {omega:.6g};',
        f'type omegaWallFunction; value uniform {omega:.6g};', f'type omegaWallFunction; value uniform {omega:.6g};')
    files['0/nut'] = field('nut', 'volScalarField', '[0 2 -1 0 0 0 0]', 'uniform 0', 'type calculated; value uniform 0;',
        'type calculated; value uniform 0;', 'type nutkWallFunction; value uniform 0;', 'type nutkWallFunction; value uniform 0;')
    # The OpenFOAM bashrc exits non-zero under `set -e`, so it is sourced first.
    # SKIPMESH=1 reruns the solve on an existing decomposed mesh.
    files['Allrun'] = f'''#!/bin/bash
cd "${{0%/*}}"
source /opt/openfoam12/etc/bashrc || true
set -e
if [ -z "$SKIPMESH" ]; then
blockMesh > log.blockMesh 2>&1
surfaceFeatures > log.surfaceFeatures 2>&1
decomposePar -copyZero -force > log.decomposePar 2>&1
fi
[ -n "$SKIPMESH" ] || mpirun --allow-run-as-root -np {NPROC} snappyHexMesh -parallel -overwrite > log.snappyHexMesh 2>&1
mpirun --allow-run-as-root -np {NPROC} checkMesh -parallel > log.checkMesh 2>&1 || true
mpirun --allow-run-as-root -np {NPROC} renumberMesh -parallel -overwrite > log.renumberMesh 2>&1
mpirun --allow-run-as-root -np {NPROC} potentialFoam -parallel -initialiseUBCs > log.potentialFoam 2>&1
mpirun --allow-run-as-root -np {NPROC} foamRun -parallel > log.foamRun 2>&1
echo DONE > DONE
'''
    return files


# ---------------------------------------------------------------------------------------------
# Transient DES variant (turbulence "ddes"). The RANS files above are written unchanged; a "ddes"
# request ADDS des/system/{controlDict,fvSchemes,fvSolution}, des/constant/momentumTransport and
# AllrunDES. The workflow is the OpenFOAM 12 motorBike LES one: run the steady RANS case, move its
# last time into 0, swap in the transient dictionaries, run foamRun again.
#   tutorials/incompressibleFluid/motorBike/lesFiles/{Allrun,controlDict,fvSchemes,fvSolution,momentumTransport}
# This template has never been run. Every number below is a choice or a formula, stated where used.
# ---------------------------------------------------------------------------------------------
TURBULENCE = ("rans", "ddes")
DES_DEFAULTS = {
    # choices, not published values: ~5 flow-throughs (L/U) to flush the RANS start-up transient,
    # ~10 to average over; the statistics in force-coeffs.js decide whether that was enough.
    "flowThroughsDiscard": 5.0, "flowThroughsAverage": 10.0,
    # target maximum Courant number of the finest cells (see des_timing); 1 is a choice.
    "cflTarget": 1.0,
}
# Peak local speed assumed in the finest cells, as a multiple of the free stream: a choice (flow
# over a bluff body's roof/shoulder reaches about 1.3-1.5 U; not computed from this mesh).
U_PEAK_FACTOR = 1.5
CDES = 0.61          # kOmegaSSTDES.C: CDES default 0.61 (written explicitly)
FSST = 2             # kOmegaSSTDES.C FDES(): case 2 = Lt*(1 - F2)/(CDES*delta), the DDES-style F2 shielding
DELTA_COEFF = 2      # maxDeltaxyz.H: for a regular hex cell delta = half the width, so deltaCoeff 2 gives the max edge


def surface_level(files):
    """Finest snappyHexMesh surface refinement level, read from the snappy dictionary actually written."""
    m = re.search(r'refinementSurfaces\s*\{\s*\S+\s*\{\s*level\s*\((\d+)\s+(\d+)\)', files['system/snappyHexMeshDict'])
    if not m:
        raise ValueError("cannot read the refinement level from snappyHexMeshDict")
    return max(int(m.group(1)), int(m.group(2)))


def base_cell(block):
    """Largest blockMesh cell edge (m): extent / count per axis, from a written blockMeshDict."""
    vs = re.search(r'vertices\s*\((.*?)\)\s*;', block, re.S).group(1)
    pts = [tuple(float(x) for x in t.split()) for t in re.findall(r'\(([^()]*)\)', vs)]
    n = [int(x) for x in re.search(r'hex\s*\([^)]*\)\s*\((\d+)\s+(\d+)\s+(\d+)\)', block).groups()]
    lo, hi = pts[0], pts[6]
    return max((hi[i] - lo[i]) / n[i] for i in range(3))


def des_timing(h_fine, lref, cfl, n_discard, n_average):
    """
    Time step and run length. dt = cfl * h_fine / (U_PEAK_FACTOR * U), rounded DOWN to 2 significant
    digits (so Co <= cfl is kept), h_fine = the finest cell edge = blockMesh cell / 2^surface level.
    One flow-through is lref / U. endTime = ceil(total / dt) whole steps.
    """
    raw = cfl * h_fine / (U_PEAK_FACTOR * U)
    e = math.floor(math.log10(raw))
    dt = float(f"{math.floor(raw / 10**e * 10 + 1e-9) / 10:.1f}e{e}")
    t_ft = lref / U
    steps = lambda t: int(math.ceil(t / dt - 1e-9))
    n_total = steps((n_discard + n_average) * t_ft)
    return {
        "dtS": dt, "hFineM": h_fine, "cflTarget": cfl, "uPeakFactor": U_PEAK_FACTOR,
        "flowThroughS": t_ft, "stepsPerFlowThrough": steps(t_ft),
        "discardTimeS": float(f"{n_discard * t_ft:.10g}"), "windowTimeS": float(f"{n_average * t_ft:.10g}"),
        "flowThroughsDiscard": n_discard, "flowThroughsAverage": n_average,
        "totalSteps": n_total, "endTimeS": float(f"{n_total * dt:.10g}"),
        "model": "kOmegaSSTDES", "FSST": FSST, "CDES": CDES, "delta": "maxDeltaxyz", "deltaCoeff": DELTA_COEFF,
    }


def build_des(files, des, nproc, ransEnd):
    """Adds the transient overlay to `files` (in place)."""
    # Same function objects as the RANS controlDict (forceCoeffs written EVERY step: writeInterval 1).
    rc = files['system/controlDict']
    funcs = rc[rc.index('functions\n'):]
    files['des/system/controlDict'] = H('dictionary', 'controlDict', 'system') + f'''
application foamRun;
solver incompressibleFluid;
startFrom startTime; startTime 0; stopAt endTime; endTime {des["endTimeS"]:.8g}; deltaT {des["dtS"]:.8g};
// fixed dt from cflTarget (openfoam_case.py des_timing); adjustTimeStep is NOT used, so the
// force series is uniformly spaced, which force-coeffs.js timeWindowStatistics requires.
writeControl timeStep; writeInterval {des["stepsPerFlowThrough"]}; purgeWrite 2; writeFormat binary;
writePrecision 8; writeCompression off; timeFormat general; timePrecision 8;
runTimeModifiable true;
{funcs}'''
    # fvSchemes: motorBike/lesFiles/fvSchemes (backward, LUST unlimitedGrad(U), limitedLinear 1 on the
    # turbulence scalars, limited corrected 0.33); omega takes the same scheme as k (an extension of the tutorial).
    files['des/system/fvSchemes'] = H('dictionary', 'fvSchemes', 'system') + '''
ddtSchemes { default backward; }
gradSchemes { default Gauss linear; grad(U) cellLimited Gauss linear 1; }
divSchemes
{
    default none;
    div(phi,U) Gauss LUST unlimitedGrad(U);
    div(phi,k) Gauss limitedLinear 1;
    div(phi,omega) Gauss limitedLinear 1;
    div((nuEff*dev2(T(grad(U))))) Gauss linear;
}
laplacianSchemes { default Gauss linear limited corrected 0.33; }
interpolationSchemes { default linear; }
snGradSchemes { default limited corrected 0.33; }
wallDist { method meshWave; }
'''
    # fvSolution: motorBike/lesFiles/fvSolution (PIMPLE nCorrectors 3, pFinal relTol 0, U/k relTol 0)
    files['des/system/fvSolution'] = H('dictionary', 'fvSolution', 'system') + '''
solvers
{
    p { solver GAMG; tolerance 1e-6; relTol 0.05; smoother GaussSeidel; nCellsInCoarsestLevel 50; }
    pFinal { $p; relTol 0; }
    "(U|k|omega).*" { solver smoothSolver; smoother symGaussSeidel; tolerance 1e-7; relTol 0; }
}
PIMPLE { nCorrectors 3; nNonOrthogonalCorrectors 0; }
relaxationFactors { "U.*" 1; "(k|omega).*" 1; }
'''
    # momentumTransport: LES block layout as motorBike/lesFiles/momentumTransport; model kOmegaSSTDES
    # (src/MomentumTransportModels/momentumTransportModels/LES/kOmegaSSTDES/kOmegaSSTDES.C reads CDES and FSST
    # from kOmegaSSTDESCoeffs); delta maxDeltaxyz (LES/LESdeltas/maxDeltaxyz reads deltaCoeff from maxDeltaxyzCoeffs).
    files['des/constant/momentumTransport'] = H('dictionary', 'momentumTransport', 'constant') + f'''
simulationType LES;
LES
{{
    model kOmegaSSTDES;
    delta maxDeltaxyz;
    turbulence on;
    printCoeffs on;
    kOmegaSSTDESCoeffs {{ CDES {CDES}; FSST {FSST}; }}
    maxDeltaxyzCoeffs {{ deltaCoeff {DELTA_COEFF}; }}
}}
'''
    files['AllrunDES'] = f'''#!/bin/bash
# Stage 2 of the DDES case: run AFTER ./Allrun has finished the steady RANS (DONE exists). Same
# procedure as OpenFOAM 12 tutorials/incompressibleFluid/motorBike/lesFiles/Allrun.
cd "${{0%/*}}"
source /opt/openfoam12/etc/bashrc || true
set -e
[ -f DONE ] || {{ echo "run ./Allrun (steady RANS, endTime {ransEnd}) first"; exit 1; }}
[ ! -d postProcessing.rans ] || {{ echo "postProcessing.rans exists: stage 2 was already started"; exit 1; }}
LATEST=$(ls processor0 | grep -E '^[0-9.]+$' | sort -g | tail -1)
[ "$LATEST" = "{ransEnd}" ] || {{ echo "latest RANS time is $LATEST, expected {ransEnd}"; exit 1; }}
mv postProcessing postProcessing.rans
for p in processor*; do
  rm -rf "$p/0"
  mv "$p/$LATEST" "$p/0"
  rm -rf "$p/0/uniform"
  for t in $(ls "$p" | grep -E '^[0-9.]+$' | grep -vx 0); do rm -rf "$p/$t"; done
done
cp des/system/controlDict des/system/fvSchemes des/system/fvSolution system/
cp des/constant/momentumTransport constant/
mpirun --allow-run-as-root -np {nproc} foamRun -parallel > log.foamRun.des 2>&1
echo DONE > DONE.des
'''
    return files


def case_hash(files):
    h = hashlib.sha256()
    for p in sorted(files):
        h.update(p.encode()); h.update(b"\0"); h.update(files[p].encode()); h.update(b"\0")
    return h.hexdigest()


def main():
    try:
        req = json.load(sys.stdin)
        preset = req.get("preset")
        if preset not in PRESETS:
            raise ValueError(f"preset must be one of {sorted(PRESETS)}")
        nproc = req.get("nproc"); endt = req.get("endTime")
        if not isinstance(nproc, int) or isinstance(nproc, bool) or not 1 <= nproc <= 4096:
            raise ValueError("nproc must be an integer 1..4096")
        if not isinstance(endt, int) or isinstance(endt, bool) or not 1 <= endt <= 100000:
            raise ValueError("endTime must be an integer 1..100000")
        if preset == "ahmed":
            aref = 0.389*0.288; lref = 1.044
        else:
            aref = req.get("aref"); lref = req.get("lref")
            for nm, v in (("aref", aref), ("lref", lref)):
                if not isinstance(v, (int, float)) or isinstance(v, bool) or not v > 0 or v != v or v == float("inf"):
                    raise ValueError(f"{nm} must be a positive finite number (m2 / m)")
            aref = float(aref); lref = float(lref)
        refinement = req.get("refinement", "medium")
        if refinement is None or refinement not in REFINEMENTS:
            raise ValueError(f"refinement must be one of {sorted(REFINEMENTS)}")
        turb = req["turbulence"] if "turbulence" in req else "rans"
        if turb not in TURBULENCE:
            raise ValueError(f"turbulence must be one of {list(TURBULENCE)}, got {json.dumps(turb)}")
        des_req = {k: req[k] for k in DES_DEFAULTS if k in req}
        if turb == "rans" and des_req:
            raise ValueError(f"{sorted(des_req)} only apply with turbulence \"ddes\"")
        files = build(PRESETS[preset], nproc, endt, aref, lref, refinement)
        des = None
        if turb == "ddes":
            if endt % 500:
                raise ValueError("with turbulence \"ddes\" endTime (the RANS stage) must be a multiple of 500, the RANS writeInterval, so its last time is written")
            vals = {**DES_DEFAULTS, **des_req}
            for nm, v in vals.items():
                if not isinstance(v, (int, float)) or isinstance(v, bool) or not v > 0 or v != v or v == float("inf"):
                    raise ValueError(f"{nm} must be a positive finite number")
            if vals["cflTarget"] > 2:
                raise ValueError("cflTarget must be <= 2 (DES with a low-dissipation scheme wants Co of order 1)")
            if vals["flowThroughsAverage"] < 2:
                raise ValueError("flowThroughsAverage must be >= 2 flow-throughs")
            # Finest cell of the mesh this request wrote. refinement scales blockMesh; the snappy
            # level does not. The preset template still contains @CELLS@, so the count comes from
            # the written blockMeshDict, not from the template text.
            h_fine = base_cell(files["system/blockMeshDict"]) / 2 ** surface_level(files)
            des = des_timing(h_fine, lref, float(vals["cflTarget"]), float(vals["flowThroughsDiscard"]), float(vals["flowThroughsAverage"]))
            if des["totalSteps"] > 10_000_000:
                raise ValueError("more than 1e7 time steps: the request is not a usable DES run")
            if des["stepsPerFlowThrough"] * 1 < 20:
                raise ValueError("fewer than 20 steps per flow-through")
            build_des(files, des, nproc, endt)
        out = req.get("outDir")
        if out:
            for p, txt in files.items():
                full = os.path.join(out, p)
                os.makedirs(os.path.dirname(full), exist_ok=True)
                with open(full, "w") as f:
                    f.write(txt)
            os.chmod(os.path.join(out, "Allrun"), 0o755)
            if "AllrunDES" in files:
                os.chmod(os.path.join(out, "AllrunDES"), 0o755)
        reply = {
            "ok": True, "preset": preset, "aref": aref, "lref": lref, "speedMs": U, "nu": NU,
            "fits": PRESETS[preset]["fits"],
            "refinement": refinement, "blockCells": list(block_cells(PRESETS[preset], refinement)),
            "refinementStep": R_STEP,
            "domainVolumeM3": PRESETS[preset]["extent"][0] * PRESETS[preset]["extent"][1] * PRESETS[preset]["extent"][2],
            # hash of the files refinement does not touch: equal across a study's levels
            "solverSetupSha256": case_hash({p: t for p, t in files.items() if p.startswith(("0/", "constant/")) or p in ("system/controlDict", "system/fvSchemes", "system/fvSolution", "system/decomposeParDict", "system/surfaceFeaturesDict")}),
            "files": {p: hashlib.sha256(t.encode()).hexdigest() for p, t in sorted(files.items())},
            "caseSha256": case_hash(files),
        }
        if des is not None:
            reply["turbulence"] = turb
            reply["des"] = des
        print(json.dumps(reply))
    except Exception as e:  # noqa: BLE001 - every failure goes back as JSON
        print(json.dumps({"ok": False, "error": str(e)}))


if __name__ == "__main__":
    main()
