# Engine: hcipy — HCIPy · SXE-33

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/hcipy.js` — id `hcipy`,
version pin **0.6.0**, licence **BSD-3-Clause**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_HCIPY_BIN` (default
`/opt/concord-engines/hcipy/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `airy`. Kernel:
`server/lib/conkay/engines/kernels/kernel-hcipy.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/hcipy` (hcipy 0.6.0, pip pin). Footprint: ~512 MB disk, 1 GB memory, 2 threads.

## Health

`health`: a 650 nm wavefront through a 1 m circular aperture, propagated by HCIPy's Fraunhofer propagator to a 50 m focal plane; the first Airy null is located on the centre-row intensity profile vs the closed form 1.22 * lambda * f / D; band **10%** (the focal-plane sampling sets the floor).

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:hcipy` with the install hint.
- Env provisioned but hcipy unimportable → FAIL `engine_failed:hcipy:hcipy import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:hcipy` before spawn; an unknown
  op → FAIL `engine_unknown_op:hcipy:<op>`.

## Tests

`server/tests/conkay/engines/hcipy.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-hcipy.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_HCIPY_BIN`, and fails if any test skips.
