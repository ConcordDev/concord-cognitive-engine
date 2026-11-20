# Engine: opendss — OpenDSS (OpenDSSDirect) · SXE-19

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/opendss.js` — id `opendss`,
version pin **0.9.0**, licence **BSD-3-Clause**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_OPENDSS_BIN` (default
`/opt/concord-engines/opendss/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `power-flow`. Kernel:
`server/lib/conkay/engines/kernels/kernel-opendss.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/opendss` (OpenDSSDirect.py 0.9.0, pip pin — it bundles the DSS engine library). Footprint: ~256 MB disk, 512 MB memory, 1 thread.

## Health

`health`: a two-bus single-phase feeder (7.2 kV source, R = 1.2 + j1.9 ohm line, 400 kW constant-PQ load at pf 0.95). The expected load-bus voltage is computed in-kernel by fixed-point iteration of V = V1 - Z * conj(S / V) — a different method from the DSS solver, so agreement (band **0.5%**) is a genuine cross-check.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:opendss` with the install hint.
- Env provisioned but opendssdirect unimportable → FAIL `engine_failed:opendss:opendssdirect import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:opendss` before spawn; an unknown
  op → FAIL `engine_unknown_op:opendss:<op>`.

## Tests

`server/tests/conkay/engines/opendss.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-opendss.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_OPENDSS_BIN`, and fails if any test skips.
