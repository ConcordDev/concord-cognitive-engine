# Engine: gmat — GMAT · SXE-36

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/gmat.js` — id `gmat`,
version pin **R2025a**, licence **Apache-2.0**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_GMAT_BIN` (default
`/opt/concord-engines/gmat/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `propagate`. Kernel:
`server/lib/conkay/engines/kernels/kernel-gmat.py`.

## Install (host provisioning, H2)

Provision the GMAT R2025a console binary on PATH (the SourceForge release artefact name is verified at the lane's first dispatch), the case dir `/opt/concord-engines/gmat-case` holding health.script (written by the lane; CONKAY_GMAT_CASE_DIR overrides), and a driver venv at `/opt/concord-engines/gmat`. Footprint: ~1 GB disk, 2 GB memory, 2 threads.

## Health

COMPLETION class. `health`: the lane's minimal mission script (Keplerian spacecraft, SMA 7000 km, ECC 0.001, propagated 600 s) runs under GmatConsole on a scratch copy; acceptance is the report file's final state with radius inside **[6000, 8000] km**, the envelope the scripted orbit implies. GMAT's script dialect is version-sensitive — the script is verified against the pinned release at first dispatch.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:gmat` with the install hint.
- Env provisioned but the GmatConsole binary or health.script missing → FAIL (kernel exit 3, named).
- A request that fails the op schema → FAIL
  `engine_request_invalid:gmat` before spawn; an unknown
  op → FAIL `engine_unknown_op:gmat:<op>`.

## Tests

`server/tests/conkay/engines/gmat.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-gmat.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_GMAT_BIN`, and fails if any test skips.
