# Engine: vina — AutoDock Vina · SXE-28

Built in the CI-only scope of the founder F1 ruling
(2026-11-18) under SXE-54 (the breadth engine programme);
the H1/H2 hosts these engines will run on are that programme's
deferred-open remainder — nothing is installed on any host
by this ticket.

## Manifest entry

`server/lib/conkay/engines/entries/vina.js` — id `vina`,
version pin **1.2.7**, licence **Apache-2.0**
(as catalogued for the pinned release at registration,
2026-11-19), link mode **process**. The framework resolves
the engine's driver-env Python via `CONKAY_ENGINE_VINA_BIN` (default
`/opt/concord-engines/vina/bin/python`): the env exists
only where provisioned, so the report's `present` tracks
provisioning. Ops: `health`, `redock`. Kernel:
`server/lib/conkay/engines/kernels/kernel-vina.py`.

## Install (host provisioning, H2)

Provision the Vina 1.2.7 release binary on PATH, a driver venv at `/opt/concord-engines/vina`, and the docking case at `CONKAY_VINA_CASE_DIR`: `receptor.pdbqt`, `ligand.pdbqt` (the crystal pose) and `case.json` {center, size} — assembled from the AutoDock Vina tutorial case (1iep) in the pinned v1.2.7 source tree, with the box recorded from the tutorial at provisioning time. Footprint: ~256 MB disk, 512 MB memory, 4 threads.

## Health

`health` is the plan's case: re-dock the case ligand into its receptor; the best mode's RMSD against the crystal pose must be **< 2 A**, the standard redocking criterion. The case is environment data — no case dir is a provisioning defect (exit 3), never an invented case.

## Absent behaviour

- Driver env unprovisioned → NOT_COMPUTED
  `engine_unavailable:vina` with the install hint.
- Env provisioned but vina missing or the case unprovisioned → FAIL `engine_failed:vina:vina executable not found …` / the CONKAY_VINA_CASE_DIR naming line.
- A request that fails the op schema → FAIL
  `engine_request_invalid:vina` before spawn; an unknown
  op → FAIL `engine_unknown_op:vina:<op>`.

## Tests

`server/tests/conkay/engines/vina.test.js` — registration
and manifest validity, the absence answer, schema and
unknown-op refusals, and the kernel's provisioning-defect
leg run locally. The value legs run only in the CI lane
(`.github/workflows/conkay-engine-vina.yml`, manual
dispatch per F8), which installs the pinned engine, sets
`CONKAY_ENGINE_VINA_BIN`, and fails if any test skips.
