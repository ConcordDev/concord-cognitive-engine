// server/lib/conkay/knowledge/standards.js
//
// Test standards the test-plan generator may cite. Each entry's designation
// and title were checked against the publisher's page (or, for CSA/ANSI
// CHMC 2, ISO 11114-5, ISO 19881 and SAE J2579, a peer-reviewed review that
// cites them) on `verified`. Only designation and title are recorded: no
// procedure text is copied. Add a standard here only after checking it the
// same way; the generator refuses unknown designations.

const V = "2026-10-09";

export const STANDARDS = {
  "ASTM D792": { title: "Standard Test Methods for Density and Specific Gravity (Relative Density) of Plastics by Displacement", url: "https://store.astm.org/d0792-13.html", verified: V },
  "ASTM D256": { title: "Standard Test Methods for Determining the Izod Pendulum Impact Resistance of Plastics", url: "https://store.astm.org/d0256-26.html", verified: V, note: "resembles ISO 180 in title only; results are not interchangeable" },
  "ASTM D6110": { title: "Standard Test Method for Determining the Charpy Impact Resistance of Notched Specimens of Plastics", url: "https://store.astm.org/d6110-26.html", verified: V, note: "resembles ISO 179 in title only" },
  "ISO 179-1": { title: "Plastics — Determination of Charpy impact properties — Part 1: Non-instrumented impact test", url: "https://webstore.ansi.org/preview-pages/ISO/preview_ISO+179-1-2026.pdf", verified: V },
  "ISO 180": { title: "Plastics — Determination of Izod impact strength", url: "https://www.iso.org/standard/72820.html", verified: V, note: "ISO 180:2019" },
  "ASTM D3763": { title: "Standard Test Method for High Speed Puncture Properties of Plastics Using Load and Displacement Sensors", url: "https://store.astm.org/d3763-23.html", verified: V },
  "ASTM D638": { title: "Standard Test Method for Tensile Properties of Plastics", url: "https://store.astm.org/d0638-22.html", verified: V },
  "ASTM D2240": { title: "Standard Test Method for Rubber Property—Durometer Hardness", url: "https://www.normsplash.com/Samples/ASTM/151384388/ASTM-D2240-15-(R2021)-en.pdf", verified: V, note: "covers rubbers, elastomers and some plastics (Shore D for rigid plastics)" },
  "ASTM D2990": { title: "Standard Test Methods for Tensile, Compressive, and Flexural Creep and Creep-Rupture of Plastics", url: "https://store.astm.org/d2990-17r25.html", verified: V },
  "ASTM D1434": { title: "Standard Test Method for Determining Gas Permeability Characteristics of Plastic Film and Sheeting", url: "https://store.astm.org/d1434-23.html", verified: V },
  "ISO 15105-1": { title: "Plastics — Film and sheeting — Determination of gas-transmission rate — Part 1: Differential-pressure methods", url: "https://www.iso.org/standard/41677.html", verified: V },
  "ISO 11114-2": { title: "Gas cylinders — Compatibility of cylinder and valve materials with gas contents — Part 2: Non-metallic materials", url: "https://standards.globalspec.com/std/14480158/ds-en-iso-11114-2", verified: V },
  "ISO 11114-5": { title: "Gas cylinders — Compatibility of cylinder and valve materials with gas contents — Part 5: Test methods for evaluating plastic liners", url: "https://www.mdpi.com/1996-1944/16/15/5366", verified: V, note: "verified via Li et al., Materials 2023, 16, 5366 (ref. 24)" },
  "CSA/ANSI CHMC 2": { title: "Test methods for evaluating material compatibility in compressed hydrogen applications — Polymers", url: "https://www.mdpi.com/1996-1944/16/15/5366", verified: V, note: "verified via Li et al., Materials 2023, 16, 5366 (ref. 23); high-pressure hydrogen permeation (HPHP) method" },
  "ISO 19881": { title: "Gaseous hydrogen — Land vehicle fuel containers", url: "https://www.mdpi.com/1996-1944/16/15/5366", verified: V, note: "verified via Li et al. 2023 (ref. 22): Type IV container permeation < 46 NmL/(h·L) at 1.15 NWP and 55 °C, < 6 NmL/(h·L) at NWP and 15 °C" },
  "SAE J2579": { title: "Standard for Fuel Systems in Fuel Cell and Other Hydrogen Vehicles", url: "https://www.normsplash.com/Samples/SAE/138617147/SAE-J-2579-2018-en-2.pdf", verified: V },
  "ASTM D1238": { title: "Standard Test Method for Melt Flow Rates of Thermoplastics by Extrusion Plastometer", url: "https://store.astm.org/d1238-23a.html", verified: V },
  "ASTM D3418": { title: "Standard Test Method for Transition Temperatures and Enthalpies of Fusion and Crystallization of Polymers by Differential Scanning Calorimetry", url: "https://webstore.ansi.org/standards/astm/astmd341821", verified: V },
  "ASTM G154": { title: "Standard Practice for Operating Fluorescent Ultraviolet (UV) Lamp Apparatus for Exposure of Materials", url: "https://store.astm.org/g0154-23.html", verified: V },
  "ASTM D543": { title: "Standard Practices for Evaluating the Resistance of Plastics to Chemical Reagents", url: "https://store.astm.org/d0543-21.html", verified: V },
  "ASTM D1141": { title: "Standard Practice for Preparation of Substitute Ocean Water", url: "https://store.astm.org/d1141-98r21.html", verified: V },
  "ISO 22007-2": { title: "Plastics — Determination of thermal conductivity and thermal diffusivity — Part 2: Transient plane heat source (hot disc) method", url: "https://www.iso.org/standard/81836.html", verified: V },
  "ASTM E1461": { title: "Standard Test Method for Thermal Diffusivity by the Flash Method", url: "https://store.astm.org/e1461-13r22.html", verified: V },
  "ASTM E1131": { title: "Standard Test Method for Compositional Analysis by Thermogravimetry", url: "https://store.astm.org/e1131-20.html", verified: V },
  "ASTM D5630": { title: "Standard Test Method for Ash Content in Plastics", url: "https://webstore.ansi.org/standards/astm/astmd563022", verified: V },
  "ASTM D4052": { title: "Standard Test Method for Density, Relative Density, and API Gravity of Liquids by Digital Density Meter", url: "https://store.astm.org/d4052-22.html", verified: V },
  "ASTM D445": { title: "Standard Test Method for Kinematic Viscosity of Transparent and Opaque Liquids (and Calculation of Dynamic Viscosity)", url: "https://store.astm.org/d0445-24.html", verified: V },
  "ASTM D56": { title: "Standard Test Method for Flash Point by Tag Closed Cup Tester", url: "https://store.astm.org/d0056-22.html", verified: V },
  "ASTM E1269": { title: "Standard Test Method for Determining Specific Heat Capacity by Differential Scanning Calorimetry", url: "https://store.astm.org/e1269-24.html", verified: V },
  "ASTM D7896": { title: "Standard Test Method for Thermal Conductivity, Thermal Diffusivity, and Volumetric Heat Capacity of Engine Coolants and Related Fluids by Transient Hot Wire Liquid Thermal Conductivity Method", url: "https://store.astm.org/d7896-19.html", verified: V, note: "scope is engine coolants and related fluids: its fit for another liquid is for the laboratory to confirm" },
  "ASTM D1078": { title: "Standard Test Method for Distillation Range of Volatile Organic Liquids", url: "https://store.astm.org/d1078-11r19.html", verified: V, note: "a distillation range, not an equilibrium bubble point" },
  "ASTM E324": { title: "Standard Test Method for Relative Initial and Final Melting Points and the Melting Range of Organic Chemicals", url: "https://store.astm.org/e0324-23.html", verified: V },
};

export function standard(designation) {
  const s = STANDARDS[designation];
  if (!s) throw new Error(`standard "${designation}" is not in the verified list (standards.js)`);
  return { designation, ...s };
}
