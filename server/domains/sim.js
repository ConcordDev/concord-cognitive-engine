// server/domains/sim.js
//
// Simulation domain — AnyLogic / Vensim parity.
// The original four macros (scenarioRun, parameterSweep, monteCarlo,
// sensitivityAnalysis) are pure stateless compute. The eight macros added
// below implement the marquee simulation paradigms — system dynamics
// (stock-and-flow), agent-based modeling, discrete-event simulation — plus a
// safe formula evaluator, goal-seek optimization, calibration against
// historical data, and persistent per-user system-dynamics model storage.
//
// All handlers return { ok, result?, error? } and never throw.

// ─── Persistent per-user model store ─────────────────────────────────────────
// System-dynamics models authored in the visual builder persist here keyed by
// userId so the front-end builder can save / load / list them.
function getSimState() {
  const STATE = globalThis._concordSTATE;
  if (!STATE) return null;
  if (!STATE.simLens) {
    STATE.simLens = {
      models: new Map(),  // userId -> Map<modelId, sdModel>
      seq: new Map(),     // userId -> integer counter
    };
  }
  return STATE.simLens;
}

function userId(ctx) {
  return (ctx && (ctx.userId || (ctx.actor && ctx.actor.userId))) || "anon";
}

function nextId(state, uid, prefix) {
  const cur = (state.seq.get(uid) || 0) + 1;
  state.seq.set(uid, cur);
  return `${prefix}_${cur}_${Date.now().toString(36)}`;
}

// ─── Safe arithmetic expression evaluator ────────────────────────────────────
// Shunting-yard parser + RPN evaluator. Supports + - * / % ^, parentheses,
// unary minus, a function whitelist (min/max/abs/sqrt/exp/ln/sin/cos/floor/
// ceil/round/pow), numeric literals, and named variables resolved from `vars`.
// No `eval`, no `Function` — pure token machine. Throws on malformed input;
// callers wrap in try/catch.
const FUNCS1 = {
  abs: Math.abs, sqrt: Math.sqrt, exp: Math.exp, ln: Math.log,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, floor: Math.floor,
  ceil: Math.ceil, round: Math.round, sign: Math.sign, log10: Math.log10,
};
const FUNCS2 = {
  min: Math.min, max: Math.max, pow: Math.pow, mod: (a, b) => a % b,
};
const OPS = {
  "+": { prec: 2, assoc: "L", fn: (a, b) => a + b },
  "-": { prec: 2, assoc: "L", fn: (a, b) => a - b },
  "*": { prec: 3, assoc: "L", fn: (a, b) => a * b },
  "/": { prec: 3, assoc: "L", fn: (a, b) => a / b },
  "%": { prec: 3, assoc: "L", fn: (a, b) => a % b },
  "^": { prec: 4, assoc: "R", fn: (a, b) => Math.pow(a, b) },
};

function tokenizeExpr(src) {
  const tokens = [];
  let i = 0;
  const s = String(src);
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t" || c === "\n") { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let num = "";
      while (i < s.length && /[0-9.eE]/.test(s[i])) {
        // allow exponent sign
        if ((s[i] === "e" || s[i] === "E") && (s[i + 1] === "+" || s[i + 1] === "-")) {
          num += s[i]; i++;
        }
        num += s[i]; i++;
      }
      const v = parseFloat(num);
      if (!Number.isFinite(v)) throw new Error(`bad number "${num}"`);
      tokens.push({ t: "num", v });
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let name = "";
      while (i < s.length && /[a-zA-Z0-9_]/.test(s[i])) { name += s[i]; i++; }
      tokens.push({ t: "name", v: name });
      continue;
    }
    if (c === "(") { tokens.push({ t: "lp" }); i++; continue; }
    if (c === ")") { tokens.push({ t: "rp" }); i++; continue; }
    if (c === ",") { tokens.push({ t: "comma" }); i++; continue; }
    if (OPS[c]) { tokens.push({ t: "op", v: c }); i++; continue; }
    throw new Error(`unexpected char "${c}"`);
  }
  return tokens;
}

function evalExpr(src, vars) {
  const tokens = tokenizeExpr(src);
  // Shunting-yard -> RPN, tracking unary minus + function arity.
  const out = [];
  const stack = [];
  let prevType = null; // for unary-minus detection
  for (let k = 0; k < tokens.length; k++) {
    const tk = tokens[k];
    if (tk.t === "num") { out.push(tk); prevType = "val"; continue; }
    if (tk.t === "name") {
      const isFunc = tokens[k + 1] && tokens[k + 1].t === "lp";
      if (isFunc) {
        stack.push({ t: "func", v: tk.v });
        prevType = "func";
      } else {
        out.push({ t: "var", v: tk.v });
        prevType = "val";
      }
      continue;
    }
    if (tk.t === "comma") {
      while (stack.length && stack[stack.length - 1].t !== "lp") out.push(stack.pop());
      if (!stack.length) throw new Error("misplaced comma");
      prevType = "comma";
      continue;
    }
    if (tk.t === "op") {
      // unary minus / plus
      if ((tk.v === "-" || tk.v === "+") &&
          (prevType === null || prevType === "op" || prevType === "lp" || prevType === "comma")) {
        out.push({ t: "num", v: 0 });
        const o1 = OPS[tk.v];
        while (stack.length) {
          const top = stack[stack.length - 1];
          if (top.t === "op" && (OPS[top.v].prec > o1.prec)) out.push(stack.pop());
          else break;
        }
        stack.push({ t: "op", v: tk.v });
        prevType = "op";
        continue;
      }
      const o1 = OPS[tk.v];
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.t === "op") {
          const o2 = OPS[top.v];
          if ((o1.assoc === "L" && o1.prec <= o2.prec) ||
              (o1.assoc === "R" && o1.prec < o2.prec)) {
            out.push(stack.pop());
            continue;
          }
        }
        break;
      }
      stack.push({ t: "op", v: tk.v });
      prevType = "op";
      continue;
    }
    if (tk.t === "lp") { stack.push({ t: "lp" }); prevType = "lp"; continue; }
    if (tk.t === "rp") {
      while (stack.length && stack[stack.length - 1].t !== "lp") out.push(stack.pop());
      if (!stack.length) throw new Error("mismatched parentheses");
      stack.pop(); // discard lp
      if (stack.length && stack[stack.length - 1].t === "func") out.push(stack.pop());
      prevType = "val";
      continue;
    }
  }
  while (stack.length) {
    const top = stack.pop();
    if (top.t === "lp") throw new Error("mismatched parentheses");
    out.push(top);
  }
  // Evaluate RPN.
  const vs = [];
  for (const tk of out) {
    if (tk.t === "num") { vs.push(tk.v); continue; }
    if (tk.t === "var") {
      const v = vars && vars[tk.v];
      if (v === undefined || v === null || Number.isNaN(Number(v))) {
        throw new Error(`unknown variable "${tk.v}"`);
      }
      vs.push(Number(v));
      continue;
    }
    if (tk.t === "op") {
      const b = vs.pop(), a = vs.pop();
      if (a === undefined || b === undefined) throw new Error("malformed expression");
      vs.push(OPS[tk.v].fn(a, b));
      continue;
    }
    if (tk.t === "func") {
      const name = tk.v;
      if (FUNCS2[name]) {
        const b = vs.pop(), a = vs.pop();
        if (a === undefined || b === undefined) throw new Error(`${name}() needs 2 args`);
        vs.push(FUNCS2[name](a, b));
      } else if (FUNCS1[name]) {
        const a = vs.pop();
        if (a === undefined) throw new Error(`${name}() needs 1 arg`);
        vs.push(FUNCS1[name](a));
      } else {
        throw new Error(`unknown function "${name}"`);
      }
      continue;
    }
  }
  if (vs.length !== 1) throw new Error("malformed expression");
  const result = vs[0];
  if (!Number.isFinite(result)) throw new Error("non-finite result");
  return result;
}

