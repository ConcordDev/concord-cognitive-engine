# SENTINEL / RAM — Physics-Grounded Engineering Specification

Revision 1.0 · 9 October 2026 · Research baseline, not a certified build specification
Status of this document: computed and sourced where marked. It is not a manufacturing instruction, pressure-vessel design, or flight clearance.

Claim statuses used throughout:

- **Sourced** — traceable published measurement or standard.
- **Computed** — derived here from stated inputs and a named method.
- **Estimated** — explicit approximation, not a measurement.
- **Hypothesis** — proposed, not established.
- **Contradicted** — conflicts with conservation laws, geometry, or a sourced value.
- **Unknown** — insufficient information.

A design may be geometrically valid while its propulsion claims remain contradicted. Status is attached to the claim, not to the project.

---

## 0. What this specification is for

Keep the Sentinel, Ram, USB materials, solar intake, and closed-loop infrastructure as research programs. Separate them into three bins. ConKay, or any later solver, must not promote a claim from bin 3 into a fabrication step because an internal calculation is self-consistent.

| Bin | Meaning | Disposition in this revision |
| --- | --- | --- |
| Buildable engineering | Frames, sensors, solar, batteries, pumps, thermal management, composite coupons, cabin packaging, controls, simulation | Milestone 0 and Milestone 1 below |
| Research-stage | USB formulations, self-healing, piezoelectric harvesting, sensory skins, high-load polymer/metal composites | Materials test matrix; no assigned performance |
| Unsupported as stated | Laser seawater splitting as a fuel cycle, indefinite operation, zero drag, instant acceleration, stated interplanetary transit times | Retained as hypotheses. Removed from acceptance criteria |

First real milestone: a low-speed, ground-based, instrumented Sentinel prototype with a measured solar/battery budget, a coupon-level materials program, and a constraint-driven CAD body. Not an interplanetary vehicle.

---

## 1. Corrections that close the March 2026 spec

### 1.1 The 96.79 THz figure is a Raman band position, not a dissociation threshold

The arithmetic is accepted.

Seawater salinity taken as 3.5 mass percent. Using the stated fit \(\Delta\nu_1 = 3222.8 + 1.69 \times \mathrm{sal}\):

\[
\Delta\nu_1 = 3222.8 + 1.69 \times 3.5 = 3228.715\ \mathrm{cm}^{-1}
\]

\[
\nu = 3228.715\ \mathrm{cm}^{-1} \times 2.99792458 \times 10^{10}\ \mathrm{cm\,s}^{-1} = 9.679 \times 10^{13}\ \mathrm{Hz} = 96.79\ \mathrm{THz}
\]

\[
\lambda = c / \nu = 3097\ \mathrm{nm}
\]

Status of the wavenumber and the wavelength conversion: **computed**, conditional on the stated salinity fit. 3097 nm is mid-infrared. Near-infrared ends near 2500 nm. The March text calling 96.79 THz near-infrared is **contradicted**.

Photon energy at that frequency:

\[
E = h\nu = 0.400\ \mathrm{eV}
\]

Status: **computed**.

What the band actually is: the OH-stretching region of liquid water, observed by Raman spectroscopy. Published saline-solution work assigns components near 3018, 3223, 3393, 3506 and 3624 cm⁻¹ to hydrogen-bonded and non-bonded water. That is a vibrational spectroscopy observable. It is not a measured photodissociation cross-section, quantum yield, or hydrogen production rate.

Why one photon at this energy cannot be the splitting event:

- Reversible electrical work to split water at 25 °C is \(\Delta G^\circ = 237.1\ \mathrm{kJ\,mol}^{-1}\), equivalent to 1.229 V for a two-electron reaction. Status: **sourced** (standard thermochemistry).
- Full enthalpy is \(\Delta H^\circ = 285.8\ \mathrm{kJ\,mol}^{-1}\), thermoneutral cell voltage 1.481 V. Status: **sourced**.
- The O–H bond energy is on the order of 4.8 eV. Direct gas-phase photolysis of water is a vacuum-ultraviolet process. A 0.40 eV mid-IR photon is an order of magnitude too small.
- Absorbing that band heats the water. Heating is what a reference-cell “confirmation” would detect. Temperature rise does not demonstrate H₂ yield.

