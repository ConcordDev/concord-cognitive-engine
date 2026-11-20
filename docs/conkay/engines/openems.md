# Engine: openems — openEMS · SXE-17

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/openems.js` — id `openems`,
version pin **0.0.35**, licence **GPL-3.0-only**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_OPENEMS_BIN` (default
`/opt/concord-engines/openems/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `dipole-impedance`. Kernel:
`server/lib/conkay/engines/kernels/kernel-openems.py`.

## Install (host provisioning, H2)

Provision a conda env at `/opt/concord-engines/openems` (Python 3.12 + openems 0.0.35 from conda-forge, which brings CSXCAD). Footprint: ~1 GB disk, 2 GB memory, 4 threads.

## Health

`health` is a COMPLETION-class case, named as such: a centre-fed half-wave dipole in free space at 1 GHz on a coarse (lambda/12) FDTD mesh; the kernel requires the run to finish and the lumped port to yield a FINITE input impedance. No closed form exists for a thick-wire FDTD dipole at this mesh, so the stored-reference shape applies: when the lane has recorded `CONKAY_OPENEMS_REF_R` / `CONKAY_OPENEMS_REF_X` from a verified run, the kernel also enforces a **15%** band around them. The dipole's closed-form impedance is the nec2c leg's case (same row).

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:openems` with the install hint.
- Env provisioned but the openEMS bindings unimportable → FAIL `engine_failed:openems:openEMS import failed …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:openems` before spawn; an unknown
  op → FAIL `engine_unknown_op:openems:<op>`.

## Tests

`server/tests/conkay/engines/openems.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-openems.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_OPENEMS_BIN`, and fails if any test skips.
