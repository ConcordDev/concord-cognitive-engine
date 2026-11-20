# Engine: pysam — PySAM · SXE-37

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/pysam.js` — id `pysam`,
version pin **7.1.0**, licence **BSD-3-Clause (NREL SAM licence)**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_PYSAM_BIN` (default
`/opt/concord-engines/pysam/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `simulate`. Kernel:
`server/lib/conkay/engines/kernels/kernel-pysam.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/pysam` (nrel-pysam 7.1.0, pip pin). Footprint: ~512 MB disk, 1 GB memory, 2 threads.

## Health

ENVELOPE class (named honestly): PVWatts has no closed form short of reimplementing it, so `health` drives a synthetic equatorial day the kernel constructs (hourly GHI a pure sine arch peaking at 1000 W/m^2; sun geometry from the in-kernel NOAA series) through a horizontal 5 kW PVWatts v8 system and accepts when the peak hourly AC lands inside nameplate x **[0.58, 0.92]** — the envelope the published derate chain forces (14.08% system losses, ~0.90 cell-temperature factor at full sun, 96% inverter efficiency; centre ~0.74).

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:pysam` with the install hint.
- Env provisioned but PySAM unimportable → FAIL `engine_failed:pysam:PySAM import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:pysam` before spawn; an unknown
  op → FAIL `engine_unknown_op:pysam:<op>`.

## Tests

`server/tests/conkay/engines/pysam.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-pysam.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_PYSAM_BIN`, and fails if any test skips.