Status of “irradiating seawater at 96.79 THz dissociates it into hydrogen and oxygen”: **hypothesis**, and the proposed mechanism is **contradicted** by photon energy. A quantum-cascade laser near 3.1 µm is a real instrument class. Pointing one at seawater and getting bulk fuel is a separate, unmeasured claim.

### 1.2 The hydrogen energy figure used in March is wrong by about 6×

March used 38.62 kJ per mole of hydrogen and concluded 805 W, then 1.61 kW at 50 percent “QCL efficiency,” for 2.5 g H₂ per minute.

Correct basis, same production rate:

\[
\dot n = \frac{2.5\ \mathrm{g\,min}^{-1}}{2.016\ \mathrm{g\,mol}^{-1}} = 1.240\ \mathrm{mol\,min}^{-1} = 0.150\ \mathrm{kg\,h}^{-1}
\]

| Basis | Energy rate | Status |
| --- | --- | --- |
| Gibbs electrical minimum, heat supplied free | \(1.240 \times 237.1 = 294\ \mathrm{kJ\,min}^{-1} = 4.90\ \mathrm{kW}\) | Computed from sourced \(\Delta G\) |
| Thermoneutral, electricity supplies all enthalpy | \(1.240 \times 285.8 = 354\ \mathrm{kJ\,min}^{-1} = 5.91\ \mathrm{kW}\) | Computed from sourced \(\Delta H\) |
| HHV equivalent | 39.4 kWh/kg × 0.150 kg/h = 5.91 kW | Sourced HHV, computed rate |
| LHV equivalent | 33.3 kWh/kg × 0.150 kg/h = 5.00 kW | Sourced LHV, computed rate |
| Current PEM system electricity, ~55 kWh/kg | 8.3 kW | Sourced order of magnitude (DOE PEM analyses cite ~51 kWh/kg stack and ~55–57.5 kWh/kg system), computed rate |
| March emitter estimate | 1.61 kW | Contradicted |

A car-battery cranking pulse of roughly 6 kW for a few seconds does not cover an 8 kW continuous load. Status of “the battery has headroom”: **contradicted** for continuous operation.

### 1.3 The closed loop is not self-sustaining

Each conversion loses energy. Recovered energy is credited only when measured.

Combustion or a fuel cell returns at most the heating value, and only after real conversion losses. LHV is 33.3 kWh/kg. A small engine-alternator chain at 20 percent fuel-to-electric efficiency returns about 6.7 kWh/kg. Making the hydrogen cost about 55 kWh/kg at current PEM system figures, or 39.4 kWh/kg even at the thermoneutral limit. The ratio is negative in every honest case:

\[
\eta_\mathrm{loop} \approx \frac{0.20 \times 33.3}{55} \approx 0.12
\]

About 12 percent of the electrical input comes back. The other 88 percent must come from outside the loop. Status of “one battery start, indefinite operation”: **contradicted**.

Seawater is not water plus reusable salt. Direct seawater electrolysis produces chlorine-side reactions, hypochlorite, and corrosion products unless the process is specifically engineered against them. Brine does not reconstitute into clean fuel by remixing with condensate. Status of the rain-cycle fuel claim: **hypothesis**, mechanism **contradicted** as stated.

### 1.4 Formulations do not sum to 100 percent

Computed from the March ranges. No balance component was named.

| Formulation | Sum of minima | Sum of maxima | Status |
| --- | --- | --- | --- |
| USB Blend D | 85% | 103% | Contradicted as a complete recipe |
| Steel-USB reinforcement | 81% | 97% | Contradicted as a complete recipe |
| Piezoelectric outer shell | 78% | 92% | Contradicted as a complete recipe |
| Sensory layer | 72% | 82% | Contradicted as a complete recipe |

HDPE and PP are thermoplastics. They melt, flow, and solidify. “Cure at 200 °C” does not define grade, melt temperature, residence time, shear, dispersion, degradation, mold temperature, or cooling profile. Status of the process as a reproducible manufacturing instruction: **unknown**, and the curing language is misleading.

Adding BaTiO₃ or PZT particles does not establish a harvester. Adding steel particles does not establish an armor cage. Status of “beyond ballistic,” “self-repairing,” “99.9% IR blocking,” “radiation-proof,” and “all impact becomes usable energy”: **hypothesis** until a named specimen passes a named test.

### 1.5 Mass, cost, and transit claims do not close

