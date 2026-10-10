// server/lib/conkay/northstar/sources.js
//
// Every external number the north-star work uses (the Sentinel/RAM spec
// re-checks and the Sentinel Milestone 1 demo), with where it came from.
// Each entry was read on 2026-10-09 from the URL given; `excerpt` is the
// passage the value was taken from. Values not found in a source are not
// here: they appear in the demo as "estimated" (with assumptions and a
// range) or "unknown", never as a quiet default.

const R = "2026-10-09";

export const SOURCES = Object.freeze({
  // Physical constants (exact in the 2019 SI).
  "si-2019-exact-constants": {
    title: "SI Brochure, 9th ed. (2019): defining constants c, h, e, N_A (exact)",
    url: "https://www.bipm.org/en/publications/si-brochure", retrieved: R,
    locator: "Table 1, defining constants",
    excerpt: "c = 299 792 458 m/s; h = 6.626 070 15e-34 J s; e = 1.602 176 634e-19 C; N_A = 6.022 140 76e23 /mol",
  },
  "nist-webbook-h2": {
    title: "NIST Chemistry WebBook, SRD 69: Hydrogen (CAS 1333-74-0)",
    url: "https://webbook.nist.gov/cgi/cbook.cgi?ID=C1333740&Units=SI", retrieved: R,
    locator: "Formula / molecular weight line", excerpt: "Molecular weight: 2.01588",
  },
  "hyperphysics-electrolysis": {
    title: "HyperPhysics (Georgia State Univ.): Electrolysis of Water and Fuel Cell Operation",
    url: "https://hyperphysics.gsu.edu/hbase/thermo/electrol.html", retrieved: R,
    locator: "Electrolysis of Water: table at 298 K, 1 atm",
    excerpt: "ΔH = 285.83 kJ ... TΔS = 48.7 kJ ... ΔG = ΔH - TΔS = 285.83 kJ - 48.7 kJ = 237.1 kJ",
  },
  "afdc-fuel-comparison": {
    title: "U.S. DOE Alternative Fuels Data Center, Fuel Properties Comparison (PDF)",
    url: "https://afdc.energy.gov/files/u/publication/fuel_comparison_chart.pdf", retrieved: R,
    sha256: "d412d0a3839b3b9d0a0abce66b543d106a75077991e71e9046ee88719c59eed2",
    locator: "Hydrogen column, rows 'Energy Content (lower heating value)' and '(higher heating value)'",
    excerpt: "Hydrogen: 51,585 Btu/lb ... 33.3 kWh/kg (lower heating value); 61,013 Btu/lb (higher heating value)",
  },
  "doe-pem-targets": {
    title: "U.S. DOE, Technical Targets for Proton Exchange Membrane Electrolysis",
    url: "https://www.energy.gov/cmei/fuels/technical-targets-proton-exchange-membrane-electrolysis", retrieved: R,
    locator: "Table, System / Energy Efficiency, 2022 Status",
    excerpt: "Stack Electrical Efficiency kWh/kg H2 (% LHV): 51 (65%) ... System Energy Efficiency: 55 (61%)",
  },
  "iso-20473": {
    title: "ISO 20473:2007 Optics and photonics — Spectral bands",
    url: "https://www.iso.org/standard/39482.html", retrieved: R,
    locator: "Table 1 (sample PDF via standards.iteh.ai)",
    excerpt: "near infrared (NIR) 0.78 µm to 3 µm; mid infrared (MIR) 3 µm to 50 µm",
  },
  "iau-2012-b2": {
    title: "IAU 2012 Resolution B2: re-definition of the astronomical unit",
    url: "https://syrte.obspm.fr/IAU_resolutions/Res_IAU2012_B2.pdf", retrieved: R,
    locator: "Resolution text", excerpt: "the astronomical unit ... 149 597 870 700 m exactly",
  },
  "nasa-moon-fact-sheet": {
    title: "NASA NSSDCA Moon Fact Sheet",
    url: "https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html", retrieved: R,
    locator: "Orbital parameters: Semimajor axis", excerpt: "Semimajor axis (10^6 km) 0.3844",
  },

  // Structural material and stock sections.
  "astm-b221-6061-t6": {
    title: "ASTM B221 Standard Specification for Aluminum and Aluminum-Alloy Extruded Bars, Rods, Wire, Profiles, and Tubes",
    url: "https://store.astm.org/b0221-21.html", retrieved: R,
    locator: "Table 2 (mechanical property limits), alloy 6061-T6",
    excerpt: "6061-T6 extruded: tensile strength 38 ksi min, yield strength (0.2% offset) 35 ksi min",
  },
  "asm-6061-t6": {
    title: "ASM Aerospace Specification Metals: Aluminum 6061-T6; 6061-T651 (MatWeb data)",
    url: "https://www.aerospacemetals.com/wp-content/uploads/2023/06/Aluminum-6061-T6-6061-T651.pdf", retrieved: R,
    locator: "Physical/Mechanical properties table",
    excerpt: "Density 2.7 g/cc; Tensile Yield Strength 276 MPa; Modulus of Elasticity 68.9 GPa (typical)",
  },
  "aircraft-spruce-6061-square-tube": {
    title: "Aircraft Spruce: 6061T6 Square Aluminum Tubing (stock list)",
    url: "https://www.aircraftspruce.com/catalog/mepages/alumtubing-sq.php", retrieved: R,
    locator: "Size / Wall Thick. / Wt./Ft. table",
    excerpt: "1/2 x 1/2 .058 .156; 3/4 x 3/4 .049 .217; 1 x 1 .065 .300; 2 x 2 .125 1.120; 2 x 2 .190 1.420 (lb/ft)",
  },

  // Bought components.
  "cubemars-ak80-64": {
    title: "CubeMars AK80-64 KV80 Robotic Actuator, product page specifications",
    url: "https://www.cubemars.com/product/ak80-64-kv80-robotic-actuator.html", retrieved: R,
    locator: "Core Data / specification table",
    excerpt: "Rated voltage (V) 24/48; Rated torque (Nm) 48; Peak torque (Nm) 120; Rated speed (rpm) 23/48; Rated current (ADC) 7; Peak current (ADC) 19; Weight (g) 850; Motor Dimensions Ф98*61.9mm",
  },
  "molicel-p45b": {
    title: "Molicel INR-21700-P45B Product Data Sheet v1.2",
    url: "https://www.molicel.com/wp-content/uploads/INR21700P45B_1.2_Product-Data-Sheet-of-INR-21700-P45B-80109.pdf", retrieved: R,
    locator: "Cell characteristics / physical characteristics",
    excerpt: "Typical 4500 mAh 16.2 Wh; Nominal 3.6 V; Charge 4.2 V; Discharge 2.5 V; Discharge Current Continuous 45 A; Diameter 21.55 mm (Max); Height 70.15 mm (Max); Weight 70 g (Max)",
  },
  "renogy-rng-100d-ss": {
    title: "Renogy RNG-100D-SS G3 100W Monocrystalline Solar Panel datasheet",
    url: "https://store-fhnch.mybigcommerce.com/content/RNG-100D-SS/RNG-100D-SS-G3%20Datasheet.pdf", retrieved: R,
    locator: "Electrical / Mechanical / Thermal data",
    excerpt: "Maximum Power at STC 100 W; Module Efficiency 17.8%; 1062 x 530 x 35 mm; 6.4 kg (14.1 lbs); NOCT 47±2 ºC; Temperature Coefficient of Pmax -0.37%/ºC",
  },
  "nvidia-jetson-agx-orin": {
    title: "NVIDIA Jetson AGX Orin Series data sheet DS-10662-001 v1.2",
    url: "https://www.diamondsystems.com/files/binaries/Jetson_AGX_Orin_DS-10662-001_v1.2.pdf", retrieved: R,
    locator: "Total module power; Module dimensions",
    excerpt: "Total module power JAO 64GB: 15 W | 30 W | 50 W, and up to 60 W; Module dimensions 100.0 mm × 87.0 mm × 16.0 mm (no module mass stated)",
  },
  "velodyne-vlp16": {
    title: "Velodyne Lidar Puck (VLP-16) datasheet 63-9229 Rev-K",
    url: "https://docs.clearpathrobotics.com/assets/files/clearpath_robotics_020972-TDS2-7ff55388f43738df9b51da2a7fc1110a.pdf", retrieved: R,
    locator: "Mechanical/Electrical/Operational",
    excerpt: "Power Consumption: 8 W (Typical); Weight: ~830 g (without Cabling and Interface Box); 103 mm diameter x 72 mm height",
  },
  "advantech-mic-733-ao": {
    title: "Advantech MIC-733-AO AI Inference System (NVIDIA Jetson AGX Orin) datasheet, 2023-07-13 (hosted by CSI)",
    url: "https://csi.pl/wp-content/uploads/2023/09/MIC-733-AO_DS07132320230714103359.pdf", retrieved: R,
    sha256: "dfd6decea20bfd1296cabc68200d419bd0e6b7cb646bed0970963a65db97a077",
    locator: "Specifications: Mechanical / Power",
    excerpt: "MIC-733-A06A1 ... AGX Orin 64G; Compact fanless design; Input Voltage 9 ~ 36 VDC, 16-4A; Core Module: 192 x 230 x 87 mm (7.55\" x 9.05\" x 3.43\"); Weight 4.5 kg (9.9 lb)",
  },
  "realsense-d400-datasheet": {
    title: "RealSense D400 Series Product Family Datasheet, 337029-017 (Mar 2026)",
    url: "https://www.realsenseai.com/wp-content/uploads/2026/03/RealSense-D400-Series-Datasheet-Mar-2026.pdf", retrieved: R,
    sha256: "96cb5706bd879479bab36648bd3ec67f6338b4616d696dda55007f898182454f",
    locator: "Table 3-53 (D455 mechanical dimensions); Table 7-9 (D455 component power)",
    excerpt: "Table 3-53. RealSense Depth Camera D455, D455f, D456 Mechanical Dimensions ... Depth 26 mm ... Weight 116(1) g ... (1) The weight can be +/- 10% from the nominal. Table 7-9 ... All Components 3461.47 mW (Max Operating Mode)",
  },
  "xsens-mti-630": {
    title: "Xsens MTi-630 AHRS product leaflet (07-02-2025)",
    url: "https://www.xsens.com/hubfs/MTi%20product%20leaflet_07022025_MTi-630.pdf", retrieved: R,
    sha256: "fb4643a6304241da887b6d27118c1532dc38c8a0eeff20d8649a42f36a4ad29c",
    locator: "Specifications: mechanical / electrical",
    excerpt: "Dimensions 28x31.5x13 mm; Weight 8.9 g; Input voltage 4.5 to 24V; Power consumption (typ) <0.5 W",
  },
  "sanyo-san-ace-80-9ga": {
    title: "Sanyo Denki San Ace 80 9GA type Low Power Consumption Fan, 80×80×25 mm, datasheet (hosted by CERN EPC)",
    url: "https://sy-dep-epc-lpc.web.cern.ch/components/datasheets/epc-lpc%20(converters)/9GA0824P4J001-24VDC%20Axial%20Fan%2080x25-Sanyo%20Denki.pdf", retrieved: R,
    sha256: "98b97b507b74d0b1905e5acf234f7a691083babf97669b670836c692d8497474",
    locator: "General Specifications; Specifications table",
    excerpt: "Mass ... 110 g; 9GA0824P4H001: rated voltage 24 V, PWM duty 100 %: rated current 0.1 A, rated input 2.4 W, 5200 min-1, 1.46 m³/min",
  },
  "pvwatts-v8-nyc": {
    title: "NREL/NLR PVWatts v8 API (NSRDB PSM V3 TMY), lat 40.71 lon -74.01, south-facing",
    url: "https://developer.nlr.gov/api/pvwatts/v8.json", retrieved: R,
    locator: "northstar/fixtures/pvwatts-nyc-tilt90-south.json outputs.solrad_annual / solrad_monthly",
    excerpt: "tilt 90° azimuth 180°: solrad_annual 2.918 kWh/m²/day (June 2.093); losses=14 (PVWatts default)",
  },
  "pvwatts-v5-manual": {
    title: "PVWatts Version 5 Manual (NREL/TP-6A20-62641)",
    url: "https://docs.nlr.gov/docs/fy14osti/62641.pdf", retrieved: R,
    locator: "System losses section", excerpt: "default total system loss 14% (soiling, shading, snow, mismatch, wiring, connections, LID, nameplate, age, availability)",
  },
});

/** An evidence ref (knowledge/schema.js EvidenceRef) for a source id. */
export function sourceRef(id, kind = "url") {
  const s = SOURCES[id];
  if (!s) throw new Error(`unknown source ${id}`);
  return { kind, sourceId: id, title: s.title, url: s.url, retrieved: s.retrieved, locator: s.locator, excerpt: s.excerpt, ...(s.sha256 ? { sha256: s.sha256 } : {}) };
}
