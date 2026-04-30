/**
 * Chemistry Compute Module
 *
 * Molecular analysis, reaction balancing, solution chemistry, thermodynamics.
 * Pure JavaScript, no external dependencies.
 */

// ── Atomic masses (g/mol) ────────────────────────────────────────────────────
const ATOMIC_MASS = {
  H:1.008, He:4.003, Li:6.941, Be:9.012, B:10.811, C:12.011, N:14.007,
  O:15.999, F:18.998, Ne:20.180, Na:22.990, Mg:24.305, Al:26.982, Si:28.086,
  P:30.974, S:32.065, Cl:35.453, Ar:39.948, K:39.098, Ca:40.078, Sc:44.956,
  Ti:47.867, V:50.942, Cr:51.996, Mn:54.938, Fe:55.845, Co:58.933, Ni:58.693,
  Cu:63.546, Zn:65.38, Ga:69.723, Ge:72.63, As:74.922, Se:78.96, Br:79.904,
  Kr:83.798, Rb:85.468, Sr:87.62, Y:88.906, Zr:91.224, Nb:92.906, Mo:95.96,
  Tc:98, Ru:101.07, Rh:102.91, Pd:106.42, Ag:107.87, Cd:112.41, In:114.82,
  Sn:118.71, Sb:121.76, Te:127.60, I:126.90, Xe:131.29, Cs:132.91, Ba:137.33,
  La:138.91, Ce:140.12, Pr:140.91, Nd:144.24, Pm:145, Sm:150.36, Eu:151.96,
  Gd:157.25, Tb:158.93, Dy:162.50, Ho:164.93, Er:167.26, Tm:168.93, Yb:173.05,
  Lu:174.97, Hf:178.49, Ta:180.95, W:183.84, Re:186.21, Os:190.23, Ir:192.22,
  Pt:195.08, Au:196.97, Hg:200.59, Tl:204.38, Pb:207.2, Bi:208.98, Th:232.04,
  U:238.03,
};

// ── Standard enthalpies of formation (kJ/mol) ────────────────────────────────
const DELTA_HF = {
  'H2O(l)': -285.8, 'H2O(g)': -241.8, 'CO2(g)': -393.5, 'CO(g)': -110.5,
  'HCl(g)': -92.3, 'HBr(g)': -36.3, 'HF(g)': -271.1, 'NH3(g)': -46.1,
  'H2SO4(l)': -814.0, 'HNO3(l)': -174.1, 'CH4(g)': -74.8, 'C2H6(g)': -84.7,
  'C3H8(g)': -103.8, 'C4H10(g)': -126.2, 'C2H4(g)': 52.5, 'C2H2(g)': 226.7,
  'C6H6(l)': 49.0, 'C6H12O6(s)': -1274.4, 'C12H22O11(s)': -2222.1,
  'NaCl(s)': -411.2, 'NaOH(s)': -425.6, 'NaHCO3(s)': -950.8, 'Na2CO3(s)': -1130.7,
  'KCl(s)': -436.7, 'KOH(s)': -424.8, 'CaCO3(s)': -1207.6, 'CaO(s)': -635.1,
  'Ca(OH)2(s)': -986.1, 'MgO(s)': -601.6, 'Al2O3(s)': -1675.7, 'Fe2O3(s)': -824.2,
  'FeO(s)': -272.0, 'Fe3O4(s)': -1118.4, 'SO2(g)': -296.8, 'SO3(g)': -395.7,
  'NO(g)': 90.3, 'NO2(g)': 33.2, 'N2O4(g)': 9.2, 'P4O10(s)': -3009.9,
  // Elements in standard state = 0
  'H2(g)': 0, 'O2(g)': 0, 'N2(g)': 0, 'F2(g)': 0, 'Cl2(g)': 0, 'Br2(l)': 0,
  'I2(s)': 0, 'C(s,graphite)': 0, 'S(s)': 0, 'Na(s)': 0, 'Fe(s)': 0,
  'Al(s)': 0, 'Ca(s)': 0, 'Mg(s)': 0, 'Cu(s)': 0, 'Zn(s)': 0,
};

// ── Formula Parser ────────────────────────────────────────────────────────────