Square-cube check, assuming Mark I and Mark III are the same density. Linear scale \(35/10 = 3.5\). Mass scale \(3.5^3 = 42.875\).

\[
4000\ \mathrm{lb} \times 42.875 = 171{,}500\ \mathrm{lb}
\]

March Mark III operational mass is 40,000 lb, about 4.3 times lighter than geometric scaling of Mark I. Both masses cannot describe the same construction. Status: **contradicted** as a paired mass budget. Neither mass is measured.

Cost of $8,000–10,000 for a 10 ft, 4,000 lb actuated machine, and $15,000–20,000 for the 35 ft machine, has no bill of materials. Status: **hypothesis**, and inconsistent with commodity actuator, battery, and sensor prices. Not an acceptance criterion.

Earth–Mars distance is on the order of 0.5–2.5 AU. A 2.5-day transit at 1 AU average requires about 700 km/s. That is not available from the stated hardware. Moon at 3.5 hours is about 30 km/s average, above Apollo-class speeds and unsupported by a thrust and propellant budget. Status of the stated transit times: **contradicted** as engineering requirements. They may remain labeled hypotheses.

Cabin climate of 97–99 °F is not a general human-comfort target. Status: **contradicted** as a comfort specification. Use an ordinary HVAC setpoint and size it independently.

---

## 2. Energy law for every later claim

No energy-consuming process is accepted without an external source. Recovered energy is a measured credit, not an assumption.

\[
P_\mathrm{total} = P_\mathrm{intake} + P_\mathrm{compute} + P_\mathrm{sensors} + P_\mathrm{actuators} + P_\mathrm{thermal} + P_\mathrm{experimental} + P_\mathrm{other}
\]

\[
E_\mathrm{daily,solar} = \int_\mathrm{day} P_\mathrm{solar}(t)\,dt
\]

\[
t_\mathrm{operate} = \frac{E_\mathrm{battery,usable} + E_\mathrm{recovered,measured}}{P_\mathrm{average}}
\]

Reject any claim of perpetual operation if this balance is negative or if \(E_\mathrm{recovered}\) is unverified.

Solar sizing uses site irradiance, panel area, nameplate efficiency, temperature derate, soiling, shading, and power-electronics efficiency. Laboratory cell efficiency is not daily yield.

---

## 3. Milestone 0 — stationary power and intake prototype

Purpose: measure a power budget that does not depend on the QCL hypothesis.

### 3.1 Architecture

- Solar array, charge controller, battery, distribution rails.
- One intake pump, filter, flow meter, pressure tap, salinity or conductivity sensor.
- Compute and sensor rail, separately fused from the pump rail.
- Data logger. No telemetry requirement beyond local storage.
- The QCL sphere is not in this milestone.

### 3.2 Required records, each with status

| Item | Unit | Acceptance |
| --- | --- | --- |
| Site, date, panel orientation | — | Recorded |
| Plane-of-array irradiance | W/m² | Measured or a named typical meteorological year, marked estimated |
| Array area and nameplate efficiency | m², percent | Sourced from the panel datasheet |
| Array output | W, Wh/day | Measured |
| Battery chemistry, nominal capacity, usable fraction, discharge limit, reserve | V, Ah, Wh | Sourced from the cell datasheet; usable fraction marked estimated until measured |
| Pump flow, head, electrical draw | L/min, m, W | Measured against the pump curve |
| Compute and sensor draw | W | Measured |
| Operating duration at the measured average load | h | Computed from measured Wh and W |

### 3.3 Explicit non-goals

No hydrogen production. No claim that intake water is fuel. No welded closed vessel.

---

## 4. Milestone 1 — low-speed ground Sentinel prototype

This is the first end-to-end acceptance case. Stationary sensing first, then low-speed mobile. Not flight, marine supercavitation, or orbit.

### 4.1 Mission

Autonomous interposition is a later behavior claim. Milestone 1 mission is: stand, walk at low speed, carry a stated payload, sense, stop safely, and report its energy and structural margins.

Human override: an authenticated hardware safe-stop, independent of voice. Voice recognition alone is not an accepted interlock. Status of “Dutch voiceprint is the only weakness”: **rejected** as a safety requirement.

### 4.2 Frame inputs that must be parsed, not assumed

