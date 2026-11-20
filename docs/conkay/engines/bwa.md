# Engine: bwa — BWA · SXE-28

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/bwa.js` — id `bwa`,
version pin **0.7.19**, licence **MIT**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_BWA_BIN` (default
`/opt/concord-engines/bwa/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `align`. Kernel:
`server/lib/conkay/engines/kernels/kernel-bwa.py`.

## Install (host provisioning, H2)

Provision bwa (distribution package of BWA 0.7.19) on PATH and a driver venv at `/opt/concord-engines/bwa`. Footprint: ~256 MB disk, 512 MB memory, 1 thread.

## Health

`health`: the kernel indexes a bundled 600 bp reference and aligns a read that is an exact substring starting at position 201 — the SAM must place it at exactly **201**, mapped.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:bwa` with the install hint.
- Env provisioned but bwa missing → FAIL `engine_failed:bwa:bwa executable not found …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:bwa` before spawn; an unknown
  op → FAIL `engine_unknown_op:bwa:<op>`.

## Tests

`server/tests/conkay/engines/bwa.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-bwa.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_BWA_BIN`, and fails if any test skips.
