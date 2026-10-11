# USB Blend D — laboratory test plan

Document version 1.0.0. Rendered from the formulation report. Source sha256 `d143a16fd4d87980e7fbe3a87457fbf5a3db1a773f1ca0d97e3c4e7b43a4ca3c`.
Formulation version `formulation:usb-blend-d:v1-proposed`. Process version `process:usb-blend-d:p1-as-stated`.

This is a plan for tests that have not been run. It is not a result, and a criterion below is not a measurement. Where the source states no limit, the plan says so and does not invent one.

## Material under test

The source ranges sum to 86 % at their minima and 103 % at their maxima, so they do not fix a composition. The batch is the formulation version below (uniform-range-position rule), not 'whatever is inside the ranges'.

| Ingredient | Version |
|---|---:|
| HDPE base | 69.1177 % |
| HDPE/HC co-polymer | 14.1176 % |
| Basalt fiber | 7.4706 % |
| CaCO3 | 4.6471 % |
| Graphene | 2.8235 % |
| Silica | 1.8235 % |
| **Total** | **100.0000 %** |

Inorganic reference for the ash and TGA checks (basalt + CaCO3 + silica, graphene excluded): **13.9412 %**.

Process temperature on the version: 473.15 K (the source's 200 °C), recorded as a melt-processing temperature. It is not a cure.

The HDPE grade, the HDPE/HC copolymer, the basalt grade and the graphene grade are not identified in the source. Name the supplier lot on the test report. A result on a different lot is not a result on this version.

## Specimens, conditioning, equipment

- Specimens: at least 5 of the compound and 5 of the unfilled HDPE control for each material test, moulded from this formulation version and this process version. USB Blend D states no specimen count. Use at least five of the compound and five of the unfilled HDPE control, or the cited standard's own minimum when that is higher. Status: plan choice.
- Conditioning: the source states none. Follow the conditioning clause of the cited standard and record the temperature, humidity and time. Do not substitute a conditioning the source did not state.
- Equipment: the apparatus named with each method. That name is the plan's description of the standard's title. It is not a procedure, and it is not a copy of the standard.
- Controls: the unfilled HDPE is the same lot used as the version's HDPE base. Vessel tests have no coupon control; they are tests of a finished container.
- Report with every result: batch, supplier lots, deviations, specimen orientation, and the conditions listed under the test.

## Tests

### composition_verification

Priority: P0 prerequisite. Scope: material.

Reference inorganic loading of this formulation version: basalt + CaCO3 + silica = 13.9412 % (computed from the version's fractions; graphene is not included, because what it does in an ash test is unknown). Measure ash by ASTM D5630 and the composition by ASTM E1131 on the same batch. The source states no tolerance. Report the measured residue and the difference from 13.9412 %. Do not pass or fail a tolerance that was not set. The version is one point inside ranges that sum from 86 % to 103 %. A batch made to a different point in those ranges is a different composition. Identify the version on the report. A comparison with the marine blend cannot pass here. That blend is not on record, so measuring this batch does not show a higher polymer ratio than it.

Methods:
- ASTM E1131. thermogravimetric compositional analysis (polymer vs inorganic residue) of each batch
  - ASTM E1131: Standard Test Method for Compositional Analysis by Thermogravimetry. thermogravimetric analyser meeting ASTM E1131. https://store.astm.org/e1131-20.html
- ASTM D5630. ash content: total inorganic loading (basalt + CaCO3 + silica) against the formulation version
  - ASTM D5630: Standard Test Method for Ash Content in Plastics. furnace and balance meeting ASTM D5630. https://webstore.ansi.org/standards/astm/astmd563022

Conditions to record: method, atmosphere, batch.

Claims this test is aimed at:
- `claim:usb-blend-d:s01-composition_verification` (unsupported): higher polymer ratio than standard marine blend
- `claim:usb-blend-d:s11-composition_verification` (unsupported): Higher HDPE ratio means more polymer, less aggregate.
- `claim:usb-blend-d:total` (partially_supported): Total: 100%

### density

Priority: P0 prerequisite. Scope: material.

ASTM D792 on the moulded compound. This replaces the rule-of-mixtures estimate. The source states no density. Report the value and the difference from the conditional estimate. The difference is a void indication, not a pass limit. The strict density is unknown because the HDPE/HC copolymer has no cited density.

Methods:
- ASTM D792. density / specific gravity by displacement, on compression- or injection-moulded specimens of the exact formulation and process version
  - ASTM D792: Standard Test Methods for Density and Specific Gravity (Relative Density) of Plastics by Displacement. balance and immersion vessel meeting ASTM D792. https://store.astm.org/d0792-13.html

Conditions to record: temperature, method, specimen_preparation.

No open claim is tied to this property. It is a prerequisite characterisation, so that a later result can be traced to a batch.

### melt_flow_rate

Priority: P0 prerequisite. Scope: material.

ASTM D1238 on the HDPE lot and on the compound. The catalog's usual polyethylene condition is 190 °C / 2.16 kg; record the condition actually used. The source states no melt-flow number. The source states no numeric limit. Report the measured value with the method's repeatability. Do not pass or fail a number the source did not set.

Methods:
- ASTM D1238. melt flow rate of the HDPE grade and of the compound (190 °C / 2.16 kg is the usual PE condition)
  - ASTM D1238: Standard Test Method for Melt Flow Rates of Thermoplastics by Extrusion Plastometer. extrusion plastometer meeting ASTM D1238. https://store.astm.org/d1238-23a.html

Conditions to record: temperature, load.

No open claim is tied to this property. It is a prerequisite characterisation, so that a later result can be traced to a batch.

### processing_temperature

Priority: P0 prerequisite. Scope: material.

The source says 'Cure temperature: 200 °C'. HDPE is not cured. The process version records 200 °C (473.15 K) as a melt-processing temperature. FAIL that reading if the compound's ASTM D3418 melting peak is at or above 200 °C: the stated temperature would not melt it. The source does not say whether 200 °C is barrel, melt or mould, and it states no time at temperature, no machine and no cooling profile. Record those. Do not fill them in.

Methods:
- ASTM D3418, ASTM D1238. DSC of the HDPE grade and of the compound to fix the melt window; melt flow rate at the stated temperature range to check processability
  - ASTM D3418: Standard Test Method for Transition Temperatures and Enthalpies of Fusion and Crystallization of Polymers by Differential Scanning Calorimetry. differential scanning calorimeter meeting ASTM D3418. https://webstore.ansi.org/standards/astm/astmd341821
  - ASTM D1238: Standard Test Method for Melt Flow Rates of Thermoplastics by Extrusion Plastometer. extrusion plastometer meeting ASTM D1238. https://store.astm.org/d1238-23a.html

Conditions to record: where_measured, duration, equipment.

Claims this test is aimed at:
- `claim:usb-blend-d:process-temperature` (partially_supported): Cure temperature: 200°C —

### thermal_transitions

Priority: P0 prerequisite. Scope: material.

ASTM D3418 melting and crystallisation peaks of the HDPE lot and of the compound. Report the peaks. No transition temperature is stated as a requirement except as used under processing temperature.

Methods:
- ASTM D3418. DSC melting / crystallisation peaks: fixes the melt-processing window the 'cure temperature' must sit in
  - ASTM D3418: Standard Test Method for Transition Temperatures and Enthalpies of Fusion and Crystallization of Polymers by Differential Scanning Calorimetry. differential scanning calorimeter meeting ASTM D3418. https://webstore.ansi.org/standards/astm/astmd341821

Conditions to record: heating_rate, atmosphere.

No open claim is tied to this property. It is a prerequisite characterisation, so that a later result can be traced to a batch.

### hydrogen_compatibility

Priority: P1 safety-critical. Scope: material.

Claims 'inherently resistant to ... hydrogen' and 'No degradation from fuel contact', read here as hydrogen. CSA/ANSI CHMC 2 exposure and decompression cycles, at a pressure and temperature the laboratory states. Track mass, dimensions, appearance, and ASTM D638 tensile strength and elongation against unexposed controls from the same batch. FAIL 'no degradation' if blistering or collapse is observed, or if a tracked property changes by more than that method's repeatability. The source allows no change and states no percentage. 'Inherently resistant' is not awarded by one exposure. Record the result against the claim and leave the wording unsettled.

Methods:
- CSA/ANSI CHMC 2. polymer compatibility in compressed hydrogen: property retention after exposure and decompression cycles
  - CSA/ANSI CHMC 2: Test methods for evaluating material compatibility in compressed hydrogen applications — Polymers. high-pressure hydrogen exposure and permeation apparatus meeting CSA/ANSI CHMC 2. https://www.mdpi.com/1996-1944/16/15/5366
- ISO 11114-2. compatibility assessment of non-metallic materials with the gas content (guidance)
  - ISO 11114-2: Gas cylinders — Compatibility of cylinder and valve materials with gas contents — Part 2: Non-metallic materials. the compatibility assessment of ISO 11114-2 (guidance, not a coupon method). https://standards.globalspec.com/std/14480158/ds-en-iso-11114-2

Conditions to record: pressure, temperature, exposure_time, decompression_rate, cycles.

Claims this test is aimed at:
- `claim:usb-blend-d:s07-hydrogen_compatibility` (partially_supported): chemical resistance to hydrogen and saltwater
- `claim:usb-blend-d:s17-hydrogen_compatibility` (partially_supported): HDPE is inherently resistant to both saltwater and hydrogen gas.
- `claim:usb-blend-d:s18-hydrogen_compatibility` (unsupported): No degradation from fuel contact.

### hydrogen_permeability

Priority: P1 safety-critical. Scope: material.

Material screening (ASTM D1434 or ISO 15105-1, then CSA/ANSI CHMC 2 or ISO 11114-5 at pressure) reports the permeability of this compound. The source states no numeric limit. Report the measured value with the method's repeatability. Do not pass or fail a number the source did not set. These coupon numbers do not pass 'Hydrogen stays contained'. That sentence is a finished-vessel claim. See vessel containment.

Methods:
- ASTM D1434, ISO 15105-1. differential-pressure H2 transmission rate and permeability on sheet specimens (screening, low pressure)
  - ASTM D1434: Standard Test Method for Determining Gas Permeability Characteristics of Plastic Film and Sheeting. differential-pressure gas transmission cell meeting ASTM D1434, with hydrogen as the test gas. https://store.astm.org/d1434-23.html
  - ISO 15105-1: Plastics — Film and sheeting — Determination of gas-transmission rate — Part 1: Differential-pressure methods. differential-pressure gas transmission apparatus meeting ISO 15105-1, with hydrogen as the test gas. https://www.iso.org/standard/41677.html
- CSA/ANSI CHMC 2, ISO 11114-5. high-pressure hydrogen permeation (HPHP method) at service pressure and temperature, specimens made by the production process
  - CSA/ANSI CHMC 2: Test methods for evaluating material compatibility in compressed hydrogen applications — Polymers. high-pressure hydrogen exposure and permeation apparatus meeting CSA/ANSI CHMC 2. https://www.mdpi.com/1996-1944/16/15/5366
  - ISO 11114-5: Gas cylinders — Compatibility of cylinder and valve materials with gas contents — Part 5: Test methods for evaluating plastic liners. plastic-liner hydrogen test apparatus meeting ISO 11114-5. https://www.mdpi.com/1996-1944/16/15/5366

Conditions to record: gas, temperature, pressure, specimen_thickness, conditioning.

Claims this test is aimed at:
- `claim:usb-blend-d:s15-hydrogen_permeability` (unsupported): A viscoelastic chamber deforms, maintains seal integrity, springs back.
- `claim:usb-blend-d:s16-hydrogen_permeability` (contradicted): Hydrogen stays contained through the crash.

### pressure_containment

Priority: P1 safety-critical. Scope: component.

Claim that pressure resistance is retained. The source states no pressure. Material: ASTM D2990 creep at a stress the laboratory computes from a stated wall and pressure. No such wall is in the source, so the stress stays blank until a vessel drawing exists. Vessel: ISO 19881 hydraulic burst and pressure cycling. A coupon creep curve does not pass the vessel.

Methods:
- ASTM D2990. long-term creep and creep-rupture of the material under the stress the wall will see
  - ASTM D2990: Standard Test Methods for Tensile, Compressive, and Flexural Creep and Creep-Rupture of Plastics. creep frame meeting ASTM D2990. https://store.astm.org/d2990-17r25.html
- ISO 19881. hydraulic burst and pressure-cycle qualification of the finished container
  - ISO 19881: Gaseous hydrogen — Land vehicle fuel containers. a finished container and the pressure, permeation and impact facilities ISO 19881 names. https://www.mdpi.com/1996-1944/16/15/5366

Conditions to record: pressure, temperature, duration, geometry.

Claims this test is aimed at:
- `claim:usb-blend-d:s04-pressure_containment` (unsupported): pressure resistance retained from marine spec

### vessel_containment

Priority: P1 safety-critical. Scope: component.

Claim 'Hydrogen stays contained through the crash', and 'maintains seal integrity'. A material coupon cannot pass these. Pass only on a finished vessel: ISO 19881 permeation under 6 NmL/(h·L) at nominal working pressure and 15 °C, and under 46 NmL/(h·L) at 1.15 times nominal working pressure and 55 °C, AND the vessel's impact or drop sequence in ISO 19881 or SAE J2579, after which permeation still meets those rates. Those rates are the Type IV container limits quoted from Li et al. 2023 (the ISO 19881 entry in standards.js). They are not a material limit for Blend D, and Blend D states no nominal working pressure. Nominal working pressure is unknown until the vessel is specified. Do not insert one.

Methods:
- ISO 19881, SAE J2579. vessel-level qualification (permeation, pressure cycling, drop/impact, burst) on the finished container; a material coupon cannot establish this
  - ISO 19881: Gaseous hydrogen — Land vehicle fuel containers. a finished container and the pressure, permeation and impact facilities ISO 19881 names. https://www.mdpi.com/1996-1944/16/15/5366
  - SAE J2579: Standard for Fuel Systems in Fuel Cell and Other Hydrogen Vehicles. a finished fuel system and the facilities SAE J2579 names. https://www.normsplash.com/Samples/SAE/138617147/SAE-J-2579-2018-en-2.pdf

Conditions to record: nominal_working_pressure, temperature, vessel_geometry, impact_condition.

Claims this test is aimed at:
- `claim:usb-blend-d:s15-vessel_containment` (unsupported): A viscoelastic chamber deforms, maintains seal integrity, springs back.
- `claim:usb-blend-d:s16-vessel_containment` (unsupported): Hydrogen stays contained through the crash.

### impact_resistance

Priority: P2 performance. Scope: material.

Claims 'bends not breaks on impact' and 'deforms under impact'. Break type is the criterion those words support. FAIL the claim if any compound specimen is recorded as a complete break under the cited method. Impact energy has no limit in the source. The source states no numeric limit. Report the measured value with the method's repeatability. Do not pass or fail a number the source did not set. Run one system only. ASTM D256 and ISO 180 are not interchangeable, and ASTM D6110 and ISO 179-1 are not interchangeable.

Methods:
- ASTM D256, ISO 180. notched Izod impact energy (ASTM and ISO results are not interchangeable: pick one system and keep it)
  - ASTM D256: Standard Test Methods for Determining the Izod Pendulum Impact Resistance of Plastics. pendulum Izod impact tester meeting ASTM D256. https://store.astm.org/d0256-26.html
  - ISO 180: Plastics — Determination of Izod impact strength. pendulum Izod impact tester meeting ISO 180. https://www.iso.org/standard/72820.html
- ASTM D6110, ISO 179-1. notched Charpy impact energy
  - ASTM D6110: Standard Test Method for Determining the Charpy Impact Resistance of Notched Specimens of Plastics. pendulum Charpy impact tester meeting ASTM D6110. https://store.astm.org/d6110-26.html
  - ISO 179-1: Plastics — Determination of Charpy impact properties — Part 1: Non-instrumented impact test. pendulum Charpy impact tester meeting ISO 179-1. https://webstore.ansi.org/preview-pages/ISO/preview_ISO+179-1-2026.pdf
- ASTM D3763. instrumented high-speed puncture: load-displacement curve, energy to peak and to failure, ductile vs brittle failure mode; repeat at the lowest service temperature
  - ASTM D3763: Standard Test Method for High Speed Puncture Properties of Plastics Using Load and Displacement Sensors. instrumented high-speed puncture machine meeting ASTM D3763. https://store.astm.org/d3763-23.html

Conditions to record: test_standard, temperature, notch, specimen_thickness, specimen_orientation, processing_history.

Claims this test is aimed at:
- `claim:usb-blend-d:s03-impact_resistance` (unsupported): bends not breaks on impact
- `claim:usb-blend-d:s13-impact_resistance` (unsupported): Polymer absorbs energy through deformation.
- `claim:usb-blend-d:s14-impact_resistance` (unsupported): At 65-70% HDPE this blend deforms under impact and returns to shape rather than cracking.
- `claim:usb-blend-d:s16-impact_resistance` (unsupported): Hydrogen stays contained through the crash.

### saltwater_resistance

Priority: P2 performance. Scope: material.

Claim of chemical resistance to saltwater. Immerse per ASTM D543 in ASTM D1141 substitute ocean water. Report mass, dimensions, appearance, and ASTM D638 retention. The source states no numeric limit. Report the measured value with the method's repeatability. Do not pass or fail a number the source did not set.

Methods:
- ASTM D543, ASTM D1141, ASTM D638. immersion in ASTM D1141 substitute ocean water per ASTM D543; report mass, dimension and appearance change and ASTM D638 property retention
  - ASTM D543: Standard Practices for Evaluating the Resistance of Plastics to Chemical Reagents. immersion vessels meeting ASTM D543. https://store.astm.org/d0543-21.html
  - ASTM D1141: Standard Practice for Preparation of Substitute Ocean Water. substitute ocean water prepared to ASTM D1141. https://store.astm.org/d1141-98r21.html
  - ASTM D638: Standard Test Method for Tensile Properties of Plastics. tensile testing machine and extensometer meeting ASTM D638. https://store.astm.org/d0638-22.html

Conditions to record: medium, temperature, duration, strain, properties_tracked.

Claims this test is aimed at:
- `claim:usb-blend-d:s07-saltwater_resistance` (unsupported): chemical resistance to hydrogen and saltwater
- `claim:usb-blend-d:s17-saltwater_resistance` (unsupported): HDPE is inherently resistant to both saltwater and hydrogen gas.

### surface_hardness

Priority: P2 performance. Scope: material.

Claim that CaCO3 provides surface hardness. Report Shore D of the compound and of the unfilled HDPE control. The source states no numeric limit. Report the measured value with the method's repeatability. Do not pass or fail a number the source did not set.

Methods:
- ASTM D2240. Shore D durometer hardness against the unfilled base resin as control
  - ASTM D2240: Standard Test Method for Rubber Property—Durometer Hardness. Shore D durometer meeting ASTM D2240. https://www.normsplash.com/Samples/ASTM/151384388/ASTM-D2240-15-(R2021)-en.pdf

Conditions to record: scale, temperature, dwell_time, specimen_thickness.

Claims this test is aimed at:
- `claim:usb-blend-d:s06-surface_hardness` (unsupported): surface hardness

### tensile_properties

Priority: P2 performance. Scope: material.

Claim 'tensile reinforcement without adding brittleness', read as a comparison with the unfilled HDPE control in the same run. Reading of those words, not a margin from the source: FAIL if the compound's mean elongation at break is lower than the control's mean. A difference inside the method's repeatability does not fail. Tensile strength and modulus are reported. The source states no minimum for either.

Methods:
- ASTM D638. tensile strength, modulus and elongation at break (elongation is the 'no added brittleness' check); fibre-reinforced compounds need flow-direction and cross-flow specimens
  - ASTM D638: Standard Test Method for Tensile Properties of Plastics. tensile testing machine and extensometer meeting ASTM D638. https://store.astm.org/d0638-22.html

Conditions to record: test_standard, specimen_type, test_speed, temperature, conditioning, specimen_orientation, processing_history.

Claims this test is aimed at:
- `claim:usb-blend-d:s05-tensile_properties` (unsupported): tensile reinforcement without adding brittleness
- `claim:usb-blend-d:s08-tensile_properties` (unsupported): structural integrity
- `claim:usb-blend-d:s12-tensile_properties` (unsupported): Aggregate makes materials rigid and strong until fracture.

### thermal_conductivity

Priority: P2 performance. Scope: material.

Claim that graphene provides thermal conductivity for heat dissipation. ISO 22007-2 in-plane and through-thickness, or ASTM E1461 diffusivity with a measured density and specific heat. The source states no conductivity. The source states no numeric limit. Report the measured value with the method's repeatability. Do not pass or fail a number the source did not set.

Methods:
- ISO 22007-2. thermal conductivity by transient plane source (hot disc), in-plane and through-thickness
  - ISO 22007-2: Plastics — Determination of thermal conductivity and thermal diffusivity — Part 2: Transient plane heat source (hot disc) method. transient plane source (hot disc) instrument meeting ISO 22007-2. https://www.iso.org/standard/81836.html
- ASTM E1461. thermal diffusivity by flash (conductivity also needs density and specific heat)
  - ASTM E1461: Standard Test Method for Thermal Diffusivity by the Flash Method. flash diffusivity apparatus meeting ASTM E1461. https://store.astm.org/e1461-13r22.html

Conditions to record: temperature, direction, method.

Claims this test is aimed at:
- `claim:usb-blend-d:s09-thermal_conductivity` (unsupported): thermal conductivity for heat dissipation during splitting cycles

### uv_weathering

Priority: P2 performance. Scope: material.

Claim of weather and UV stability. Expose per ASTM G154, then ASTM D638 and ASTM D256 against unexposed controls. The source states no irradiance, no duration and no retained-property fraction. The source states no numeric limit. Report the measured value with the method's repeatability. Do not pass or fail a number the source did not set.

Methods:
- ASTM G154, ASTM D638, ASTM D256. fluorescent-UV cycle exposure per ASTM G154, then tensile and impact retention vs unexposed controls
  - ASTM G154: Standard Practice for Operating Fluorescent Ultraviolet (UV) Lamp Apparatus for Exposure of Materials. fluorescent UV exposure apparatus meeting ASTM G154. https://store.astm.org/g0154-23.html
  - ASTM D638: Standard Test Method for Tensile Properties of Plastics. tensile testing machine and extensometer meeting ASTM D638. https://store.astm.org/d0638-22.html
  - ASTM D256: Standard Test Methods for Determining the Izod Pendulum Impact Resistance of Plastics. pendulum Izod impact tester meeting ASTM D256. https://store.astm.org/d0256-26.html

Conditions to record: cycle, irradiance, duration, properties_tracked.

Claims this test is aimed at:
- `claim:usb-blend-d:s10-uv_weathering` (unsupported): weather and UV stability

### viscoelastic_recovery

Priority: P2 performance. Scope: material.

Claims 'returns to shape', 'springs back', and 'a viscoelastic chamber deforms ... springs back'. ASTM D2990: creep, then unload, and record recovery against time. The source states no stress, no duration and no recovered fraction. ASTM D3763 below perforation: record residual dent depth after a recovery time the laboratory writes down before the test. The source states no dent depth and no recovery time. The source states no numeric limit. Report the measured value with the method's repeatability. Do not pass or fail a number the source did not set. A coupon result does not by itself pass the chamber claim; that claim is also under vessel containment.

Methods:
- ASTM D2990. creep under constant load, then unload and record recovery over time (the 'returns to shape' claim)
  - ASTM D2990: Standard Test Methods for Tensile, Compressive, and Flexural Creep and Creep-Rupture of Plastics. creep frame meeting ASTM D2990. https://store.astm.org/d2990-17r25.html
- ASTM D3763. sub-perforation impacts at increasing energy, then measure residual dent depth after a stated recovery time (no single standard defines 'springs back'; the acceptance threshold must be set for the part)
  - ASTM D3763: Standard Test Method for High Speed Puncture Properties of Plastics Using Load and Displacement Sensors. instrumented high-speed puncture machine meeting ASTM D3763. https://store.astm.org/d3763-23.html

Conditions to record: load_or_strain, temperature, duration, recovery_time, specimen_orientation.

Claims this test is aimed at:
- `claim:usb-blend-d:s02-viscoelastic_recovery` (unsupported): gives viscoelastic behavior
- `claim:usb-blend-d:s14-viscoelastic_recovery` (unsupported): At 65-70% HDPE this blend deforms under impact and returns to shape rather than cracking.
- `claim:usb-blend-d:s15-viscoelastic_recovery` (unsupported): A viscoelastic chamber deforms, maintains seal integrity, springs back.

## Claims with no laboratory test in this plan

- `claim:usb-blend-d:s01-comparison`: the marine blend formulation and its test data are not on record, so the comparison can't be checked; ingest it first
- `claim:usb-blend-d:s04-comparison`: the marine blend formulation and its test data are not on record, so the comparison can't be checked; ingest it first
- `claim:usb-blend-d:s11-comparison`: the marine blend formulation and its test data are not on record, so the comparison can't be checked; ingest it first
- `claim:usb-blend-d:s12-tensile_properties`: general statement about a material class, not this formulation: cite literature, or drop it
- `claim:usb-blend-d:s13-impact_resistance`: general statement about a material class, not this formulation: cite literature, or drop it

## What a pass does not mean

A completed row in this plan is a measurement against the criterion written here. It does not qualify a hydrogen vessel, it does not establish a service life, and it does not turn the source's wording into evidence. Vessel containment stays failed until a finished vessel is tested. Coupon permeability, however low, does not pass 'Hydrogen stays contained through the crash'.