| Input | March value | Status in this revision | Rule |
| --- | --- | --- | --- |
| Height | 10 ft (3.048 m) | Hypothesis, usable as a packaging target | Keep as a hard dimension only after CAD confirms proportions |
| Mass | 4,000 lb (1,814 kg) | Unknown until a mass budget closes | Do not use as an input and an output |
| Armor cage | 600 lb | Unknown | Component line, not a capability |
| Sprint | 80–100 mph sustained | Contradicted as a Milestone 1 requirement | Replace with a measured walking speed |
| Lift | 15,000 lb | Hypothesis | Not accepted without actuator force, moment arm, and stability |
| Strike | 4,000–6,000 lb | Out of scope | Non-violence doctrine is a behavior constraint, not a structural load case to design toward |
| Cost | $8,000–10,000 | Hypothesis | Output of a BOM, not an input |

Proxy geometry is labeled proxy. Critical bought components use datasheet dimensions.

### 4.3 Parameterized assembly

Minimum component set:

- Structural frame members with section, length, material assignment, and joint identifiers.
- Actuators at named joints, with stall torque or force, speed, mass, and voltage from a datasheet or an explicit estimate.
- Battery module with mass, volume, capacity, and placement.
- Solar panel mount with area and mass, even if body-mounted area is small.
- Compute, sensor head, and a payload hard-point.
- Feet with contact patches.

Required calculations:

- Mass properties and center of gravity from the component list. Missing mass is a gap, not zero.
- Collision, clearance, and a service-access envelope around battery and controller.
- Static stability: vertical through the center of gravity falls inside the support polygon for the stated pose. Margin reported, not scored into a single number with unrelated domains.
- One bending load case on a named member, with section modulus, allowable stress, and a factor. If the material allowable is estimated, the check is marked estimated.
- Deliberate faults the workflow must catch: one undersized battery relative to the load list, one member over the allowable. A repair may change section or battery capacity. It may not silently delete the payload or the speed requirement.

### 4.4 Electrical budget for Milestone 1

Rails stay separate: actuators, compute, sensors, thermal, experimental.

Peak power is the sum of simultaneous peaks the control policy can actually command. Average power is the duty-cycle sum. Operating duration uses usable watt-hours and average power, with a stated reserve that is not available for the mission.

An undersized battery is a failed check, not a prompt to invent regeneration.

### 4.5 What still requires physical testing

Software passage is not validation. Milestone 1 still needs:

- Measured component masses against the CAD mass budget.
- A static tip-load or joint-torque test.
- A logged walk at the accepted speed on the accepted surface.
- A battery rundown at the logged average load.
- Thermal measurement at the controller and actuator drivers.

---

## 5. Materials program

USB is a proposed family, not one material.

Four formulation lanes, kept separate: structural composite, flexible impact layer, sensory skin, piezoelectric composite. Each lane needs a normalized recipe before any specimen is poured.

Normalization rule until a balance component is chosen: ranges are targets, not compositions. A valid recipe states one mass fraction per ingredient, fractions sum to 1.000 within 0.005, and names the polymer grade.

Processing record, all required, none defaulted:

- Polymer grade and melt-flow index.
- Additive grades and particle size.
- Melt temperature, residence time, mixing method, screw or batch shear if known.
- Mold temperature and cooling profile.
- Specimen identity, dimensions, and conditioning.

Predicted properties and measured batch results are different fields. No strength, fatigue, impact, thermal, chemical, or permeability number is assigned without a method and a specimen.

First articles are coupons. Not a load-bearing shell. Not a welded operational vessel.

Out of scope until a coupon passes the corresponding test: ballistic rating, self-repair, lightning absorption, radiation blocking, and impact-to-electrical-energy conversion. Piezoelectric output requires electrodes, particle connectivity or a stated composite architecture, poling where applicable, and a measured coulomb or watt figure under a stated load and frequency.

---

## 6. QCL sphere — experiment record, not a build

Retain the March hardware notes as a lab hypothesis. Do not fabricate the closed welded housing as a pressure vessel. The March design does not establish design pressure, weld procedure, fatigue, hydrogen compatibility, leak rate, or relief capacity.

If a spectroscopy experiment is run later, the acceptance data are:

- Measured wavelength and linewidth, not a setpoint.
- Absorbed power and temperature rise in a reference cell.
- Gas chromatography or an equivalent H₂ measurement, with a blank.
- Electrical input to the laser, driver, and cooler.
- Hydrogen mass per hour and watt-hours per kilogram.

