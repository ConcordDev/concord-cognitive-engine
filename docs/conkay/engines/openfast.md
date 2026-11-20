# Engine: openfast — OpenFAST · SXE-37

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/openfast.js` — id `openfast`,
version pin **4.1.2**, licence **Apache-2.0**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_OPENFAST_BIN` (default
`/opt/concord-engines/openfast/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `run`. Kernel:
`server/lib/conkay/engines/kernels/kernel-openfast.py`.

## Install (host provisioning, H2)

Provision the OpenFAST v4.1.2 binary on PATH (pinned source build) and the r-test AWT_YFree_WTurb case at `/opt/concord-engines/openfast-case` (CONKAY_OPENFAST_CASE_DIR overrides; that path is the kernel's default), plus a driver venv at `/opt/concord-engines/openfast`. Footprint: ~1 GB disk, 2 GB memory, 4 threads.

## Health

COMPLETION class. `health`: the provisioned r-test case runs on a scratch copy; acceptance is the output file's final time reaching at least **90% of the deck's TMax** with a finite output table. The `run` op may shorten TMax (the kernel edits only the scratch copy).

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:openfast` with the install hint.
- Env provisioned but the openfast binary or the case dir missing → FAIL (kernel exit 3, named).
- A request that fails the op schema → FAIL
  `engine_request_invalid:openfast` before spawn; an unknown
  op → FAIL `engine_unknown_op:openfast:<op>`.

## Tests

`server/tests/conkay/engines/openfast.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-openfast.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_OPENFAST_BIN`, and fails if any test skips.
