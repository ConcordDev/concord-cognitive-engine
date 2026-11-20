# Engine: psi4 — Psi4 · SXE-26

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/psi4.js` — id `psi4`,
version pin **1.10.0**, licence **GPL-2.0-only**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_PSI4_BIN` (default
`/opt/concord-engines/psi4/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `rhf-energy`. Kernel:
`server/lib/conkay/engines/kernels/kernel-psi4.py`.

## Install (host provisioning, H2)

Provision a conda env at `/opt/concord-engines/psi4` (Python 3.12 + Psi4 1.10.0 from conda-forge). Footprint: ~1 GB disk, 1 GB memory, 2 threads.

## Health

`health` is the same NIST CCCBDB point the PySCF entry checks — H2O RHF/STO-3G vs -75.9839 Ha, band **0.005 Ha** — so the two quantum engines cross-check one published value. H2 rides the same op.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:psi4` with the install hint.
- Env provisioned but psi4 unimportable → FAIL `engine_failed:psi4:psi4 import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:psi4` before spawn; an unknown
  op → FAIL `engine_unknown_op:psi4:<op>`.

## Tests

`server/tests/conkay/engines/psi4.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-psi4.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_PSI4_BIN`, and fails if any test skips.
