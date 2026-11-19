# Engine: ngspice — ngspice circuit simulation · SXE-16

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-53 (the car-chain engine programme);
the H2 host these engines will run on is that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/ngspice.js` — id `ngspice`,
version pin **44**, licence **BSD-3-Clause (modified BSD)**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_NGSPICE_BIN` (default
`/opt/concord-engines/ngspice/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `rc-step`. Kernel:
`server/lib/conkay/engines/kernels/kernel-ngspice.py`.

## Install (host provisioning, H2)

Install ngspice (pin of record 44; the distro package in the CI lane) so `ngspice` is on PATH, and provision a driver venv at `/opt/concord-engines/ngspice`. Footprint: ~256 MB disk, 512 MB memory, 2 threads.

## Health

`health` runs an RC step response (R=1 kohm, C=1 uF, tau=1 ms) and serves v(out) at t=tau beside the exact closed form V*(1 - e^-1) = 0.63212*V; acceptance band **2%**.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:ngspice` with the install hint.
- Env provisioned but `ngspice` missing → FAIL `engine_failed:ngspice:ngspice executable not found …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:ngspice` before spawn; an unknown
  op → FAIL `engine_unknown_op:ngspice:<op>`.

## Tests

`server/tests/conkay/engines/ngspice.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-ngspice.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_NGSPICE_BIN`, and fails if any test skips.
