# Engine: openmm — OpenMM · SXE-27

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/openmm.js` — id `openmm`,
version pin **8.2.0**, licence **MIT (OpenMM licence)**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_OPENMM_BIN` (default
`/opt/concord-engines/openmm/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `oscillator`. Kernel:
`server/lib/conkay/engines/kernels/kernel-openmm.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/openmm` (openmm 8.2.0, pip pin; CPU platform only). Footprint: ~512 MB disk, 1 GB memory, 2 threads.

## Health

`health`: a single argon particle in an isotropic harmonic potential, Verlet-integrated on the CPU platform; the period is measured from x(t) zero crossings vs the closed form 2*pi*sqrt(m/k) computed in-kernel, band **2%**.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:openmm` with the install hint.
- Env provisioned but openmm unimportable → FAIL `engine_failed:openmm:openmm import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:openmm` before spawn; an unknown
  op → FAIL `engine_unknown_op:openmm:<op>`.

## Tests

`server/tests/conkay/engines/openmm.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-openmm.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_OPENMM_BIN`, and fails if any test skips.
