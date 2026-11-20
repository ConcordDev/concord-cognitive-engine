# ConKay engines — framework (SXE-00)

External engines are how ConKay reaches fidelity tiers L3/L4: a solver's
top tier delegates to a real external code (a finite-element package, a
CAS, a CFD code) instead of an in-process approximation. This framework
is the only path from a solver to an engine.

## Pieces

- `server/lib/conkay/engines/manifest.js` — the engine manifest. Every
  engine is declared once: id, **pinned version**, licence (re-read from
  the pinned release), link mode, env var + default path for the binary,
  health op, ops, kernel script, install hint, footprint.
- `server/lib/conkay/engines/run-engine.js` — `runEngine` /
  `runProcessKernel`. Schema-validates the request before spawn, runs
  the kernel as a separate process under resource caps (wall time,
  threads, scratch dir), schema-validates the result, and caches by
  kernel-script hash + canonical request. Provenance on every result:
  engine id + version + kernel hash.
- `server/lib/conkay/engines/index.js` — `engineListReport()`, served by
  both `GET /api/conkay/engines` and the MCP `conkay_engine_list` tool
  so the two views cannot drift.

## The NOT_COMPUTED contract

An engine result is never faked:

- engine absent → `NOT_COMPUTED engine_unavailable:<id>` with the
  manifest's install hint;
- engine crashed / timed out / garbled its output →
  `FAIL engine_failed:<id>:<first stderr line or cause>`;
- engine reported non-convergence → `NOT_COMPUTED
  engine_not_converged:<id>` with its residuals;
- a fallback number is never labelled as the engine's result. A solver
  whose engine is absent may still answer at a lower in-process tier,
  labelled with that tier and `screening: true` — that is the solver's
  declaration, never the engine runner's substitution.

## Licence discipline

GPL engines run only as separate processes; AGPL engines run only as
separate processes **and unmodified**. The manifest validator refuses
entries that break either rule. Engine licences are re-read from the
pinned release at manifest time, not copied from memory.

## Adding an engine (per-engine tickets SXE-01…)

1. Add the manifest entry (in the engine's own module, registered at
   import) with the version pin and licence of the pinned release.
2. Write the kernel script: reads `{op, request}` as JSON on stdin,
   writes the result JSON on stdout, diagnostics on stderr, non-zero
   exit on failure. Declare per-op request/result schemas in the entry.
3. Instantiate the CI lane from `workflow-template.yml` as
   `.github/workflows/conkay-engine-<id>.yml` (via the desk git route —
   the connector cannot write workflow files) with the engine's tests
   under `server/tests/conkay/engines/<id>/`. The lane fails if a test
   skips: an engine tier that never runs in CI does not exist.
4. Write `docs/conkay/engines/<id>.md`: install, footprint, health,
   absent behaviour, licence/link mode.
5. Engine results become signable only through a solver declaration
   that passed the independent checker agent (DC-01) — the framework
   signs nothing itself.

## First-live correction — kernel environment (2026-11-19)

runEngine spawned kernels with a fixed env allowlist
(PATH, thread caps, CONKAY_ENGINE_ID/SCRATCH) that stripped
every CONKAY_* provisioning var the kernels read — tool
paths (CONKAY_CCX_BIN, CONKAY_MF6_BIN, CONKAY_EPANET_LIB,
CONKAY_GEANT4_B1), case/mesh/demo dirs (CONKAY_SU2_MESH,
CONKAY_OQ_DEMO, CONKAY_VINA_CASE_DIR, CONKAY_GMAT_CASE_DIR,
CONKAY_QE_PSEUDO, CONKAY_SPICE_KERNEL_DIR, CONKAY_SKYFIELD_DATA,
...) and every stored-reference var (CONKAY_*_REF_*). No
env-provisioned or stored-reference real leg could pass
through the runner; the suites could not see it because the
legs skip without engines and the kernel-direct legs spawn
with the env intact. runEngine now forwards the CONKAY_*
family from the ambient environment (its own ID/SCRATCH
still win); arbitrary ambient vars stay out. Found by the
SXE-53/54 hardening pass running SU2 end to end; see
CHECK-SXE-HARDENING.md. The same defect exists in the
sx/solver-core branch's copy of run-engine.js — flagged
for that branch's next landing.
