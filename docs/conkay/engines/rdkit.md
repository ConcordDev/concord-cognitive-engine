# Engine: rdkit — RDKit · SXE-26

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/rdkit.js` — id `rdkit`,
version pin **2025.09.1**, licence **BSD-3-Clause**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_RDKIT_BIN` (default
`/opt/concord-engines/rdkit/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `descriptors`. Kernel:
`server/lib/conkay/engines/kernels/kernel-rdkit.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/rdkit` (RDKit 2025.09.1, pip pin). Footprint: ~512 MB disk, 512 MB memory, 1 thread.

## Health

`health`: ethanol (CCO) — RDKit's average molecular weight vs the value computed independently in the kernel from C2H6O and standard atomic weights (46.069); band **0.01**.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:rdkit` with the install hint.
- Env provisioned but rdkit unimportable → FAIL `engine_failed:rdkit:rdkit import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:rdkit` before spawn; an unknown
  op → FAIL `engine_unknown_op:rdkit:<op>`.

## Tests

`server/tests/conkay/engines/rdkit.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-rdkit.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_RDKIT_BIN`, and fails if any test skips.
