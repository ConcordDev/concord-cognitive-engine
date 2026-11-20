# Engine: blast — BLAST+ · SXE-28

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/blast.js` — id `blast`,
version pin **2.16.0**, licence **Public domain (NCBI)**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_BLAST_BIN` (default
`/opt/concord-engines/blast/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `search`. Kernel:
`server/lib/conkay/engines/kernels/kernel-blast.py`.

## Install (host provisioning, H2)

Provision the BLAST+ 2.16.0 release tools on PATH and a driver venv at `/opt/concord-engines/blast`. Footprint: ~512 MB disk, 512 MB memory, 2 threads.

## Health

`health` is the plan's case: BLAST a short sequence against a tiny bundled database — the query is an exact copy of one record, so the best hit must be that record at ~100% identity over the full query.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:blast` with the install hint.
- Env provisioned but the BLAST+ tools missing → FAIL `engine_failed:blast:makeblastdb executable not found …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:blast` before spawn; an unknown
  op → FAIL `engine_unknown_op:blast:<op>`.

## Tests

`server/tests/conkay/engines/blast.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-blast.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_BLAST_BIN`, and fails if any test skips.
