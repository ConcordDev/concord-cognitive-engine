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
  const cred = { username: u, email: `${u}@example.com`, password: 'ValueAssert!2026', dateOfBirth: '1990-01-01' };
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
  { lens:'chem', d:'chem', n:'molecularAnalysis', input:{ formula:'H2O' },
    why:'molar mass 18.015 g/mol, elements H:2 O:1',
    assert:r=>near(r.molarMass,18.015,1e-3)&&r.elements?.H===2&&r.elements?.O===1,
    show:r=>`molarMass=${r.molarMass} elements=${JSON.stringify(r.elements)}` },
  { lens:'chem', d:'chem', n:'balanceReaction', input:{ equation:'H2 + O2 = H2O' },
    why:'2H₂ + O₂ → 2H₂O (coeffs 2,1,2)',
    assert:r=>r.coefficients?.H2===2&&r.coefficients?.O2===1&&r.coefficients?.H2O===2,
    show:r=>`${r.balanced}` },
  { lens:'physics', d:'physics', n:'kinematicsSim', input:{ initialVelocity:0, acceleration:10, time:2 },
    why:'v = u+at = 20, s = ½at² = 20  (was mislabeled structural)',
    assert:r=>near(r.finalVelocity,20)&&near(r.displacement,20),
    show:r=>`v=${r.finalVelocity} s=${r.displacement}` },
  { lens:'physics', d:'physics', n:'orbitalMechanics', input:{ mass1:5.972e24, mass2:7.348e22, distance:3.844e8 },
    why:'Earth–Moon F = G·m₁·m₂/r² ≈ 1.98×10²⁰ N  (was calling windLoad)',
    assert:r=>near(r.gravitationalForce/1e20, 1.982, 0.01),
    show:r=>`F=${r.gravitationalForce?.toExponential?.(3)} N, v=${Math.round(r.orbitalVelocity)} m/s` },
  { lens:'physics', d:'physics', n:'waveInterference', input:{ frequency:100, waveSpeed:340 },
    why:'λ = v/f = 340/100 = 3.4 m',
    assert:r=>near(r.results?.wavelength?.value,3.4),
    show:r=>`λ=${r.results?.wavelength?.value} m` },
  { lens:'quantum', d:'quantum', n:'simulateCircuit', input:{ qubits:1, gates:[{type:'H',target:0}] },
    why:'Hadamard on |0⟩ → equal superposition: P(0)=P(1)=0.5, amp 1/√2≈0.707',
    assert:r=>near(r.stateProbabilities?.[0]?.probability,0.5)&&near(r.stateProbabilities?.[0]?.amplitude?.re,0.707107,1e-4),
    show:r=>`P(0)=${r.stateProbabilities?.[0]?.probability} amp=${r.stateProbabilities?.[0]?.amplitude?.re}` },
  { lens:'finance', d:'finance', n:'compoundInterest', input:{ principal:1000, annualRate:0.05, years:10 },
    why:'$1000 @ 5%/yr, 10y, monthly comp → 1000·(1+0.05/12)¹²⁰ = 1647.01',
    assert:r=>near(r.finalBalance,1647.01,0.5),
    show:r=>`finalBalance=${r.finalBalance}` },
  { lens:'chem', d:'chem', n:'solutionChemistry', input:{ type:'strong-acid', concentration:0.01 },
    why:'0.01 M strong acid → pH=−log(0.01)=2, pOH=pKw−pH=12  (was pOH=2)',
    assert:r=>near(r.pH,2)&&near(r.pOH,12,0.05),
    show:r=>`pH=${r.pH} pOH=${r.pOH}` },
  { lens:'chem', d:'chem', n:'enthalpyCalc', input:{ reactants:[{formula:'H2(g)',moles:2},{formula:'O2(g)',moles:1}], products:[{formula:'H2O(l)',moles:2}] },
    why:'2H₂(g)+O₂(g)→2H₂O(l): ΔH = 2·(−285.8) − 0 = −571.6 kJ',
    assert:r=>near(r.deltaH,-571.6,0.5), show:r=>`ΔH=${r.deltaH}` },
  { lens:'chem', d:'chem', n:'gibbsEnergy', input:{ deltaH:-286, deltaS:-163, tempK:298 },
    why:'ΔG = ΔH − TΔS = −286 − 298·(−0.163) = −237.4 kJ/mol',
    assert:r=>near(r.deltaG,-237.426,0.1), show:r=>`ΔG=${r.deltaG}` },
  { lens:'physics', d:'physics', n:'thermodynamics', input:{ moles:1, temperatureK:273.15, volume:0.022414 },
    why:'PV=nRT → P = nRT/V = 8.314·273.15/0.022414 ≈ 101325 Pa',
    assert:r=>near(r.results?.idealGas?.value,101325,5),
    show:r=>`P=${Math.round(r.results?.idealGas?.value)} Pa` },
  { lens:'quantum', d:'quantum', n:'analyzeCircuit', input:{ qubits:2, gates:[{type:'H',target:0},{type:'CNOT',control:0,target:1}] },
    why:'Bell pair H+CNOT → (|00⟩+|11⟩)/√2: P(00)=P(11)=0.5, depth 2',
    assert:r=>near(r.depth,2)&&near(r.stateProbabilities?.[0]?.probability,0.5),
    show:r=>`depth=${r.depth} P(00)=${r.stateProbabilities?.[0]?.probability}` },
  { lens:'engineering', d:'engineering', n:'stressAnalysis', input:{ forceNewtons:1000, crossSectionMm2:10, yieldStrengthMPa:250 },
    why:'σ = F/A = 1000N/10mm² = 100 MPa, SF = 250/100 = 2.5',
    assert:r=>String(r.appliedStress).includes('100')&&near(r.safetyFactor,2.5),
    show:r=>`σ=${r.appliedStress} SF=${r.safetyFactor}` },
  { lens:'engineering', d:'engineering', n:'unitConvert', input:{ value:1, from:'in', to:'mm' },
    why:'1 in = 25.4 mm',
    assert:r=>String(r.output).includes('25.4'), show:r=>`${r.output}` },
  { lens:'sim', d:'sim', n:'sensitivity-analysis', input:{ baseline:[1,2,3], variables:[{name:'a',samples:[2,4,6]}] },
    why:'corr([1,2,3],[2,4,6]) = 1 (perfectly correlated)',
    assert:r=>near(r.sensitivity?.[0]?.correlation?.value ?? r.sensitivity?.[0]?.correlation, 1),
    show:r=>`corr=${r.sensitivity?.[0]?.correlation?.value ?? r.sensitivity?.[0]?.correlation}` },
  { lens:'accounting', d:'accounting', n:'trialBalance', input:{ accounts:[
      {accountNumber:'1000',name:'Cash',type:'asset',entries:[{debit:1500},{credit:500}]},
      {accountNumber:'1500',name:'Equipment',type:'asset',entries:[{debit:800}]},
      {accountNumber:'2000',name:'AP',type:'liability',entries:[{credit:1800}]}] },
    why:'Cash net-D 1000 + Equip 800 = 1800 debits; A/P 1800 credits → balanced',
    assert:r=>near(r.totalDebits,1800)&&near(r.totalCredits,1800)&&r.isBalanced===true,
    show:r=>`D=${r.totalDebits} C=${r.totalCredits} balanced=${r.isBalanced}` },
  { lens:'accounting', d:'accounting', n:'profitLoss', input:{ accounts:[
      {name:'Sales',type:'revenue',entries:[{credit:5000,date:'2026-03-01'}]},
      {name:'Rent',type:'expense',entries:[{debit:3000,date:'2026-03-01'}]}] },
    why:'revenue 5000 − expenses 3000 → net income 2000',
    assert:r=>near(r.revenue?.total,5000)&&near(r.operatingExpenses?.total,3000)&&near(r.netIncome,2000),
    show:r=>`rev=${r.revenue?.total} exp=${r.operatingExpenses?.total} net=${r.netIncome}` },
  { lens:'accounting', d:'accounting', n:'budgetVariance', input:{ budget:[{category:'Marketing',planned:1000,actual:1200}] },
    why:'actual 1200 − planned 1000 = 200 over (20%)',
    assert:r=>near(r.lineItems?.[0]?.variance,200)&&r.lineItems?.[0]?.status==='over-budget',
    show:r=>`variance=${r.lineItems?.[0]?.variance} ${r.lineItems?.[0]?.status}` },
  { lens:'finance', d:'finance', n:'portfolioAnalysis', input:{ holdings:[{symbol:'A',value:6000},{symbol:'B',value:4000}] },
    why:'$6000/$10000 = 60% allocation, $4000 = 40%',
    assert:r=>near(r.holdings?.[0]?.allocation,60)&&near(r.holdings?.[1]?.allocation,40),
    show:r=>`A=${r.holdings?.[0]?.allocation}% B=${r.holdings?.[1]?.allocation}%` },
  { lens:'finance', d:'finance', n:'debtPayoff', input:{ debts:[{name:'Card',balance:1000,rate:0.12,minimumPayment:100}], extraPayment:0 },
    why:'$1000 @ 12% APR, $100/mo → ~11 months to debt-free',
    assert:r=>near(r.monthsToDebtFree,11,1),
    show:r=>`months=${r.monthsToDebtFree}` },
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
