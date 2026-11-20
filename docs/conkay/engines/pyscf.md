# Engine: pyscf — PySCF · SXE-26

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/pyscf.js` — id `pyscf`,
version pin **2.9.0**, licence **Apache-2.0**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_PYSCF_BIN` (default
`/opt/concord-engines/pyscf/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `rhf-energy`. Kernel:
`server/lib/conkay/engines/kernels/kernel-pyscf.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/pyscf` (PySCF 2.9.0, pip pin). Footprint: ~512 MB disk, 1 GB memory, 2 threads.

## Health

`health` is the plan's case: H2O RHF/STO-3G total energy vs the NIST CCCBDB published value for that level of theory (-75.9839 Ha at the CCCBDB reference geometry, embedded in the kernel); band **0.005 Ha**. H2 (-1.1167 Ha, CCCBDB) rides the same op.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:pyscf` with the install hint.
- Env provisioned but pyscf unimportable → FAIL `engine_failed:pyscf:pyscf import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:pyscf` before spawn; an unknown
  op → FAIL `engine_unknown_op:pyscf:<op>`.

## Tests

`server/tests/conkay/engines/pyscf.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-pyscf.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_PYSCF_BIN`, and fails if any test skips.
