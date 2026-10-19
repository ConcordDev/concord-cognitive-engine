# ConKay aero.cfd — OpenFOAM drag for the CAD body

`aero.cfd` reports the drag of a `cad.body` from a **recorded** OpenFOAM run. OpenFOAM runs for
hours on a separate machine, so the solver never starts it: it looks up the run recorded for the
exact body and re-derives the drag from the run's copied force files.

| piece | file |
|---|---|
| case kernel (stdlib Python, presets `ahmed`, `car5m`) | `server/lib/conkay/cfd/openfoam_case.py` |
| Ahmed 25° geometry (gmsh, OCC kernel) | `server/lib/conkay/cfd/ahmed.geo` |
| forceCoeffs parser, tail statistics, settled check | `server/lib/conkay/cfd/force-coeffs.js` |
| run store (receipts keyed by the cad.body request hash) | `server/lib/conkay/cfd/run-store.js` |
| Ahmed acceptance gate | `server/lib/conkay/cfd/validation.js` |
| solver | `server/lib/conkay/physics/solvers/aero-cfd.js` |
| CLI (`case`, `import`) | `server/scripts/conkay-cfd.mjs` |
| tests + fixtures | `server/tests/conkay-aero-cfd.test.js`, `server/tests/fixtures/conkay-cfd/` |

## The case

OpenFOAM 12, `foamRun` with `incompressibleFluid`; steady SIMPLE (consistent); k-ω SST with wall
functions; snappyHexMesh, surface level 6, 3 prism layers; 40 m/s, ν 1.5e-5 m²/s; moving ground;
symmetry planes on the top and sides; inlet turbulence 0.5 % with a 0.1 m length scale (a choice).

The kernel replies with the sha256 of every file it writes and `caseSha256` over all of them. The
four recorded cases (Ahmed at 2000 and 4000 iterations, two car stances) were diffed byte-for-byte
against the dictionaries that ran; their hashes are pinned in the test.

## When aero.cfd reports a number

All of these must hold, otherwise the result is NOT_COMPUTED with the reason:

1. a run is recorded under this body's `cad.body` kernel request hash;
2. the recorded STEP sha256 equals the body's current STEP file;
3. every copied file matches its receipt hash;
4. the run was made from the current case kernel (`kernelSha256`);
5. the run settled: over the last 500 iterations, sd/mean ≤ 2 % and the two half-window means agree
   within 1 % (`CONVERGENCE_LIMITS`; a choice, not a published standard);
6. the same template's Ahmed 25° run is settled and within ±5 % of Gant's 0.285 (`validation.js`).

A run that fails 5 or 6 keeps its statistics in the envelope, labelled `not_a_result`.

## Ahmed 25° validation — status: PENDING

First run: 5.62 M cells, 3 layers at 99–100 % coverage, 2000 iterations, 7 MPI ranks.

| 250-it block ending | total | slant | base |
|---|---|---|---|
| 1000 | 0.2983 | 0.1652 | 0.1059 |
| 1500 | 0.2963 | 0.1520 | 0.1173 |
| 2000 | 0.2918 | 0.1326 | 0.1323 |
| published (Gant from SAE 840300) | 0.285 | 0.140 | 0.070 |
| published (Lienhart, via Gant) | — | 0.158 | 0.116 |

The total over the last 500 iterations is 0.2934 (+2.9 %), but the run is **not settled**: pressure is
moving from the slant to the base (the slant flow progressively separating; 25° is Ahmed's critical
angle, where the flow is bistable), and the half-window drift of the total is 1.1 %. Under the
limits above that run is not accepted, and the number is not a validation. The run is being extended
to 4000 iterations; `validation.js` will be filled from the extended run's fixture, and the test
re-derives it from that fixture.

Even if the total is accepted, the component split is not: the base is high and the nose low against
Gant, and the two errors partly cancel.

Caveats regardless of the outcome: 40 m/s (Re_L 2.78e6) vs Ahmed's 60 m/s; stilts omitted; moving
ground; the validation run is a single mesh (see Grid convergence below for the study tooling; no
study has been run yet).

## Grid convergence

