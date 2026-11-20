# Engine: epanet — EPANET · SXE-35

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/epanet.js` — id `epanet`,
version pin **2.3.0**, licence **Public domain (US EPA)**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_EPANET_BIN` (default
`/opt/concord-engines/epanet/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `pipe`. Kernel:
`server/lib/conkay/engines/kernels/kernel-epanet.py`.

## Install (host provisioning, H2)

Provision the EPANET toolkit shared library built from the pinned 2.3.0 source where `CONKAY_EPANET_LIB` points (the lane records the built library's exact filename at provisioning; the env value in the lane file is the documented default name), and a driver venv at `/opt/concord-engines/epanet`. Footprint: ~256 MB disk, 512 MB memory, 1 thread.

## Health

`health`: a single-pipe network written by the kernel (reservoir head 100 m, 1000 m / 300 mm / C=100 pipe, one junction) — EPANET's junction head must match the closed-form Hazen-Williams headloss computed in the kernel; band **1%**.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:epanet` with the install hint.
- Env provisioned but CONKAY_EPANET_LIB unset/missing → FAIL `engine_failed:epanet:… does not name a provisioned EPANET toolkit library`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:epanet` before spawn; an unknown
  op → FAIL `engine_unknown_op:epanet:<op>`.

## Tests

`server/tests/conkay/engines/epanet.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-epanet.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_EPANET_BIN`, and fails if any test skips.
