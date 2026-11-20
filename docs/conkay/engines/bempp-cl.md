# Engine: bempp-cl — bempp-cl · SXE-34

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/bempp-cl.js` — id `bempp-cl`,
version pin **0.4.2**, licence **MIT**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_BEMPP_CL_BIN` (default
`/opt/concord-engines/bempp-cl/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `scatter`. Kernel:
`server/lib/conkay/engines/kernels/kernel-bempp-cl.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/bempp-cl` (bempp-cl 0.4.2, pip pin; its numba/exaFEM dependencies ride the wheel set). Footprint: ~1 GB disk, 2 GB memory, 2 threads.

## Health

`health` is the plan's case: acoustic scattering from a rigid (sound-soft) unit sphere vs the analytic **Mie series**. bempp-cl solves the exterior Dirichlet problem (single-layer representation, DP0 space, coarse h = 0.3 grid, k = 2) and the kernel evaluates the scattered field at r = 10 on the +z axis; the expected value is the Mie far field computed in-kernel from scipy's spherical Bessel functions. Band **15%** — the coarse grid's discretisation error dominates and sits honestly inside it.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:bempp-cl` with the install hint.
- Env provisioned but bempp unimportable → FAIL `engine_failed:bempp-cl:bempp import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:bempp-cl` before spawn; an unknown
  op → FAIL `engine_unknown_op:bempp-cl:<op>`.

## Tests

`server/tests/conkay/engines/bempp-cl.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-bempp-cl.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_BEMPP_CL_BIN`, and fails if any test skips.
