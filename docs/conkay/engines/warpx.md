# Engine: warpx — WarpX (CPU) · SXE-31

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-53 (the car-chain engine programme);
the H2 host these engines will run on is that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/warpx.js` — id `warpx`,
version pin **25.10**, licence **BSD-3-Clause (BSD-3-LBNL)**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_WARPX_BIN` (default
`/opt/concord-engines/warpx/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `langmuir`. Kernel:
`server/lib/conkay/engines/kernels/kernel-warpx.py`.

## Install (host provisioning, H2)

Provision the WarpX 25.10 CPU build (conda-forge 1-D variant) so `warpx.1d` is on the env's PATH, with the driver Python at `/opt/concord-engines/warpx`. Footprint: ~1 GB disk, 2 GB memory, 4 threads.

## Health

`health` is the plan's case: a 1-D Langmuir oscillation (sinusoidally perturbed cold electrons, periodic box). The FieldEnergy reduced diagnostic oscillates at 2*omega_p; the FFT peak gives omega_p within a **10%** band of the closed form.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:warpx` with the install hint.
- Env provisioned but `warpx.1d` missing → FAIL `engine_failed:warpx:warpx executable (warpx.1d) not found …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:warpx` before spawn; an unknown
  op → FAIL `engine_unknown_op:warpx:<op>`.

## Tests

`server/tests/conkay/engines/warpx.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-warpx.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_WARPX_BIN`, and fails if any test skips.

## First-live correction (2026-11-19, hardening pass)

The kernel located `warpx.1d` by PATH only; the lane
provisions WarpX into the driver env, whose bin is not on
the ambient PATH — the real leg could never have found
it. The kernel now falls back to the sibling of the
running interpreter (the env's own bin) after the PATH
lookup, in the SXE-00 env-provisioning shape. Verified by
construction with a stub beside the interpreter under a
scrubbed PATH; absent both, it still exits 3 naming
warpx.
