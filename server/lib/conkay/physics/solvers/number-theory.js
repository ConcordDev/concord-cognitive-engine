// server/lib/conkay/physics/solvers/number-theory.js
//
// math.number-theory — SX-NUM-20 (ConKay solver catalogue,
// Wave 0).
//
// Elementary number theory in BigInt throughout. Inputs are
// accepted as integer strings, so values past 2^53 stay
// honest; every operation declares its size envelope, and
// the row's validity rule — integer sizes declared — is the
// shape of every refusal.
//
// A primality verdict names its own epistemic status: below
// 3.3e24 the Miller-Rabin base set used here is proven
// deterministic and the verdict is PROVEN; above it the
// verdict is probable-prime WITH THE BASES LISTED, never a
// bare "prime". Factorization is trial division + Pollard
// rho under an iteration budget; an exhausted budget refuses
// with the remaining cofactor named rather than guessing.
//
// Catalogue reference case: phi(36) = 12 (OEIS A000010).

import { registerSolver } from "../registry.js";

function toBig(v, field) {
  if (typeof v === "bigint") return v;
  if (typeof v === "number" && Number.isSafeInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^[+-]?\d+$/.test(v.trim())) return BigInt(v.trim());
  throw Object.assign(new Error(`missing_input:${field} (an integer, as a safe number or a decimal string)`), { nc: true });
}
const abs = (a) => (a < 0n ? -a : a);
function gcd(a, b) {
  a = abs(a); b = abs(b);
  while (b !== 0n) { const t = a % b; a = b; b = t; }
  return a;
}
function egcd(a, b) {
  let [r0, r1] = [a, b];
  let [s0, s1] = [1n, 0n];
  let [t0, t1] = [0n, 1n];
  while (r1 !== 0n) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
    [t0, t1] = [t1, t0 - q * t1];
  }
  return { g: r0, x: s0, y: t0 };
}
function modpow(base, exp, mod) {
  let result = 1n % mod;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

/* ---------------- primality ---------------- */

// deterministic for n < 3,317,044,064,679,887,385,961,981
const MR_PROVEN_BOUND = 3317044064679887385961981n;
const MR_BASES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];

function isPrime(n) {
  if (n < 2n) return { prime: false, proven: true, bases: [] };
  for (const p of MR_BASES) {
    if (n === p) return { prime: true, proven: true, bases: [] };
    if (n % p === 0n) return { prime: false, proven: true, bases: [] };
  }
  let d = n - 1n;
  let r = 0n;
  while ((d & 1n) === 0n) { d >>= 1n; r += 1n; }
  const used = [];
  for (const a of MR_BASES) {
    used.push(a.toString());
    let x = modpow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    let composite = true;
    for (let i = 0n; i < r - 1n; i += 1n) {
      x = (x * x) % n;
      if (x === n - 1n) { composite = false; break; }
    }
    if (composite) return { prime: false, proven: true, bases: used };
  }
  return { prime: true, proven: n < MR_PROVEN_BOUND, bases: used };
}

/* ---------------- factorization ---------------- */

function pollardRho(n, budget) {
  if (n % 2n === 0n) return 2n;
  let seed = 2n;
  while (budget.steps > 0) {
    let x = seed;
    let y = seed;
    let d = 1n;
    const c = seed;
    let local = 0;
    while (d === 1n && local < 100000 && budget.steps > 0) {
      x = (x * x + c) % n;
      y = (y * y + c) % n;
      y = (y * y + c) % n;
      d = gcd(abs(x - y), n);
      local += 1;
      budget.steps -= 1;
    }
    if (d > 1n && d < n) return d;
    seed += 1n;
  }
  return null;
}

function factorize(n, budget) {
  const factors = new Map();
  const add = (p, k = 1) => factors.set(p, (factors.get(p) || 0) + k);
  let rest = n;
  for (let p = 2n; p * p <= rest && p <= 1000n; p = p === 2n ? 3n : p + 2n) {
    while (rest % p === 0n) { add(p); rest /= p; }
  }
  const stack = rest > 1n ? [rest] : [];
  while (stack.length > 0) {
    const m = stack.pop();
    if (m === 1n) continue;
    if (isPrime(m).prime) { add(m); continue; }
    const d = pollardRho(m, budget);
    if (d === null) return { complete: false, factors, remaining: m };
    stack.push(d, m / d);
  }
  return { complete: true, factors, remaining: 1n };
}

