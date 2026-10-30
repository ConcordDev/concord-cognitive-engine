// server/lib/chat/compute-si.js
//
// Chat run_compute adapter: SI in, SI out for the engineering functions whose
// compute-module signatures are imperial (physics.beamDeflection wants
// loadLbs/lengthFt, engineering.columnBuckling wants loadKips/lengthFt), plus a
// "did you mean" for unknown keys that carries each candidate's input schema,
// so the model can fix the call in one retry.
//
// Quantities may be a bare number (SI), a { value, unit } object, or a string
// such as "10 kN". Nothing here changes the imperial functions: a call that
// uses their own keys still reaches them untouched.

import { loadComputeModule, listComputeModules } from "../compute/index.js";

const UNITS = {
  force: { N: 1, kN: 1e3, MN: 1e6, lbf: 4.4482216152605, kip: 4448.2216152605, kips: 4448.2216152605 },
  length: { m: 1, mm: 1e-3, cm: 1e-2, km: 1e3, in: 0.0254, ft: 0.3048 },
  stress: { Pa: 1, kPa: 1e3, MPa: 1e6, GPa: 1e9, psi: 6894.757293168, ksi: 6894757.293168 },
  inertia: { m4: 1, cm4: 1e-8, mm4: 1e-12, in4: 0.0254 ** 4 },
  moment: { "N*m": 1, Nm: 1, "N·m": 1, "kN*m": 1e3, kNm: 1e3, "kN·m": 1e3, "lbf*ft": 1.3558179483314 },
  area: { m2: 1, cm2: 1e-4, mm2: 1e-6, in2: 0.0254 ** 2 },
};

