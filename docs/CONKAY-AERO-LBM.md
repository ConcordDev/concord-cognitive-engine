# ConKay aero.lbm — GPU lattice-Boltzmann drag for the CAD body

`aero.lbm` reports the drag of a `cad.body` from a **recorded** GPU lattice-Boltzmann (LBM) run, the same
way `aero.cfd` reports it from a recorded OpenFOAM run (`docs/CONKAY-AERO-CFD.md`). The run happens on a
separate GPU machine and takes tens of minutes instead of hours; the solver never starts it. It looks up
the run recorded for the exact body and re-derives the drag from the run's copied force series.

| piece | file |
|---|---|
| case generator (stdlib Python, presets `ahmed`, `car`) | `server/lib/conkay/cfd/lbm/lbm_case.py` |
| case program (OpenLB 1.9r0, CUDA) | `server/lib/conkay/cfd/lbm/aero_lbm.cpp` |
| Ahmed 25° geometry (gmsh, OCC kernel; shared with the OpenFOAM case) | `server/lib/conkay/cfd/ahmed.geo` |
| force-series parser, window statistics, settled check | `server/lib/conkay/cfd/lbm/force-series.js` |
| run store (receipts keyed by the cad.body request hash) | `server/lib/conkay/cfd/lbm/run-store.js` |
| Ahmed acceptance gate | `server/lib/conkay/cfd/lbm/validation.js` |
| solver | `server/lib/conkay/physics/solvers/aero-lbm.js` |
| CLI (`case`, `import`) | `server/scripts/conkay-lbm.mjs` |
| tests + fixture | `server/tests/conkay-aero-lbm.test.js`, `server/tests/fixtures/conkay-lbm/ahmed25/` |

@@RESULT@@
