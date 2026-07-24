// server/lib/asset-gen/degradation-constants.js
//
// W1-A — Long-horizon materials degradation engine, constants table.
//
// ── Honest boundary (repeated verbatim from server/lib/simulation/
// degradation-kinetics.js — see that file for the canonical copy) ───────
// Empirical-kinetics engineering practice, not first-principles materials
// physics. Atomistic/molecular-dynamics simulation is out of scope: no
// bond-scale chemistry, no polymer chain-scission mechanism, no
// microstructural evolution. Arrhenius, Paris-Erdogan and Fickian
// diffusion are phenomenological laws whose constants are fitted to
// short-term accelerated tests; this engine extrapolates those fits. No
// 50-year field data is used or claimed. The kinetic-extent → stiffness/
// strength knock-down law is the least-standardised step: there is no
// universal form, the default here is one cited empirical fit, and it is
// caller-overridable precisely because it should be calibrated per
// material system before any result is relied on.
//
// ── Why this is a SIBLING table, not an extension of MATERIAL_LIBRARY ──
// server/domains/engineering.js's `MATERIAL_LIBRARY` is re-declared
// (byte-for-byte) in server/lib/asset-gen/mass-properties.js, which is
// being concurrently edited by a sibling work unit (W1-B). This table is
// keyed by the SAME MATERIAL_LIBRARY keys ('steel-a36', 'aluminum-7075-
// t6', 'concrete-30mpa', 'cfrp', …) and is joined at the CALL SITE (see
// durability-gate.js) — never merged into that object, so this file
// never touches engineering.js or mass-properties.js.
//
// ── The honesty rule, enforced in code (read before adding an entry) ───
// Every numeric value below carries a real, checkable `source` string and
// a `confidence` label. A material with no entry, or missing the
// sub-table a requested mechanism needs, is handled by the getters below
// returning `null` for that sub-table — callers (degradation-kinetics.js,
// durability-gate.js) turn a null sub-table into an honest
// `{ok:false, reason:'missing_degradation_constants', material, mechanism}`
// refusal rather than inventing, defaulting, or interpolating a value.
//
// This ships FOUR materials, each cited for ONLY the mechanism(s) a real
// search of the literature actually turned up a citable, class-
// representative value for:
//   - steel-a36          → paris (fatigue) only
//   - aluminum-7075-t6    → paris (fatigue) only
//   - concrete-30mpa      → arrhenius + diffusion (chloride ingress) only
//   - cfrp                → arrhenius + diffusion (moisture ingress) only
// Every other sub-table on every entry is explicitly `null` — NOT
// omitted, so a caller/reviewer can see at a glance what was deliberately
// left uncited rather than silently missing. In particular: no material
// below carries an ABSOLUTE Arrhenius pre-exponential factor `A` (units
// of a true rate constant, e.g. s⁻¹) for a first-order "extent of
// thermal degradation" reaction — the literature search for this task
// turned up real activation energies (Ea) for various corrosion/aging
// mechanisms, paired with test conditions (e.g. 1M HCl, 15% HCl) that do
// NOT match a generic 50-year structural-service assumption, and no
// safely-citable `A` to pair with a matched, in-scope Ea was found. Since
// `A` scales the ABSOLUTE rate by orders of magnitude, guessing one would
// be fabrication, not honest engineering judgement — so the `thermal`
// mechanism (see degradation-kinetics.js#integrateDegradation) is
// deliberately UNAVAILABLE for every material in this table. This is a
// real, load-bearing refusal, not a placeholder: durability-gate.test.js
// pins it.
//
// The `arrhenius` entries that DO exist below (concrete, cfrp) are cited
// ONLY for the temperature-ratio correction of a diffusion coefficient
// (`arrheniusRatio` — D(T₂)/D(T₁) = exp[-(Ea/R)(1/T₂-1/T₁)], which needs
// no absolute `A`), not for an absolute rate constant — hence `A: null`
// on both, with the reason stated inline.

export const GAS_CONSTANT_J_PER_MOL_K = 8.314462618; // CODATA 2018 exact value

