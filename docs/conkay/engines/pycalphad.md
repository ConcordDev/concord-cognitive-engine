# Engine: pycalphad — pycalphad · SXE-24

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-53 (the car-chain engine programme);
the H2 host these engines will run on is that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/pycalphad.js` — id `pycalphad`,
version pin **0.11.0**, licence **MIT**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_PYCALPHAD_BIN` (default
`/opt/concord-engines/pycalphad/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `equilibrium`. Kernel:
`server/lib/conkay/engines/kernels/kernel-pycalphad.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/pycalphad` (pycalphad 0.11.0, pip pin) and place the open TDB the health point uses where `CONKAY_PYCALPHAD_TDB` points, with its source + licence recorded here at provisioning time. Footprint: ~512 MB disk, 512 MB memory, 2 threads.

## Health

`health` runs an equilibrium on the provisioned open TDB at the recorded point (`CONKAY_PYCALPHAD_POINT`, default the Al-Zn shape of the plan's case) and checks the internal invariants (stable set non-empty, fractions sum to 1). The published-diagram comparison is the stored-reference shape: the lane records the expected stable phase set into `CONKAY_PYCALPHAD_EXPECT_PHASES` on its first verified run and the kernel then enforces set equality — no diagram point is invented in code.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:pycalphad` with the install hint.
- Env provisioned but pycalphad unimportable or the TDB missing → FAIL `engine_failed:pycalphad:…` naming which.
- A request that fails the op schema → FAIL
  `engine_request_invalid:pycalphad` before spawn; an unknown
  op → FAIL `engine_unknown_op:pycalphad:<op>`.

## Tests

`server/tests/conkay/engines/pycalphad.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-pycalphad.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_PYCALPHAD_BIN`, and fails if any test skips.