/** A number, {value, unit} or "12 kN" -> SI number for the given dimension, or null. */
export function toSI(raw, dim) {
  const table = UNITS[dim];
  if (raw == null || !table) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  let value; let unit;
  if (typeof raw === "string") {
    const m = raw.trim().match(/^(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*([A-Za-z*·0-9^]+)?$/i);
    if (!m) return null;
    value = Number(m[1]); unit = m[2];
  } else if (typeof raw === "object") {
    value = Number(raw.value); unit = raw.unit;
  } else return null;
  if (!Number.isFinite(value)) return null;
  if (unit == null || unit === "") return value;
  const key = Object.keys(table).find((u) => u === unit || u.toLowerCase() === String(unit).toLowerCase());
  return key ? value * table[key] : null;
}

const pick = (input, names) => {
  for (const n of names) if (input[n] !== undefined) return input[n];
  return undefined;
};

const ALIASES = {
  load: ["loadN", "forceN", "load", "force", "P"],
  length: ["lengthM", "spanM", "length", "span", "L"],
  modulus: ["modulusPa", "youngsModulusPa", "modulus", "E"],
  inertia: ["momentOfInertiaM4", "momentI_m4", "I_m4", "momentOfInertia", "I"],
  moment: ["momentNm", "moment"],
  distance: ["distanceM", "distance", "c"],
  width: ["widthM", "width", "b"],
  height: ["heightM", "depthM", "height", "depth", "h"],
  area: ["areaM2", "area", "A"],
};
const IMPERIAL_KEYS = new Set(["loadLbs", "lengthFt", "loadKips", "momentI", "modulusE", "kFactor_"]);

function usesImperial(input) {
  return Object.keys(input).some((k) => IMPERIAL_KEYS.has(k));
}

function readAll(input, spec) {
  const out = {}; const bad = [];
  for (const [field, [alias, dim]] of Object.entries(spec)) {
    const raw = pick(input, ALIASES[alias]);
    if (raw === undefined) { out[field] = undefined; continue; }
    const v = toSI(raw, dim);
    if (v == null) bad.push(`${alias}=${JSON.stringify(raw)}`);
    out[field] = v;
  }
  return { out, bad };
}

const fail = (message, schema) => ({ error: message, system: "SI", inputSchema: schema });

const SCHEMAS = {
  "physics.beamDeflection": {
    SI: { required: ["loadN", "lengthM", "modulusPa", "momentOfInertiaM4"], optional: ["supportType: simple|cantilever|fixed (default simple)"], note: "central point load; values may be numbers (SI) or {value, unit} / \"10 kN\"; returns deflectionM and deflectionMm" },
    imperial: { required: ["loadLbs", "lengthFt", "modulusE", "momentI"], optional: ["supportType"], note: "psi, in^4; returns inches" },
  },
  "physics.bendingStress": {
    SI: { required: ["momentNm", "momentOfInertiaM4", "distanceM"], note: "sigma = M c / I; returns Pa and MPa" },
    imperial: { required: ["moment", "momentI", "distance"], note: "unit-agnostic: the result is in the stress unit of the inputs" },
  },
  "engineering.columnBuckling": {
    SI: { required: ["lengthM", "modulusPa", "momentOfInertiaM4 (or widthM + heightM for a rectangle: the weak axis is used)"], optional: ["loadN (gives the factor of safety)", "kFactor (1 pinned-pinned, 0.5 fixed-fixed, 0.7 fixed-pinned, 2 fixed-free)", "areaM2 (gives L/r)"], note: "Euler: Pcr = pi^2 E I / (K L)^2; returns Pcr in N and kN, slenderness L/r" },
    imperial: { required: ["lengthFt", "modulusE", "momentI"], optional: ["loadKips", "kFactor"], note: "psi, in^4, kips" },
  },
};

const ADAPTERS = {
  "physics.beamDeflection"(input) {
    const { out: q, bad } = readAll(input, { P: ["load", "force"], L: ["length", "length"], E: ["modulus", "stress"], I: ["inertia", "inertia"] });
    if (bad.length) return fail(`could not read a unit: ${bad.join(", ")}`, SCHEMAS["physics.beamDeflection"]);
    const missing = ["P", "L", "E", "I"].filter((k) => !(q[k] > 0));
    if (missing.length) return fail(`positive values required for: ${missing.map((k) => ({ P: "loadN", L: "lengthM", E: "modulusPa", I: "momentOfInertiaM4" })[k]).join(", ")}`, SCHEMAS["physics.beamDeflection"]);
    const support = input.supportType || "simple";
    const k = { simple: 48, cantilever: 3, fixed: 192 }[support];
    if (!k) return fail(`unknown supportType: ${support} (simple, cantilever, fixed)`, SCHEMAS["physics.beamDeflection"]);
    const delta = (q.P * q.L ** 3) / (k * q.E * q.I);
    return {
      value: delta, unit: "m", system: "SI", deflectionM: delta, deflectionMm: delta * 1000,
      formula: `delta = P L^3 / (${k} E I)`, supportType: support,
      inputs: { loadN: q.P, lengthM: q.L, modulusPa: q.E, momentOfInertiaM4: q.I },
    };
  },

  "physics.bendingStress"(input) {
    const { out: q, bad } = readAll(input, { M: ["moment", "moment"], I: ["inertia", "inertia"], c: ["distance", "length"] });
    if (bad.length) return fail(`could not read a unit: ${bad.join(", ")}`, SCHEMAS["physics.bendingStress"]);
    if (!Number.isFinite(q.M) || !(q.I > 0) || !Number.isFinite(q.c)) return fail("momentNm, momentOfInertiaM4 (> 0) and distanceM required", SCHEMAS["physics.bendingStress"]);
    const sigma = (q.M * q.c) / q.I;
    return {
      value: sigma, unit: "Pa", system: "SI", stressPa: sigma, stressMPa: sigma / 1e6,
      formula: "sigma = M c / I", inputs: { momentNm: q.M, momentOfInertiaM4: q.I, distanceM: q.c },
    };
  },

  "engineering.columnBuckling"(input) {
    const { out: q, bad } = readAll(input, {
      P: ["load", "force"], L: ["length", "length"], E: ["modulus", "stress"], I: ["inertia", "inertia"],
      b: ["width", "length"], h: ["height", "length"], A: ["area", "area"],
    });
    if (bad.length) return fail(`could not read a unit: ${bad.join(", ")}`, SCHEMAS["engineering.columnBuckling"]);
    const K = Number.isFinite(Number(input.kFactor)) && Number(input.kFactor) > 0 ? Number(input.kFactor) : 1;
    let { I, A } = q; let axis = null;
    if (!(I > 0) && q.b > 0 && q.h > 0) {
      // a rectangle buckles about its weak axis
      const lo = Math.min(q.b, q.h); const hi = Math.max(q.b, q.h);
      I = (hi * lo ** 3) / 12; A = q.b * q.h; axis = `weak axis (${lo} m thickness)`;
    }
    if (!(q.L > 0) || !(q.E > 0) || !(I > 0)) return fail("lengthM, modulusPa and momentOfInertiaM4 (or widthM + heightM) required, all positive", SCHEMAS["engineering.columnBuckling"]);
    const Le = K * q.L;
    const pcr = (Math.PI ** 2 * q.E * I) / (Le * Le);
    const result = {
      value: pcr, unit: "N", system: "SI", criticalLoadN: pcr, criticalLoadKN: pcr / 1e3,
      formula: "Pcr = pi^2 E I / (K L)^2", effectiveLengthM: Le, kFactor: K, momentOfInertiaM4: I,
      ...(axis ? { bucklingAxis: axis } : {}),
      factorOfSafety: q.P > 0 ? pcr / q.P : null,
      inputs: { loadN: q.P ?? null, lengthM: q.L, modulusPa: q.E },
    };
    if (A > 0) {
      const r = Math.sqrt(I / A);
      result.radiusOfGyrationM = r; result.slenderness = Le / r; result.areaM2 = A;
      result.slendernessNote = "L/r with the effective length";
    }
    if (result.factorOfSafety !== null && result.factorOfSafety < 1.67) result.warnings = ["below AISC recommended FS of 1.67"];
    return result;
  },
};

/** Run a compute function. SI input reaches the SI adapter; anything else the module itself. */
export function runChatCompute(key, mod, fnName, input) {
  const adapter = ADAPTERS[key];
  const obj = input && typeof input === "object" && !Array.isArray(input) ? input : null;
  if (adapter && obj && !usesImperial(obj)) {
    const known = new Set(Object.values(ALIASES).flat().concat("supportType", "kFactor"));
    if (Object.keys(obj).some((k) => known.has(k))) return adapter(obj);
  }
  const raw = mod[fnName](input);
  // the module's own failure: say what it needs, in both unit systems
  if (raw && typeof raw === "object" && raw.error && SCHEMAS[key]) return { ...raw, inputSchema: SCHEMAS[key] };
  return raw;
}

/** { required, optional } from a function's destructured parameter list. */
export function describeComputeFn(fn) {
  const src = Function.prototype.toString.call(fn);
  const m = src.match(/^[^(]*\(\s*\{([\s\S]*?)\}\s*(?:=\s*\{\}\s*)?\)/);
  if (!m) return null;
  const required = []; const optional = [];
  for (const part of m[1].split(",")) {
    const p = part.trim();
    if (!p) continue;
    const [name, def] = p.split("=").map((s) => s.trim());
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue;
    (def === undefined ? required : optional).push(def === undefined ? name : `${name} (default ${def})`);
  }
  return { required, optional };
}

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

const words = (s) => String(s).replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Closest real compute keys for a wrong one, each with its input schema. */
export async function closestComputeKeys(key, limit = 4) {
  const [modPart, fnPart = ""] = String(key || "").split(".");
  const wanted = words(`${modPart} ${fnPart}`);
  const rows = [];
  for (const m of listComputeModules()) {
    const modName = typeof m === "string" ? m : m.name;
    const mod = await loadComputeModule(modName);
    for (const fn of Object.keys(mod || {})) {
      if (typeof mod[fn] !== "function" || /^(?:parse|stringify|_)/.test(fn)) continue;
      const k = `${modName}.${fn}`;
      const have = words(k);
      const overlap = wanted.filter((w) => have.some((h) => h === w || h.startsWith(w) || w.startsWith(h))).length;
      const dist = editDistance(String(fnPart).toLowerCase(), fn.toLowerCase());
      const score = overlap * 3 + (modName === modPart ? 2 : 0) - dist / Math.max(fn.length, 1);
      rows.push({ key: k, score, mod, fn });
    }
  }
  rows.sort((a, b) => b.score - a.score);
  return rows.slice(0, limit).map((r) => ({
    key: r.key,
    inputSchema: SCHEMAS[r.key] || describeComputeFn(r.mod[r.fn]),
  }));
}