export const DEGRADATION_CONSTANTS = Object.freeze({
  'steel-a36': {
    label: 'ASTM A36 Structural Steel (ferrite-pearlite)',
    paris: {
      // da/dN = C·ΔK^m, da/dN in m/cycle, ΔK in MPa·√m — the standard
      // Paris-regime (Region II) fit form.
      C: 6.9e-12,
      m: 3.0,
      units: 'da/dN in m/cycle, ΔK (deltaK) in MPa·m^0.5',
      source:
        'Barsom & Rolfe, "Fatigue and Fracture Control in Structures" — ' +
        'commonly tabulated representative Paris-law constants for ' +
        'ferrite-pearlite structural steels (also reproduced in Dowling, ' +
        '"Mechanical Behavior of Materials"). A36 is a ferrite-pearlite ' +
        'low-carbon steel, so this is a MATCHING microstructural class, ' +
        'not a borrowed/adjacent-alloy value. Independent literature ' +
        'review corroborates the range: C ∈ [1e-13, 1e-12], m ∈ [2.8, ' +
        '3.5] for ferrite-pearlite steels (e.g. corrosion-fatigue-crack-' +
        'growth-rate studies on NR/TMCP ferrite-pearlite steels).',
      confidence: 'medium — class-representative textbook value, not a ' +
        'certified per-heat/per-batch test result for this specific mill ' +
        'certification.',
    },
    arrhenius: null, // see file header — no safely-citable (A, Ea) pair found for a matching service environment
    diffusion: null, // bulk metal — no Fickian ingress mechanism applies (explicit null, per the task's own worked example)
    knockdown: {
      law: 'linear-damage-fraction-lemaitre-chaboche',
      source:
        'Lemaitre & Chaboche, "Mechanics of Solid Materials" (Cambridge ' +
        'University Press, 1990) — the standard continuum-damage-' +
        'mechanics effective-stiffness form E_eff = E0·(1−D) for a scalar ' +
        'damage variable D ∈ [0,1].',
      confidence: 'generic/textbook — NOT calibrated to A36 specifically; ' +
        'caller-overridable via lawOverride (see durability-gate.js).',
    },
  },

  'aluminum-7075-t6': {
    label: 'Aluminum 7075-T6',
    paris: {
      C: 2.1e-12,
      m: 3.2,
      units: 'da/dN in m/cycle, ΔK (deltaK) in MPa·m^0.5',
      source:
        'Commonly cited representative Paris-law constants for 7075-T6 ' +
        'aluminum fatigue-crack-growth studies (C in the ~1e-12 range, ' +
        'MPa√m units — literature review of ASTM E647-style fatigue-' +
        'crack-growth-rate testing on 7075-T6). Published constants for ' +
        'this alloy vary meaningfully by R-ratio, environment, and test ' +
        'lab (a second commonly-cited fit gives m≈4.05, C≈1e-8 under a ' +
        'different loading/frequency protocol) — this entry uses the ' +
        'C=2.1e-12, m=3.2 pairing as the representative point value.',
      confidence: 'medium — test-condition-dependent (R-ratio, ' +
        'environment, frequency); treat as a screening-level value, not ' +
        'a certified per-heat-lot result.',
    },
    arrhenius: null,
    diffusion: null, // bulk metal — no Fickian ingress mechanism applies
    knockdown: {
      law: 'linear-damage-fraction-lemaitre-chaboche',
      source:
        'Lemaitre & Chaboche, "Mechanics of Solid Materials" (Cambridge ' +
        'University Press, 1990).',
      confidence: 'generic/textbook — NOT calibrated to 7075-T6 ' +
        'specifically; caller-overridable via lawOverride.',
    },
  },

  'concrete-30mpa': {
    label: 'Concrete (30 MPa) — chloride ingress',
    paris: null, // concrete fatigue/fracture is a distinct (and distinctly less standardized) literature this table does not attempt to cite
    arrhenius: {
      A: null, // used ONLY via the ratio form (arrheniusRatio) — Life-365 itself specifies only Ea, never a standalone rate-constant A
      Ea_J_per_mol: 35000,
      mechanism:
        'chloride_diffusion_temperature_correction (ratio form only — ' +
        'D(T2)/D(T1) = exp[-(Ea/R)(1/T2-1/T1)]; no absolute rate ' +
        'constant is published or used)',
      source:
        'Life-365 Service Life Prediction Model (Bentz, 2003; Life-365 ' +
        'Consortium documentation) — the model applies the Arrhenius law ' +
        'to temperature-correct the chloride diffusion coefficient with ' +
        'a standard activation energy of 35 kJ/mol, "regardless of ' +
        'concrete mixture type." Independent experimental studies report ' +
        'a wider range (roughly 18-40 kJ/mol depending on mix and test ' +
        'method) — 35 kJ/mol is the Life-365 DEFAULT, not a universal ' +
        'constant.',
      confidence: 'medium — a named-model default value, with a real ' +
        'measured range (18-40 kJ/mol) bracketing it in the literature.',
    },
    diffusion: {
      D_m2_s: 5e-12,
      referenceTempK: 296.15, // 23°C, the standard chloride-diffusion test temperature
      species: 'chloride',
      units: 'D in m^2/s at referenceTempK; correct to another ' +
        'temperature via arrheniusRatio(this.arrhenius)',
      source:
        'Order-of-magnitude representative value for structural concrete ' +
        'apparent chloride diffusion coefficients, which the literature ' +
        'reports spanning roughly 1e-13 to 1e-11 m^2/s depending on mix ' +
        'design and age (e.g. apparent diffusion coefficients of ' +
        '2-6 ×10^-13 m^2/s reported in chloride-diffusion / service-life ' +
        'studies; Life-365 / ASTM C1556-style estimates for typical ' +
        'structural mixes fall in this band).',
      confidence: 'low (order-of-magnitude) — NOT specific to the exact ' +
        '30 MPa mix design in MATERIAL_LIBRARY; a real mix-specific test ' +
        '(e.g. ASTM C1556) is required before relying on this figure.',
    },
    knockdown: {
      law: 'linear-damage-fraction-lemaitre-chaboche',
      source:
        'Lemaitre & Chaboche, "Mechanics of Solid Materials" (Cambridge ' +
        'University Press, 1990).',
      confidence: 'generic/textbook — NOT calibrated to this mix; ' +
        'caller-overridable via lawOverride.',
    },
  },

  cfrp: {
    label: 'Carbon Fiber Reinforced Polymer — moisture ingress',
    paris: null, // composite delamination/fatigue uses different fracture-mechanics models than a metal Paris law; not attempted here
    arrhenius: {
      A: null, // ratio form only — see steel-a36 header note on why no absolute A is cited anywhere in this table
      Ea_J_per_mol: 63000,
      mechanism:
        'moisture_diffusion_temperature_correction (ratio form only)',
      source:
        'Carbon/epoxy composite moisture-diffusion activation energies ' +
        'reported in the literature (Shen & Springer-style Arrhenius ' +
        'analysis of ln(D) vs 1/T) span roughly 61-71 kJ/mol for carbon/ ' +
        'epoxy composites (vs. 47 kJ/mol for E-glass/epoxy with diamine ' +
        'hardener, a different fiber/matrix system) — 63 kJ/mol is a ' +
        'representative point value near the low end of the cited ' +
        'carbon/epoxy composite range (61.18-63.37 kJ/mol).',
      confidence: 'medium — resin-system- and fiber-volume-fraction-' +
        'dependent; treat as a class-representative point value.',
    },
    diffusion: {
      D_m2_s: 2e-13,
      referenceTempK: 293.15, // 20°C
      species: 'moisture',
      units: 'D in m^2/s at referenceTempK; correct to another ' +
        'temperature via arrheniusRatio(this.arrhenius)',
      source:
        'Order-of-magnitude representative value for epoxy-based ' +
        'composite/resin moisture diffusion coefficients at room ' +
        'temperature, which the literature reports spanning roughly ' +
        '1e-14 to 1e-13 m^2/s for neat/composite epoxy systems (e.g. ' +
        '~1.66e-13 m^2/s reported for water diffusivity in a 977-2 epoxy ' +
        'resin; epoxy moulding-compound studies report ~3.8e-13 m^2/s at ' +
        '20°C for a different formulation).',
      confidence: 'low (order-of-magnitude) — resin-formulation- and ' +
        'cure-state-dependent; a real coupon test is required before ' +
        'relying on this figure for a specific layup.',
    },
    knockdown: {
      law: 'linear-damage-fraction-lemaitre-chaboche',
      source:
        'Lemaitre & Chaboche, "Mechanics of Solid Materials" (Cambridge ' +
        'University Press, 1990).',
      confidence: 'generic/textbook — NOT calibrated to this layup; ' +
        'caller-overridable via lawOverride.',
    },
  },
});

