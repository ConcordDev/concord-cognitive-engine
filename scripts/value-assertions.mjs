#!/usr/bin/env node
// scripts/value-assertions.mjs
//
// BUSINESS-LOGIC verification — the layer above the reachability walkthrough. The walk
// proves a lens loads + survives clicks; this proves the macro computes the RIGHT VALUE.
// Each case sends a KNOWN input to a lens macro via /api/lens/run and asserts the computed
// output against a hand-verified expected answer. Catches the "renders fine, math is wrong"
// class of bug (e.g. a duplicate registration shadowing the real handler with a shape the
// UI can't read — which is exactly how the math lens shipped μ=undefined / 0 roots).
//
// Usage (against a running dev/test instance):  node scripts/value-assertions.mjs
//   BASE=http://127.0.0.1:5050 (override)  ·  exit 0 = all pass, 1 = any wrong value.
// It self-authenticates (register+login with a browser UA to clear the bot gate). Run it
// against a throwaway/test instance, not a rate-limited prod.

const BASE = process.env.BASE || 'http://127.0.0.1:5050';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';
const g=s=>`\x1b[32m${s}\x1b[0m`, r=s=>`\x1b[31m${s}\x1b[0m`, dim=s=>`\x1b[2m${s}\x1b[0m`;
const near=(a,b,eps=1e-6)=>Number.isFinite(+a)&&Math.abs(+a-+b)<=eps;
const eqSet=(a,b)=>Array.isArray(a)&&a.length===b.length&&[...a].sort((x,y)=>x-y).every((v,i)=>near(v,[...b].sort((x,y)=>x-y)[i]));

let cookie = '';
async function auth() {
  const u = 'va' + Date.now().toString().slice(-8);
  const cred = { username: u, email: `${u}@example.com`, password: 'ValueAssert!2026' };
  const h = { 'content-type':'application/json', 'user-agent':UA, 'origin':BASE };
  const reg = await fetch(`${BASE}/api/auth/register`, { method:'POST', headers:h, body:JSON.stringify(cred) });
  const setC = (resp) => { const sc = resp.headers.get('set-cookie'); if (sc) cookie = sc.split(',').map(s=>s.split(';')[0].trim()).filter(c=>/concord_(auth|refresh)/.test(c)).join('; ') || cookie; };
  setC(reg);
  const lg = await fetch(`${BASE}/api/auth/login`, { method:'POST', headers:h, body:JSON.stringify({username:u,password:cred.password}) });
  setC(lg);
  return lg.ok;
}
async function run(domain, name, input) {
  const res = await fetch(`${BASE}/api/lens/run`, { method:'POST',
    headers:{ 'content-type':'application/json', 'user-agent':UA, 'origin':BASE, cookie },
    body: JSON.stringify({ domain, name, input }) });
  const b = await res.json().catch(()=>({}));
  return { status: res.status, result: b.result ?? b };
}

// Each case: known input → assertion on the computed result, with the hand-verified math.
const CASES = [
  { lens:'math', d:'math', n:'statisticalAnalysis', input:{ values:[2,4,4,4,5,5,7,9] },
    why:'Σ40/8 → mean 5, median (4+5)/2=4.5, popσ=√(32/8)=2, n=8',
    assert:r=>near(r.count,8)&&near(r.mean,5)&&near(r.median,4.5)&&near(r.stdDev,2),
    show:r=>`count=${r.count} mean=${r.mean} median=${r.median} σ=${r.stdDev}` },
  { lens:'math', d:'math', n:'polynomialAnalysis', input:{ coefficients:[1,-5,6] },
    why:'x²−5x+6 = (x−2)(x−3) → roots {2,3}, f′=2x−5',
    assert:r=>near(r.degree,2)&&eqSet(r.roots,[2,3])&&/2x\s*-\s*5/.test(r.derivative),
    show:r=>`degree=${r.degree} roots=${JSON.stringify(r.roots)} f'=${r.derivative}` },
  { lens:'math', d:'math', n:'regressionFit', input:{ x:[1,2,3], y:[2,4,6], type:'linear' },
    why:'y=2x exact → slope 2, intercept 0, R²=1',
    assert:r=>near(r.slope,2)&&near(r.intercept,0)&&near(r.rSquared,1),
    show:r=>`slope=${r.slope} intercept=${r.intercept} R²=${r.rSquared}` },
  { lens:'math', d:'math', n:'matrixOperations', input:{ matrixA:[[1,2],[3,4]], operation:'determinant' },
    why:'det[[1,2],[3,4]] = 1·4 − 2·3 = −2',
    assert:r=>near(r.determinant,-2), show:r=>`det=${r.determinant}` },
  { lens:'chem', d:'chem', n:'molecular-weight', input:{ formula:'H2O' },
    why:'2·1.008 + 15.999 = 18.015 g/mol',
    assert:r=>near(r.molecularWeight,18.015,1e-3), show:r=>`MW=${r.molecularWeight}` },
  { lens:'chem', d:'chem', n:'calc-molarity', input:{ moles:0.5, liters:2 },
    why:'M = mol/L = 0.5/2 = 0.25',
    assert:r=>near(r.molarity,0.25), show:r=>`M=${r.molarity}` },
];

console.log('\nBusiness-logic value assertions  '+dim(`(${BASE})`)+'\n');
if (!await auth()) { console.log(r('✗ could not authenticate — is the server up + accepting registration?')); process.exit(1); }
let pass=0, fail=0;
for (const c of CASES) {
  try {
    const { status, result } = await run(c.d, c.n, c.input);
    if (status >= 400) { console.log(`${r('✗')} ${c.lens}.${c.n}  HTTP ${status}`); fail++; continue; }
    const ok = c.assert(result);
    console.log(`${ok?g('✓'):r('✗')} ${c.lens}.${c.n.padEnd(20)} ${dim(c.why)}\n    → ${c.show(result)}`);
    ok ? pass++ : fail++;
  } catch (e) { console.log(`${r('✗')} ${c.lens}.${c.n}  ERROR ${String(e).slice(0,90)}`); fail++; }
}
console.log(`\n${pass===CASES.length?g(pass+' passed'):r(fail+' failed')} / ${CASES.length}`);
process.exit(fail ? 1 : 0);