`openfoam_case.py` takes an optional `refinement` of `coarse`, `medium` (default) or `fine`. `medium`
is exactly the mesh above (the pinned `caseSha256` values are unchanged); an unknown value is an
error. Every blockMesh axis count is scaled by sqrt 2 per step (Ahmed 80x20x14 becomes 57x14x10 /
113x28x20; car 85x30x15 becomes 60x21x11 / 120x42x21) and the snappy refinement levels stay put, so
every cell size, the layers included (`relativeSizes`), scales by the same r = 1.414, above the 1.3
that Celik et al. (2008, Step 2) ask for. A ratio of 2 (one snappy level) would make the fine Ahmed
mesh about 45 M cells; sqrt 2 gives about 2.8x the cells per step (~2 M / 5.6 M / ~16 M for Ahmed).
Axis counts are rounded and snappy snapping is not self-similar, so the study uses the realised cell
counts, not the nominal r. The fine level raises `maxLocalCells` to 6 M (per rank) so refinement is
not cut short; the other files are byte-identical across levels (`solverSetupSha256` proves it).

```bash
node server/scripts/conkay-cfd.mjs case --body <hash> --out /tmp/car-fine --refinement fine
# run it, then import; non-medium runs are stored beside the medium one as <hash>.fine / <hash>.coarse
node server/scripts/conkay-cfd.mjs import --body <hash> --run /tmp/car-fine
```

`cfd/gci.js` is the Celik et al. (2008) procedure (Eqs. 1-7: apparent order by fixed-point iteration,
extrapolated value, e_a, e_ext, GCI_fine). Oscillatory, divergent, zero-difference or
non-converging series give no number. `cfd/mesh-study.js` reduces the three runs with the usual tail
statistics, requires each level to be settled and the cases to differ only in `refinement`, takes
h = (domain volume / snappy cell count)^(1/3), and feeds the GCI. When coarse/fine runs are
recorded for a body, `aero.cfd` adds a `discretizationUncertainty` output; it never changes the
settled/Ahmed verdict. The GCI is the discretization error of Cd for this mesh family only, not
turbulence-model error and not validation; the bluff-body wake's iterative scatter (up to the 2 %
settled limit) can be as large as the level-to-level differences.

Acceptance: `tests/conkay-cfd-gci.test.js` reproduces the three columns of Table 1 of the JFE
procedure (p, phi_ext, e_a, e_ext, GCI_fine; backward-facing step data of Celik & Karatekin) and
recovers p and phi_0 from exact power series. Note the kernel's file hash changed (new code), so
runs recorded under the previous `kernelSha256` must be re-recorded or re-stamped before `aero.cfd`
accepts them.

## Running a case

```bash
# on the Mac: write the case for a cad.body (its request hash is in cad.body's outputs.kernel)
node server/scripts/conkay-cfd.mjs case --body <hash> --out /tmp/car-case --nproc 7 --end 4000
# copy to the CFD machine, then there:
./tessellate.sh && ./Allrun          # writes DONE when finished
# copy the finished case dir back (postProcessing/, log.*, case.json, surface.json), then:
node server/scripts/conkay-cfd.mjs import --body <hash> --run /tmp/car-case --host "<machine>"
```

Size `--nproc` to the machine's **real** CPU quota (`cat /sys/fs/cgroup/cpu.max`), not `nproc`: the
RunPod A40 pod reports 96 CPUs but its container quota is 7.65 cores (`765000 100000`), and MPI jobs
sized to 48–88 ranks time-sliced to a crawl. On that pod the 5.6 M-cell Ahmed case takes about
4.4 s per iteration and the 8 M-cell car case about 5 s.

## Problems met on the first run (each pinned by a test)

- the OpenFOAM `bashrc` exits non-zero under `set -e`: `Allrun` sources it first;
- two side faces in one `symmetryPlane` patch are not one plane: `sideL` / `sideR`;
- decomposed fields need a `"proc.*" { type processor; }` entry;
- `potentialFoam` needs a `Phi` solver entry;
- OpenFOAM 12's `reconstructParMesh` is a stub that prints a notice and exits 0: do not delete
  `processor*` after it (a finished mesh was lost this way).