const fmtFactors = (factors) =>
  [...factors.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([p, k]) => ({ prime: p.toString(), exponent: k }));

/* ---------------- targets ---------------- */

function runNt(ctx, target) {
  const inputs = ctx?.inputs || {};
  try {
    switch (target) {
      case "is-prime": {
        const n = toBig(inputs.n, "n");
        if (abs(n) > 10n ** 200n) return { notComputed: "size_above_envelope:n is capped at 200 digits (declared envelope)" };
        const v = isPrime(n);
        return {
          inputs: { digits: abs(n).toString().length },
          outputs: {
            n: n.toString(),
            prime: v.prime,
            verdict: !v.prime ? "composite" : v.proven ? "prime-proven" : "prime-probable",
            millerRabinBases: v.bases,
          },
          margins: [], covers: [target],
        };
      }
      case "factor": {
        const n = toBig(inputs.n, "n");
        if (n < 2n) return { notComputed: "invalid_input:factor needs n >= 2" };
        if (n > 10n ** 60n) return { notComputed: "size_above_envelope:factorization is capped at 60 digits (declared envelope; Pollard rho budget)" };
        const budget = { steps: 2_000_000 };
        const f = factorize(n, budget);
        if (!f.complete) {
          return { notComputed: `factorization_incomplete:budget exhausted with composite cofactor ${f.remaining} remaining — the partial factors are not served as a factorization` };
        }
        return {
          inputs: { digits: n.toString().length },
          outputs: { n: n.toString(), factors: fmtFactors(f.factors) },
          margins: [], covers: [target],
        };
      }
      case "phi": {
        const n = toBig(inputs.n, "n");
        if (n < 1n) return { notComputed: "invalid_input:phi needs n >= 1" };
        if (n > 10n ** 60n) return { notComputed: "size_above_envelope:phi is capped at 60 digits (it rides factorization)" };
        const budget = { steps: 2_000_000 };
        const f = factorize(n, budget);
        if (!f.complete) return { notComputed: `factorization_incomplete:phi rides factorization, which did not finish` };
        let phi = n;
        for (const p of f.factors.keys()) phi = (phi / p) * (p - 1n);
        return { inputs: {}, outputs: { n: n.toString(), phi: phi.toString() }, margins: [], covers: [target] };
      }
      case "gcd-lcm": {
        const a = toBig(inputs.a, "a");
        const b = toBig(inputs.b, "b");
        const g = gcd(a, b);
        const lcm = g === 0n ? 0n : abs(a / g * b);
        return { inputs: {}, outputs: { gcd: g.toString(), lcm: lcm.toString() }, margins: [], covers: [target] };
      }
      case "modpow": {
        const base = toBig(inputs.base, "base");
        const exp = toBig(inputs.exp, "exp");
        const mod = toBig(inputs.mod, "mod");
        if (mod <= 0n || exp < 0n) return { notComputed: "invalid_input:modpow needs mod > 0 and exp >= 0" };
        return { inputs: {}, outputs: { result: modpow(base, exp, mod).toString() }, margins: [], covers: [target] };
      }
      case "modinv": {
        const a = toBig(inputs.a, "a");
        const mod = toBig(inputs.mod, "mod");
        if (mod <= 1n) return { notComputed: "invalid_input:modinv needs mod > 1" };
        const { g, x } = egcd(((a % mod) + mod) % mod, mod);
        if (g !== 1n) return { notComputed: `not_invertible:gcd(a, mod) = ${g} — no inverse exists, and the gcd is the reason` };
        return { inputs: {}, outputs: { inverse: (((x % mod) + mod) % mod).toString() }, margins: [], covers: [target] };
      }
      case "crt": {
        if (!Array.isArray(inputs.residues) || !Array.isArray(inputs.moduli) || inputs.residues.length !== inputs.moduli.length || inputs.residues.length === 0) {
          return { notComputed: "missing_input:residues and moduli arrays of equal length" };
        }
        const rs = inputs.residues.map((v, i) => toBig(v, `residues[${i}]`));
        const ms = inputs.moduli.map((v, i) => toBig(v, `moduli[${i}]`));
        for (let i = 0; i < ms.length; i += 1) {
          if (ms[i] <= 1n) return { notComputed: `invalid_input:moduli[${i}] must exceed 1` };
          for (let j = i + 1; j < ms.length; j += 1) {
            if (gcd(ms[i], ms[j]) !== 1n) return { notComputed: `invalid_input:moduli ${ms[i]} and ${ms[j]} are not coprime — the seated CRT is the coprime case; the general case is named follow-on scope` };
          }
        }
        let M = 1n;
        for (const m of ms) M *= m;
        let x = 0n;
        for (let i = 0; i < ms.length; i += 1) {
          const Mi = M / ms[i];
          const inv = egcd(Mi % ms[i], ms[i]).x;
          x = (x + ((rs[i] % ms[i]) + ms[i]) % ms[i] * Mi * (((inv % ms[i]) + ms[i]) % ms[i])) % M;
        }
        return { inputs: {}, outputs: { solution: x.toString(), modulus: M.toString() }, margins: [], covers: [target] };
      }
      case "jacobi": {
        const a = toBig(inputs.a, "a");
        const n = toBig(inputs.n, "n");
        if (n <= 0n || n % 2n === 0n) return { notComputed: "invalid_input:jacobi needs an odd positive n" };
        let aa = ((a % n) + n) % n;
        let nn = n;
        let result = 1n;
        while (aa !== 0n) {
          while (aa % 2n === 0n) {
            aa /= 2n;
            const r = nn % 8n;
            if (r === 3n || r === 5n) result = -result;
          }
          [aa, nn] = [nn, aa];
          if (aa % 4n === 3n && nn % 4n === 3n) result = -result;
          aa %= nn;
        }
        return { inputs: {}, outputs: { symbol: (nn === 1n ? result : 0n).toString() }, margins: [], covers: [target] };
      }
      case "discrete-log": {
        const g = toBig(inputs.g, "g");
        const h = toBig(inputs.h, "h");
        const p = toBig(inputs.p, "p");
        if (p <= 2n) return { notComputed: "invalid_input:discrete-log needs p > 2" };
        if (p > 2n ** 40n) return { notComputed: "size_above_envelope:the baby-step giant-step table is capped at p <= 2^40 (declared envelope)" };
        const m = BigInt(Math.ceil(Math.sqrt(Number(p))));
        const table = new Map();
        let cur = 1n % p;
        for (let j = 0n; j < m; j += 1n) {
          if (!table.has(cur.toString())) table.set(cur.toString(), j);
          cur = (cur * g) % p;
        }
        const factor = modpow(g, p - 1n - (m % (p - 1n)), p); // g^{-m}
        let gamma = ((h % p) + p) % p;
        for (let i = 0n; i <= m; i += 1n) {
          const hit = table.get(gamma.toString());
          if (hit !== undefined) {
            const x = i * m + hit;
            if (modpow(g, x, p) === ((h % p) + p) % p) {
              return { inputs: {}, outputs: { x: x.toString() }, margins: [], covers: [target] };
            }
          }
          gamma = (gamma * factor) % p;
        }
        return { notComputed: "no_discrete_log:g^x = h (mod p) has no solution in range — reported, never approximated" };
      }
      default:
        return { notComputed: `unknown_operation:${target}` };
    }
  } catch (err) {
    if (err.nc) return { notComputed: err.message };
    throw err;
  }
}

export const numberTheory = registerSolver({
  id: "math.number-theory",
  version: "1.0.0",
  domain: "math",
  domains: ["math"],
  fidelity: 1,
  method: "BigInt throughout: deterministic Miller-Rabin (proven below 3.3e24, bases listed above), trial division + Pollard rho factorization under a declared budget, extended Euclid, coprime CRT, Jacobi symbol, baby-step giant-step discrete log under a 2^40 cap",
  reference: "OEIS (oeis.org) — reference case: phi(36) = 12 (A000010)",
  regime: "integer sizes declared per operation: primality to 200 digits, factorization and phi to 60 digits, discrete log to p <= 2^40; a primality verdict names whether it is proven or probable",
  units: { inputs: "integers as safe numbers or decimal strings", outputs: "integer results as decimal strings" },
  tolerance: "exact integer arithmetic — no tolerance; refusals name the envelope or the unfinished cofactor",
  screening: true,
  targets: () => [], // direct-call solver (solve.direct shape)
  run: runNt,
});
