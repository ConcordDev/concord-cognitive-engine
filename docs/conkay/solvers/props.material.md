# props.material — material properties vs temperature (SX-XC-02)

Sourced material property tables with provenance per value.
Code: `server/lib/conkay/physics/solvers/props-material.js`
(registry solver, L2; L1 fast path via solver.select, SX-XC-01).

## Model

For a material and property, the table holds sourced points
(temperature K → value, SI). The answer at temperature T is:

- the sourced value, when T is a sourced point;
- the linear interpolation between the two bracketing sourced
  points, labelled `interpolated: true` with the bracket echoed;
- **NOT_COMPUTED** when T is outside the property's sourced range —
  extrapolation is never served — or when the material/property has
  no sourced points.

Constant properties (density, thermal constants) carry two identical
points spanning their declared range; the method string and the
per-value provenance say so.

## Inputs / units

- `material`: one of `al-6061-t6`, `steel-a36`, `ti-6al-4v`.
- `temperature`: bare number = kelvin; or `{value, unit}` with unit
  K, °C or °F, converted exactly and echoed in the assumptions.
  Absent temperature uses the declared default 293.15 K, echoed as
  defaulted. NaN or sub-zero kelvin → NOT_COMPUTED
  `invalid_input:temperature`.
- Target = the property: `E`, `nu`, `yieldStrength`,
  `ultimateStrength`, `density`, `thermalConductivity`,
  `specificHeat`, `thermalExpansion`. Outputs are SI (Pa, kg/m³,
  W/(m·K), J/(kg·K), 1/K, 1) with `provenance` naming the source and
  locator of the value served.

## Envelope (validity)

Sourced range only, per property: single-point properties (e.g.
6061-T6 yield) serve only at their sourced temperature; the steel
curves run 293.15–1073.15 K; thermal constants run over their
declared ranges. The out-of-envelope refusal names the violated
bound and the sourced range.

## Reference + locator

- 6061-T6 anchors: MIL-HDBK-5J (public domain), Table 3.6.2.b —
  Fty 40 ksi → yield 276 MPa at RT (the CI reference case);
  Ftu 45 ksi → 310 MPa; E 10.0×10³ ksi → 68.9 GPa.
- Ti-6Al-4V anchors: MIL-HDBK-5J — Fty 126 ksi → 869 MPa;
  Ftu 138 ksi → 950 MPa; E 16.5×10³ ksi → 113.8 GPa.
- Carbon steel: ASTM A36 minima (Fy 250 MPa, Fu 400 MPa) with the
  EN 1993-1-2 Table 3.1 reduction factors for temperature:
  yield at 500 °C = 250 × 0.78 = 195 MPa; E at 600 °C =
  200 × 0.31 = 62 GPa (both CI reference cases).
- Thermal constants: publisher datasheet nominals, named per value
  in the module's provenance strings.

## Tiers

- L2 (this solver): full sourced curves, `screening: false`.
- L1 (solver.select fast path): room-temperature values at any
  temperature, `screening: true`, envelope status WARN with the
  warning "temperature dependence not applied". Never a silent PASS.

## Replay

Walker: `conkay_solve` / solve.direct for
`{material: "al-6061-t6", temperature: 293.15}` target
`yieldStrength` → PASS, 276 MPa, provenance MIL-HDBK-5J;
`{material: "al-6061-t6", temperature: 600}` → NOT_COMPUTED
`out_of_envelope` naming the bound. Reachability via solve.direct
rides SC-00 (named foundation); the MCP/chain paths reach the
registry entry as registered.
