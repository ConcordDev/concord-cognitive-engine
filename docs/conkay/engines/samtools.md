# Engine: samtools — samtools + bcftools · SXE-28

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/samtools.js` — id `samtools`,
version pin **1.21**, licence **MIT**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_SAMTOOLS_BIN` (default
`/opt/concord-engines/samtools/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `count`. Kernel:
`server/lib/conkay/engines/kernels/kernel-samtools.py`.

## Install (host provisioning, H2)

Provision samtools + bcftools (distribution packages, 1.21 series) on PATH and a driver venv at `/opt/concord-engines/samtools`. Footprint: ~256 MB disk, 256 MB memory, 1 thread.

## Health

`health`: a bundled 5-record SAM is converted, sorted and indexed, and `samtools view -c` must return exactly **5**; bcftools must also answer --version.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:samtools` with the install hint.
- Env provisioned but either binary missing → FAIL `engine_failed:samtools:samtools executable not found …` (or bcftools).
- A request that fails the op schema → FAIL
  `engine_request_invalid:samtools` before spawn; an unknown
  op → FAIL `engine_unknown_op:samtools:<op>`.

## Tests

`server/tests/conkay/engines/samtools.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-samtools.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_SAMTOOLS_BIN`, and fails if any test skips.
