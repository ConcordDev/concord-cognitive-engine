# Engine: iqtree — IQ-TREE · SXE-28

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/iqtree.js` — id `iqtree`,
version pin **2.3.6**, licence **GPL-2.0-only**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_IQTREE_BIN` (default
`/opt/concord-engines/iqtree/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `tree`. Kernel:
`server/lib/conkay/engines/kernels/kernel-iqtree.py`.

## Install (host provisioning, H2)

Provision the IQ-TREE 2.3.6 release binary on PATH and a driver venv at `/opt/concord-engines/iqtree`. Footprint: ~256 MB disk, 512 MB memory, 2 threads.

## Health

`health`: a bundled 4-taxon alignment under JC — the run must complete, report a finite log-likelihood, and its tree must carry exactly the four input tips.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:iqtree` with the install hint.
- Env provisioned but iqtree2 missing → FAIL `engine_failed:iqtree:iqtree2 executable not found …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:iqtree` before spawn; an unknown
  op → FAIL `engine_unknown_op:iqtree:<op>`.

## Tests

`server/tests/conkay/engines/iqtree.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-iqtree.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_IQTREE_BIN`, and fails if any test skips.