// ─── Deterministic seeded RNG (mulberry32) ───────────────────────────────────
// Lets Monte-Carlo-style stochastic macros be reproducible when a seed is given.
function makeRng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function round3(n) { return Math.round((Number(n) || 0) * 1000) / 1000; }

// ─── System-dynamics (stock-and-flow) integrator ─────────────────────────────
// A model = { stocks:[{name,initial}], flows:[{name,expr,from?,to?}],
//   auxiliaries:[{name,expr}], params:{name:value} }.
// Each step: evaluate auxiliaries, then flows, then Euler-integrate stocks
// (stock += dt * (sum inflows - sum outflows)). `expr` is a formula string
// over stocks + auxiliaries + params + `t`.
function integrateSystemDynamics(model, opts) {
  const stocks = Array.isArray(model.stocks) ? model.stocks : [];
  const flows = Array.isArray(model.flows) ? model.flows : [];
  const auxiliaries = Array.isArray(model.auxiliaries) ? model.auxiliaries : [];
  const params = model.params && typeof model.params === "object" ? model.params : {};
  const dt = Number(opts.dt) > 0 ? Number(opts.dt) : 1;
  const steps = Math.min(Math.max(parseInt(opts.steps) || 50, 1), 2000);

  const stockVals = {};
  for (const s of stocks) stockVals[s.name] = Number(s.initial) || 0;

  const trajectory = [];
  const flowSeries = {};
  for (const f of flows) flowSeries[f.name] = [];

  function snapshot(t) {
    const row = { t: round3(t) };
    for (const s of stocks) row[s.name] = round3(stockVals[s.name]);
    return row;
  }
  trajectory.push(snapshot(0));

  for (let i = 1; i <= steps; i++) {
    const t = i * dt;
    const env = { ...params, ...stockVals, t };
    // auxiliaries (in declared order; later ones may use earlier ones)
    for (const a of auxiliaries) {
      env[a.name] = evalExpr(a.expr, env);
    }
    // flows
    const flowVals = {};
    for (const f of flows) {
      const v = evalExpr(f.expr, env);
      flowVals[f.name] = v;
      flowSeries[f.name].push(round3(v));
    }
    // integrate
    const next = { ...stockVals };
    for (const f of flows) {
      const rate = flowVals[f.name] * dt;
      if (f.from && f.from in next) next[f.from] -= rate;
      if (f.to && f.to in next) next[f.to] += rate;
    }
    for (const k of Object.keys(next)) stockVals[k] = next[k];
    trajectory.push(snapshot(t));
  }

  // Detect reinforcing / balancing feedback loops from flow expr references.
  // Loop polarity on a referenced stock S is the product of two signs:
  //   (a) how the flow expr depends on S (a leading/explicit '-' flips it), and
  //   (b) the flow's direction on S: +1 when it ADDS to S (to===S),
  //       -1 when it DRAINS S (from===S).
  // A drain whose rate grows with the stock (e.g. expr "tank*0.2", from:"tank")
  // is negative (balancing) feedback — the bigger the stock, the faster it
  // empties back toward equilibrium. Looking only at the expr sign mislabels
  // every such outflow as "reinforcing".
  const stockNames = stocks.map((s) => s.name);
  const loops = [];
  for (const f of flows) {
    const refs = stockNames.filter((sn) => new RegExp(`\\b${sn}\\b`).test(String(f.expr || "")));
    if (refs.length) {
      const exprSign = /-/.test(String(f.expr)) ? -1 : 1;
      const refPolarities = refs.map((sn) => {
        const dirSign = f.from === sn ? -1 : f.to === sn ? 1 : 1;
        return exprSign * dirSign >= 0 ? "reinforcing" : "balancing";
      });
      // Overall flow polarity: reinforcing only if every referenced-stock
      // contribution is reinforcing; otherwise balancing.
      const polarity = refPolarities.every((p) => p === "reinforcing") ? "reinforcing" : "balancing";
      loops.push({ flow: f.name, referencesStocks: refs, polarity });
    }
  }

  const finalState = {};
  for (const s of stocks) finalState[s.name] = round3(stockVals[s.name]);

  return {
    method: "euler",
    dt,
    stepsRun: steps,
    stocks: stockNames,
    flows: flows.map((f) => f.name),
    initialState: Object.fromEntries(stocks.map((s) => [s.name, Number(s.initial) || 0])),
    finalState,
    trajectory,
    flowSeries,
    feedbackLoops: loops,
  };
}