Heating of a water cell is not a pass. Absence of those measurements keeps the claim at hypothesis.

A practical hydrogen path, if hydrogen is actually required, is a commercial electrolyzer on the solar/battery rail, with a defined water-treatment step. That path is sized with the 55 kWh/kg class of system electricity, not with laser photon energy. It is not part of Milestone 0 or 1.

---

## 7. Later programs, parked

### 7.1 Mark II and Mark III

Parked. Cabin work, when started, uses occupant envelopes, egress, restraints, ventilation, fire protection, and an independently sized climate system. Walking does not demonstrate aircraft or submarine performance. The 40,000 lb mass, apartment-in-torso claim, and flight speeds are not established. Re-open only after Milestone 1 mass properties exist, so scaling has a measured density.

### 7.2 Ram scout, carrier, hauler

Concept classes only. A legitimate long-duration option is solar-electric propulsion: arrays make electricity, thrusters consume electricity and reaction mass. Solar arrays do not create thrust. Re-open only with a mass budget, propellant or reaction-mass budget, thrust, specific impulse, power, thermal rejection, and a trajectory. Stated transit times and costs are not requirements.

### 7.3 Concord City

Separate civil program. Land, water rights, environmental review, building code, fire protection, utilities, and municipal law are not solved by a foundation material. The resonance-emitter utility claim depends on section 6 and is not an infrastructure requirement.

### 7.4 Conquest and Node Hopper

Conquest is a speculative concept, not spacecraft engineering. Node Hopper, if pursued, is consent-based signed software distribution. Replication onto devices without owner permission is not a requirement.

### 7.5 Nano-USB neural interface

Not an engineering requirement. No fabrication, no dosing, no procedure. Status: hypothesis, out of scope.

---

## 8. Solver and evidence rules

These are the acceptance rules for any ConKay implementation of this record.

1. Parse components, materials, dimensions, performance claims, processes, and environments into separate claims.
2. Attach source, date, passage, units, and status. Missing data stays unknown. No authoritative default for a missing property.
3. A safe documented assumption is labeled estimated and is not a sourced specification.
4. Solvers declare regime, assumptions, input units, output units, numerical tolerance, and whether the result is screening-level.
5. Conservation checks for mass, energy, charge, and fluid volume run where the domain applies. Domains are not collapsed into one score.
6. Geometry pass and structural fail are both reportable.
7. A repair loop may change design parameters. It may not change user requirements silently.
8. Passing software tests is not physical validation.
9. Results are invalid after a relevant input or solver version changes.

---

## 9. Ranked open gaps

1. No measured electrical budget for any Sentinel load. Blocks every endurance claim.
2. No closed mass budget or center of gravity. Blocks stability and the Mark I to Mark III scale.
3. USB recipes are not normalized and have no coupon data. Blocks every shell claim.
4. No actuator selection. Blocks speed, lift, and joint loads.
5. QCL hydrogen yield is unmeasured and the proposed mechanism conflicts with photon energy. Blocks every fuel-cycle claim.
6. No pressure-vessel basis for the sphere housing. Blocks any closed-vessel experiment.
7. No trajectory, thrust, or reaction-mass budget. Blocks Ram transit claims.

---

## 10. Demonstration request

Input to the workflow, Milestone 1 scale, all values either datasheet-sourced or marked estimated:

- Frame height target 3.05 m. Member sections and material allowables stated, not inferred from “USB.”
- Four to six actuators with datasheet torque, speed, mass, and voltage.
- Battery watt-hours and mass from a cell datasheet. One case intentionally below the computed average load.
- Solar area and efficiency from a panel datasheet. Irradiance marked estimated if not measured.
- Sensor and compute load measured or estimated and labeled.
- One structural member sized so the screening bending stress exceeds the allowable.

Required output:

- Assembly mass and center of gravity, with unknowns listed.
- Collision and clearance result.
- Structural check, failed member identified.
- Peak power, average power, operating duration.
- Undersized-battery failure identified.
- One bounded repair, requirements unchanged, checks re-run.
- Report of passed checks, failed checks, assumptions, and claims that remain hypothesis or contradicted.

Success is that report. Success is not a green badge on the March performance table.
