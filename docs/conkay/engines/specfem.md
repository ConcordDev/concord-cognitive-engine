# Engine: specfem — SPECFEM2D · SXE-35

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/specfem.js` — id `specfem`,
version pin **8.1.0**, licence **GPL-3.0-only**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_SPECFEM_BIN` (default
`/opt/concord-engines/specfem/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `example`. Kernel:
`server/lib/conkay/engines/kernels/kernel-specfem.py`.

## Install (host provisioning, H2)

Provision SPECFEM2D 8.1.0 built from the pinned source (binaries on PATH), one shipped example case (Tape2007, as carried in the pinned tree) at `CONKAY_SPECFEM_EXAMPLE`, and a driver venv at `/opt/concord-engines/specfem`. Footprint: ~1 GB disk, 1 GB memory, 4 threads.

## Health

`health` is a COMPLETION-class case, named as such: the mesher and solver must both complete on the shipped example and the seismogram output must hold finite, non-zero traces. There is no honest closed form for a shipped heterogeneous example and the kernel invents none; the served values are the trace count and the first trace's maximum amplitude.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:specfem` with the install hint.
- Env provisioned but a binary or the example missing → FAIL `engine_failed:specfem:…` naming which.
- A request that fails the op schema → FAIL
  `engine_request_invalid:specfem` before spawn; an unknown
  op → FAIL `engine_unknown_op:specfem:<op>`.

## Tests

`server/tests/conkay/engines/specfem.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-specfem.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_SPECFEM_BIN`, and fails if any test skips.
