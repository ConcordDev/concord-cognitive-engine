# Engine: aermod — AERMOD · SXE-35

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/aermod.js` — id `aermod`,
version pin **24142**, licence **Public domain (US EPA)**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_AERMOD_BIN` (default
`/opt/concord-engines/aermod/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `plume`. Kernel:
`server/lib/conkay/engines/kernels/kernel-aermod.py`.

## Install (host provisioning, H2)

Provision aermod built from the pinned EPA source (version 24142, from the EPA SCRAM archive) on PATH, and a driver venv at `/opt/concord-engines/aermod`. Footprint: ~256 MB disk, 512 MB memory, 1 thread.

## Health

`health` is a COMPLETION-class case, named as such: an embedded minimal case (one elevated point source, flat terrain, polar receptor grid, one day of synthetic AERMET-format meteorology written by the kernel) must complete, and its output must carry a finite, positive maximum 1-hour concentration. The concentration reference is the stored-reference shape (`CONKAY_AERMOD_REF_CONC`, **10%** band) recorded by the lane on its first verified run.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:aermod` with the install hint.
- Env provisioned but aermod missing → FAIL `engine_failed:aermod:aermod executable not found …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:aermod` before spawn; an unknown
  op → FAIL `engine_unknown_op:aermod:<op>`.

## Tests

`server/tests/conkay/engines/aermod.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-aermod.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_AERMOD_BIN`, and fails if any test skips.
