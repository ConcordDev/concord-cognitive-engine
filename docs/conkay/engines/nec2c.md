# Engine: nec2c — NEC2 (nec2c) · SXE-17

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/nec2c.js` — id `nec2c`,
version pin **1.3.1**, licence **Public domain**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_NEC2C_BIN` (default
`/opt/concord-engines/nec2c/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `dipole-impedance`. Kernel:
`server/lib/conkay/engines/kernels/kernel-nec2c.py`.

## Install (host provisioning, H2)

Provision the nec2c 1.3.1 binary on PATH (source build from the pinned tag) and a driver venv at `/opt/concord-engines/nec2c`. Footprint: ~128 MB disk, 256 MB memory, 1 thread.

## Health

`health` is the plan's case: the half-wave dipole's input impedance vs the closed-form reference **73 + j42.5 ohm**. The kernel generates the deck (centre-fed wire, length lambda/2 at the request frequency, radius lambda/1000, 21 segments), runs nec2c, and parses the ANTENNA INPUT PARAMETERS block. Bands: |R - 73| <= **10 ohm**, |X - 42.5| <= **15 ohm** — NEC2 thin-wire results move a few ohms with segmentation and radius; the bands cover the converged range without letting a wrong deck pass.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:nec2c` with the install hint.
- Env provisioned but the nec2c binary missing → FAIL `engine_failed:nec2c:nec2c executable not found …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:nec2c` before spawn; an unknown
  op → FAIL `engine_unknown_op:nec2c:<op>`.

## Tests

`server/tests/conkay/engines/nec2c.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-nec2c.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_NEC2C_BIN`, and fails if any test skips.
