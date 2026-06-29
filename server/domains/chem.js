// server/domains/chem.js
// Domain actions for chemistry: molecular formula parsing, reaction balancing,
// solution chemistry, and thermochemistry.

import { cachedFetchJson } from "../lib/external-fetch.js";

export default function registerChemActions(registerLensAction) {
  // ── Per-user persistent state (structures, lab notebook) ──
  function chemState() {
    const g = globalThis._concordSTATE || (globalThis._concordSTATE = {});
    if (!g.chemStructures) g.chemStructures = new Map();  // userId -> Map<id, structure>
    if (!g.chemLabNotebook) g.chemLabNotebook = new Map(); // userId -> Array<entry>
    return g;
  }
  function chemActor(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function chemId(prefix) { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  // Periodic table subset (atomic masses)
  const ELEMENTS = {
    H: 1.008, He: 4.003, Li: 6.941, Be: 9.012, B: 10.81, C: 12.011,
    N: 14.007, O: 15.999, F: 18.998, Ne: 20.180, Na: 22.990, Mg: 24.305,
    Al: 26.982, Si: 28.086, P: 30.974, S: 32.065, Cl: 35.453, Ar: 39.948,
    K: 39.098, Ca: 40.078, Ti: 47.867, V: 50.942, Cr: 51.996, Mn: 54.938,
    Fe: 55.845, Co: 58.933, Ni: 58.693, Cu: 63.546, Zn: 65.38, Br: 79.904,
    Ag: 107.868, I: 126.904, Ba: 137.327, Au: 196.967, Pb: 207.2, U: 238.029,
  };

  // Parse molecular formula into element counts: "H2O" → {H:2, O:1}
  function parseFormula(formula) {
    const counts = {};
    const stack = [counts];
    let i = 0;
    while (i < formula.length) {
      if (formula[i] === '(') {
        const sub = {};
        stack.push(sub);
        i++;
      } else if (formula[i] === ')') {
        i++;
        let num = '';
        while (i < formula.length && /\d/.test(formula[i])) { num += formula[i]; i++; }
        const mult = num ? parseInt(num) : 1;
        const sub = stack.pop();
        const parent = stack[stack.length - 1];
        for (const [el, cnt] of Object.entries(sub)) {
          parent[el] = (parent[el] || 0) + cnt * mult;
        }
      } else if (/[A-Z]/.test(formula[i])) {
        let el = formula[i]; i++;
        while (i < formula.length && /[a-z]/.test(formula[i])) { el += formula[i]; i++; }
        let num = '';
        while (i < formula.length && /\d/.test(formula[i])) { num += formula[i]; i++; }
        const mult = num ? parseInt(num) : 1;
        const current = stack[stack.length - 1];
        current[el] = (current[el] || 0) + mult;
      } else {
        i++;
      }
    }
    return counts;
  }

  /**
   * molecularAnalysis
   * Parse a molecular formula and compute molecular weight, elemental composition,
   * empirical formula, and degree of unsaturation.
   * artifact.data.formula = "C6H12O6" or params.formula
   */
  registerLensAction("chem", "molecularAnalysis", (ctx, artifact, params) => {
    const formula = params.formula || artifact.data?.formula;
    if (!formula) return { ok: false, error: "No molecular formula provided." };

    const elements = parseFormula(formula);
    const r = v => Math.round(v * 10000) / 10000;

    // Molecular weight
    let mw = 0;
    const composition = [];
    for (const [el, count] of Object.entries(elements)) {
      const mass = ELEMENTS[el];
      if (!mass) return { ok: false, error: `Unknown element: ${el}` };
      const elMass = mass * count;
      mw += elMass;
      composition.push({ element: el, count, atomicMass: mass, totalMass: r(elMass) });
    }

    // Mass percentages
    for (const c of composition) {
      c.massPercent = r((c.totalMass / mw) * 100);
    }

    // Empirical formula: divide all counts by GCD
    const counts = Object.values(elements);
    function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
    let g = counts[0];
    for (let i = 1; i < counts.length; i++) g = gcd(g, counts[i]);
    const empirical = {};
    for (const [el, count] of Object.entries(elements)) {
      empirical[el] = count / g;
    }
    const empiricalFormula = Object.entries(empirical)
      .map(([el, n]) => n === 1 ? el : `${el}${n}`).join('');
    const empiricalMW = Object.entries(empirical)
      .reduce((s, [el, n]) => s + ELEMENTS[el] * n, 0);
    const formulaRatio = Math.round(mw / empiricalMW);

    // Degree of unsaturation (Index of Hydrogen Deficiency)
    // DoU = (2C + 2 + N - H - X) / 2  where X = halogens
    const C = elements.C || 0, H = elements.H || 0, N = elements.N || 0;
    const halogens = (elements.F || 0) + (elements.Cl || 0) + (elements.Br || 0) + (elements.I || 0);
    const dou = C > 0 ? (2 * C + 2 + N - H - halogens) / 2 : null;

    // Moles calculations
    const molesIn1g = 1 / mw;
    const moleculesIn1g = molesIn1g * 6.022e23;

    return {
      ok: true, result: {
        formula, molecularWeight: r(mw),
        elements: composition,
        empiricalFormula, empiricalWeight: r(empiricalMW),
        formulaToEmpiricalRatio: formulaRatio,
        degreeOfUnsaturation: dou,
        molarMass: r(mw) + " g/mol",
        molesPerGram: r(molesIn1g),
        moleculesPerGram: r(moleculesIn1g),
        totalAtoms: Object.values(elements).reduce((s, n) => s + n, 0),
      },
    };
  });

  /**
   * balanceReaction
   * Balance a chemical equation using Gaussian elimination on the composition matrix.
   * artifact.data.reactants = ["H2", "O2"], artifact.data.products = ["H2O"]
   * OR params.equation = "H2 + O2 -> H2O"
   */
  registerLensAction("chem", "balanceReaction", (ctx, artifact, params) => {
    let reactants, products;

    if (params.equation) {
      const sides = params.equation.split(/->|→|=/).map(s => s.trim());
      if (sides.length !== 2) return { ok: false, error: "Equation must have exactly one arrow (->)." };
      reactants = sides[0].split('+').map(s => s.trim()).filter(Boolean);
      products = sides[1].split('+').map(s => s.trim()).filter(Boolean);
    } else {
      reactants = artifact.data?.reactants || [];
      products = artifact.data?.products || [];
    }

    if (reactants.length === 0 || products.length === 0) {
      return { ok: false, error: "Need at least one reactant and one product." };
    }

    const compounds = [...reactants, ...products];
    const nCompounds = compounds.length;
    const nReactants = reactants.length;

    // Parse all compounds
    const parsed = compounds.map(parseFormula);

    // Collect all elements
    const allElements = new Set();
    for (const p of parsed) for (const el of Object.keys(p)) allElements.add(el);
    const elementList = [...allElements];
    const nElements = elementList.length;

    // Build composition matrix: rows = elements, cols = compounds
    // Reactants are positive, products are negative
    const matrix = Array.from({ length: nElements }, () => new Array(nCompounds + 1).fill(0));
    for (let j = 0; j < nCompounds; j++) {
      const sign = j < nReactants ? 1 : -1;
      for (let i = 0; i < nElements; i++) {
        matrix[i][j] = sign * (parsed[j][elementList[i]] || 0);
      }
    }

    // Gaussian elimination (reduced row echelon form)
    const rows = nElements, cols = nCompounds;
    let pivotRow = 0;
    for (let col = 0; col < cols && pivotRow < rows; col++) {
      let maxR = pivotRow;
      for (let row = pivotRow + 1; row < rows; row++) {
        if (Math.abs(matrix[row][col]) > Math.abs(matrix[maxR][col])) maxR = row;
      }
      if (Math.abs(matrix[maxR][col]) < 1e-10) continue;
      [matrix[pivotRow], matrix[maxR]] = [matrix[maxR], matrix[pivotRow]];
      const pivot = matrix[pivotRow][col];
      for (let j = col; j <= cols; j++) matrix[pivotRow][j] /= pivot;
      for (let row = 0; row < rows; row++) {
        if (row === pivotRow) continue;
        const factor = matrix[row][col];
        for (let j = col; j <= cols; j++) matrix[row][j] -= factor * matrix[pivotRow][j];
      }
      pivotRow++;
    }

    // Extract solution: free variables = 1, solve for others
    const coefficients = new Array(nCompounds).fill(1);
    // Back-substitution: for each pivot row, solve
    for (let i = Math.min(pivotRow, rows) - 1; i >= 0; i--) {
      let pivotCol = -1;
      for (let j = 0; j < cols; j++) {
        if (Math.abs(matrix[i][j]) > 1e-10) { pivotCol = j; break; }
      }
      if (pivotCol === -1) continue;
      let val = -matrix[i][cols]; // RHS
      for (let j = pivotCol + 1; j < cols; j++) {
        val -= matrix[i][j] * coefficients[j];
      }
      coefficients[pivotCol] = val / matrix[i][pivotCol];
    }

    // Make all coefficients positive and convert to integers
    const minCoeff = Math.min(...coefficients.filter(c => Math.abs(c) > 1e-10).map(Math.abs));
    const normalized = coefficients.map(c => Math.abs(c) / (minCoeff || 1));

    // Find smallest multiplier to make all integers
    let multiplier = 1;
    for (let m = 1; m <= 100; m++) {
      if (normalized.every(c => Math.abs(Math.round(c * m) - c * m) < 0.01)) {
        multiplier = m;
        break;
      }
    }
    const intCoeffs = normalized.map(c => Math.round(c * multiplier));

    // Build balanced equation string
    const reactantStr = reactants.map((r, i) => intCoeffs[i] === 1 ? r : `${intCoeffs[i]}${r}`).join(' + ');
    const productStr = products.map((p, i) => {
      const idx = nReactants + i;
      return intCoeffs[idx] === 1 ? p : `${intCoeffs[idx]}${p}`;
    }).join(' + ');

    // Verify balance
    const verification = {};
    for (const el of elementList) {
      let left = 0, right = 0;
      for (let j = 0; j < nReactants; j++) left += (parsed[j][el] || 0) * intCoeffs[j];
      for (let j = nReactants; j < nCompounds; j++) right += (parsed[j][el] || 0) * intCoeffs[j];
      verification[el] = { left, right, balanced: left === right };
    }
    const isBalanced = Object.values(verification).every(v => v.balanced);

    return {
      ok: true, result: {
        balanced: isBalanced,
        equation: `${reactantStr} → ${productStr}`,
        coefficients: compounds.map((c, i) => ({ compound: c, coefficient: intCoeffs[i] })),
        elementCheck: verification,
        reactants: reactants.map((r, i) => ({ formula: r, coefficient: intCoeffs[i] })),
        products: products.map((p, i) => ({ formula: p, coefficient: intCoeffs[nReactants + i] })),
      },
    };
  });

  /**
   * solutionChemistry
   * Compute pH, dilution, titration curves, and buffer capacity.
   * artifact.data.solution = { type, concentration, volume?, pKa?, pKb? }
   * params.operation: "pH" | "dilute" | "titrate" | "buffer"
   */
  registerLensAction("chem", "solutionChemistry", (ctx, artifact, params) => {
    const sol = artifact.data?.solution || {};
    const op = params.operation || "pH";
    const r = v => Math.round(v * 10000) / 10000;

    switch (op) {
      case "pH": {
        const type = sol.type || "strong-acid";
        const conc = sol.concentration || 0.1; // mol/L
        const pKa = sol.pKa;
        const pKb = sol.pKb;
        let pH, pOH;

        if (type === "strong-acid") {
          pH = -Math.log10(conc);
          pOH = 14 - pH;
        } else if (type === "strong-base") {
          pOH = -Math.log10(conc);
          pH = 14 - pOH;
        } else if (type === "weak-acid" && pKa != null) {
          const Ka = Math.pow(10, -pKa);
          // Quadratic: [H+]² + Ka[H+] - Ka*C = 0
          const disc = Ka * Ka + 4 * Ka * conc;
          const H = (-Ka + Math.sqrt(disc)) / 2;
          pH = -Math.log10(H);
          pOH = 14 - pH;
        } else if (type === "weak-base" && pKb != null) {
          const Kb = Math.pow(10, -pKb);
          const disc = Kb * Kb + 4 * Kb * conc;
          const OH = (-Kb + Math.sqrt(disc)) / 2;
          pOH = -Math.log10(OH);
          pH = 14 - pOH;
        } else {
          return { ok: false, error: "Unsupported solution type or missing pKa/pKb." };
        }

        const H = Math.pow(10, -pH);
        const OH = Math.pow(10, -pOH);
        const acidic = pH < 7;

        return {
          ok: true, result: {
            pH: r(pH), pOH: r(pOH),
            hydrogenIonConc: r(H), hydroxideIonConc: r(OH),
            nature: acidic ? "acidic" : pH > 7 ? "basic" : "neutral",
            type, concentration: conc,
          },
        };
      }

      case "dilute": {
        const C1 = sol.concentration || 0.1;
        const V1 = sol.volume || 1; // L
        const C2 = params.targetConcentration;
        const V2 = params.targetVolume;

        if (C2) {
          // C1V1 = C2V2 → V2 = C1V1/C2
          const finalVolume = C1 * V1 / C2;
          const solventToAdd = finalVolume - V1;
          return {
            ok: true, result: {
              initialConcentration: C1, initialVolume: V1,
              finalConcentration: r(C2), finalVolume: r(finalVolume),
              solventToAdd: r(solventToAdd),
              dilutionFactor: r(C1 / C2),
            },
          };
        } else if (V2) {
          const finalConc = C1 * V1 / V2;
          return {
            ok: true, result: {
              initialConcentration: C1, initialVolume: V1,
              finalConcentration: r(finalConc), finalVolume: V2,
              solventToAdd: r(V2 - V1),
              dilutionFactor: r(C1 / finalConc),
            },
          };
        }
        return { ok: false, error: "Provide targetConcentration or targetVolume." };
      }

      case "titrate": {
        // Generate titration curve
        const analyteConc = sol.concentration || 0.1;
        const analyteVol = sol.volume || 0.025; // 25 mL default
        const titrantConc = params.titrantConcentration || 0.1;
        const isAcid = sol.type?.includes("acid");
        const pKa = sol.pKa || 4.75; // acetic acid default for weak

        const equivalenceVol = analyteConc * analyteVol / titrantConc;
        const curve = [];

        for (let frac = 0; frac <= 2; frac += 0.02) {
          const vTitrant = frac * equivalenceVol;
          const totalVol = analyteVol + vTitrant;
          const molesAnalyte = analyteConc * analyteVol;
          const molesTitrant = titrantConc * vTitrant;
          let pH;

          if (sol.type === "strong-acid") {
            if (molesTitrant < molesAnalyte) {
              const excessH = (molesAnalyte - molesTitrant) / totalVol;
              pH = -Math.log10(excessH);
            } else if (Math.abs(molesTitrant - molesAnalyte) < 1e-10) {
              pH = 7;
            } else {
              const excessOH = (molesTitrant - molesAnalyte) / totalVol;
              pH = 14 + Math.log10(excessOH);
            }
          } else {
            // Weak acid-strong base (Henderson-Hasselbalch in buffer region)
            const Ka = Math.pow(10, -pKa);
            if (molesTitrant < molesAnalyte * 0.999) {
              const remaining = molesAnalyte - molesTitrant;
              const conjugate = molesTitrant;
              if (conjugate > 0) {
                pH = pKa + Math.log10(conjugate / remaining);
              } else {
                const C = remaining / totalVol;
                const disc = Ka * Ka + 4 * Ka * C;
                pH = -Math.log10((-Ka + Math.sqrt(disc)) / 2);
              }
            } else if (Math.abs(molesTitrant - molesAnalyte) < molesAnalyte * 0.002) {
              // Equivalence point: hydrolysis of conjugate base
              const Cb = molesAnalyte / totalVol;
              const Kb = 1e-14 / Ka;
              const OH = Math.sqrt(Kb * Cb);
              pH = 14 + Math.log10(OH);
            } else {
              const excessOH = (molesTitrant - molesAnalyte) / totalVol;
              pH = 14 + Math.log10(excessOH);
            }
          }

          curve.push({ volumeAdded: Math.round(vTitrant * 1e6) / 1e6, fractionEquivalence: r(frac), pH: r(pH) });
        }

        // Half-equivalence point
        const halfEq = curve.find(p => Math.abs(p.fractionEquivalence - 0.5) < 0.02);
        const eqPoint = curve.find(p => Math.abs(p.fractionEquivalence - 1.0) < 0.02);

        return {
          ok: true, result: {
            equivalenceVolume: r(equivalenceVol * 1000) + " mL",
            equivalencePoint: eqPoint,
            halfEquivalencePoint: halfEq,
            pKaEstimate: halfEq ? halfEq.pH : null,
            curve: curve.filter((_, i) => i % 2 === 0 || Math.abs(curve[i].fractionEquivalence - 1) < 0.1),
            analyteType: sol.type, titrantType: isAcid ? "strong-base" : "strong-acid",
          },
        };
      }

      case "buffer": {
        const pKa = sol.pKa || 4.75;
        const acidConc = sol.concentration || 0.1;
        const baseConc = params.conjugateBaseConcentration || acidConc;
        const Ka = Math.pow(10, -pKa);

        // Henderson-Hasselbalch
        const pH = pKa + Math.log10(baseConc / acidConc);

        // Buffer capacity (β = 2.303 * C * Ka * [H+] / (Ka + [H+])²)
        const H = Math.pow(10, -pH);
        const totalConc = acidConc + baseConc;
        const beta = 2.303 * totalConc * Ka * H / Math.pow(Ka + H, 2);

        // Effective buffer range
        const rangeMin = pKa - 1;
        const rangeMax = pKa + 1;

        // How much strong acid/base to shift pH by 1 unit
        const molesAcidToShift = beta * 1; // approximate
        const molesBaseToShift = beta * 1;

        return {
          ok: true, result: {
            pH: r(pH), pKa,
            acidConcentration: acidConc, conjugateBaseConcentration: baseConc,
            ratio: r(baseConc / acidConc),
            bufferCapacity: r(beta),
            effectiveRange: { min: r(rangeMin), max: r(rangeMax) },
            molesToShiftpH1: { acid: r(molesAcidToShift), base: r(molesBaseToShift) },
            quality: Math.abs(pH - pKa) < 0.5 ? "optimal" : Math.abs(pH - pKa) < 1 ? "good" : "poor",
          },
        };
      }

      default:
        return { ok: false, error: `Unknown operation "${op}". Use: pH, dilute, titrate, buffer.` };
    }
  });

  /**
   * generate-safety
   * Build a GHS-style safety profile for a compound. Heuristic lookup
   * against a small hazard table. Real production should hit PubChem
   * GHS section. Returns hazard classes, GHS pictograms, handling,
   * storage, first aid, disposal. Pre-this macro the manifest
   * "generate-safety" UniversalAction button was a dead click.
   */
  registerLensAction("chem", "generate-safety", (ctx, artifact, params) => {
  try {
    const d = artifact.data || {};
    const name = String(d.name || d.compound || d.formula || params?.name || artifact.title || "(unknown)").trim();
    const lname = name.toLowerCase();

    const HAZARD_KEYWORDS = [
      { match: /sulfuric|hcl|hydrochloric|nitric|phosphoric|acid/, classes: ['corrosive','acute-toxicity'], pictograms: ['GHS05','GHS06'], handling: 'Always add acid to water (AAA), never reverse. Use fume hood. Acid-resistant gloves + face shield.' },
      { match: /sodium hydroxide|naoh|koh|caustic|lye|base/,        classes: ['corrosive','skin-burn'],   pictograms: ['GHS05'],        handling: 'Heat on dissolution — add base to water slowly. PPE: nitrile gloves + face shield.' },
      { match: /methanol|ethanol|isopropanol|alcohol/,              classes: ['flammable','intoxicant'],  pictograms: ['GHS02','GHS07'], handling: 'Keep away from ignition. Ventilation. Bond/ground when transferring large volumes.' },
      { match: /benzene|toluene|xylene/,                            classes: ['flammable','carcinogenic','aspiration-hazard'], pictograms: ['GHS02','GHS08','GHS07'], handling: 'Fume hood required. PPE: nitrile gloves, lab coat, eye protection. Avoid skin contact.' },
      { match: /chloroform|dichloromethane|carbon tetra/,            classes: ['carcinogenic','toxic'],    pictograms: ['GHS08','GHS06'], handling: 'Fume hood. Double-glove. Bottle on tray to contain spills.' },
      { match: /mercury|lead|cadmium|arsenic/,                      classes: ['heavy-metal','toxic','environmental'], pictograms: ['GHS06','GHS09'], handling: 'Strict spill containment. Designated workspace. Hazardous waste stream.' },
      { match: /oxygen|hydrogen|methane|propane|acetylene/,          classes: ['flammable','asphyxiant'],  pictograms: ['GHS02','GHS04'], handling: 'Compressed gas — secure cylinder vertically. Proper regulator. Soap-leak-check.' },
      { match: /cyanide|hcn/,                                       classes: ['acute-toxicity-fatal','rapid'], pictograms: ['GHS06'], handling: 'EXTREME hazard. Designated operator only. Buddy system. Antidote kit on-site.' },
      { match: /ether|peroxide/,                                    classes: ['flammable','peroxide-former'], pictograms: ['GHS02','GHS03'], handling: 'Test for peroxides before use; never distill to dryness. Date containers on opening.' },
    ];
    const matched = HAZARD_KEYWORDS.find(p => p.match.test(lname));
    const profile = matched ? matched : {
      classes: ['unspecified'], pictograms: [],
      handling: 'No specific hazard signature matched. Consult PubChem GHS section, manufacturer SDS, and your CHP. Default: PPE (gloves, eye protection), fume hood for unknowns.',
    };

    const result = {
      generatedAt: new Date().toISOString(),
      compound: name,
      formula: d.formula || null,
      hazardClasses: profile.classes,
      ghsPictograms: profile.pictograms,
      handling: profile.handling,
      storage: matched && /flammable/.test(profile.classes.join(','))
        ? 'Flammable cabinet, away from oxidizers. Cool, ventilated.'
        : matched && /corrosive/.test(profile.classes.join(','))
          ? 'Corrosive cabinet, segregated from incompatibles.'
          : 'Closed container, room temperature, away from incompatibles.',
      firstAid: {
        skin: 'Remove contaminated clothing. Flush 15 min with water. Medical attention if irritation persists.',
        eye: 'Eyewash 15 min. Hold eyelids open. Medical attention.',
        inhalation: 'Move to fresh air. Oxygen if breathing difficult. Medical attention.',
        ingestion: 'Do not induce vomiting. Rinse mouth. Immediate medical attention with SDS.',
      },
      disposal: 'Hazardous waste stream — do not pour down drain. Label per local regulations.',
      summary: matched ? `${name}: ${profile.classes.join(', ')}.` : `${name}: no preset hazard profile. Consult manufacturer SDS.`,
      sources: [
        { name: 'PubChem GHS', url: `https://pubchem.ncbi.nlm.nih.gov/#query=${encodeURIComponent(name)}` },
        { name: 'ICSC',        url: `https://www.ilo.org/dyn/icsc/showcard.home?p_lang=en` },
      ],
    };
    if (artifact.data) artifact.data.lastSafetyProfile = result;
    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * check-interactions
   * Cross-reference a set of compounds for known incompatibilities.
   * Pairwise rule lookup against a real (small) chem hazard table.
   */
  registerLensAction("chem", "check-interactions", (ctx, artifact, params) => {
  try {
    const raw = artifact.data?.compounds || params?.compounds || [];
    const compounds = raw.map(c => typeof c === 'string' ? { name: c } : c).filter(c => c.name);
    if (compounds.length < 2) {
      return { ok: false, error: "need_two", message: "Provide at least two compounds." };
    }

    const INCOMPATIBILITIES = [
      { a: /acid/i,                      b: /base|hydroxide|cyanide/i,    severity: 'high', issue: 'Violent neutralization, heat release. Cyanide+acid releases lethal HCN gas.' },
      { a: /oxidizer|perchlorate|nitrate|chlorate|peroxide/i, b: /organic|alcohol|hydrocarbon|ether/i, severity: 'high', issue: 'Risk of fire or explosion, especially with friction or heat.' },
      { a: /sodium|potassium|lithium/i,  b: /water|alcohol/i,             severity: 'high', issue: 'Reacts violently with water releasing H2; potential fire/explosion.' },
      { a: /chlorine|hypochlorite|bleach/i, b: /ammonia|amine/i,          severity: 'high', issue: 'Releases toxic chloramine gas. Ventilate immediately.' },
      { a: /chlorine|hypochlorite|bleach/i, b: /acid/i,                   severity: 'high', issue: 'Releases toxic chlorine gas.' },
      { a: /silver|mercury/i,            b: /azide|ammonia/i,             severity: 'high', issue: 'Forms shock-sensitive explosive azides.' },
      { a: /sulfuric/i,                  b: /permanganate|chlorate/i,     severity: 'high', issue: 'Explosive Mn2O7 / chloric acid byproducts.' },
      { a: /flammable/i,                 b: /oxidizer/i,                  severity: 'high', issue: 'Fire / explosion risk; segregate in storage.' },
      { a: /reducing|hydride|borohydride/i, b: /oxidizer|peroxide/i,      severity: 'high', issue: 'Redox runaway risk.' },
    ];

    const interactions = [];
    for (let i = 0; i < compounds.length; i++) {
      for (let j = i + 1; j < compounds.length; j++) {
        const ni = compounds[i].name;
        const nj = compounds[j].name;
        for (const rule of INCOMPATIBILITIES) {
          if ((rule.a.test(ni) && rule.b.test(nj)) || (rule.a.test(nj) && rule.b.test(ni))) {
            interactions.push({ between: [ni, nj], severity: rule.severity, issue: rule.issue });
            break;
          }
        }
      }
    }

    const result = {
      checkedAt: new Date().toISOString(),
      compounds: compounds.map(c => c.name),
      interactions,
      severity: interactions.some(i => i.severity === 'high') ? 'high' : interactions.length > 0 ? 'medium' : 'ok',
      summary: interactions.length === 0
        ? `No known incompatibilities among ${compounds.length} compound(s). Library is small — for production consult OSHA / Bretherick's.`
        : `${interactions.length} incompatibility(ies). ${interactions.filter(i => i.severity === 'high').length} HIGH severity — segregate immediately.`,
    };
    if (artifact.data) artifact.data.lastInteractionCheck = result;
    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * explore-element
   * Element profile: properties, uses, history, key compounds.
   * Small bundled library; for full coverage point at PubChem element pages.
   */
  registerLensAction("chem", "explore-element", (ctx, artifact, params) => {
    const sym = String(artifact.data?.symbol || params?.symbol || artifact.data?.element || params?.element || artifact.title || "").trim();
    const lookup = sym.toLowerCase();

    const ELEMENTS = {
      h:   { name: 'Hydrogen',   symbol: 'H',   z: 1,  group: 1,  period: 1, category: 'nonmetal',         atomicMass: 1.008,   uses: ['fuel','ammonia synthesis','reducing agent'],            history: 'Identified by Cavendish 1766; named by Lavoisier.' },
      he:  { name: 'Helium',     symbol: 'He',  z: 2,  group: 18, period: 1, category: 'noble',            atomicMass: 4.0026,  uses: ['cryogenics','balloons','MRI'],                          history: 'Detected in solar spectrum 1868; isolated on Earth 1895.' },
      c:   { name: 'Carbon',     symbol: 'C',   z: 6,  group: 14, period: 2, category: 'nonmetal',         atomicMass: 12.011,  uses: ['steel','plastics','life chemistry'],                    history: 'Known since antiquity (charcoal); named by Lavoisier.' },
      n:   { name: 'Nitrogen',   symbol: 'N',   z: 7,  group: 15, period: 2, category: 'nonmetal',         atomicMass: 14.007,  uses: ['ammonia','fertilizer','cryogenics'],                    history: 'Isolated by Rutherford 1772.' },
      o:   { name: 'Oxygen',     symbol: 'O',   z: 8,  group: 16, period: 2, category: 'nonmetal',         atomicMass: 15.999,  uses: ['respiration','combustion','steel-making'],              history: 'Discovered by Scheele 1771 and Priestley 1774 independently.' },
      na:  { name: 'Sodium',     symbol: 'Na',  z: 11, group: 1,  period: 3, category: 'alkali',           atomicMass: 22.990,  uses: ['salt','soap','sodium lamps'],                           history: 'Isolated by Davy 1807 via electrolysis.' },
      cl:  { name: 'Chlorine',   symbol: 'Cl',  z: 17, group: 17, period: 3, category: 'halogen',          atomicMass: 35.45,   uses: ['water treatment','PVC','disinfectants'],                history: 'Discovered by Scheele 1774; named by Davy 1810.' },
      fe:  { name: 'Iron',       symbol: 'Fe',  z: 26, group: 8,  period: 4, category: 'transition',       atomicMass: 55.845,  uses: ['steel','hemoglobin','catalysts'],                       history: 'Used ~3000 BCE; Iron Age ~1200 BCE.' },
      au:  { name: 'Gold',       symbol: 'Au',  z: 79, group: 11, period: 6, category: 'transition',       atomicMass: 196.97,  uses: ['jewelry','electronics','reserve'],                      history: 'Known since antiquity; symbol from Latin "aurum".' },
      pb:  { name: 'Lead',       symbol: 'Pb',  z: 82, group: 14, period: 6, category: 'post-transition',  atomicMass: 207.2,   uses: ['batteries','radiation shielding'],                      history: 'Romans used widely; now restricted due to toxicity.' },
      u:   { name: 'Uranium',    symbol: 'U',   z: 92, group: -1, period: 7, category: 'actinide',         atomicMass: 238.03,  uses: ['nuclear fuel','weapons'],                                history: 'Discovered by Klaproth 1789; named after planet Uranus.' },
    };
    const entry = ELEMENTS[lookup] || ELEMENTS[lookup.slice(0,2)] || ELEMENTS[lookup.slice(0,1)];
    if (!entry) {
      return {
        ok: true,
        result: {
          requested: sym,
          message: `Element "${sym}" not in bundled library. Use PubChem element index for full coverage.`,
          link: 'https://pubchem.ncbi.nlm.nih.gov/periodic-table/',
        },
      };
    }
    const result = {
      generatedAt: new Date().toISOString(),
      ...entry,
      summary: `${entry.name} (${entry.symbol}, Z=${entry.z}): ${entry.category}, group ${entry.group}, period ${entry.period}. Uses: ${entry.uses.join(', ')}. ${entry.history}`,
      sources: [
        { name: 'PubChem element', url: `https://pubchem.ncbi.nlm.nih.gov/element/${entry.z}` },
      ],
    };
    if (artifact.data) artifact.data.lastElementProfile = result;
    return { ok: true, result };
  });

  // ─── 2026 parity — ChemDraw/Ketcher/RDKit-grade calculators ──
  //
  // Pure JS (no external lib deps). Adds molecular weight calc, molarity/
  // dilution/pH/gas-law calculators, periodic-table-118 data, simple
  // reaction balancer.

  // Full periodic table (1-118) — symbol, name, atomic number, atomic mass.
  const PERIODIC_TABLE = {
    H:  { z: 1,   name: "Hydrogen",      mass: 1.008,    category: "nonmetal" },
    He: { z: 2,   name: "Helium",        mass: 4.0026,   category: "noble_gas" },
    Li: { z: 3,   name: "Lithium",       mass: 6.94,     category: "alkali_metal" },
    Be: { z: 4,   name: "Beryllium",     mass: 9.0122,   category: "alkaline_earth" },
    B:  { z: 5,   name: "Boron",         mass: 10.81,    category: "metalloid" },
    C:  { z: 6,   name: "Carbon",        mass: 12.011,   category: "nonmetal" },
    N:  { z: 7,   name: "Nitrogen",      mass: 14.007,   category: "nonmetal" },
    O:  { z: 8,   name: "Oxygen",        mass: 15.999,   category: "nonmetal" },
    F:  { z: 9,   name: "Fluorine",      mass: 18.998,   category: "halogen" },
    Ne: { z: 10,  name: "Neon",          mass: 20.180,   category: "noble_gas" },
    Na: { z: 11,  name: "Sodium",        mass: 22.990,   category: "alkali_metal" },
    Mg: { z: 12,  name: "Magnesium",     mass: 24.305,   category: "alkaline_earth" },
    Al: { z: 13,  name: "Aluminum",      mass: 26.982,   category: "post_transition" },
    Si: { z: 14,  name: "Silicon",       mass: 28.085,   category: "metalloid" },
    P:  { z: 15,  name: "Phosphorus",    mass: 30.974,   category: "nonmetal" },
    S:  { z: 16,  name: "Sulfur",        mass: 32.06,    category: "nonmetal" },
    Cl: { z: 17,  name: "Chlorine",      mass: 35.45,    category: "halogen" },
    Ar: { z: 18,  name: "Argon",         mass: 39.948,   category: "noble_gas" },
    K:  { z: 19,  name: "Potassium",     mass: 39.098,   category: "alkali_metal" },
    Ca: { z: 20,  name: "Calcium",       mass: 40.078,   category: "alkaline_earth" },
    Sc: { z: 21,  name: "Scandium",      mass: 44.956,   category: "transition_metal" },
    Ti: { z: 22,  name: "Titanium",      mass: 47.867,   category: "transition_metal" },
    V:  { z: 23,  name: "Vanadium",      mass: 50.942,   category: "transition_metal" },
    Cr: { z: 24,  name: "Chromium",      mass: 51.996,   category: "transition_metal" },
    Mn: { z: 25,  name: "Manganese",     mass: 54.938,   category: "transition_metal" },
    Fe: { z: 26,  name: "Iron",          mass: 55.845,   category: "transition_metal" },
    Co: { z: 27,  name: "Cobalt",        mass: 58.933,   category: "transition_metal" },
    Ni: { z: 28,  name: "Nickel",        mass: 58.693,   category: "transition_metal" },
    Cu: { z: 29,  name: "Copper",        mass: 63.546,   category: "transition_metal" },
    Zn: { z: 30,  name: "Zinc",          mass: 65.38,    category: "transition_metal" },
    Ga: { z: 31,  name: "Gallium",       mass: 69.723,   category: "post_transition" },
    Ge: { z: 32,  name: "Germanium",     mass: 72.630,   category: "metalloid" },
    As: { z: 33,  name: "Arsenic",       mass: 74.922,   category: "metalloid" },
    Se: { z: 34,  name: "Selenium",      mass: 78.971,   category: "nonmetal" },
    Br: { z: 35,  name: "Bromine",       mass: 79.904,   category: "halogen" },
    Kr: { z: 36,  name: "Krypton",       mass: 83.798,   category: "noble_gas" },
    Rb: { z: 37,  name: "Rubidium",      mass: 85.468,   category: "alkali_metal" },
    Sr: { z: 38,  name: "Strontium",     mass: 87.62,    category: "alkaline_earth" },
    Y:  { z: 39,  name: "Yttrium",       mass: 88.906,   category: "transition_metal" },
    Zr: { z: 40,  name: "Zirconium",     mass: 91.224,   category: "transition_metal" },
    Nb: { z: 41,  name: "Niobium",       mass: 92.906,   category: "transition_metal" },
    Mo: { z: 42,  name: "Molybdenum",    mass: 95.95,    category: "transition_metal" },
    Tc: { z: 43,  name: "Technetium",    mass: 98,       category: "transition_metal" },
    Ru: { z: 44,  name: "Ruthenium",     mass: 101.07,   category: "transition_metal" },
    Rh: { z: 45,  name: "Rhodium",       mass: 102.906,  category: "transition_metal" },
    Pd: { z: 46,  name: "Palladium",     mass: 106.42,   category: "transition_metal" },
    Ag: { z: 47,  name: "Silver",        mass: 107.868,  category: "transition_metal" },
    Cd: { z: 48,  name: "Cadmium",       mass: 112.414,  category: "transition_metal" },
    In: { z: 49,  name: "Indium",        mass: 114.818,  category: "post_transition" },
    Sn: { z: 50,  name: "Tin",           mass: 118.710,  category: "post_transition" },
    Sb: { z: 51,  name: "Antimony",      mass: 121.760,  category: "metalloid" },
    Te: { z: 52,  name: "Tellurium",     mass: 127.60,   category: "metalloid" },
    I:  { z: 53,  name: "Iodine",        mass: 126.904,  category: "halogen" },
    Xe: { z: 54,  name: "Xenon",         mass: 131.293,  category: "noble_gas" },
    Cs: { z: 55,  name: "Cesium",        mass: 132.905,  category: "alkali_metal" },
    Ba: { z: 56,  name: "Barium",        mass: 137.327,  category: "alkaline_earth" },
    Pt: { z: 78,  name: "Platinum",      mass: 195.084,  category: "transition_metal" },
    Au: { z: 79,  name: "Gold",            mass: 196.967,  category: "transition_metal" },
    Hg: { z: 80,  name: "Mercury",         mass: 200.592,  category: "transition_metal" },
    // Lanthanides (Z 57-71)
    La: { z: 57,  name: "Lanthanum",       mass: 138.905,  category: "lanthanide" },
    Ce: { z: 58,  name: "Cerium",          mass: 140.116,  category: "lanthanide" },
    Pr: { z: 59,  name: "Praseodymium",    mass: 140.908,  category: "lanthanide" },
    Nd: { z: 60,  name: "Neodymium",       mass: 144.242,  category: "lanthanide" },
    Pm: { z: 61,  name: "Promethium",      mass: 145,      category: "lanthanide" },
    Sm: { z: 62,  name: "Samarium",        mass: 150.36,   category: "lanthanide" },
    Eu: { z: 63,  name: "Europium",        mass: 151.964,  category: "lanthanide" },
    Gd: { z: 64,  name: "Gadolinium",      mass: 157.25,   category: "lanthanide" },
    Tb: { z: 65,  name: "Terbium",         mass: 158.925,  category: "lanthanide" },
    Dy: { z: 66,  name: "Dysprosium",      mass: 162.500,  category: "lanthanide" },
    Ho: { z: 67,  name: "Holmium",         mass: 164.930,  category: "lanthanide" },
    Er: { z: 68,  name: "Erbium",          mass: 167.259,  category: "lanthanide" },
    Tm: { z: 69,  name: "Thulium",         mass: 168.934,  category: "lanthanide" },
    Yb: { z: 70,  name: "Ytterbium",       mass: 173.045,  category: "lanthanide" },
    Lu: { z: 71,  name: "Lutetium",        mass: 174.967,  category: "lanthanide" },
    // Transition (Z 72-77)
    Hf: { z: 72,  name: "Hafnium",         mass: 178.486,  category: "transition_metal" },
    Ta: { z: 73,  name: "Tantalum",        mass: 180.948,  category: "transition_metal" },
    W:  { z: 74,  name: "Tungsten",        mass: 183.84,   category: "transition_metal" },
    Re: { z: 75,  name: "Rhenium",         mass: 186.207,  category: "transition_metal" },
    Os: { z: 76,  name: "Osmium",          mass: 190.23,   category: "transition_metal" },
    Ir: { z: 77,  name: "Iridium",         mass: 192.217,  category: "transition_metal" },
    // Post-transition + metalloids + nonmetals (Z 81, 83-86)
    Tl: { z: 81,  name: "Thallium",        mass: 204.382,  category: "post_transition" },
    Pb: { z: 82,  name: "Lead",            mass: 207.2,    category: "post_transition" },
    Bi: { z: 83,  name: "Bismuth",         mass: 208.980,  category: "post_transition" },
    Po: { z: 84,  name: "Polonium",        mass: 209,      category: "metalloid" },
    At: { z: 85,  name: "Astatine",        mass: 210,      category: "halogen" },
    Rn: { z: 86,  name: "Radon",           mass: 222,      category: "noble_gas" },
    // Actinides (Z 87-103)
    Fr: { z: 87,  name: "Francium",        mass: 223,      category: "alkali_metal" },
    Ra: { z: 88,  name: "Radium",          mass: 226,      category: "alkaline_earth" },
    Ac: { z: 89,  name: "Actinium",        mass: 227,      category: "actinide" },
    Th: { z: 90,  name: "Thorium",         mass: 232.038,  category: "actinide" },
    Pa: { z: 91,  name: "Protactinium",    mass: 231.036,  category: "actinide" },
    U:  { z: 92,  name: "Uranium",         mass: 238.029,  category: "actinide" },
    Np: { z: 93,  name: "Neptunium",       mass: 237,      category: "actinide" },
    Pu: { z: 94,  name: "Plutonium",       mass: 244,      category: "actinide" },
    Am: { z: 95,  name: "Americium",       mass: 243,      category: "actinide" },
    Cm: { z: 96,  name: "Curium",          mass: 247,      category: "actinide" },
    Bk: { z: 97,  name: "Berkelium",       mass: 247,      category: "actinide" },
    Cf: { z: 98,  name: "Californium",     mass: 251,      category: "actinide" },
    Es: { z: 99,  name: "Einsteinium",     mass: 252,      category: "actinide" },
    Fm: { z: 100, name: "Fermium",         mass: 257,      category: "actinide" },
    Md: { z: 101, name: "Mendelevium",     mass: 258,      category: "actinide" },
    No: { z: 102, name: "Nobelium",        mass: 259,      category: "actinide" },
    Lr: { z: 103, name: "Lawrencium",      mass: 266,      category: "actinide" },
    // Superheavies (Z 104-118)
    Rf: { z: 104, name: "Rutherfordium",   mass: 267,      category: "transition_metal" },
    Db: { z: 105, name: "Dubnium",         mass: 268,      category: "transition_metal" },
    Sg: { z: 106, name: "Seaborgium",      mass: 269,      category: "transition_metal" },
    Bh: { z: 107, name: "Bohrium",         mass: 270,      category: "transition_metal" },
    Hs: { z: 108, name: "Hassium",         mass: 277,      category: "transition_metal" },
    Mt: { z: 109, name: "Meitnerium",      mass: 278,      category: "transition_metal" },
    Ds: { z: 110, name: "Darmstadtium",    mass: 281,      category: "transition_metal" },
    Rg: { z: 111, name: "Roentgenium",     mass: 282,      category: "transition_metal" },
    Cn: { z: 112, name: "Copernicium",     mass: 285,      category: "transition_metal" },
    Nh: { z: 113, name: "Nihonium",        mass: 286,      category: "post_transition" },
    Fl: { z: 114, name: "Flerovium",       mass: 289,      category: "post_transition" },
    Mc: { z: 115, name: "Moscovium",       mass: 290,      category: "post_transition" },
    Lv: { z: 116, name: "Livermorium",     mass: 293,      category: "post_transition" },
    Ts: { z: 117, name: "Tennessine",      mass: 294,      category: "halogen" },
    Og: { z: 118, name: "Oganesson",       mass: 294,      category: "noble_gas" },
  };

  // ── Periodic table (return all elements) ──
  //
  // Derive (group, period) from atomic number so the frontend grid can place
  // each cell. The PeriodicTable.tsx component reads `symbol`, `group` and
  // `period` (for the 18×7 layout) plus `atomicMass` — none of which were in
  // the bare PERIODIC_TABLE entries (they carry z/name/mass/category only).
  // Without these the component's gridPos() returned null for every element
  // and the whole table rendered empty. We compute them here for real so the
  // grid is honest, and keep z/name/mass/category untouched for back-compat
  // with molecular-weight / parse-smiles / conformer-3d / the parity census.
  function groupPeriodForZ(z) {
    // s/p block period boundaries by atomic number (last element of each period).
    const PERIOD_END = [2, 10, 18, 36, 54, 86, 118];
    let period = 1;
    for (let p = 0; p < PERIOD_END.length; p++) {
      if (z <= PERIOD_END[p]) { period = p + 1; break; }
    }
    // Lanthanides (57–71) and actinides (89–103) are the f-block series —
    // conventionally drawn in their own rows with no main-grid group.
    if ((z >= 57 && z <= 71) || (z >= 89 && z <= 103)) {
      return { group: null, period };
    }
    // Main-grid group assignment.
    let group = null;
    if (z === 1) group = 1;                       // H
    else if (z === 2) group = 18;                 // He
    else if (z === 3 || z === 11) group = 1;      // Li, Na
    else if (z === 4 || z === 12) group = 2;      // Be, Mg
    else if (z >= 5 && z <= 10) group = 13 + (z - 5);   // B..Ne → 13..18
    else if (z >= 13 && z <= 18) group = 13 + (z - 13); // Al..Ar → 13..18
    else if (z >= 19 && z <= 36) group = 1 + (z - 19);  // K..Kr → 1..18
    else if (z >= 37 && z <= 54) group = 1 + (z - 37);  // Rb..Xe → 1..18
    else if (z === 55) group = 1;                 // Cs
    else if (z === 56) group = 2;                 // Ba
    else if (z >= 72 && z <= 86) group = 4 + (z - 72);  // Hf..Rn → 4..18
    else if (z === 87) group = 1;                 // Fr
    else if (z === 88) group = 2;                 // Ra
    else if (z >= 104 && z <= 118) group = 4 + (z - 104); // Rf..Og → 4..18
    return { group, period };
  }

  registerLensAction("chem", "periodic-table", (_ctx, _artifact, _params = {}) => {
    const elements = {};
    for (const [symbol, el] of Object.entries(PERIODIC_TABLE)) {
      const { group, period } = groupPeriodForZ(el.z);
      elements[symbol] = {
        ...el,
        symbol,
        atomicMass: el.mass,
        group,
        period,
      };
    }
    return { ok: true, result: { elements, count: Object.keys(elements).length } };
  });

  // ── Molecular weight calculator (parses simple formulas like H2O, NaCl, C6H12O6) ──

  function parseFormulaMW(formula) {
    // Returns { element: count } — molecular-weight calculator's parser
    // (distinct from the earlier parseFormula used by the analysis macros).
    const tokens = [];
    let i = 0;
    while (i < formula.length) {
      const ch = formula[i];
      if (ch === "(" || ch === ")") { tokens.push(ch); i++; continue; }
      if (ch >= "A" && ch <= "Z") {
        let sym = ch;
        i++;
        if (i < formula.length && formula[i] >= "a" && formula[i] <= "z") { sym += formula[i]; i++; }
        let count = "";
        while (i < formula.length && formula[i] >= "0" && formula[i] <= "9") { count += formula[i]; i++; }
        tokens.push({ sym, count: count ? Number(count) : 1 });
      } else if (ch >= "0" && ch <= "9") {
        let count = "";
        while (i < formula.length && formula[i] >= "0" && formula[i] <= "9") { count += formula[i]; i++; }
        tokens.push(Number(count));
      } else {
        i++;
      }
    }
    // Resolve parens with stack
    function resolve(arr) {
      const result = {};
      let j = 0;
      while (j < arr.length) {
        const t = arr[j];
        if (t === "(") {
          const sub = [];
          let depth = 1;
          j++;
          while (j < arr.length && depth > 0) {
            if (arr[j] === "(") depth++;
            else if (arr[j] === ")") { depth--; if (depth === 0) break; }
            sub.push(arr[j]);
            j++;
          }
          j++; // skip ')'
          let mult = 1;
          if (j < arr.length && typeof arr[j] === "number") { mult = arr[j]; j++; }
          const subResult = resolve(sub);
          for (const [k, v] of Object.entries(subResult)) {
            result[k] = (result[k] || 0) + v * mult;
          }
        } else if (typeof t === "object" && t.sym) {
          result[t.sym] = (result[t.sym] || 0) + t.count;
          j++;
        } else {
          j++;
        }
      }
      return result;
    }
    return resolve(tokens);
  }

  registerLensAction("chem", "molecular-weight", (_ctx, _artifact, params = {}) => {
    const formula = String(params.formula || "").trim();
    if (!formula) return { ok: false, error: "formula required (e.g. H2O, C6H12O6, Ca(OH)2)" };
    if (formula.length > 100) return { ok: false, error: "formula too long" };
    let counts;
    try {
      counts = parseFormulaMW(formula);
    } catch (_e) {
      return { ok: false, error: "could not parse formula" };
    }
    // No parseable element (e.g. "x", lone lowercase/garbage) → reject rather
    // than returning a zero-weight result that violates molecularWeight > 0.
    if (!counts || Object.keys(counts).length === 0) {
      return { ok: false, error: "no parseable element in formula" };
    }
    let mw = 0;
    const components = [];
    for (const [sym, n] of Object.entries(counts)) {
      const el = PERIODIC_TABLE[sym];
      if (!el) return { ok: false, error: `unknown element: ${sym}` };
      const contribution = el.mass * n;
      mw += contribution;
      components.push({
        element: sym, name: el.name,
        count: n, atomicMass: el.mass,
        contribution: Math.round(contribution * 1000) / 1000,
      });
    }
    if (!Number.isFinite(mw) || mw <= 0) {
      return { ok: false, error: "no parseable element in formula" };
    }
    // Percent composition
    for (const c of components) {
      c.percentMass = Math.round((c.contribution / mw) * 10000) / 100;
    }
    return {
      ok: true,
      result: {
        formula,
        molecularWeight: Math.round(mw * 1000) / 1000,
        units: "g/mol",
        components: components.sort((a, b) => b.contribution - a.contribution),
      },
    };
  });

  // ── Molarity / dilution / pH / gas law calculators ──

  registerLensAction("chem", "calc-molarity", (_ctx, _artifact, params = {}) => {
    const moles = params.moles != null ? Number(params.moles) : null;
    const liters = params.liters != null ? Number(params.liters) : null;
    const molarity = params.molarity != null ? Number(params.molarity) : null;
    const provided = [moles, liters, molarity].filter((v) => v != null && Number.isFinite(v)).length;
    if (provided !== 2) return { ok: false, error: "provide exactly 2 of: moles, liters, molarity" };
    let result;
    if (moles != null && liters != null) {
      if (liters === 0) return { ok: false, error: "liters cannot be 0" };
      result = { moles, liters, molarity: Math.round((moles / liters) * 10000) / 10000 };
    } else if (moles != null && molarity != null) {
      if (molarity === 0) return { ok: false, error: "molarity cannot be 0" };
      result = { moles, molarity, liters: Math.round((moles / molarity) * 10000) / 10000 };
    } else {
      result = { liters, molarity, moles: Math.round((liters * molarity) * 10000) / 10000 };
    }
    result.formula = "M = mol / L";
    return { ok: true, result };
  });

  registerLensAction("chem", "calc-dilution", (_ctx, _artifact, params = {}) => {
    const m1 = Number(params.m1);
    const v1 = Number(params.v1);
    const m2 = Number(params.m2);
    const v2 = Number(params.v2);
    const provided = [m1, v1, m2, v2].filter((v) => Number.isFinite(v)).length;
    if (provided !== 3) return { ok: false, error: "provide exactly 3 of: m1, v1, m2, v2" };
    let result;
    if (!Number.isFinite(m1)) {
      if (v1 === 0) return { ok: false, error: "v1 cannot be 0" };
      result = { m1: Math.round((m2 * v2 / v1) * 10000) / 10000, v1, m2, v2 };
    } else if (!Number.isFinite(v1)) {
      if (m1 === 0) return { ok: false, error: "m1 cannot be 0" };
      result = { m1, v1: Math.round((m2 * v2 / m1) * 10000) / 10000, m2, v2 };
    } else if (!Number.isFinite(m2)) {
      if (v2 === 0) return { ok: false, error: "v2 cannot be 0" };
      result = { m1, v1, m2: Math.round((m1 * v1 / v2) * 10000) / 10000, v2 };
    } else {
      if (m2 === 0) return { ok: false, error: "m2 cannot be 0" };
      result = { m1, v1, m2, v2: Math.round((m1 * v1 / m2) * 10000) / 10000 };
    }
    result.formula = "M1V1 = M2V2";
    return { ok: true, result };
  });

  registerLensAction("chem", "calc-ph", (_ctx, _artifact, params = {}) => {
    const concentration = Number(params.concentration);
    if (!Number.isFinite(concentration) || concentration <= 0) {
      return { ok: false, error: "concentration must be > 0 (mol/L)" };
    }
    const kind = String(params.kind || "acid"); // 'acid' | 'base' | 'h_plus' | 'oh_minus'
    let pH, pOH, hPlus, ohMinus;
    if (kind === "acid" || kind === "h_plus") {
      hPlus = concentration;
      ohMinus = 1e-14 / hPlus;
    } else if (kind === "base" || kind === "oh_minus") {
      ohMinus = concentration;
      hPlus = 1e-14 / ohMinus;
    } else {
      return { ok: false, error: "kind must be acid | base | h_plus | oh_minus" };
    }
    pH = -Math.log10(hPlus);
    pOH = -Math.log10(ohMinus);
    return {
      ok: true,
      result: {
        pH: Math.round(pH * 100) / 100,
        pOH: Math.round(pOH * 100) / 100,
        hPlus: hPlus,
        ohMinus: ohMinus,
        classification: pH < 7 ? "acidic" : pH > 7 ? "basic" : "neutral",
        formula: "pH = -log10([H+]) ; pH + pOH = 14",
      },
    };
  });

  registerLensAction("chem", "calc-gas-law", (_ctx, _artifact, params = {}) => {
    const R = 0.08206; // L·atm·K-1·mol-1
    const P = params.P != null ? Number(params.P) : null; // atm
    const V = params.V != null ? Number(params.V) : null; // L
    const n = params.n != null ? Number(params.n) : null; // mol
    const T = params.T != null ? Number(params.T) : null; // K
    const provided = [P, V, n, T].filter((v) => v != null && Number.isFinite(v)).length;
    if (provided !== 3) return { ok: false, error: "provide exactly 3 of: P (atm), V (L), n (mol), T (K)" };
    let result;
    if (P == null) result = { P: Math.round((n * R * T / V) * 10000) / 10000, V, n, T };
    else if (V == null) result = { P, V: Math.round((n * R * T / P) * 10000) / 10000, n, T };
    else if (n == null) result = { P, V, n: Math.round((P * V / (R * T)) * 10000) / 10000, T };
    else result = { P, V, n, T: Math.round((P * V / (n * R)) * 10000) / 10000 };
    result.formula = "PV = nRT (R = 0.08206 L·atm·K⁻¹·mol⁻¹)";
    return { ok: true, result };
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2026 parity backlog — structure editing, SMILES, stoichiometry,
  // spectroscopy, mechanism diagrams, lab notebook.
  // ═══════════════════════════════════════════════════════════════════

  // ── SMILES tokenizer + formula derivation ──
  // Supports a practical subset of SMILES: atoms (organic subset +
  // bracketed atoms), bonds (- = # :), branches ( ), rings (digits),
  // and implicit-hydrogen valence filling for the organic subset.
  const ORGANIC_SUBSET = { B: 3, C: 4, N: 3, O: 2, P: 3, S: 2, F: 1, Cl: 1, Br: 1, I: 1 };
  const AROMATIC = { b: "B", c: "C", n: "N", o: "O", p: "P", s: "S" };

  function tokenizeSmiles(smiles) {
    const tokens = [];
    let i = 0;
    while (i < smiles.length) {
      const ch = smiles[i];
      if (ch === "(" || ch === ")") { tokens.push({ t: "branch", v: ch }); i++; continue; }
      if (ch === "-" || ch === "=" || ch === "#" || ch === ":" || ch === "/" || ch === "\\") {
        tokens.push({ t: "bond", v: ch }); i++; continue;
      }
      if (ch >= "0" && ch <= "9") { tokens.push({ t: "ring", v: Number(ch) }); i++; continue; }
      if (ch === "%") {
        const num = smiles.slice(i + 1, i + 3);
        tokens.push({ t: "ring", v: Number(num) }); i += 3; continue;
      }
      if (ch === "[") {
        const close = smiles.indexOf("]", i);
        if (close === -1) throw new Error("unbalanced bracket atom");
        const inner = smiles.slice(i + 1, close);
        const m = inner.match(/^(\d*)([A-Z][a-z]?|[a-z])((?:H\d*)?)((?:[+-]\d*)*)$/);
        if (!m) throw new Error(`bad bracket atom [${inner}]`);
        const sym = m[2][0] >= "a" ? (AROMATIC[m[2]] || m[2].toUpperCase()) : m[2];
        let hCount = 0;
        if (m[3]) hCount = m[3] === "H" ? 1 : Number(m[3].slice(1));
        tokens.push({ t: "atom", v: sym, aromatic: m[2][0] >= "a", explicitH: hCount, bracketed: true });
        i = close + 1; continue;
      }
      // organic-subset atom
      let sym = null, aromatic = false;
      if (ch === "C" && smiles[i + 1] === "l") { sym = "Cl"; i += 2; }
      else if (ch === "B" && smiles[i + 1] === "r") { sym = "Br"; i += 2; }
      else if (/[A-Z]/.test(ch)) { sym = ch; i++; }
      else if (AROMATIC[ch]) { sym = AROMATIC[ch]; aromatic = true; i++; }
      else { i++; continue; }
      tokens.push({ t: "atom", v: sym, aromatic, bracketed: false });
    }
    return tokens;
  }

  function smilesToGraph(smiles) {
    const tokens = tokenizeSmiles(smiles);
    const atoms = [];           // { sym, aromatic, bracketed, explicitH, bonds:[] }
    const bonds = [];           // { a, b, order }
    const branchStack = [];
    const ringMap = {};         // ringNum -> { atomIdx, order }
    let prev = -1;
    let pendingBond = 1;        // bond order for next connection
    for (const tok of tokens) {
      if (tok.t === "atom") {
        const idx = atoms.length;
        atoms.push({
          sym: tok.v, aromatic: tok.aromatic, bracketed: tok.bracketed,
          explicitH: tok.explicitH || 0, bonds: [],
        });
        if (prev !== -1) {
          const order = pendingBond;
          bonds.push({ a: prev, b: idx, order });
          atoms[prev].bonds.push({ to: idx, order });
          atoms[idx].bonds.push({ to: prev, order });
        }
        prev = idx;
        pendingBond = 1;
      } else if (tok.t === "bond") {
        pendingBond = tok.v === "=" ? 2 : tok.v === "#" ? 3 : tok.v === ":" ? 1.5 : 1;
      } else if (tok.t === "branch") {
        if (tok.v === "(") branchStack.push(prev);
        else prev = branchStack.pop();
      } else if (tok.t === "ring") {
        if (ringMap[tok.v]) {
          const { atomIdx, order } = ringMap[tok.v];
          const o = Math.max(order, pendingBond);
          bonds.push({ a: atomIdx, b: prev, order: o, ring: true });
          atoms[atomIdx].bonds.push({ to: prev, order: o });
          atoms[prev].bonds.push({ to: atomIdx, order: o });
          delete ringMap[tok.v];
        } else {
          ringMap[tok.v] = { atomIdx: prev, order: pendingBond };
        }
        pendingBond = 1;
      }
    }
    if (Object.keys(ringMap).length) throw new Error("unclosed ring bond");
    return { atoms, bonds };
  }

  function graphToFormula(graph) {
    const counts = {};
    let rings = 0;
    let bondSum = 0;
    for (const b of graph.bonds) {
      bondSum += (b.aromatic || b.order === 1.5) ? 1.5 : b.order;
    }
    for (const a of graph.atoms) {
      counts[a.sym] = (counts[a.sym] || 0) + 1;
      // implicit hydrogens for organic-subset, non-bracket atoms
      if (!a.bracketed && ORGANIC_SUBSET[a.sym] != null) {
        // Bonds between two aromatic atoms count as order 1.5 (delocalised
        // ring bond) even when written without an explicit ':' — otherwise
        // benzene (c1ccccc1) over-fills hydrogens to C6H12.
        const used = a.bonds.reduce((s, bd) => {
          const neighbour = graph.atoms[bd.to];
          const aromaticBond = a.aromatic && neighbour && neighbour.aromatic && bd.order === 1;
          const ord = aromaticBond ? 1.5 : bd.order;
          return s + (ord === 1.5 ? 1.5 : ord);
        }, 0);
        // organic-subset valence applies to both aliphatic and aromatic atoms
        const target = ORGANIC_SUBSET[a.sym];
        const h = Math.max(0, Math.round(target - used));
        if (h > 0) counts.H = (counts.H || 0) + h;
      } else if (a.bracketed && a.explicitH) {
        counts.H = (counts.H || 0) + a.explicitH;
      }
    }
    // ring count = bonds - atoms + connected-components (assume 1 component)
    rings = Math.max(0, graph.bonds.length - graph.atoms.length + 1);
    return { counts, rings, bondSum };
  }

  function formatHill(counts) {
    // Hill system: C first, H second, then alphabetical
    const keys = Object.keys(counts).sort();
    const ordered = [];
    if (counts.C) { ordered.push("C"); if (counts.H) ordered.push("H"); }
    for (const k of keys) { if (k !== "C" && k !== "H") ordered.push(k); }
    if (!counts.C && counts.H) ordered.push("H");
    return ordered.map((k) => (counts[k] === 1 ? k : `${k}${counts[k]}`)).join("");
  }

  /**
   * parse-smiles — parse a SMILES string into an atom/bond graph, derive
   * the molecular formula (Hill notation), ring count, heavy-atom count.
   */
  registerLensAction("chem", "parse-smiles", (_ctx, _artifact, params = {}) => {
    const smiles = String(params.smiles || "").trim();
    if (!smiles) return { ok: false, error: "smiles required (e.g. CCO, c1ccccc1, CC(=O)O)" };
    if (smiles.length > 400) return { ok: false, error: "smiles too long (max 400)" };
    let graph;
    try {
      graph = smilesToGraph(smiles);
    } catch (e) {
      return { ok: false, error: `could not parse SMILES: ${e.message}` };
    }
    if (graph.atoms.length === 0) return { ok: false, error: "no atoms found in SMILES" };
    const { counts, rings } = graphToFormula(graph);
    const formula = formatHill(counts);
    // molecular weight from PERIODIC_TABLE
    let mw = 0;
    let unknown = null;
    for (const [sym, n] of Object.entries(counts)) {
      const el = PERIODIC_TABLE[sym];
      if (!el) { unknown = sym; break; }
      mw += el.mass * n;
    }
    return {
      ok: true,
      result: {
        smiles,
        formula,
        molecularWeight: unknown ? null : Math.round(mw * 1000) / 1000,
        unknownElement: unknown,
        heavyAtomCount: graph.atoms.length,
        ringCount: rings,
        bondCount: graph.bonds.length,
        aromatic: graph.atoms.some((a) => a.aromatic),
        atoms: graph.atoms.map((a, i) => ({ index: i, element: a.sym, aromatic: a.aromatic })),
        bonds: graph.bonds.map((b) => ({ from: b.a, to: b.b, order: b.order })),
      },
    };
  });

  // ── 2D structure layout — force-directed coordinate assignment ──
  // Produces drawable (x,y) coordinates from a SMILES graph so the
  // frontend editor / viewer can render a real skeletal structure.
  function layout2D(graph) {
    const n = graph.atoms.length;
    const pos = graph.atoms.map((_, i) => {
      const ang = (i / Math.max(1, n)) * Math.PI * 2;
      return { x: Math.cos(ang) * 60, y: Math.sin(ang) * 60 };
    });
    // adjacency
    const adj = graph.atoms.map(() => []);
    for (const b of graph.bonds) { adj[b.a].push(b.b); adj[b.b].push(b.a); }
    // BFS tree layout from atom 0 along bond directions at 120° angles
    const visited = new Array(n).fill(false);
    const BOND_LEN = 50;
    const queue = [{ idx: 0, x: 0, y: 0, dir: 0 }];
    visited[0] = true;
    pos[0] = { x: 0, y: 0 };
    while (queue.length) {
      const { idx, x, y, dir } = queue.shift();
      let childDir = dir + Math.PI;
      const children = adj[idx].filter((c) => !visited[c]);
      const spread = Math.PI / 1.5;
      children.forEach((c, k) => {
        const a = childDir + (k - (children.length - 1) / 2) * (spread / Math.max(1, children.length));
        const nx = x + Math.cos(a) * BOND_LEN;
        const ny = y + Math.sin(a) * BOND_LEN;
        pos[c] = { x: nx, y: ny };
        visited[c] = true;
        queue.push({ idx: c, x: nx, y: ny, dir: a });
      });
    }
    // light spring relaxation to de-overlap ring closures
    for (let iter = 0; iter < 60; iter++) {
      const force = pos.map(() => ({ x: 0, y: 0 }));
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const dx = pos[i].x - pos[j].x, dy = pos[i].y - pos[j].y;
          const d2 = dx * dx + dy * dy || 0.01;
          const rep = 1200 / d2;
          force[i].x += dx * rep; force[i].y += dy * rep;
          force[j].x -= dx * rep; force[j].y -= dy * rep;
        }
      }
      for (const b of graph.bonds) {
        const dx = pos[b.b].x - pos[b.a].x, dy = pos[b.b].y - pos[b.a].y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const k = (d - BOND_LEN) * 0.08;
        force[b.a].x += dx / d * k; force[b.a].y += dy / d * k;
        force[b.b].x -= dx / d * k; force[b.b].y -= dy / d * k;
      }
      for (let i = 1; i < n; i++) {
        pos[i].x += Math.max(-8, Math.min(8, force[i].x));
        pos[i].y += Math.max(-8, Math.min(8, force[i].y));
      }
    }
    return pos.map((p) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 }));
  }

  /**
   * structure-layout — convert a SMILES string into 2D drawable atom
   * coordinates + bond list for the structure editor / viewer.
   */
  registerLensAction("chem", "structure-layout", (_ctx, _artifact, params = {}) => {
    const smiles = String(params.smiles || "").trim();
    if (!smiles) return { ok: false, error: "smiles required" };
    if (smiles.length > 400) return { ok: false, error: "smiles too long" };
    let graph;
    try {
      graph = smilesToGraph(smiles);
    } catch (e) {
      return { ok: false, error: `could not parse SMILES: ${e.message}` };
    }
    if (graph.atoms.length === 0) return { ok: false, error: "no atoms in SMILES" };
    const coords = layout2D(graph);
    const { counts } = graphToFormula(graph);
    return {
      ok: true,
      result: {
        smiles,
        formula: formatHill(counts),
        atoms: graph.atoms.map((a, i) => ({
          index: i, element: a.sym, aromatic: a.aromatic,
          x: coords[i].x, y: coords[i].y,
        })),
        bonds: graph.bonds.map((b) => ({ from: b.a, to: b.b, order: b.order, ring: !!b.ring })),
      },
    };
  });

  /**
   * save-structure — persist a user-drawn / parsed structure to per-user
   * state. Accepts a SMILES string and an optional name; stores the
   * derived graph so it can be re-opened in the editor.
   */
  registerLensAction("chem", "save-structure", (ctx, _artifact, params = {}) => {
    const userId = chemActor(ctx);
    const smiles = String(params.smiles || "").trim();
    const name = String(params.name || "").trim() || "Untitled structure";
    if (!smiles) return { ok: false, error: "smiles required" };
    let graph;
    try { graph = smilesToGraph(smiles); }
    catch (e) { return { ok: false, error: `invalid SMILES: ${e.message}` }; }
    const { counts } = graphToFormula(graph);
    const s = chemState();
    if (!s.chemStructures.has(userId)) s.chemStructures.set(userId, new Map());
    const map = s.chemStructures.get(userId);
    const id = chemId("struct");
    const record = {
      id, name, smiles, formula: formatHill(counts),
      heavyAtomCount: graph.atoms.length,
      createdAt: new Date().toISOString(),
    };
    map.set(id, record);
    return { ok: true, result: record };
  });

  /**
   * list-structures — return all structures saved by the user.
   */
  registerLensAction("chem", "list-structures", (ctx) => {
    const userId = chemActor(ctx);
    const s = chemState();
    const map = s.chemStructures.get(userId);
    const structures = map ? [...map.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [];
    return { ok: true, result: { structures, count: structures.length } };
  });

  /**
   * delete-structure — remove a saved structure by id.
   */
  registerLensAction("chem", "delete-structure", (ctx, _artifact, params = {}) => {
    const userId = chemActor(ctx);
    const id = String(params.id || "").trim();
    if (!id) return { ok: false, error: "id required" };
    const s = chemState();
    const map = s.chemStructures.get(userId);
    if (!map || !map.has(id)) return { ok: false, error: "structure not found" };
    map.delete(id);
    return { ok: true, result: { deleted: id } };
  });

  /**
   * resolve-structure — given a compound name or SMILES, look up the
   * canonical structure from PubChem (free PUG-REST API): canonical
   * SMILES, InChI, InChIKey, IUPAC name, molecular formula, CID.
   */
  registerLensAction("chem", "resolve-structure", async (_ctx, _artifact, params = {}) => {
    const query = String(params.query || params.name || "").trim();
    if (!query) return { ok: false, error: "query required (compound name or SMILES)" };
    if (query.length > 200) return { ok: false, error: "query too long" };
    const ns = params.bySmiles ? "smiles" : "name";
    const props = "MolecularFormula,MolecularWeight,CanonicalSMILES,IsomericSMILES,InChI,InChIKey,IUPACName";
    const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/${ns}/${encodeURIComponent(query)}/property/${props}/JSON`;
    try {
      const json = await cachedFetchJson(url, { ttlMs: 24 * 60 * 60 * 1000 });
      const row = json?.PropertyTable?.Properties?.[0];
      if (!row) return { ok: false, error: `no PubChem match for "${query}"` };
      return {
        ok: true,
        result: {
          query,
          cid: row.CID,
          iupacName: row.IUPACName || null,
          molecularFormula: row.MolecularFormula || null,
          molecularWeight: row.MolecularWeight ? Number(row.MolecularWeight) : null,
          canonicalSmiles: row.CanonicalSMILES || null,
          isomericSmiles: row.IsomericSMILES || null,
          inchi: row.InChI || null,
          inchiKey: row.InChIKey || null,
          structureImage: row.CID
            ? `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${row.CID}/PNG`
            : null,
          conformerUrl: row.CID
            ? `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${row.CID}/record/SDF?record_type=3d`
            : null,
        },
      };
    } catch (e) {
      return { ok: false, error: `PubChem lookup failed: ${e.message}` };
    }
  });

  /**
   * conformer-3d — fetch the 3D conformer (atom coords + bonds) for a
   * PubChem compound by CID. Parses the free SDF/JSON 3D record into a
   * coordinate list the 3D viewer can render.
   */
  registerLensAction("chem", "conformer-3d", async (_ctx, _artifact, params = {}) => {
    const cid = Number(params.cid);
    if (!Number.isInteger(cid) || cid <= 0) return { ok: false, error: "valid integer cid required" };
    const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/record/JSON?record_type=3d`;
    try {
      const json = await cachedFetchJson(url, { ttlMs: 24 * 60 * 60 * 1000 });
      const compound = json?.PC_Compounds?.[0];
      if (!compound) return { ok: false, error: `no 3D conformer for CID ${cid}` };
      const elementIds = compound.atoms?.element || [];
      const conf = compound.coords?.[0]?.conformers?.[0];
      const xs = conf?.x || [], ys = conf?.y || [], zs = conf?.z || [];
      // PubChem atomic-number → symbol
      const Z_TO_SYM = {};
      for (const [sym, el] of Object.entries(PERIODIC_TABLE)) Z_TO_SYM[el.z] = sym;
      const atoms = elementIds.map((z, i) => ({
        element: Z_TO_SYM[z] || `#${z}`,
        x: xs[i] ?? 0, y: ys[i] ?? 0, z: zs[i] ?? 0,
      }));
      const bondA = compound.bonds?.aid1 || [];
      const bondB = compound.bonds?.aid2 || [];
      const bondOrder = compound.bonds?.order || [];
      const bonds = bondA.map((a, i) => ({ from: a - 1, to: bondB[i] - 1, order: bondOrder[i] || 1 }));
      return {
        ok: true,
        result: { cid, atomCount: atoms.length, atoms, bonds },
      };
    } catch (e) {
      return { ok: false, error: `conformer fetch failed: ${e.message}` };
    }
  });

  /**
   * stoichiometry — given a balanced equation and the amounts (in grams
   * or moles) of one or more reactants, compute the limiting reagent,
   * theoretical yield of every product, and percent yield if an actual
   * yield is supplied.
   *
   * params.equation = "2H2 + O2 -> 2H2O"  (must already be balanced OR
   *   pass balance:true to balance it first)
   * params.amounts = { "H2": { grams: 4 }, "O2": { grams: 40 } }
   * params.actualYield = { compound: "H2O", grams: 30 }  (optional)
   */
  registerLensAction("chem", "stoichiometry", (_ctx, _artifact, params = {}) => {
    const equation = String(params.equation || "").trim();
    if (!equation) return { ok: false, error: "equation required (e.g. 2H2 + O2 -> 2H2O)" };
    const sides = equation.split(/->|→|=/).map((s) => s.trim());
    if (sides.length !== 2) return { ok: false, error: "equation must have one arrow (->)" };

    // parse "2H2" → { coeff, formula }
    function parseTerm(term) {
      const m = term.trim().match(/^(\d*)\s*(.+)$/);
      return { coeff: m[1] ? Number(m[1]) : 1, formula: m[2].trim() };
    }
    const reactants = sides[0].split("+").map((s) => parseTerm(s)).filter((t) => t.formula);
    const products = sides[1].split("+").map((s) => parseTerm(s)).filter((t) => t.formula);
    if (!reactants.length || !products.length) {
      return { ok: false, error: "need at least one reactant and one product" };
    }

    function mwOf(formula) {
      let counts;
      try { counts = parseFormulaMW(formula); }
      catch { return null; }
      let mw = 0;
      for (const [sym, n] of Object.entries(counts)) {
        const el = PERIODIC_TABLE[sym];
        if (!el) return null;
        mw += el.mass * n;
      }
      return mw;
    }

    const amounts = params.amounts || {};
    const r = (v) => Math.round(v * 10000) / 10000;

    // moles of each supplied reactant
    const supplied = [];
    for (const rt of reactants) {
      const a = amounts[rt.formula];
      if (!a) continue;
      const mw = mwOf(rt.formula);
      if (mw == null) return { ok: false, error: `cannot compute MW of ${rt.formula}` };
      let moles;
      if (a.moles != null) moles = Number(a.moles);
      else if (a.grams != null) moles = Number(a.grams) / mw;
      else continue;
      if (!Number.isFinite(moles) || moles < 0) {
        return { ok: false, error: `bad amount for ${rt.formula}` };
      }
      supplied.push({ formula: rt.formula, coeff: rt.coeff, mw: r(mw), moles, grams: a.grams != null ? Number(a.grams) : r(moles * mw) });
    }
    if (supplied.length === 0) {
      return { ok: false, error: "provide amounts (grams or moles) for at least one reactant" };
    }

    // limiting reagent = min(moles / coeff)
    let limiting = null;
    for (const s of supplied) {
      const ratio = s.moles / s.coeff;
      s.reactionRatio = r(ratio);
      if (limiting == null || ratio < limiting.reactionRatio) limiting = s;
    }
    const extent = limiting.moles / limiting.coeff; // mol of "reaction"

    // theoretical yield of every product
    const productYields = products.map((p) => {
      const mw = mwOf(p.formula);
      const moles = extent * p.coeff;
      return {
        formula: p.formula,
        coefficient: p.coeff,
        molarMass: mw == null ? null : r(mw),
        molesProduced: r(moles),
        gramsProduced: mw == null ? null : r(moles * mw),
      };
    });

    // leftover reactants
    const leftovers = supplied
      .filter((s) => s.formula !== limiting.formula)
      .map((s) => {
        const consumed = extent * s.coeff;
        const remainingMol = s.moles - consumed;
        return {
          formula: s.formula,
          remainingMoles: r(Math.max(0, remainingMol)),
          remainingGrams: r(Math.max(0, remainingMol) * s.mw),
        };
      });

    // percent yield
    let percentYield = null;
    if (params.actualYield && params.actualYield.compound) {
      const py = productYields.find((p) => p.formula === params.actualYield.compound);
      if (py) {
        let actualMol;
        if (params.actualYield.moles != null) actualMol = Number(params.actualYield.moles);
        else if (params.actualYield.grams != null && py.molarMass) actualMol = Number(params.actualYield.grams) / py.molarMass;
        if (actualMol != null && py.molesProduced > 0) {
          percentYield = {
            compound: params.actualYield.compound,
            theoreticalMoles: py.molesProduced,
            actualMoles: r(actualMol),
            percent: r((actualMol / py.molesProduced) * 100),
          };
        }
      }
    }

    return {
      ok: true,
      result: {
        equation,
        limitingReagent: limiting.formula,
        reactionExtent: r(extent),
        suppliedReactants: supplied.map((s) => ({
          formula: s.formula, moles: r(s.moles), grams: r(s.grams),
          molarMass: s.mw, coefficient: s.coeff,
        })),
        products: productYields,
        leftoverReactants: leftovers,
        percentYield,
      },
    };
  });

  /**
   * spectroscopy-reference — return a characteristic peak table for a
   * spectroscopy technique (IR / NMR-1H / NMR-13C / MS). Optionally
   * filtered by functional group. Values are standard reference ranges.
   */
  const SPECTRO_TABLES = {
    ir: {
      technique: "Infrared (IR)", unit: "cm⁻¹",
      peaks: [
        { group: "O–H (alcohol)", range: "3200–3550", intensity: "strong, broad", note: "Hydrogen-bonded; sharper if free" },
        { group: "O–H (carboxylic acid)", range: "2500–3300", intensity: "strong, very broad", note: "Overlaps C–H" },
        { group: "N–H (amine/amide)", range: "3300–3500", intensity: "medium", note: "1° amine shows two bands" },
        { group: "C–H (sp³)", range: "2850–2960", intensity: "medium", note: "Alkyl stretch" },
        { group: "C–H (sp², aromatic)", range: "3000–3100", intensity: "medium", note: "Just above 3000" },
        { group: "C≡C / C≡N", range: "2100–2260", intensity: "medium", note: "Triple-bond stretch" },
        { group: "C=O (carbonyl)", range: "1670–1780", intensity: "strong", note: "Ketone ~1715, ester ~1740, acid ~1710" },
        { group: "C=C (alkene)", range: "1620–1680", intensity: "medium", note: "Conjugation lowers frequency" },
        { group: "Aromatic C=C", range: "1450–1600", intensity: "medium", note: "Ring breathing modes" },
        { group: "C–O (ester/ether)", range: "1000–1300", intensity: "strong", note: "Often two bands for esters" },
        { group: "C–N", range: "1020–1250", intensity: "medium", note: "Amine fingerprint region" },
      ],
    },
    "nmr-1h": {
      technique: "¹H NMR", unit: "ppm",
      peaks: [
        { group: "TMS reference", range: "0.0", intensity: "—", note: "Calibration standard" },
        { group: "Alkyl C–H (R–CH₃)", range: "0.8–1.2", intensity: "—", note: "Most shielded" },
        { group: "Alkyl C–H (R–CH₂–R)", range: "1.2–1.5", intensity: "—", note: "Methylene" },
        { group: "Allylic / α-to-C=O", range: "2.0–2.6", intensity: "—", note: "Deshielded by adjacent π/C=O" },
        { group: "C–H next to O/N", range: "3.3–4.0", intensity: "—", note: "Ethers, amines" },
        { group: "Vinyl C–H (alkene)", range: "4.6–6.0", intensity: "—", note: "sp² hydrogens" },
        { group: "Aromatic C–H", range: "6.5–8.0", intensity: "—", note: "Ring current deshielding" },
        { group: "Aldehyde C–H", range: "9.0–10.0", intensity: "—", note: "Highly deshielded" },
        { group: "Carboxylic acid O–H", range: "10.0–13.0", intensity: "broad", note: "Exchangeable" },
      ],
    },
    "nmr-13c": {
      technique: "¹³C NMR", unit: "ppm",
      peaks: [
        { group: "Alkyl C (sp³)", range: "0–50", intensity: "—", note: "Saturated carbons" },
        { group: "C–O / C–N (sp³)", range: "50–90", intensity: "—", note: "Alcohols, ethers, amines" },
        { group: "Alkyne C", range: "65–90", intensity: "—", note: "sp carbons" },
        { group: "Alkene / aromatic C", range: "100–150", intensity: "—", note: "sp² carbons" },
        { group: "Nitrile C≡N", range: "115–120", intensity: "—", note: "" },
        { group: "Ester / acid / amide C=O", range: "160–185", intensity: "—", note: "Carbonyl carbons" },
        { group: "Ketone / aldehyde C=O", range: "190–220", intensity: "—", note: "Most deshielded" },
      ],
    },
    ms: {
      technique: "Mass Spectrometry", unit: "m/z loss",
      peaks: [
        { group: "Loss of 15", range: "M–15", intensity: "—", note: "Loss of •CH₃" },
        { group: "Loss of 17", range: "M–17", intensity: "—", note: "Loss of •OH" },
        { group: "Loss of 18", range: "M–18", intensity: "—", note: "Loss of H₂O" },
        { group: "Loss of 28", range: "M–28", intensity: "—", note: "Loss of CO or C₂H₄" },
        { group: "Loss of 29", range: "M–29", intensity: "—", note: "Loss of CHO or C₂H₅" },
        { group: "Loss of 31", range: "M–31", intensity: "—", note: "Loss of •OCH₃" },
        { group: "Loss of 45", range: "M–45", intensity: "—", note: "Loss of •COOH / •OEt" },
        { group: "m/z 77", range: "77", intensity: "—", note: "Phenyl cation C₆H₅⁺" },
        { group: "m/z 43", range: "43", intensity: "—", note: "Acylium CH₃CO⁺ / C₃H₇⁺" },
        { group: "M+1 isotope", range: "M+1", intensity: "~1.1%/C", note: "¹³C abundance" },
      ],
    },
  };

  registerLensAction("chem", "spectroscopy-reference", (_ctx, _artifact, params = {}) => {
    const technique = String(params.technique || "ir").toLowerCase().trim();
    const table = SPECTRO_TABLES[technique];
    if (!table) {
      return { ok: false, error: `unknown technique "${technique}". Use: ir, nmr-1h, nmr-13c, ms` };
    }
    const filter = String(params.group || "").toLowerCase().trim();
    let peaks = table.peaks;
    if (filter) {
      peaks = peaks.filter((p) => p.group.toLowerCase().includes(filter) || p.note.toLowerCase().includes(filter));
    }
    return {
      ok: true,
      result: {
        technique: table.technique,
        unit: table.unit,
        peaks,
        peakCount: peaks.length,
        availableTechniques: Object.keys(SPECTRO_TABLES),
      },
    };
  });

  /**
   * reaction-mechanism — produce an electron-pushing / mechanism step
   * outline for a named reaction type. Each step lists the bond changes
   * and curved-arrow descriptions used to render a mechanism diagram.
   */
  const MECHANISMS = {
    sn2: {
      name: "SN2 (bimolecular nucleophilic substitution)",
      summary: "Concerted backside attack — one step, inversion of configuration.",
      steps: [
        { step: 1, title: "Backside attack", arrows: ["Nucleophile lone pair → C–LG carbon"], bondChanges: ["Form Nu–C", "Break C–LG"], description: "Nucleophile attacks 180° opposite the leaving group; transition state is trigonal bipyramidal." },
        { step: 2, title: "Product", arrows: [], bondChanges: [], description: "Inverted stereocenter; leaving group departs with the bonding pair." },
      ],
      kinetics: "rate = k[substrate][nucleophile] — 2nd order",
    },
    sn1: {
      name: "SN1 (unimolecular nucleophilic substitution)",
      summary: "Two-step via carbocation — racemization at the stereocenter.",
      steps: [
        { step: 1, title: "Ionization", arrows: ["C–LG bond pair → leaving group"], bondChanges: ["Break C–LG"], description: "Rate-determining loss of leaving group forms a planar carbocation." },
        { step: 2, title: "Nucleophilic capture", arrows: ["Nucleophile lone pair → carbocation"], bondChanges: ["Form Nu–C"], description: "Nucleophile attacks either face of the planar cation → racemic mixture." },
        { step: 3, title: "Deprotonation (if Nu is neutral)", arrows: ["Solvent base lone pair → O–H/N–H"], bondChanges: ["Break Nu–H"], description: "Restores neutral product when the nucleophile was protic." },
      ],
      kinetics: "rate = k[substrate] — 1st order",
    },
    e2: {
      name: "E2 (bimolecular elimination)",
      summary: "Concerted anti-periplanar elimination — one step.",
      steps: [
        { step: 1, title: "Concerted elimination", arrows: ["Base lone pair → β-H", "β C–H bond pair → forming C=C", "α C–LG bond pair → leaving group"], bondChanges: ["Break β C–H", "Form C=C π", "Break C–LG"], description: "Base removes β-hydrogen anti-periplanar to the leaving group as the π bond forms." },
      ],
      kinetics: "rate = k[substrate][base] — 2nd order",
    },
    e1: {
      name: "E1 (unimolecular elimination)",
      summary: "Two-step via carbocation — same intermediate as SN1.",
      steps: [
        { step: 1, title: "Ionization", arrows: ["C–LG bond pair → leaving group"], bondChanges: ["Break C–LG"], description: "Rate-determining carbocation formation." },
        { step: 2, title: "β-Hydrogen loss", arrows: ["β C–H bond pair → forming C=C"], bondChanges: ["Break β C–H", "Form C=C π"], description: "Weak base removes a β-hydrogen, giving the more substituted (Zaitsev) alkene." },
      ],
      kinetics: "rate = k[substrate] — 1st order",
    },
    esterification: {
      name: "Fischer esterification",
      summary: "Acid-catalyzed condensation of a carboxylic acid + alcohol → ester.",
      steps: [
        { step: 1, title: "Carbonyl protonation", arrows: ["Acid H⁺ → carbonyl O lone pair"], bondChanges: ["Form O–H⁺"], description: "Protonation activates the carbonyl toward nucleophilic attack." },
        { step: 2, title: "Alcohol attack", arrows: ["Alcohol O lone pair → carbonyl C"], bondChanges: ["Form C–O", "Break C=O π"], description: "Tetrahedral intermediate forms." },
        { step: 3, title: "Proton transfer + water loss", arrows: ["O–H pair → leaving water"], bondChanges: ["Break C–OH₂⁺"], description: "Proton shuffling converts an OH into a good leaving group (water)." },
        { step: 4, title: "Deprotonation", arrows: ["Water lone pair → O–H⁺"], bondChanges: ["Break O–H⁺"], description: "Regenerates the acid catalyst and gives the neutral ester." },
      ],
      kinetics: "equilibrium — driven by excess reagent or water removal",
    },
    "acid-base": {
      name: "Brønsted acid–base proton transfer",
      summary: "Single concerted proton transfer from acid to base.",
      steps: [
        { step: 1, title: "Proton transfer", arrows: ["Base lone pair → acidic H", "H–A bond pair → A⁻"], bondChanges: ["Form B–H", "Break H–A"], description: "Equilibrium position set by relative pKa — proton moves to the stronger base." },
      ],
      kinetics: "fast, diffusion-limited equilibrium",
    },
  };

  registerLensAction("chem", "reaction-mechanism", (_ctx, _artifact, params = {}) => {
    const type = String(params.type || "").toLowerCase().trim();
    if (!type) {
      return {
        ok: true,
        result: { available: Object.keys(MECHANISMS).map((k) => ({ key: k, name: MECHANISMS[k].name })) },
      };
    }
    const mech = MECHANISMS[type];
    if (!mech) {
      return { ok: false, error: `unknown mechanism "${type}". Available: ${Object.keys(MECHANISMS).join(", ")}` };
    }
    return {
      ok: true,
      result: {
        type, name: mech.name, summary: mech.summary,
        kinetics: mech.kinetics, steps: mech.steps, stepCount: mech.steps.length,
      },
    };
  });

  /**
   * notebook-add — append a lab-notebook entry (reaction log). Stores
   * title, equation/procedure, observations, yield, and tags per user.
   */
  registerLensAction("chem", "notebook-add", (ctx, _artifact, params = {}) => {
    const userId = chemActor(ctx);
    const title = String(params.title || "").trim();
    if (!title) return { ok: false, error: "title required" };
    const s = chemState();
    if (!s.chemLabNotebook.has(userId)) s.chemLabNotebook.set(userId, []);
    const entries = s.chemLabNotebook.get(userId);
    const entry = {
      id: chemId("lab"),
      title,
      equation: String(params.equation || "").trim() || null,
      procedure: String(params.procedure || "").trim() || null,
      observations: String(params.observations || "").trim() || null,
      yieldPercent: params.yieldPercent != null && Number.isFinite(Number(params.yieldPercent))
        ? Number(params.yieldPercent) : null,
      tags: Array.isArray(params.tags) ? params.tags.map((t) => String(t)).slice(0, 12) : [],
      createdAt: new Date().toISOString(),
    };
    entries.unshift(entry);
    if (entries.length > 500) entries.length = 500;
    return { ok: true, result: entry };
  });

  /**
   * notebook-list — return the user's lab-notebook entries, optionally
   * filtered by a tag or free-text query.
   */
  registerLensAction("chem", "notebook-list", (ctx, _artifact, params = {}) => {
    const userId = chemActor(ctx);
    const s = chemState();
    let entries = s.chemLabNotebook.get(userId) || [];
    const tag = String(params.tag || "").toLowerCase().trim();
    const q = String(params.query || "").toLowerCase().trim();
    if (tag) entries = entries.filter((e) => e.tags.some((t) => t.toLowerCase() === tag));
    if (q) {
      entries = entries.filter((e) =>
        e.title.toLowerCase().includes(q) ||
        (e.observations && e.observations.toLowerCase().includes(q)) ||
        (e.equation && e.equation.toLowerCase().includes(q)));
    }
    return { ok: true, result: { entries, count: entries.length } };
  });

  /**
   * notebook-delete — remove a lab-notebook entry by id.
   */
  registerLensAction("chem", "notebook-delete", (ctx, _artifact, params = {}) => {
    const userId = chemActor(ctx);
    const id = String(params.id || "").trim();
    if (!id) return { ok: false, error: "id required" };
    const s = chemState();
    const entries = s.chemLabNotebook.get(userId);
    if (!entries) return { ok: false, error: "entry not found" };
    const idx = entries.findIndex((e) => e.id === id);
    if (idx === -1) return { ok: false, error: "entry not found" };
    entries.splice(idx, 1);
    return { ok: true, result: { deleted: id } };
  });
}
