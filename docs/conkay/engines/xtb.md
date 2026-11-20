# Engine: xtb — xtb (GFN-xTB) · SXE-26

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/xtb.js` — id `xtb`,
version pin **6.7.1**, licence **LGPL-3.0-only**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_XTB_BIN` (default
`/opt/concord-engines/xtb/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `gfn2-energy`. Kernel:
`server/lib/conkay/engines/kernels/kernel-xtb.py`.

## Install (host provisioning, H2)

Provision the xtb 6.7.1 release binary on PATH and a driver venv at `/opt/concord-engines/xtb`. Footprint: ~256 MB disk, 512 MB memory, 2 threads.

## Health

`health` runs a GFN2-xTB single point on water. GFN2 absolute energies are method-internal, so the reference is the stored-reference shape: the lane records the verified value into `CONKAY_XTB_REF_EHARTREE` on its first verified run and the kernel then enforces a **1e-3 Ha** band; before that the run is a completion leg (finite energy, xtb's own convergence) and no number is invented in code.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:xtb` with the install hint.
- Env provisioned but the xtb binary missing → FAIL `engine_failed:xtb:xtb executable not found …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:xtb` before spawn; an unknown
  op → FAIL `engine_unknown_op:xtb:<op>`.

## Tests

`server/tests/conkay/engines/xtb.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-xtb.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_XTB_BIN`, and fails if any test skips.
