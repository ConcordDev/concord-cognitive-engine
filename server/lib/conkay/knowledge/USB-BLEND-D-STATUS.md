# USB Blend D — every aspect

Each registered material, process and hydrogen check, run on Blend D with each co-polymer candidate under each reading of the percentages. A number is a model result with the stated inputs; NOT_COMPUTED names what is missing. Nothing here is a measurement of a batch.

| Check | recycled-impact-pp (mass) | recycled-impact-pp (volume) | eva (mass) | eva (volume) |
|---|---|---|---|---|
| `material.composition-check` | WARN | WARN | WARN | WARN |
| `material.density-rom` | 1026–1095 kg/m³ | 1147–1304 kg/m³ | 1032–1097 kg/m³ | 1152–1305 kg/m³ |
| `material.mass-to-volume` | PASS | PASS | PASS | PASS |
| `material.modulus-bounds` | E Reuss 1.03–1.49 / Voigt 5.70–21.90 GPa | E Reuss 1.15–1.67 / Voigt 12.66–45.21 GPa | E Reuss 0.11–0.31 / Voigt 5.58–21.76 GPa | E Reuss 0.13–0.35 / Voigt 12.53–45.00 GPa |
| `material.modulus-halpin-tsai` | NOT_COMPUTED | NOT_COMPUTED | NOT_COMPUTED | NOT_COMPUTED |
| `material.modulus-mori-tanaka` | NOT_COMPUTED | NOT_COMPUTED | NOT_COMPUTED | NOT_COMPUTED |
| `material.tensile-bounds` | NOT_COMPUTED | NOT_COMPUTED | NOT_COMPUTED | NOT_COMPUTED |
| `material.k-maxwell-garnett` | NOT_COMPUTED | NOT_COMPUTED | NOT_COMPUTED | NOT_COMPUTED |
| `material.k-lewis-nielsen` | NOT_COMPUTED | NOT_COMPUTED | NOT_COMPUTED | NOT_COMPUTED |
| `material.cte-turner` | NOT_COMPUTED | NOT_COMPUTED | NOT_COMPUTED | NOT_COMPUTED |
| `material.cte-schapery` | NOT_COMPUTED | NOT_COMPUTED | NOT_COMPUTED | NOT_COMPUTED |
| `material.thermal-transitions` | WARN | WARN | WARN | WARN |
| `material.heat-dissipation-screen` | WARN | WARN | WARN | WARN |
| `material.viscoelastic-prony` | NOT_COMPUTED | NOT_COMPUTED | NOT_COMPUTED | NOT_COMPUTED |
| `material.impact-recovery-screen` | NOT_COMPUTED | NOT_COMPUTED | NOT_COMPUTED | NOT_COMPUTED |
| `vessel.h2-permeation` | WARN | WARN | WARN | WARN |
| `material.chemical-compatibility` | WARN | WARN | WARN | WARN |
| `process.window` | WARN | WARN | WARN | WARN |
| `material.basis-discriminator` | ash: mass 9.8–18.0 %, volume 20.2–40.1 % | ash: mass 9.8–18.0 %, volume 20.2–40.1 % | ash: mass 9.8–18.0 %, volume 20.2–39.9 % | ash: mass 9.8–18.0 %, volume 20.2–39.9 % |
| `material.modulus-hashin-shtrikman` | E 1.09–14.27 GPa | E 1.34–30.21 GPa | E 0.18–14.10 GPa | E 0.21–30.00 GPa |
| `material.modulus-mori-tanaka-random` | NOT_COMPUTED | NOT_COMPUTED | NOT_COMPUTED | NOT_COMPUTED |
| `material.k-multiphase` | NOT_COMPUTED | NOT_COMPUTED | NOT_COMPUTED | NOT_COMPUTED |
| `material.cte-multiphase` | Turner 16.6–98.7 ppm/K (low for a soft matrix) | Turner 4.8–54.1 ppm/K (low for a soft matrix) | NOT_COMPUTED | NOT_COMPUTED |
| `material.viscoelastic-composite` | NOT_COMPUTED | NOT_COMPUTED | NOT_COMPUTED | NOT_COMPUTED |

## What closes the gaps

| Missing input | How to get it | Checks it unblocks |
|---|---|---|
| filler shapes: basalt fibre length after compounding, CaCO3 and silica particle shape, co-polymer droplet morphology | micrographs of a moulded batch (SEM / optical), fibre-length analysis of the ashed residue; supplier particle data | `material.modulus-halpin-tsai`, `material.modulus-mori-tanaka`, `material.tensile-bounds`, `material.k-maxwell-garnett`, `material.k-lewis-nielsen`, `material.cte-turner`, `material.cte-schapery`, `material.modulus-mori-tanaka-random`, `material.viscoelastic-composite` |
| basalt fibre thermal conductivity (solid fibre) | supplier data for the chosen fibre, or ASTM E1461 diffusivity on the fibre; every open value read is mineral wool's | `material.k-multiphase` |
| the co-polymer's identity and its own data (relaxation spectrum; for EVA also k and CTE) | name the stream/grade (Dutch's candidates: recycled impact PP, EVA); DMA (ASTM D4065/D5026) for the spectrum; ISO 22007-2 and ASTM E831 for EVA's k and CTE | `material.modulus-mori-tanaka-random`, `material.viscoelastic-composite`, `material.k-multiphase`, `material.cte-multiphase` |
| the compound's relaxation spectrum | DMA frequency sweep or stress relaxation of a moulded batch (ASTM D4065/D5026, D2990) | `material.viscoelastic-prony`, `material.impact-recovery-screen` |
| basalt–HDPE interfacial shear strength, matrix stress at composite failure, fibre orientation factor | single-fibre pull-out or fragmentation test; tensile test of the matrix; micrograph orientation analysis | `material.tensile-bounds` |
| the load case: impact strain amplitude and frequency, service frequency | design input from the crash/impact scenario (not a material property) | `material.impact-recovery-screen`, `material.viscoelastic-composite` |
| Lewis–Nielsen shape constants A and φ_max for fibres and platelets | Nielsen's published shape tables (not read here) | `material.k-lewis-nielsen` |
| notched impact strength | ASTM D256 / ISO 179 on moulded bars: no model predicts it | `material.impact-recovery-screen` |

Also open, outside the material checks: whether the percentages are by weight or by volume (one ash test decides, material.basis-discriminator); HDPE's hydrogen-permeation activation energy for 55 °C (none found in open sources); the chamber's geometry and working pressure (vessel design).