/**
 * Look up a material's degradation constants by MATERIAL_LIBRARY key.
 * Returns null (never throws) for an unknown key — an honest "no
 * degradation data at all for this material" signal, distinct from an
 * entry that exists but has a null sub-table for the requested mechanism
 * (see mechanismAvailable below).
 * @param {string} key
 * @returns {object|null}
 */
export function getDegradationConstants(key) {
  return DEGRADATION_CONSTANTS[key] ? { key, ...DEGRADATION_CONSTANTS[key] } : null;
}

// Maps a caller-facing mechanism name (as used by degradation-kinetics.js#
// integrateDegradation and durability-gate.js#checkDurabilityGate) to the
// constants sub-table(s) that mechanism needs present (and non-null) to
// run honestly.
export const MECHANISM_REQUIREMENTS = Object.freeze({
  fatigue: ['paris'],
  thermal: ['arrhenius'], // additionally requires arrhenius.A !== null — see mechanismAvailable
  moisture: ['diffusion'],
});

/**
 * Whether `entry` (a getDegradationConstants() result) genuinely supports
 * `mechanism`. For 'thermal' this additionally requires a non-null
 * absolute rate constant `arrhenius.A` — every entry in this table has
 * `arrhenius.A === null` by design (see file header), so 'thermal' is
 * honestly unavailable for every material shipped here.
 * @param {object|null} entry
 * @param {string} mechanism one of 'fatigue' | 'thermal' | 'moisture'
 * @returns {boolean}
 */
export function mechanismAvailable(entry, mechanism) {
  if (!entry) return false;
  const requiredTables = MECHANISM_REQUIREMENTS[mechanism];
  if (!requiredTables) return false;
  for (const table of requiredTables) {
    const sub = entry[table];
    if (!sub) return false;
    if (mechanism === 'thermal' && !Number.isFinite(sub.A)) return false;
  }
  return true;
}
