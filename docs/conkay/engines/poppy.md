# Engine: poppy — POPPY · SXE-33

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/poppy.js` — id `poppy`,
version pin **1.1.0**, licence **BSD-3-Clause**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_POPPY_BIN` (default
`/opt/concord-engines/poppy/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `airy`. Kernel:
`server/lib/conkay/engines/kernels/kernel-poppy.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/poppy` (poppy 1.1.0, pip pin). Footprint: ~512 MB disk, 1 GB memory, 2 threads.

## Health

`health`: POPPY's Fraunhofer propagation of a 650 nm wavefront through a 1 m circular aperture; the first Airy null on the detector centre row vs the closed form 1.22 * lambda / D in angle; band **15%** (detector sampling 0.02 arcsec/pixel sets the floor). The POPPY PSF API surface is verified at the lane's first dispatch.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:poppy` with the install hint.
- Env provisioned but poppy unimportable → FAIL `engine_failed:poppy:poppy import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:poppy` before spawn; an unknown
  op → FAIL `engine_unknown_op:poppy:<op>`.

## Tests

`server/tests/conkay/engines/poppy.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-poppy.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_POPPY_BIN`, and fails if any test skips.