export function parseFormula(formula) {
  // Tokenize e.g. "H2SO4" → { H:2, S:1, O:4 }
  const result = {};
  const stack  = [result];

  const re = /([A-Z][a-z]?)(\d*)|(\()|(\))(\d*)/g;
  let m;
  while ((m = re.exec(formula)) !== null) {
    if (m[1]) {
      const el  = m[1];
      const cnt = parseInt(m[2] || '1', 10);
      const top = stack[stack.length - 1];
      top[el] = (top[el] || 0) + cnt;
    } else if (m[3]) {
      const sub = {};
      stack.push(sub);
    } else if (m[4]) {
      const sub = stack.pop();
      const cnt = parseInt(m[5] || '1', 10);
      const top = stack[stack.length - 1];
      for (const [el, n] of Object.entries(sub)) {
        top[el] = (top[el] || 0) + n * cnt;
      }
    }
  }
  return result;
}

// ── Molecular Analysis ────────────────────────────────────────────────────────

export function molecularAnalysis({ formula }) {
  if (!formula) return { ok: false, error: 'formula required' };

  // Strip state like (g), (l), (s), (aq)
  const clean = formula.replace(/\([glsaq]+\)$/, '').trim();
  let elements;
  try {
    elements = parseFormula(clean);
  } catch (e) {
    return { ok: false, error: `Cannot parse formula: ${e.message}` };
  }

  // Molar mass
  let molarMass = 0;
  for (const [el, count] of Object.entries(elements)) {
    const mass = ATOMIC_MASS[el];
    if (!mass) return { ok: false, error: `Unknown element: ${el}` };
    molarMass += mass * count;
  }

  // Degree of unsaturation (organic only) = (2C + 2 + N - H - X) / 2
  const C = elements['C'] || 0, H = elements['H'] || 0,
        N = elements['N'] || 0, O = elements['O'] || 0;
  const halogens = (elements['F'] || 0) + (elements['Cl'] || 0) +
                   (elements['Br'] || 0) + (elements['I'] || 0);
  const dbu = C > 0 ? (2 * C + 2 + N - H - halogens) / 2 : null;

  // Empirical formula (divide by GCD)
  const counts = Object.values(elements);
  const gcd = counts.reduce((a, b) => {
    let x = a, y = b;
    while (y) { [x, y] = [y, x % y]; }
    return x;
  });
  const empirical = Object.entries(elements)
    .map(([el, n]) => `${el}${n / gcd > 1 ? n / gcd : ''}`)
    .join('');

  // Percent composition
  const composition = Object.fromEntries(
    Object.entries(elements).map(([el, n]) => [
      el,
      { count: n, mass: ATOMIC_MASS[el] * n, percent: ((ATOMIC_MASS[el] * n) / molarMass * 100).toFixed(2) }
    ])
  );

  return {
    ok: true,
    formula: clean,
    elements,
    molarMass: parseFloat(molarMass.toFixed(4)),
    empiricalFormula: empirical,
    degreeOfUnsaturation: dbu !== null ? parseFloat(dbu.toFixed(1)) : null,
    composition,
    elementCount: Object.keys(elements).length,
    atomCount: Object.values(elements).reduce((s, n) => s + n, 0),
  };
}

// ── Reaction Balancing ────────────────────────────────────────────────────────
// Gaussian elimination over integer coefficient matrix

