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
| CLI (`case`, `import`; `--turbulence ddes`) | `server/scripts/conkay-cfd.mjs` |
| tests + fixtures | `server/tests/conkay-aero-cfd.test.js`, `server/tests/conkay-cfd-des.test.js`, `server/tests/fixtures/conkay-cfd/` |

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
ground; one mesh, no grid-convergence study.

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

## Transient DES (`--turbulence ddes`) — template written, NEVER RUN

Why: the steady k-ω SST run on Ahmed 25° did not settle (slant Cd 0.146 → 0.115 and base 0.123 →
0.138 between iterations 2000 and 2300: the slant flow progressively separating at Ahmed's critical,
bistable angle). A steady solver has no one answer there; the usual remedy is a scale-resolving
run with time-averaged forces. **Passing tests does not validate this template**: no DES case has
been made, `AHMED_DES_VALIDATION` is `pending`, and until a DES Ahmed run passes the same ±5 % gate
no DES car result is reported.

**Model.** `kOmegaSSTDES` with `FSST 2` and `CDES 0.61`, written explicitly. OpenFOAM 12 has no
separately named SST-DDES: its `FDES()` switch `FSST 2` is `Lt·(1 − F2)/(CDES·Δ)`, the F2-shielded
(delayed) form of Menter, Kuntz & Langtry (2003) (`src/MomentumTransportModels/momentumTransportModels/LES/kOmegaSSTDES/kOmegaSSTDES.C`,
default `FSST 2`, `CDES 0.61`). `SpalartAllmarasDDES`/`IDDES` also exist in OpenFOAM 12 but need
`nuTilda` fields, so they could not start from the k-ω SST RANS solution the template already makes;
`iddes` is therefore refused. **Δ:** `maxDeltaxyz` with `deltaCoeff 2` — the maximum cell edge
(`LES/LESdeltas/maxDeltaxyz`: for a regular hex the delta is half the width, so 2 gives the full
edge). The OpenFOAM 12 `motorBike/lesFiles` tutorial uses `cubeRootVol`; the maximum edge is the
classical DES length scale, so it is used here. Both the delta type and `FSST 2` are choices.

**Numerics** (mirroring `tutorials/incompressibleFluid/motorBike/lesFiles/{fvSchemes,fvSolution}`):
`backward` in time; `div(phi,U) Gauss LUST unlimitedGrad(U)`; `limitedLinear 1` on k and ω (the
tutorial gives k; ω is the same choice); `limited corrected 0.33` for Laplacian and snGrad (the
snappyHexMesh mesh allows 65° non-orthogonality); PIMPLE `nCorrectors 3`, `pFinal relTol 0`.

**Time step.** Fixed (so the force series is uniformly spaced, which the statistics require):
`Δt = cflTarget · h_fine / (1.5 · U)`, rounded **down** to two significant digits; `h_fine` is the
blockMesh cell divided by `2^level`, both read from the files the kernel writes (Ahmed: 0.1 m / 64 =
1.5625 mm, `Δt = 2.6e-5 s`). `cflTarget` defaults to 1 and the 1.5 is an assumed peak local speed
(a choice, not computed from the mesh). Δt is not adaptive: the request's Courant bound holds only
at that assumed speed, and the first run must read the real maximum Courant number from its log.

**Start.** From the steady RANS solution, as the OpenFOAM 12 `motorBike` LES tutorial does:
`./Allrun` (RANS, `--end` iterations, a multiple of 500), then `./AllrunDES` moves the last RANS
time into `0` in every `processor*`, drops `uniform`, moves the RANS `postProcessing` to
`postProcessing.rans`, copies the `des/` dictionaries over `system/` and `constant/`, and runs
`foamRun -parallel`. The forceCoeffs objects write every time step.

**Averaging.** `flowThroughsDiscard` (default 5) flow-throughs of `L_ref/U` are discarded, then
`flowThroughsAverage` (default 10) are averaged — choices, not published values; the statistics
decide whether they were enough. `case.json` records the window in seconds (`des.discardTimeS`,
`des.windowTimeS`) and the record's `case.turbulence` selects the reducer in `aero.cfd`.

**Statistics** (`timeWindowStatistics`, `timeWindowVerdict` in `force-coeffs.js`). Mean and sd over
the window; the uncertainty of the mean by non-overlapping **batch means** (Conway 1963; batch count
per Schmeiser 1982 — cited from memory, not re-read): 20 batches, standard error
`sd(batch means)/√20`, 95 % Student-t half-width (t = 2.093, 19 d.f.). That accounts for
autocorrelation; the naive `sd/√n` is reported beside it, along with the effective sample count
(`sd²/Var(mean)`) and the integral time scale (`Var(mean)·T/(2 sd²)`). The window counts as settled
only when (a) the two halves' means differ by less than the 95 % interval of their difference
(per-half batch standard errors, t = 2.262, 9 d.f.), (b) the 95 % half-width is ≤ 2 % of the mean, and
(c) the lag-1 autocorrelation of the batch means is ≤ 0.5 (else batches are shorter than the
integral time scale and the interval is not trustworthy). All limits are choices (`TRANSIENT_LIMITS`).
A batch shorter than a dominant oscillation period makes the interval wide — honestly so.

**Gate.** `validationFor("ddes")` is a separate record from the RANS one, and `validationAccepted`
refuses a record of the other model, so neither validation unlocks the other's result.

**Cost (an estimate, not a measurement).** Ahmed: ~5.6 M cells, `Δt = 2.6e-5 s`, 15 flow-throughs
of 0.0261 s ≈ 15 000 steps. The steady run took ~4.4 s per iteration on 7 cores (0.8 µs per cell per
iteration); a PIMPLE step with 3 pressure correctors and an implicit `backward` scheme is
assumed to cost about 2–4× a SIMPLE iteration, i.e. ~9–18 s per step → roughly **40–75 hours** for the
DES stage, plus ~5 h for 4000 RANS iterations. The car preset (~8 M cells, Δt 1e-4 s, 19 400 steps at
~5 s per SIMPLE iteration) would be roughly **80–160 hours**. The step cost multiplier is a guess; the first
100 steps of a real run replace this paragraph. `--ft-average 5` halves the averaging cost at the
price of a wider interval.

```bash
node server/scripts/conkay-cfd.mjs case --ahmed --out /tmp/ahmed-des --nproc 7 --end 4000 --turbulence ddes \
  [--ft-discard 5] [--ft-average 10] [--cfl 1]
# on the CFD machine: ./tessellate.sh (car only) && ./Allrun && ./AllrunDES   # AllrunDES writes DONE.des
```

Not verified against a real OpenFOAM: the dictionaries were checked keyword by keyword against
the OpenFOAM 12 sources and tutorials named above, not run. Note also that `kernelSha256` changes
whenever `openfoam_case.py` changes, so records made before this change must be re-imported with
their case regenerated before `aero.cfd` will accept them.
