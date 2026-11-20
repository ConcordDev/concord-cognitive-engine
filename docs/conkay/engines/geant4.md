# Engine: geant4 — Geant4 (reduced library) · SXE-30

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/geant4.js` — id `geant4`,
version pin **11.3.0**, licence **Geant4 Licence**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_GEANT4_BIN` (default
`/opt/concord-engines/geant4/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `b1`. Kernel:
`server/lib/conkay/engines/kernels/kernel-geant4.py`.

## Install (host provisioning, H2)

Geant4 ships no scriptable binary: the lane builds the toolkit's own basic example B1 against the pinned Geant4 11.3.0 (reduced library: default physics data set) and points `CONKAY_GEANT4_B1` at the built binary; a driver venv sits at `/opt/concord-engines/geant4`. The build is the lane's heavy step (tens of minutes, manual dispatch). Footprint: ~4 GB disk, 2 GB memory, 4 threads.

## Health

`health` runs B1 with its canonical macro shape (1000 events of 6 MeV gammas) and parses the cumulated dose B1 prints for its scoring volume. The dose depends on the exact library build, so the reference is the stored-reference shape: the lane records the verified value into `CONKAY_GEANT4_REF_DOSE` on its first verified run and the kernel then enforces a **10%** band; before that the run is a completion leg.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:geant4` with the install hint.
- Env provisioned but CONKAY_GEANT4_B1 unset/missing → FAIL `engine_failed:geant4:… does not name a provisioned exampleB1 binary …`.
- A request that fails the op schema → FAIL
  `engine_request_invalid:geant4` before spawn; an unknown
  op → FAIL `engine_unknown_op:geant4:<op>`.

## Tests

`server/tests/conkay/engines/geant4.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-geant4.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_GEANT4_BIN`, and fails if any test skips.