export default function registerSimActions(registerLensAction) {
  // ════════════════════════════════════════════════════════════════════════
  // ── Existing pure-compute macros (unchanged) ───────────────────────────
  // ════════════════════════════════════════════════════════════════════════
  registerLensAction("sim", "scenarioRun", (ctx, artifact, _params) => {
    const state = artifact.data?.initialState || {};
    const rules = artifact.data?.rules || [];
    const steps = parseInt(artifact.data?.steps) || 10;
    if (Object.keys(state).length === 0) return { ok: true, result: { message: "Provide initialState object and rules to simulate." } };
    const history = [{ step: 0, state: { ...state } }];
    let current = { ...state };
    for (let i = 1; i <= Math.min(steps, 100); i++) {
      const next = { ...current };
      rules.forEach(rule => {
        const field = rule.field || rule.variable;
        if (!field || !(field in next)) return;
        const val = parseFloat(next[field]) || 0;
        if (rule.type === "growth" || rule.type === "multiply") {
          next[field] = Math.round(val * (1 + (parseFloat(rule.rate) || 0.1)) * 1000) / 1000;
        } else if (rule.type === "decay") {
          next[field] = Math.round(val * (1 - (parseFloat(rule.rate) || 0.1)) * 1000) / 1000;
        } else if (rule.type === "add") {
          next[field] = Math.round((val + (parseFloat(rule.value) || 1)) * 1000) / 1000;
        } else if (rule.type === "cap") {
          next[field] = Math.min(val, parseFloat(rule.max) || Infinity);
        } else if (rule.type === "floor") {
          next[field] = Math.max(val, parseFloat(rule.min) || 0);
        }
      });
      history.push({ step: i, state: { ...next } });
      current = next;
    }
    return { ok: true, result: { stepsRun: history.length - 1, initialState: history[0].state, finalState: current, deltas: Object.fromEntries(Object.keys(state).map(k => [k, { start: state[k], end: current[k], change: (parseFloat(current[k]) || 0) - (parseFloat(state[k]) || 0) }])), history: history.length <= 20 ? history : [history[0], ...history.filter((_, i) => i % Math.ceil(history.length / 10) === 0), history[history.length - 1]] } };
  });

  registerLensAction("sim", "parameterSweep", (ctx, artifact, _params) => {
    const base = artifact.data?.baseState || {};
    const param = artifact.data?.parameter || "";
    const range = artifact.data?.range || {};
    const rules = artifact.data?.rules || [];
    const steps = parseInt(artifact.data?.steps) || 10;
    if (!param) return { ok: true, result: { message: "Specify parameter, range {min, max, step}, baseState, and rules." } };
    const min = parseFloat(range.min) || 0;
    const max = parseFloat(range.max) || 10;
    const step = parseFloat(range.step) || 1;
    const results = [];
    for (let val = min; val <= max; val += step) {
      let current = { ...base, [param]: val };
      for (let s = 0; s < Math.min(steps, 50); s++) {
        const next = { ...current };
        rules.forEach(rule => {
          const field = rule.field;
          if (field && field in next) {
            const v = parseFloat(next[field]) || 0;
            if (rule.type === "growth") next[field] = Math.round(v * (1 + (parseFloat(rule.rate) || 0.1)) * 1000) / 1000;
            else if (rule.type === "decay") next[field] = Math.round(v * (1 - (parseFloat(rule.rate) || 0.1)) * 1000) / 1000;
            else if (rule.type === "add") next[field] = Math.round((v + (parseFloat(rule.value) || 1)) * 1000) / 1000;
          }
        });
        current = next;
      }
      results.push({ paramValue: val, finalState: current });
    }
    const outputField = Object.keys(base).find(k => k !== param) || param;
    return { ok: true, result: { parameter: param, sweepRange: { min, max, step }, runsCompleted: results.length, stepsPerRun: steps, results: results.map(r => ({ [param]: r.paramValue, outcome: r.finalState[outputField] })), bestOutcome: results.sort((a, b) => (parseFloat(b.finalState[outputField]) || 0) - (parseFloat(a.finalState[outputField]) || 0))[0] } };
  });

  registerLensAction("sim", "monteCarlo", (ctx, artifact, _params) => {
    const trials = Math.min(parseInt(artifact.data?.trials) || 1000, 10000);
    const variables = artifact.data?.variables || [];
    const formula = artifact.data?.formula || "sum";
    if (variables.length === 0) return { ok: true, result: { message: "Provide variables with {name, min, max} or {name, mean, stddev} for Monte Carlo." } };
    const results = [];
    for (let t = 0; t < trials; t++) {
      const vals = {};
      variables.forEach(v => {
        if (v.mean !== undefined && v.stddev !== undefined) {
          const u1 = Math.random(), u2 = Math.random();
          vals[v.name] = parseFloat(v.mean) + parseFloat(v.stddev) * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        } else {
          const min = parseFloat(v.min) || 0, max = parseFloat(v.max) || 1;
          vals[v.name] = min + Math.random() * (max - min);
        }
      });
      let outcome;
      if (formula === "sum") outcome = Object.values(vals).reduce((s, v) => s + v, 0);
      else if (formula === "product") outcome = Object.values(vals).reduce((s, v) => s * v, 1);
      else if (formula === "max") outcome = Math.max(...Object.values(vals));
      else if (formula === "min") outcome = Math.min(...Object.values(vals));
      else outcome = Object.values(vals).reduce((s, v) => s + v, 0);
      results.push(outcome);
    }
    results.sort((a, b) => a - b);
    const mean = results.reduce((s, v) => s + v, 0) / trials;
    const variance = results.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / trials;
    const p5 = results[Math.floor(trials * 0.05)];
    const p25 = results[Math.floor(trials * 0.25)];
    const p50 = results[Math.floor(trials * 0.50)];
    const p75 = results[Math.floor(trials * 0.75)];
    const p95 = results[Math.floor(trials * 0.95)];
    return { ok: true, result: { trials, formula, mean: Math.round(mean * 1000) / 1000, stddev: Math.round(Math.sqrt(variance) * 1000) / 1000, min: Math.round(results[0] * 1000) / 1000, max: Math.round(results[trials - 1] * 1000) / 1000, percentiles: { p5: Math.round(p5 * 1000) / 1000, p25: Math.round(p25 * 1000) / 1000, p50: Math.round(p50 * 1000) / 1000, p75: Math.round(p75 * 1000) / 1000, p95: Math.round(p95 * 1000) / 1000 }, confidenceInterval90: { lower: Math.round(p5 * 1000) / 1000, upper: Math.round(p95 * 1000) / 1000 } } };
  });

  registerLensAction("sim", "sensitivityAnalysis", (ctx, artifact, _params) => {
  try {
    const baseState = artifact.data?.baseState || {};
    const rules = artifact.data?.rules || [];
    const perturbation = parseFloat(artifact.data?.perturbation) || 10;
    const steps = parseInt(artifact.data?.steps) || 10;
    const fields = Object.keys(baseState).filter(k => !isNaN(parseFloat(baseState[k])));
    if (fields.length === 0) return { ok: true, result: { message: "Provide baseState with numeric fields and rules." } };
    const runSim = (state) => {
      let current = { ...state };
      for (let s = 0; s < steps; s++) {
        const next = { ...current };
        rules.forEach(rule => {
          const f = rule.field;
          if (f && f in next) {
            const v = parseFloat(next[f]) || 0;
            if (rule.type === "growth") next[f] = v * (1 + (parseFloat(rule.rate) || 0.1));
            else if (rule.type === "decay") next[f] = v * (1 - (parseFloat(rule.rate) || 0.1));
            else if (rule.type === "add") next[f] = v + (parseFloat(rule.value) || 1);
          }
        });
        current = next;
      }
      return current;
    };
    const baseline = runSim(baseState);
    const outputField = fields[fields.length - 1];
    const baselineOutput = parseFloat(baseline[outputField]) || 0;
    const sensitivity = fields.map(field => {
      const baseVal = parseFloat(baseState[field]) || 0;
      const delta = baseVal * (perturbation / 100);
      const upState = { ...baseState, [field]: baseVal + delta };
      const downState = { ...baseState, [field]: baseVal - delta };
      const upOutput = parseFloat(runSim(upState)[outputField]) || 0;
      const downOutput = parseFloat(runSim(downState)[outputField]) || 0;
      const outputChange = ((upOutput - downOutput) / 2);
      const elasticity = baselineOutput !== 0 ? Math.round((outputChange / baselineOutput) * 100 * 10) / 10 : 0;
      return { parameter: field, baseValue: baseVal, perturbation: `±${perturbation}%`, outputUp: Math.round(upOutput * 1000) / 1000, outputDown: Math.round(downOutput * 1000) / 1000, sensitivity: Math.round(Math.abs(elasticity) * 10) / 10, direction: elasticity > 0 ? "positive" : elasticity < 0 ? "negative" : "neutral" };
    }).sort((a, b) => b.sensitivity - a.sensitivity);
    return { ok: true, result: { outputField, baselineOutput: Math.round(baselineOutput * 1000) / 1000, perturbationPercent: perturbation, sensitivity, mostSensitive: sensitivity[0]?.parameter, leastSensitive: sensitivity[sensitivity.length - 1]?.parameter } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ════════════════════════════════════════════════════════════════════════
  // ── NEW: stock-and-flow / system-dynamics integrator ────────────────────
  // ════════════════════════════════════════════════════════════════════════
  registerLensAction("sim", "systemDynamics", (ctx, artifact, params) => {
    try {
      const src = (params && params.model) || artifact.data?.model || artifact.data || {};
      const opts = {
        steps: (params && params.steps) ?? artifact.data?.steps ?? 50,
        dt: (params && params.dt) ?? artifact.data?.dt ?? 1,
      };
      if (!Array.isArray(src.stocks) || src.stocks.length === 0) {
        return { ok: true, result: { message: "Provide model.stocks [{name,initial}], model.flows [{name,expr,from?,to?}], optional model.auxiliaries and model.params." } };
      }
      const result = integrateSystemDynamics(src, opts);
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: `system dynamics failed: ${e.message}` };
    }
  });

  // ── Persist a system-dynamics model authored in the visual builder ──────
  registerLensAction("sim", "saveModel", (ctx, artifact, params) => {
    try {
      const state = getSimState();
      if (!state) return { ok: false, error: "state unavailable" };
      const uid = userId(ctx);
      const p = params || {};
      const model = p.model || artifact.data?.model;
      const name = p.name || artifact.data?.name || "Untitled Model";
      if (!model || !Array.isArray(model.stocks)) {
        return { ok: false, error: "model with stocks[] is required" };
      }
      if (!state.models.has(uid)) state.models.set(uid, new Map());
      const userModels = state.models.get(uid);
      const id = p.id && userModels.has(p.id) ? p.id : nextId(state, uid, "sdmodel");
      const now = new Date().toISOString();
      const existing = userModels.get(id);
      const record = {
        id,
        name,
        model,
        modelType: "system-dynamics",
        createdAt: existing ? existing.createdAt : now,
        updatedAt: now,
      };
      userModels.set(id, record);
      return { ok: true, result: { saved: true, id, name, updatedAt: now } };
    } catch (e) {
      return { ok: false, error: `saveModel failed: ${e.message}` };
    }
  });

  registerLensAction("sim", "listModels", (ctx, _artifact, _params) => {
    try {
      const state = getSimState();
      if (!state) return { ok: true, result: { models: [] } };
      const uid = userId(ctx);
      const userModels = state.models.get(uid);
      const models = userModels
        ? Array.from(userModels.values())
            .map((m) => ({
              id: m.id, name: m.name, modelType: m.modelType,
              stockCount: (m.model.stocks || []).length,
              flowCount: (m.model.flows || []).length,
              createdAt: m.createdAt, updatedAt: m.updatedAt,
            }))
            .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))
        : [];
      return { ok: true, result: { models, count: models.length } };
    } catch (e) {
      return { ok: false, error: `listModels failed: ${e.message}` };
    }
  });

  registerLensAction("sim", "loadModel", (ctx, artifact, params) => {
    try {
      const state = getSimState();
      if (!state) return { ok: false, error: "state unavailable" };
      const uid = userId(ctx);
      const id = (params && params.id) || artifact.data?.id;
      if (!id) return { ok: false, error: "id is required" };
      const userModels = state.models.get(uid);
      const record = userModels && userModels.get(id);
      if (!record) return { ok: false, error: `model "${id}" not found` };
      return { ok: true, result: record };
    } catch (e) {
      return { ok: false, error: `loadModel failed: ${e.message}` };
    }
  });

  registerLensAction("sim", "deleteModel", (ctx, artifact, params) => {
    try {
      const state = getSimState();
      if (!state) return { ok: false, error: "state unavailable" };
      const uid = userId(ctx);
      const id = (params && params.id) || artifact.data?.id;
      if (!id) return { ok: false, error: "id is required" };
      const userModels = state.models.get(uid);
      const had = userModels && userModels.delete(id);
      return { ok: true, result: { deleted: !!had, id } };
    } catch (e) {
      return { ok: false, error: `deleteModel failed: ${e.message}` };
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // ── NEW: agent-based modeling runtime ───────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════
  // Two built-in agent models on a toroidal grid:
  //   "sir"          — epidemic spread (S/I/R agents, infection radius)
  //   "schelling"    — segregation (two types, happiness threshold, moves)
  //   "predator-prey"— Lotka-Volterra agents (prey breed, predators hunt+starve)
  registerLensAction("sim", "agentBased", (ctx, artifact, params) => {
    try {
      const p = params || {};
      const cfg = { ...(artifact.data || {}), ...p };
      const kind = String(cfg.kind || cfg.model || "sir").toLowerCase();
      const steps = Math.min(Math.max(parseInt(cfg.steps) || 60, 1), 400);
      const grid = Math.min(Math.max(parseInt(cfg.gridSize) || 40, 8), 120);
      const seed = parseInt(cfg.seed) || 12345;
      const rng = makeRng(seed);
      const ri = (n) => Math.floor(rng() * n);

      const series = [];
      let agents = [];

      if (kind === "sir") {
        const n = Math.min(Math.max(parseInt(cfg.population) || 300, 4), grid * grid);
        const beta = Number(cfg.infectionRate ?? cfg.beta ?? 0.35);
        const gamma = Number(cfg.recoveryRate ?? cfg.gamma ?? 0.08);
        const radius = Number(cfg.infectionRadius ?? 1.6);
        const initialInfected = Math.min(Math.max(parseInt(cfg.initialInfected) || 5, 1), n);
        for (let i = 0; i < n; i++) {
          agents.push({ x: ri(grid), y: ri(grid), state: i < initialInfected ? "I" : "S" });
        }
        for (let step = 0; step <= steps; step++) {
          const counts = { S: 0, I: 0, R: 0 };
          for (const a of agents) counts[a.state]++;
          series.push({ t: step, susceptible: counts.S, infected: counts.I, recovered: counts.R });
          if (step === steps || counts.I === 0) break;
          // movement
          for (const a of agents) {
            a.x = (a.x + ri(3) - 1 + grid) % grid;
            a.y = (a.y + ri(3) - 1 + grid) % grid;
          }
          // infection + recovery
          const infected = agents.filter((a) => a.state === "I");
          for (const a of agents) {
            if (a.state === "S") {
              for (const inf of infected) {
                const dx = Math.abs(a.x - inf.x), dy = Math.abs(a.y - inf.y);
                const d = Math.hypot(Math.min(dx, grid - dx), Math.min(dy, grid - dy));
                if (d <= radius && rng() < beta) { a.state = "I"; break; }
              }
            }
          }
          for (const a of agents) {
            if (a.state === "I" && rng() < gamma) a.state = "R";
          }
        }
        const last = series[series.length - 1];
        const peakInfected = series.reduce((m, r) => Math.max(m, r.infected), 0);
        return { ok: true, result: {
          kind: "sir", population: n, steps: series.length - 1, gridSize: grid, seed,
          series, peakInfected,
          totalInfected: last.infected + last.recovered,
          finalState: last,
          agents: agents.slice(0, 600).map((a) => ({ x: a.x, y: a.y, state: a.state })),
        } };
      }

      if (kind === "schelling" || kind === "segregation") {
        const density = Math.min(Math.max(Number(cfg.density ?? 0.7), 0.1), 0.95);
        const threshold = Math.min(Math.max(Number(cfg.threshold ?? 0.4), 0), 1);
        const cellState = []; // grid*grid of null | 'A' | 'B'
        for (let i = 0; i < grid * grid; i++) {
          if (rng() < density) cellState.push(rng() < 0.5 ? "A" : "B");
          else cellState.push(null);
        }
        const idx = (x, y) => ((y + grid) % grid) * grid + ((x + grid) % grid);
        function happiness(x, y, type) {
          let same = 0, total = 0;
          for (let dx = -1; dx <= 1; dx++) {for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;
            const c = cellState[idx(x + dx, y + dy)];
            if (c) { total++; if (c === type) same++; }
          }}
          return total === 0 ? 1 : same / total;
        }
        for (let step = 0; step <= steps; step++) {
          let unhappy = 0, occupied = 0;
          const empties = [];
          for (let y = 0; y < grid; y++) {for (let x = 0; x < grid; x++) {
            const c = cellState[idx(x, y)];
            if (!c) { empties.push([x, y]); continue; }
            occupied++;
            if (happiness(x, y, c) < threshold) unhappy++;
          }}
          series.push({ t: step, unhappy, occupied, satisfaction: occupied ? round3(1 - unhappy / occupied) : 1 });
          if (step === steps || unhappy === 0) break;
          // relocate one unhappy agent per cell scan
          for (let y = 0; y < grid; y++) {for (let x = 0; x < grid; x++) {
            const c = cellState[idx(x, y)];
            if (!c) continue;
            if (happiness(x, y, c) < threshold && empties.length) {
              const ei = ri(empties.length);
              const [ex, ey] = empties[ei];
              cellState[idx(ex, ey)] = c;
              cellState[idx(x, y)] = null;
              empties[ei] = [x, y];
            }
          }}
        }
        const out = [];
        for (let y = 0; y < grid; y++) {for (let x = 0; x < grid; x++) {
          const c = cellState[idx(x, y)];
          if (c) out.push({ x, y, state: c });
        }}
        const last = series[series.length - 1];
        return { ok: true, result: {
          kind: "schelling", steps: series.length - 1, gridSize: grid, seed,
          density, threshold, series, finalState: last,
          agents: out.slice(0, 800),
        } };
      }

      if (kind === "predator-prey" || kind === "lotka-volterra") {
        let prey = Math.min(Math.max(parseInt(cfg.prey) || 120, 1), grid * grid);
        let predators = Math.min(Math.max(parseInt(cfg.predators) || 30, 1), grid * grid);
        const preyBreed = Number(cfg.preyBreedRate ?? 0.3);
        const predDeath = Number(cfg.predatorStarveRate ?? 0.2);
        const huntSuccess = Number(cfg.huntSuccess ?? 0.5);
        agents = [];
        for (let i = 0; i < prey; i++) agents.push({ x: ri(grid), y: ri(grid), type: "prey" });
        for (let i = 0; i < predators; i++) agents.push({ x: ri(grid), y: ri(grid), type: "predator", energy: 4 });
        for (let step = 0; step <= steps; step++) {
          prey = agents.filter((a) => a.type === "prey").length;
          predators = agents.filter((a) => a.type === "predator").length;
          series.push({ t: step, prey, predators });
          if (step === steps || (prey === 0 && predators === 0)) break;
          for (const a of agents) {
            a.x = (a.x + ri(3) - 1 + grid) % grid;
            a.y = (a.y + ri(3) - 1 + grid) % grid;
          }
          const next = [];
          const preyAt = new Map();
          for (const a of agents) {
            if (a.type === "prey") {
              const k = `${a.x},${a.y}`;
              if (!preyAt.has(k)) preyAt.set(k, []);
              preyAt.get(k).push(a);
            }
          }
          const eaten = new Set();
          for (const a of agents) {
            if (a.type === "predator") {
              const k = `${a.x},${a.y}`;
              const hereF = (preyAt.get(k) || []).filter((p2) => !eaten.has(p2));
              if (hereF.length && rng() < huntSuccess) {
                eaten.add(hereF[0]);
                a.energy = (a.energy || 0) + 3;
              } else {
                a.energy = (a.energy || 0) - 1;
              }
              if (a.energy > 0 && rng() > predDeath * 0.3) {
                next.push(a);
                if (a.energy >= 8 && rng() < 0.4) {
                  next.push({ x: a.x, y: a.y, type: "predator", energy: 4 });
                  a.energy -= 4;
                }
              }
            }
          }
          for (const a of agents) {
            if (a.type === "prey" && !eaten.has(a)) {
              next.push(a);
              if (rng() < preyBreed) next.push({ x: a.x, y: a.y, type: "prey" });
            }
          }
          agents = next;
        }
        const last = series[series.length - 1];
        return { ok: true, result: {
          kind: "predator-prey", steps: series.length - 1, gridSize: grid, seed,
          series, finalState: last,
          peakPrey: series.reduce((m, r) => Math.max(m, r.prey), 0),
          peakPredators: series.reduce((m, r) => Math.max(m, r.predators), 0),
          agents: agents.slice(0, 800).map((a) => ({ x: a.x, y: a.y, state: a.type })),
        } };
      }

      return { ok: false, error: `unknown agent model "${kind}" (use sir | schelling | predator-prey)` };
    } catch (e) {
      return { ok: false, error: `agentBased failed: ${e.message}` };
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // ── NEW: discrete-event simulation (M/M/c queue) ────────────────────────
  // ════════════════════════════════════════════════════════════════════════
  // Event-driven next-event time-advance simulation of a single-station queue
  // with `servers` parallel servers, exponential interarrival + service times.
  registerLensAction("sim", "discreteEvent", (ctx, artifact, params) => {
    try {
      const p = params || {};
      const cfg = { ...(artifact.data || {}), ...p };
      const arrivalRate = Number(cfg.arrivalRate ?? cfg.lambda ?? 1.0);   // jobs / time unit
      const serviceRate = Number(cfg.serviceRate ?? cfg.mu ?? 1.2);       // jobs / time unit / server
      const servers = Math.min(Math.max(parseInt(cfg.servers) || 1, 1), 200);
      const maxJobs = Math.min(Math.max(parseInt(cfg.maxJobs) || 5000, 10), 100000);
      const queueCapacity = cfg.queueCapacity != null ? Math.max(0, parseInt(cfg.queueCapacity)) : Infinity;
      const seed = parseInt(cfg.seed) || 4242;
      if (arrivalRate <= 0 || serviceRate <= 0) {
        return { ok: false, error: "arrivalRate and serviceRate must be positive" };
      }
      const rng = makeRng(seed);
      const expSample = (rate) => -Math.log(1 - rng()) / rate;

      // Event-list simulation.
      let clock = 0;
      let arrived = 0, served = 0, balked = 0;
      let queue = [];               // arrival times of waiting jobs
      const busyUntil = new Array(servers).fill(0); // 0 = free
      let freeServers = servers;
      let nextArrival = expSample(arrivalRate);
      let waitTimeSum = 0, systemTimeSum = 0;
      let areaQueue = 0, areaSystem = 0, lastEventTime = 0;
      let maxQueueLen = 0;
      // departure events: array of {time, serverIdx, arrivalTime}
      const departures = [];

      function inSystem() { return queue.length + (servers - freeServers); }

      while (served < maxJobs) {
        // next event = min(nextArrival, earliest departure)
        let depTime = Infinity, depIdx = -1;
        for (let i = 0; i < departures.length; i++) {
          if (departures[i].time < depTime) { depTime = departures[i].time; depIdx = i; }
        }
        const isArrival = arrived < maxJobs && nextArrival <= depTime;
        const eventTime = isArrival ? nextArrival : depTime;
        if (!Number.isFinite(eventTime)) break;

        // accumulate time-weighted areas
        const dt = eventTime - lastEventTime;
        areaQueue += queue.length * dt;
        areaSystem += inSystem() * dt;
        lastEventTime = eventTime;
        clock = eventTime;

        if (isArrival) {
          arrived++;
          nextArrival = clock + expSample(arrivalRate);
          if (freeServers > 0) {
            freeServers--;
            const svc = expSample(serviceRate);
            departures.push({ time: clock + svc, arrivalTime: clock });
            waitTimeSum += 0;
          } else if (queue.length < queueCapacity) {
            queue.push(clock);
            if (queue.length > maxQueueLen) maxQueueLen = queue.length;
          } else {
            balked++;
          }
        } else {
          // departure
          const dep = departures.splice(depIdx, 1)[0];
          served++;
          systemTimeSum += clock - dep.arrivalTime;
          if (queue.length > 0) {
            const arrivalT = queue.shift();
            waitTimeSum += clock - arrivalT;
            const svc = expSample(serviceRate);
            departures.push({ time: clock + svc, arrivalTime: arrivalT });
          } else {
            freeServers++;
          }
        }
      }

      const rho = arrivalRate / (servers * serviceRate);
      const avgWait = served > 0 ? waitTimeSum / served : 0;
      const avgSystemTime = served > 0 ? systemTimeSum / served : 0;
      const avgQueueLen = clock > 0 ? areaQueue / clock : 0;
      const avgInSystem = clock > 0 ? areaSystem / clock : 0;
      const throughput = clock > 0 ? served / clock : 0;
      const utilization = clock > 0 ? Math.min(1, (avgInSystem - avgQueueLen) / servers) : 0;

      return { ok: true, result: {
        model: "mmc-queue",
        params: { arrivalRate, serviceRate, servers, queueCapacity: Number.isFinite(queueCapacity) ? queueCapacity : null },
        clock: round3(clock),
        jobsArrived: arrived,
        jobsServed: served,
        jobsBalked: balked,
        trafficIntensity: round3(rho),
        stable: rho < 1,
        avgWaitTime: round3(avgWait),
        avgSystemTime: round3(avgSystemTime),
        avgQueueLength: round3(avgQueueLen),
        avgJobsInSystem: round3(avgInSystem),
        maxQueueLength: maxQueueLen,
        serverUtilization: round3(utilization),
        throughput: round3(throughput),
      } };
    } catch (e) {
      return { ok: false, error: `discreteEvent failed: ${e.message}` };
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // ── NEW: safe formula / expression evaluator ────────────────────────────
  // ════════════════════════════════════════════════════════════════════════
  registerLensAction("sim", "evaluateFormula", (ctx, artifact, params) => {
    try {
      const p = params || {};
      const expr = p.expression ?? p.formula ?? artifact.data?.expression ?? artifact.data?.formula;
      const vars = p.variables ?? p.vars ?? artifact.data?.variables ?? {};
      if (!expr || typeof expr !== "string") {
        return { ok: false, error: "expression string is required" };
      }
      const numericVars = {};
      for (const [k, v] of Object.entries(vars || {})) {
        if (v !== null && v !== undefined && Number.isFinite(Number(v))) numericVars[k] = Number(v);
      }
      const value = evalExpr(expr, numericVars);
      return { ok: true, result: {
        expression: expr,
        variables: numericVars,
        value: Math.round(value * 1e6) / 1e6,
      } };
    } catch (e) {
      return { ok: false, error: `formula error: ${e.message}` };
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // ── NEW: optimization / goal-seek ───────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════
  // Bisection / golden-section search: find the value of a single decision
  // parameter that drives a formula output to `target` (or maximizes it).
  registerLensAction("sim", "goalSeek", (ctx, artifact, params) => {
    try {
      const p = params || {};
      const cfg = { ...(artifact.data || {}), ...p };
      const expr = cfg.expression || cfg.formula;
      const param = cfg.parameter;
      const constants = cfg.constants || cfg.variables || {};
      const lo0 = Number(cfg.min ?? 0);
      const hi0 = Number(cfg.max ?? 100);
      const objective = String(cfg.objective || (cfg.target != null ? "target" : "maximize"));
      const target = Number(cfg.target ?? 0);
      const tol = Number(cfg.tolerance ?? 1e-4);
      const maxIter = Math.min(Math.max(parseInt(cfg.maxIterations) || 80, 5), 500);
      if (!expr || typeof expr !== "string") return { ok: false, error: "expression is required" };
      if (!param || typeof param !== "string") return { ok: false, error: "parameter name is required" };
      if (!(hi0 > lo0)) return { ok: false, error: "max must be greater than min" };

      const base = {};
      for (const [k, v] of Object.entries(constants)) {
        if (Number.isFinite(Number(v))) base[k] = Number(v);
      }
      const f = (x) => evalExpr(expr, { ...base, [param]: x });

      const iterations = [];
      let solution = null;
      let achieved = null;

      if (objective === "target") {
        // bisection on g(x) = f(x) - target
        let lo = lo0, hi = hi0;
        let glo = f(lo) - target, ghi = f(hi) - target;
        if (glo === 0) { solution = lo; achieved = f(lo); }
        else if (ghi === 0) { solution = hi; achieved = f(hi); }
        else if (glo * ghi > 0) {
          // no sign change — fall back to grid-scan for closest
          let bestX = lo, bestErr = Math.abs(glo);
          const N = 200;
          for (let i = 0; i <= N; i++) {
            const x = lo0 + (hi0 - lo0) * (i / N);
            const err = Math.abs(f(x) - target);
            if (err < bestErr) { bestErr = err; bestX = x; }
          }
          solution = bestX; achieved = f(bestX);
          iterations.push({ method: "grid-scan", note: "no sign change in bracket" });
        } else {
          for (let it = 0; it < maxIter; it++) {
            const mid = (lo + hi) / 2;
            const gmid = f(mid) - target;
            iterations.push({ iteration: it + 1, x: round3(mid), output: round3(gmid + target), error: round3(Math.abs(gmid)) });
            if (Math.abs(gmid) < tol || (hi - lo) / 2 < tol) { solution = mid; achieved = gmid + target; break; }
            if (glo * gmid < 0) { hi = mid; ghi = gmid; }
            else { lo = mid; glo = gmid; }
          }
          if (solution === null) { solution = (lo + hi) / 2; achieved = f(solution); }
        }
      } else {
        // golden-section search for max or min
        const maximize = objective !== "minimize";
        const phi = (Math.sqrt(5) - 1) / 2;
        let a = lo0, b = hi0;
        let c = b - phi * (b - a), d = a + phi * (b - a);
        let fc = f(c), fd = f(d);
        for (let it = 0; it < maxIter; it++) {
          iterations.push({ iteration: it + 1, x: round3((a + b) / 2), output: round3(f((a + b) / 2)) });
          const better = maximize ? fc > fd : fc < fd;
          if (better) { b = d; d = c; fd = fc; c = b - phi * (b - a); fc = f(c); }
          else { a = c; c = d; fc = fd; d = a + phi * (b - a); fd = f(d); }
          if (Math.abs(b - a) < tol) break;
        }
        solution = (a + b) / 2;
        achieved = f(solution);
      }

      return { ok: true, result: {
        expression: expr,
        parameter: param,
        objective,
        target: objective === "target" ? target : null,
        solution: Math.round(solution * 1e6) / 1e6,
        achievedOutput: Math.round(achieved * 1e6) / 1e6,
        residual: objective === "target" ? Math.round(Math.abs(achieved - target) * 1e6) / 1e6 : null,
        converged: objective === "target" ? Math.abs(achieved - target) < Math.max(tol, 1e-3) : true,
        iterationCount: iterations.length,
        iterations: iterations.slice(0, 40),
      } };
    } catch (e) {
      return { ok: false, error: `goalSeek failed: ${e.message}` };
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // ── NEW: calibration against historical data ────────────────────────────
  // ════════════════════════════════════════════════════════════════════════
  // Coordinate-descent calibration: tune named parameters of a system-dynamics
  // model so a chosen stock's trajectory best fits an observed time series.
  // Minimizes sum-of-squared-error; reports SSE, RMSE, R².
  registerLensAction("sim", "calibrate", (ctx, artifact, params) => {
    try {
      const p = params || {};
      const cfg = { ...(artifact.data || {}), ...p };
      const model = cfg.model;
      const observed = cfg.observed || cfg.historical;  // [{t,value}] or [number]
      const fitStock = cfg.fitStock || cfg.targetStock;
      const tunable = cfg.tunable || cfg.parameters;     // [{name,min,max}]
      if (!model || !Array.isArray(model.stocks)) return { ok: false, error: "model with stocks[] is required" };
      if (!Array.isArray(observed) || observed.length < 2) return { ok: false, error: "observed must be an array of >=2 points" };
      if (!fitStock) return { ok: false, error: "fitStock (stock name to fit) is required" };
      if (!Array.isArray(tunable) || tunable.length === 0) return { ok: false, error: "tunable parameter list is required" };

      // Normalize observed to {t,value}.
      const obs = observed.map((o, i) =>
        typeof o === "number" ? { t: i, value: o } : { t: Number(o.t ?? i), value: Number(o.value ?? o.y ?? 0) });
      const obsMap = new Map(obs.map((o) => [Math.round(o.t), o.value]));
      const obsValues = obs.map((o) => o.value);
      const obsMean = obsValues.reduce((s, v) => s + v, 0) / obsValues.length;
      const ssTot = obsValues.reduce((s, v) => s + (v - obsMean) ** 2, 0) || 1;
      const horizon = Math.max(...obs.map((o) => Math.round(o.t)));
      const dt = Number(cfg.dt) > 0 ? Number(cfg.dt) : 1;

      function sse(paramOverrides) {
        const m = { ...model, params: { ...(model.params || {}), ...paramOverrides } };
        const sim = integrateSystemDynamics(m, { steps: horizon, dt });
        let err = 0, matched = 0;
        for (const row of sim.trajectory) {
          if (obsMap.has(Math.round(row.t))) {
            err += (row[fitStock] - obsMap.get(Math.round(row.t))) ** 2;
            matched++;
          }
        }
        return { sse: err, matched };
      }

      // Initialize params at midpoint.
      const current = {};
      for (const tp of tunable) {
        const lo = Number(tp.min ?? 0), hi = Number(tp.max ?? 1);
        current[tp.name] = (model.params && model.params[tp.name] != null)
          ? Number(model.params[tp.name])
          : (lo + hi) / 2;
      }
      let best = sse(current);
      const passes = Math.min(Math.max(parseInt(cfg.passes) || 6, 1), 30);
      const refinement = [];

      for (let pass = 0; pass < passes; pass++) {
        for (const tp of tunable) {
          const lo = Number(tp.min ?? 0), hi = Number(tp.max ?? 1);
          // golden-section line search on this single param
          const phi = (Math.sqrt(5) - 1) / 2;
          let a = lo, b = hi;
          let c = b - phi * (b - a), d = a + phi * (b - a);
          const evalAt = (x) => sse({ ...current, [tp.name]: x }).sse;
          let fc = evalAt(c), fd = evalAt(d);
          for (let it = 0; it < 24 && Math.abs(b - a) > (hi - lo) * 1e-4; it++) {
            if (fc < fd) { b = d; d = c; fd = fc; c = b - phi * (b - a); fc = evalAt(c); }
            else { a = c; c = d; fc = fd; d = a + phi * (b - a); fd = evalAt(d); }
          }
          const xBest = (a + b) / 2;
          const trial = sse({ ...current, [tp.name]: xBest });
          if (trial.sse < best.sse) { current[tp.name] = xBest; best = trial; }
        }
        refinement.push({ pass: pass + 1, sse: round3(best.sse) });
      }

      const rmse = Math.sqrt(best.sse / Math.max(1, best.matched));
      const r2 = 1 - best.sse / ssTot;
      const fitted = integrateSystemDynamics(
        { ...model, params: { ...(model.params || {}), ...current } },
        { steps: horizon, dt },
      );

      return { ok: true, result: {
        fitStock,
        calibratedParameters: Object.fromEntries(
          Object.entries(current).map(([k, v]) => [k, Math.round(v * 1e6) / 1e6]),
        ),
        sse: round3(best.sse),
        rmse: round3(rmse),
        rSquared: Math.round(r2 * 1e4) / 1e4,
        pointsMatched: best.matched,
        passes: refinement,
        fittedTrajectory: fitted.trajectory.map((row) => ({
          t: row.t, fitted: row[fitStock], observed: obsMap.has(Math.round(row.t)) ? obsMap.get(Math.round(row.t)) : null,
        })),
      } };
    } catch (e) {
      return { ok: false, error: `calibrate failed: ${e.message}` };
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // ── NEW: scenario diff with statistical significance ────────────────────
  // ════════════════════════════════════════════════════════════════════════
  // Welch's two-sample t-test comparing two arrays of run outcomes. Reports
  // mean difference, t-statistic, approximate two-sided p-value, effect size.
  registerLensAction("sim", "scenarioDiff", (ctx, artifact, params) => {
    try {
      const p = params || {};
      const cfg = { ...(artifact.data || {}), ...p };
      const a = (cfg.sampleA || cfg.a || []).map(Number).filter((x) => Number.isFinite(x));
      const b = (cfg.sampleB || cfg.b || []).map(Number).filter((x) => Number.isFinite(x));
      if (a.length < 2 || b.length < 2) {
        return { ok: false, error: "sampleA and sampleB must each have >=2 numeric values" };
      }
      const stats = (arr) => {
        const n = arr.length;
        const mean = arr.reduce((s, x) => s + x, 0) / n;
        const variance = arr.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1);
        return { n, mean, variance, std: Math.sqrt(variance) };
      };
      const sa = stats(a), sb = stats(b);
      const seDiff = Math.sqrt(sa.variance / sa.n + sb.variance / sb.n) || 1e-12;
      const tStat = (sb.mean - sa.mean) / seDiff;
      // Welch–Satterthwaite degrees of freedom
      const df = Math.pow(sa.variance / sa.n + sb.variance / sb.n, 2) /
        (Math.pow(sa.variance / sa.n, 2) / (sa.n - 1) + Math.pow(sb.variance / sb.n, 2) / (sb.n - 1));
      // two-sided p-value via a normal approximation of Student's t (accurate
      // for moderate df) — erf-based survival function.
      const erf = (x) => {
        const sign = x < 0 ? -1 : 1;
        const ax = Math.abs(x);
        const t = 1 / (1 + 0.3275911 * ax);
        const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
        return sign * y;
      };
      const pValue = 2 * (1 - 0.5 * (1 + erf(Math.abs(tStat) / Math.sqrt(2))));
      // Cohen's d (pooled)
      const pooledStd = Math.sqrt(((sa.n - 1) * sa.variance + (sb.n - 1) * sb.variance) / (sa.n + sb.n - 2)) || 1e-12;
      const cohensD = (sb.mean - sa.mean) / pooledStd;
      const significant = pValue < 0.05;

      return { ok: true, result: {
        sampleA: { n: sa.n, mean: round3(sa.mean), std: round3(sa.std) },
        sampleB: { n: sb.n, mean: round3(sb.mean), std: round3(sb.std) },
        meanDifference: round3(sb.mean - sa.mean),
        percentChange: sa.mean !== 0 ? round3(((sb.mean - sa.mean) / Math.abs(sa.mean)) * 100) : null,
        tStatistic: round3(tStat),
        degreesOfFreedom: round3(df),
        pValue: Math.round(Math.min(1, Math.max(0, pValue)) * 1e4) / 1e4,
        significant,
        cohensD: round3(cohensD),
        effectSize: Math.abs(cohensD) < 0.2 ? "negligible" : Math.abs(cohensD) < 0.5 ? "small" : Math.abs(cohensD) < 0.8 ? "medium" : "large",
        verdict: significant
          ? `Scenarios differ significantly (p=${pValue.toFixed(4)})`
          : `No significant difference (p=${pValue.toFixed(4)})`,
      } };
    } catch (e) {
      return { ok: false, error: `scenarioDiff failed: ${e.message}` };
    }
  });
}
