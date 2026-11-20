# Engine: energyplus — EnergyPlus · SXE-37

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/energyplus.js` — id `energyplus`,
version pin **25.1.0**, licence **BSD-3-Clause (EnergyPlus licence)**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_ENERGYPLUS_BIN` (default
`/opt/concord-engines/energyplus/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `run`. Kernel:
`server/lib/conkay/engines/kernels/kernel-energyplus.py`.

## Install (host provisioning, H2)

Provision the EnergyPlus 25.1.0 release at `/opt/concord-engines/energyplus` (the install root holding the binary, ExampleFiles/, and WeatherData/; CONKAY_ENERGYPLUS_DIR overrides; that path is the kernel's default; the release asset name is verified at first dispatch). Footprint: ~512 MB disk, 1 GB memory, 2 threads.

## Health

COMPLETION class — the plan's case for this row: the shipped example **1ZoneUncontrolled runs**. The kernel runs the install's example IDF against its Chicago TMY3 weather file on a scratch copy; acceptance is the run's own error file reporting 'EnergyPlus Completed Successfully' and the output data file carrying a real time series (> 100 lines).

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:energyplus` with the install hint.
- Env provisioned but the install pieces (binary, example IDF, weather file) missing → FAIL (kernel exit 3, named).
- A request that fails the op schema → FAIL
  `engine_request_invalid:energyplus` before spawn; an unknown
  op → FAIL `engine_unknown_op:energyplus:<op>`.

## Tests

`server/tests/conkay/engines/energyplus.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-energyplus.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_ENERGYPLUS_BIN`, and fails if any test skips.