export function balanceReaction({ equation }) {
  if (!equation) return { ok: false, error: 'equation required' };

  // Split at → or -> or =
  const parts = equation.split(/→|->|=/).map(s => s.trim());
  if (parts.length !== 2) return { ok: false, error: 'Use → or -> or = to separate reactants and products' };

  const parseCompounds = (side) =>
    side.split('+').map(s => s.trim().replace(/\([glsaq]+\)$/, '').trim()).filter(Boolean);

  const reactants = parseCompounds(parts[0]);
  const products  = parseCompounds(parts[1]);
  const compounds = [...reactants, ...products];

  // Collect all elements
  const allElements = new Set();
  const parsed = compounds.map(f => {
    const els = parseFormula(f);
    for (const el of Object.keys(els)) allElements.add(el);
    return els;
  });

  const elements = [...allElements];
  const nComp = compounds.length;
  const nEl   = elements.length;

  // Build matrix: rows = elements, cols = compounds
  // Reactants are positive, products are negative
  const matrix = elements.map(el => {
    return compounds.map((_, ci) => {
      const sign = ci < reactants.length ? 1 : -1;
      return sign * (parsed[ci][el] || 0);
    });
  });

  // Gaussian elimination with augmented [matrix | 0]
  const augmented = matrix.map(row => [...row, 0]);
  const rows = augmented.length;
  const cols = nComp;

  // Forward elimination
  let pivotRow = 0;
  for (let col = 0; col < cols && pivotRow < rows; col++) {
    let maxRow = pivotRow;
    for (let r = pivotRow + 1; r < rows; r++) {
      if (Math.abs(augmented[r][col]) > Math.abs(augmented[maxRow][col])) maxRow = r;
    }
    if (Math.abs(augmented[maxRow][col]) < 1e-9) continue;
    [augmented[pivotRow], augmented[maxRow]] = [augmented[maxRow], augmented[pivotRow]];
    const piv = augmented[pivotRow][col];
    for (let r = pivotRow + 1; r < rows; r++) {
      const factor = augmented[r][col] / piv;
      for (let c = col; c <= cols; c++) augmented[r][c] -= factor * augmented[pivotRow][c];
    }
    pivotRow++;
  }

  // Set last free variable = 1 and back-substitute
  const coeffs = new Array(nComp).fill(0);
  coeffs[nComp - 1] = 1;

  for (let row = pivotRow - 1; row >= 0; row--) {
    let sum = augmented[row][cols];
    let pivCol = -1;
    for (let c = 0; c < cols; c++) {
      if (Math.abs(augmented[row][c]) > 1e-9) { pivCol = c; break; }
    }
    if (pivCol < 0) continue;
    for (let c = pivCol + 1; c < cols; c++) sum -= augmented[row][c] * coeffs[c];
    coeffs[pivCol] = sum / augmented[row][pivCol];
  }

  // Convert to smallest integers via LCM of denominators
  const toFraction = (x, maxDen = 100) => {
    for (let den = 1; den <= maxDen; den++) {
      if (Math.abs(x * den - Math.round(x * den)) < 0.01) return { num: Math.round(x * den), den };
    }
    return { num: Math.round(x), den: 1 };
  };

  const fracs = coeffs.map(c => toFraction(Math.abs(c)));
  const lcmDen = fracs.reduce((a, b) => {
    let x = a, y = b.den;
    while (y) { [x, y] = [y, x % y]; }
    return a * b.den / x;
  }, 1);

  const intCoeffs = fracs.map(f => f.num * (lcmDen / f.den));
  const minCoeff  = Math.min(...intCoeffs.filter(c => c > 0));
  const finalCoeffs = intCoeffs.map(c => Math.round(c / minCoeff));

  // Format balanced equation
  const fmt = (compound, coeff) => coeff === 1 ? compound : `${coeff}${compound}`;
  const lhs = reactants.map((c, i) => fmt(c, finalCoeffs[i])).join(' + ');
  const rhs = products.map((c, i) => fmt(c, finalCoeffs[reactants.length + i])).join(' + ');

  return {
    ok: true,
    balanced: `${lhs} → ${rhs}`,
    coefficients: Object.fromEntries(compounds.map((c, i) => [c, finalCoeffs[i]])),
    reactantCoeffs: Object.fromEntries(reactants.map((c, i) => [c, finalCoeffs[i]])),
    productCoeffs:  Object.fromEntries(products.map((c, i) => [c, finalCoeffs[reactants.length + i]])),
  };
}

// ── Solution Chemistry ────────────────────────────────────────────────────────

