# Engine: mafft — MAFFT · SXE-28

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/mafft.js` — id `mafft`,
version pin **7.526**, licence **BSD-3-Clause**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_MAFFT_BIN` (default
`/opt/concord-engines/mafft/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `align`. Kernel:
`server/lib/conkay/engines/kernels/kernel-mafft.py`.

## Install (host provisioning, H2)

Provision mafft (distribution package of MAFFT 7.526) on PATH and a driver venv at `/opt/concord-engines/mafft`. Footprint: ~256 MB disk, 512 MB memory, 2 threads.

## Health

`health`: three bundled homologous sequences — the alignment must satisfy the MSA invariants (row count, equal lengths, rows ungapping to their inputs); the served signal is the conserved-column count, which must be positive for this set.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:mafft` with the install hint.
- Env provisioned but mafft missing → FAIL `engine_failed:mafft:mafft executable not found …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:mafft` before spawn; an unknown
  op → FAIL `engine_unknown_op:mafft:<op>`.

## Tests

`server/tests/conkay/engines/mafft.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-mafft.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_MAFFT_BIN`, and fails if any test skips.
