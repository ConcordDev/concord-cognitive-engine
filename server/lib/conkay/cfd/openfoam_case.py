#!/usr/bin/env python3
# server/lib/conkay/cfd/openfoam_case.py
#
# Writes an OpenFOAM 12 external-aero case (foamRun, incompressibleFluid, steady SIMPLE,
# k-omega SST, wall functions, snappyHexMesh with 3 layers, moving ground). Stdlib only.
#
# Request (JSON on stdin):
#   { "preset": "ahmed" | "car5m", "outDir": "...", "nproc": int, "endTime": int,
#     "aref": m2 (car5m only), "lref": m (car5m only),
#     "refinement": "coarse" | "medium" (default) | "fine" }
# Reply (JSON on stdout): { ok, preset, files: { path: sha256 }, caseSha256 } or { ok: false, error }.
#
# The templates are the ones the recorded runs were made with (docs/CONKAY-AERO-CFD.md);
# caseSha256 is the hash of the written files, so a run can be matched to its exact case.
#
# Flow: 40 m/s (the Lienhart & Becker / ERCOFTAC 082 speed), nu 1.5e-5 -> Re_L 2.78e6 on the
# Ahmed body. Ahmed's 0.285 total was measured at Re_L 4.29e6 (60 m/s); stated, not adjusted.
# Inlet turbulence: intensity 0.5 %, length scale 0.1 m.
import hashlib, json, os, sys

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
        files = build(PRESETS[preset], nproc, endt, aref, lref, refinement)
        out = req.get("outDir")
        if out:
            for p, txt in files.items():
                full = os.path.join(out, p)
                os.makedirs(os.path.dirname(full), exist_ok=True)
                with open(full, "w") as f:
                    f.write(txt)
            os.chmod(os.path.join(out, "Allrun"), 0o755)
        print(json.dumps({
            "ok": True, "preset": preset, "aref": aref, "lref": lref, "speedMs": U, "nu": NU,
            "fits": PRESETS[preset]["fits"],
            "refinement": refinement, "blockCells": list(block_cells(PRESETS[preset], refinement)),
            "refinementStep": R_STEP,
            "domainVolumeM3": PRESETS[preset]["extent"][0] * PRESETS[preset]["extent"][1] * PRESETS[preset]["extent"][2],
            # hash of the files refinement does not touch: equal across a study's levels
            "solverSetupSha256": case_hash({p: t for p, t in files.items() if p.startswith(("0/", "constant/")) or p in ("system/controlDict", "system/fvSchemes", "system/fvSolution", "system/decomposeParDict", "system/surfaceFeaturesDict")}),
            "files": {p: hashlib.sha256(t.encode()).hexdigest() for p, t in sorted(files.items())},
            "caseSha256": case_hash(files),
        }))
    except Exception as e:  # noqa: BLE001 - every failure goes back as JSON
        print(json.dumps({"ok": False, "error": str(e)}))


if __name__ == "__main__":
    main()