export function solutionChemistry({ type = 'acid', concentration = 0, Ka = null, Kb = null, tempC = 25 }) {
  const Kw = 1e-14 * Math.exp(-6900 * (1 / (tempC + 273.15) - 1 / 298.15)); // temp-corrected
  let pH, pOH, detail;

  if (type === 'strong-acid') {
    pH   = concentration > 0 ? -Math.log10(concentration) : 7;
    pOH  = 14 + Math.log10(Kw) / Math.log10(10) + pH; // pOH = pKw - pH
    detail = 'Strong acid: [H⁺] = C';
  } else if (type === 'strong-base') {
    pOH  = concentration > 0 ? -Math.log10(concentration) : 7;
    pH   = -Math.log10(Kw) - pOH;
    detail = 'Strong base: [OH⁻] = C';
  } else if (type === 'weak-acid' && Ka) {
    // x² + Ka*x - Ka*C = 0
    const x = (-Ka + Math.sqrt(Ka * Ka + 4 * Ka * concentration)) / 2;
    pH   = -Math.log10(Math.max(x, 1e-15));
    pOH  = -Math.log10(Kw) - pH;
    detail = `Weak acid: x = [H⁺] = ${x.toExponential(3)} M`;
  } else if (type === 'weak-base' && Kb) {
    const x = (-Kb + Math.sqrt(Kb * Kb + 4 * Kb * concentration)) / 2;
    pOH  = -Math.log10(Math.max(x, 1e-15));
    pH   = -Math.log10(Kw) - pOH;
    detail = `Weak base: x = [OH⁻] = ${x.toExponential(3)} M`;
  } else if (type === 'buffer' && Ka) {
    // Henderson-Hasselbalch: pH = pKa + log([A-]/[HA])
    const ratio = concentration; // treat concentration as [A-]/[HA] ratio
    pH   = -Math.log10(Ka) + Math.log10(ratio || 1);
    pOH  = -Math.log10(Kw) - pH;
    detail = 'Buffer: Henderson-Hasselbalch';
  } else {
    pH = 7; pOH = 7;
    detail = 'Neutral water at 25°C';
  }

  return {
    ok: true,
    pH: parseFloat(pH.toFixed(3)),
    pOH: parseFloat(pOH.toFixed(3)),
    pKw: parseFloat((-Math.log10(Kw)).toFixed(3)),
    hConc: parseFloat(Math.pow(10, -pH).toExponential(4)),
    ohConc: parseFloat(Math.pow(10, -pOH).toExponential(4)),
    type,
    detail,
  };
}

// ── Enthalpy of Reaction ──────────────────────────────────────────────────────

export function enthalpyOfReaction({ reactants = [], products = [] }) {
  // reactants/products: [{ formula, moles }]
  let deltaH = 0;
  const missing = [];

  for (const p of products) {
    const hf = DELTA_HF[p.formula];
    if (hf === undefined) missing.push(p.formula);
    else deltaH += (p.moles || 1) * hf;
  }
  for (const r of reactants) {
    const hf = DELTA_HF[r.formula];
    if (hf === undefined) missing.push(r.formula);
    else deltaH -= (r.moles || 1) * hf;
  }

  return {
    ok: missing.length === 0,
    deltaH: parseFloat(deltaH.toFixed(2)),
    unit: 'kJ/mol',
    exothermic: deltaH < 0,
    missing: missing.length ? missing : undefined,
    note: missing.length ? `Missing ΔHf° for: ${missing.join(', ')}` : undefined,
  };
}

// ── Gibbs Free Energy ─────────────────────────────────────────────────────────

export function gibbsFreeEnergy({ deltaH, deltaS, tempK = 298.15 }) {
  // ΔG = ΔH - TΔS  (deltaH in kJ/mol, deltaS in J/mol/K)
  const deltaG = deltaH - tempK * (deltaS / 1000); // convert deltaS J→kJ

  let spontaneous, note;
  if (deltaG < 0) { spontaneous = true;  note = 'Spontaneous at this temperature'; }
  else if (deltaG > 0) { spontaneous = false; note = 'Non-spontaneous at this temperature'; }
  else { spontaneous = null; note = 'System at equilibrium (ΔG = 0)'; }

  // Crossover temperature where ΔG = 0: T = ΔH/ΔS
  const crossoverK = deltaS !== 0 ? (deltaH * 1000) / deltaS : null;

  return {
    ok: true,
    deltaG: parseFloat(deltaG.toFixed(3)),
    deltaH,
    deltaS,
    tempK,
    unit: 'kJ/mol',
    spontaneous,
    note,
    crossoverTempK: crossoverK !== null ? parseFloat(crossoverK.toFixed(1)) : null,
    crossoverTempC: crossoverK !== null ? parseFloat((crossoverK - 273.15).toFixed(1)) : null,
  };
}
