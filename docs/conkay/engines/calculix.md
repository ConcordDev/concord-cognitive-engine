# Engine: calculix — CalculiX structural FEA · SXE-07

The structural workhorse (statics, modal, buckling,
contact, thermal-structural) for the frame / machine /
structure solvers. Built in the CI-only scope of the
founder F1 ruling (2026-11-18) under SXE-52; host
provisioning (H2) is that programme's deferred-open
remainder.

## Manifest entry

`server/lib/conkay/engines/entries/calculix.js` — id
`calculix`, version pin **CalculiX 2.23**, licence
**GPL-2.0-only** (re-read from the pinned release at
registration, 2026-11-18), link mode **process** — the
manifest's GPL rule: the kernel drives `ccx` as a child
process and parses its output files; nothing of
CalculiX is imported or linked. Resolved via
`CONKAY_ENGINE_CALCULIX_BIN` (default
`/opt/concord-engines/calculix/bin/python`, the driver
env whose kernel shells out to `ccx` on PATH). Ops:
`health`, `tension`, `cantilever`. Kernel:
`server/lib/conkay/engines/kernels/kernel-calculix.py`.

## Install (host provisioning, H2)

`ccx` 2.23 on PATH (distribution package calculix-ccx)
plus a stdlib-only driver venv at
`/opt/concord-engines/calculix`. Footprint: ~128 MB
disk, 512 MB memory, 4 threads.

## Health

**Named substitution, recorded:** SOLVER-ENGINES-
PLAN.md §2 words the health case as a "one-element
cantilever vs closed form", but a one-element cantilever
has no exact closed form. The health case is therefore
the one-element case that does: a **single C3D8 element
in uniaxial tension** (L=0.1 m, 0.01×0.01 m section,
E=210 GPa, F=21 kN) against σ = P/A = 210 MPa and
δ = PL/(EA) = 1e-4 m exactly; the suite asserts
maxRelError < 1e-3. The `cantilever` op is the
band-checked companion: a kernel-generated C3D20 mesh
(quadratic elements — no shear locking) under a tip
resultant, serving the tip deflection beside
Euler–Bernoulli PL³/(3EI); the lane asserts the band
< 8%.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:calculix` with the install hint.
- Env provisioned but `ccx` missing → FAIL
  `engine_failed:calculix:ccx executable not found …`
  (a provisioning defect, named as such).
- A run whose .dat cannot be parsed is rejected, never
  guessed; out-of-range cantilever requests are refused
  naming the bounds.

## Tests

`server/tests/conkay/engines/calculix.test.js` —
registration and GPL discipline, absence, schema and
unknown-op refusals, and the kernel's ccx-absence shape
locally (the deck generator and .dat parser are
additionally exercised directly: 128-node / 10-element
C3D20 deck, exact-value parse); the value legs run only
in the CI lane (`.github/workflows/conkay-engine-
calculix.yml`, manual dispatch per F8), which installs
ccx, sets `CONKAY_ENGINE_CALCULIX_BIN`, and fails if
any test skips.
