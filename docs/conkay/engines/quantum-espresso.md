# Engine: quantum-espresso — Quantum ESPRESSO · SXE-26

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/quantum-espresso.js` — id `quantum-espresso`,
version pin **7.4**, licence **GPL-2.0-only**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_QUANTUM_ESPRESSO_BIN` (default
`/opt/concord-engines/quantum-espresso/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `scf`. Kernel:
`server/lib/conkay/engines/kernels/kernel-quantum-espresso.py`.

## Install (host provisioning, H2)

Provision pw.x (distribution package of Quantum ESPRESSO 7.4) on PATH, the Si PSL pseudopotential where `CONKAY_QE_PSEUDO` points, and a driver venv at `/opt/concord-engines/quantum-espresso`. Footprint: ~512 MB disk, 1 GB memory, 4 threads.

## Health

`health` runs a deliberately small silicon bulk SCF deck (smoke case, not a production calculation). pw.x must report its own convergence marker. The total-energy reference is the stored-reference shape: the lane records the verified value into `CONKAY_QE_REF_RY` on its first verified run and the kernel then enforces a **0.5%** band.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:quantum-espresso` with the install hint.
- Env provisioned but pw.x missing → FAIL `engine_failed:quantum-espresso:pw.x executable not found …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:quantum-espresso` before spawn; an unknown
  op → FAIL `engine_unknown_op:quantum-espresso:<op>`.

## Tests

`server/tests/conkay/engines/quantum-espresso.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-quantum-espresso.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_QUANTUM_ESPRESSO_BIN`, and fails if any test skips.

## First-live correction (2026-11-19, hardening pass)

Two fixes. (1) The kernel located `pw.x` by PATH only; it
now falls back to the sibling of the running interpreter
(the driver env's bin), in the SXE-00 env-provisioning
shape — verified by construction with a stub under a
scrubbed PATH. (2) The lane provisioned Quantum ESPRESSO
by apt, whose pockets serve 6.7 — the 7.4 pin is not
provisionable from Ubuntu at all. The corrected lane
provisions qe=7.4 from conda-forge (verified present for
linux-64) into the driver env, where the kernel's sibling
fallback finds pw.x.
