# Engine: openquake — OpenQuake · SXE-35

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/openquake.js` — id `openquake`,
version pin **3.21.0**, licence **AGPL-3.0-only**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_OPENQUAKE_BIN` (default
`/opt/concord-engines/openquake/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `hazard`. Kernel:
`server/lib/conkay/engines/kernels/kernel-openquake.py`.

## Install (host provisioning, H2)

Provision a driver venv at `/opt/concord-engines/openquake` (openquake.engine 3.21.0, pip pin) with the oq CLI on the env's PATH, and the official demos tree with `CONKAY_OQ_DEMO` naming the smallest classical hazard demo in the pinned tree (the lane records the exact demo directory it verified at provisioning; the env value in the lane file is the documented default). Footprint: ~2 GB disk, 2 GB memory, 4 threads.

## Health

`health` is the plan's shape for this stack (each engine's own first tutorial): the shipped classical-hazard demo named by `CONKAY_OQ_DEMO` must run through the oq engine and export a hazard-curves CSV; the kernel serves the curve count and maximum PoE. The PoE reference is the stored-reference shape: the lane records the verified value into `CONKAY_OQ_REF_POE` and the kernel then enforces a **10%** band.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:openquake` with the install hint.
- Env provisioned but oq missing or the demo unprovisioned → FAIL `engine_failed:openquake:…` naming which.
- A request that fails the op schema → FAIL
  `engine_request_invalid:openquake` before spawn; an unknown
  op → FAIL `engine_unknown_op:openquake:<op>`.

## Tests

`server/tests/conkay/engines/openquake.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-openquake.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_OPENQUAKE_BIN`, and fails if any test skips.

## First-live correction (2026-11-19, hardening pass)

The kernel located `oq` by PATH only; the lane installs
OpenQuake INTO the driver env, whose bin is not on the
ambient PATH — the real leg could never have found it. The
kernel now falls back to the sibling of the running
interpreter (the env's own bin) after the PATH lookup, in
the SXE-00 env-provisioning shape. Verified by construction:
with a stub `oq` beside the interpreter and PATH scrubbed,
the kernel proceeds past the lookup to its demo check;
absent both, it still exits 3 naming oq.
