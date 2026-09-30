#!/usr/bin/env node
/**
 * ConKay INDUSTRY VERTICALS certification harness.
 * Writes:
 *   ~/.zuko/remaining-work/conkay-industry-verticals-cert.json
 *   ~/.zuko/remaining-work/CONKAY_INDUSTRY_VERTICALS_CERT.md
 *
 * CERTIFIED only when gates V1–V6 all PASS with measured numbers.
 *
 * Honesty / overclaims rejected:
 *   - no 47/47 workers, no 140ms, no 10×–129× unless measured here
 *   - no ISO CMM lab / FDA clearance / clinical deployment
 *   - BIO: structural geometry + synthetic hospital only
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

import { buildMolecularCad } from '../../server/lib/conkay/verticals/molecular-cad.js';
import { runHospitalOpsCert } from '../../server/lib/conkay/verticals/hospital-ops.js';
import { runProstheticsCert } from '../../server/lib/conkay/verticals/prosthetics.js';
import { runAeroCert } from '../../server/lib/conkay/verticals/aerodynamics.js';
import { compileStudioShot, compileStudioShotLive } from '../../server/lib/conkay/verticals/studio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const HOME = os.homedir();
const OUT_DIR = path.join(HOME, '.zuko', 'remaining-work');
const PROOF_DIR = path.join(OUT_DIR, 'conkay-industry-verticals-proof', `run-${process.pid}`);
const JSON_OUT = path.join(OUT_DIR, 'conkay-industry-verticals-cert.json');
const MD_OUT = path.join(OUT_DIR, 'CONKAY_INDUSTRY_VERTICALS_CERT.md');
const DOC_OUT = path.join(HOME, '.zuko', 'CONKAY_INDUSTRY_VERTICALS.md');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(PROOF_DIR, { recursive: true });

function diskFreeGb() {
  try {
    const out = execSync('df -g /Users/dutch | tail -1', { encoding: 'utf8' });
    const parts = out.trim().split(/\s+/);
    // macOS df -g: Filesystem Size Used Avail % iused ifree % mounted
    const avail = Number(parts[3]);
    return Number.isFinite(avail) ? avail : null;
  } catch {
    try {
      const out = execSync('df -h /Users/dutch | tail -1', { encoding: 'utf8' });
      const m = out.match(/\s(\d+)Gi?\s+(\d+)%/);
      // fallback parse Avail column
      const parts = out.trim().split(/\s+/);
      return parts[3] || null;
    } catch {
      return null;
    }
  }
}

function gitSha() {
  try {
    return execSync('git rev-parse HEAD', { cwd: REPO, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

async function tryLogin() {
  const userFile = path.join(OUT_DIR, '_audit_user.txt');
  if (!fs.existsSync(userFile)) return null;
  try {
    const creds = Object.fromEntries(
      fs.readFileSync(userFile, 'utf8').trim().split('\n').map((l) => {
        const i = l.indexOf('=');
        return i >= 0 ? [l.slice(0, i), l.slice(i + 1)] : [l, ''];
      }),
    );
    if (!creds.USER || !creds.PASS) return null;
    const loginRes = await fetch('http://127.0.0.1:5050/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 ConKayIndustryCert' },
      body: JSON.stringify({ username: creds.USER, password: creds.PASS }),
    });
    const login = await loginRes.json();
    return login?.token || null;
  } catch {
    return null;
  }
}

async function apiPost(token, route, body) {
  const t0 = Date.now();
  const r = await fetch(`http://127.0.0.1:5050${route}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'Mozilla/5.0 ConKayIndustryCert',
      Origin: 'http://127.0.0.1:3000',
    },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, json: j, ms: Date.now() - t0 };
}

const gates = {};
const overclaimsRejected = [
  '47/47 workers alive',
  '140ms (unless measured)',
  '10×–129× compression (unless measured this run)',
  'ISO CMM lab certification',
  'FDA clearance',
  'clinical deployment',
  'ANSYS/Fluent class CFD',
  'full molecular dynamics',
];

// ── V1 Molecular ──────────────────────────────────────────────
{
  const samples = [];
  let last = null;
  let caffeine = null;
  let c60 = null;
  let sucrose = null;
  for (const text of ['H2O', 'C2H6O', 'PEG n=24', 'water', 'caffeine', 'C6H6', 'sucrose', 'C60']) {
    const t0 = Date.now();
    const r = buildMolecularCad({ text, relaxSteps: 96 });
    const e2e = Date.now() - t0;
    samples.push({
      text,
      ok: !!r.ok,
      ms: r.ms ?? e2e,
      e2eMs: e2e,
      verts: r.mesh?.vertexCount,
      atoms: r.atoms?.length,
      bonds: r.bonds?.length,
      relaxSteps: r.proxy?.mdRelax?.steps ?? null,
      deltaE: r.proxy?.mdRelax?.deltaE ?? null,
    });
    if (r.ok) last = r;
    if (text === 'caffeine' && r.ok) caffeine = r;
    if (text === 'C60' && r.ok) c60 = r;
    if (text === 'sucrose' && r.ok) sucrose = r;
  }
  const msList = samples.filter((s) => s.ok).map((s) => s.e2eMs).sort((a, b) => a - b);
  const apiToken = await tryLogin();
  let api = null;
  if (apiToken) {
    try {
      api = await apiPost(apiToken, '/api/conkay/molecular/build', { text: 'C60', relaxSteps: 96 });
    } catch (e) {
      api = { error: e?.message || String(e) };
    }
  }
  const pass =
    !!last?.ok &&
    Array.isArray(last.mesh?.positions) &&
    last.mesh.positions.length >= 9 &&
    Array.isArray(last.mesh?.indices) &&
    last.proxy?.label === 'PROXY' &&
    msList.length >= 4 &&
    !!last.proxy?.mdRelax &&
    last.proxy.mdRelax.steps >= 64 &&
    (caffeine?.atoms?.length || 0) >= 20 &&
    (caffeine?.bonds?.length || 0) >= 20 &&
    (c60?.atoms?.length || 0) >= 60 &&
    (sucrose?.atoms?.length || 0) >= 40;
  gates.V1 = {
    name: 'Molecular CAD (physics geometry PROXY + MD relax)',
    pass,
    measured: {
      samples,
      latencyMs_p50: msList[Math.floor(msList.length * 0.5)] ?? null,
      latencyMs_max: msList[msList.length - 1] ?? null,
      ljEnergy: last?.proxy?.ljEnergy ?? null,
      bondStretchEnergy: last?.proxy?.bondStretchEnergy ?? null,
      density: last?.proxy?.density ?? null,
      atomCount: last?.proxy?.atomCount ?? last?.atoms?.length ?? null,
      bondCount: last?.proxy?.bondCount ?? last?.bonds?.length ?? null,
      mdRelax: last?.proxy?.mdRelax ?? null,
      caffeineAtoms: caffeine?.atoms?.length ?? null,
      caffeineBonds: caffeine?.bonds?.length ?? null,
      c60Atoms: c60?.atoms?.length ?? null,
      c60Bonds: c60?.bonds?.length ?? null,
      sucroseAtoms: sucrose?.atoms?.length ?? null,
      angleBend: last?.proxy?.angleBend ?? null,
      meshVertexCount: last?.mesh?.vertexCount ?? null,
      meshTriangleCount: last?.mesh?.triangleCount ?? null,
      apiLive: !!(api?.json?.ok),
      apiMs: api?.ms ?? null,
      apiStatus: api?.status ?? null,
      apiRelaxSteps: api?.json?.proxy?.mdRelax?.steps ?? null,
    },
    route: 'POST /api/conkay/molecular/build',
    honesty: last?.honesty || null,
  };
  fs.writeFileSync(path.join(PROOF_DIR, 'v1-molecular.json'), JSON.stringify({ last, samples, caffeine, c60, sucrose, api }, null, 2));
}

// ── V2 Hospital ───────────────────────────────────────────────
{
  let concordLive = false;
  try {
    const hr = await fetch('http://127.0.0.1:5050/health', { signal: AbortSignal.timeout(1500) });
    const hj = await hr.json().catch(() => ({}));
    concordLive = hr.ok && (hj?.status === 'healthy' || hj?.ok === true || !!hj?.checks);
  } catch {
    concordLive = false;
  }
  const hosp = runHospitalOpsCert({ n: 200, beds: 40, samples: 9, concordLive });
  // Guard: never promote DHTP HASH design ratio as hospital payload compression
  const ratio = hosp.compressionRatio;
  const brotliRatio = hosp.brotliPacketRatio;
  const pass =
    hosp.ok &&
    hosp.n >= 200 &&
    Number.isFinite(ratio) &&
    ratio > 1 &&
    Number.isFinite(brotliRatio) &&
    brotliRatio > 1.5 &&
    Number.isFinite(hosp.latencyMs?.p50) &&
    Number.isFinite(hosp.latencyMs?.p95) &&
    hosp.honesty?.syntheticOnly === true &&
    hosp.dhtpOk === true &&
    hosp.packetQuality?.schemaVersion === 'hospital.packet.v2' &&
    (hosp.packetQuality?.fieldCoverage?.chiefCoded || 0) >= 0.9 &&
    (hosp.packetQuality?.uniqueIdRatio || 0) >= 0.99;
  gates.V2 = {
    name: 'Hospital ops packets + triage (SYNTHETIC ONLY)',
    pass,
    measured: {
      n: hosp.n,
      originalBytes: hosp.originalBytes,
      packetBytes: hosp.packetBytes,
      compressionRatio_localPackets: ratio,
      brotliPacketRatio: brotliRatio,
      brotli: hosp.brotli,
      dhtpHashPathRatio_separate: hosp.dhtpRatio,
      dhtpOk: hosp.dhtpOk,
      dhtpWorkingSetSize: hosp.dhtpWorkingSetSize,
      dhtpConcordLive: hosp.dhtpConcordLive,
      concordLive,
      compressionPath: hosp.compressionPath,
      packetQuality: hosp.packetQuality,
      note: 'Hospital gate uses local feature-packet + brotli ratios. DHTP HASH DTU ref ratio is reported separately and MUST NOT be quoted as EHR compression.',
      triage: hosp.triage,
      latencyMs: hosp.latencyMs,
    },
    honesty: hosp.honesty,
  };
  fs.writeFileSync(path.join(PROOF_DIR, 'v2-hospital.json'), JSON.stringify(hosp, null, 2));
}

// ── V3 Prosthetics ────────────────────────────────────────────
{
  const outDir = path.join(PROOF_DIR, 'prosthetics');
  const pros = runProstheticsCert({ outDir, tolMm: 0.5 });
  const pass =
    pros.ok &&
    pros.metrologyPass === true &&
    pros.fileWritesOk === true &&
    fs.existsSync(pros.toolpath?.gcodePath) &&
    fs.existsSync(pros.toolpath?.telemetryPath);
  gates.V3 = {
    name: 'Prosthetics / bioprint toolpath',
    pass,
    measured: {
      metrologyPass: pros.metrologyPass,
      absMaxResidualMm: pros.fit?.absMaxResidualMm,
      tolMm: pros.fit?.tolMm,
      gcodePath: pros.toolpath?.gcodePath,
      telemetryPath: pros.toolpath?.telemetryPath,
      gcodeBytes: pros.toolpath?.gcodeBytes,
      layers: pros.toolpath?.layers,
      fileWrites: pros.toolpath?.fileWrites,
      ms: pros.ms,
      meshVerts: pros.socket?.mesh?.vertexCount,
    },
    honesty: {
      ...pros.fit?.honesty,
      ...pros.socket?.honesty,
      fda: false,
      clinical: false,
    },
  };
  fs.writeFileSync(path.join(PROOF_DIR, 'v3-prosthetics.json'), JSON.stringify(pros, null, 2));
}

// ── V4 Studio ─────────────────────────────────────────────────
{
  const shot = compileStudioShot({ text: 'steel sword hero prop' });
  const token = await tryLogin();
  let live = null;
  if (token) {
    live = await compileStudioShotLive({ text: 'steel sword' }, { token });
  }
  // PASS if shot packet compiles with mesh + glb hook; live GLB is bonus if server up
  const pass =
    shot.ok &&
    !!shot.shot?.timeline?.length &&
    Array.isArray(shot.mesh?.positions) &&
    !!shot.glbHook?.route;
  gates.V4 = {
    name: 'Studio slice (shot packet + design-glb hook)',
    pass,
    measured: {
      archetype: shot.shot?.archetype,
      frames: shot.shot?.frames,
      timelineSteps: shot.shot?.timeline?.length,
      meshVerts: shot.mesh?.vertexCount,
      ms: shot.ms,
      liveGlb: live?.live ?? false,
      liveGlbUrl: live?.liveGlb?.glbUrl ?? null,
      liveApiMs: live?.liveGlb?.apiMs ?? null,
      glbHook: shot.glbHook,
    },
    honesty: shot.honesty,
  };
  fs.writeFileSync(path.join(PROOF_DIR, 'v4-studio.json'), JSON.stringify({ shot, live }, null, 2));
}

// ── V5 Aerodynamics ───────────────────────────────────────────
{
  const last = runAeroCert({ alphaDeg: 5 });
  const samples = (last.alphaCurve || []).map((pt) => ({
    alphaDeg: pt.alphaDeg,
    ok: true,
    Cl: pt.Cl,
    Cd: pt.Cd,
    Cm: pt.Cm,
    L_D: pt.L_D,
    ms: pt.ms,
  }));
  const pass =
    last.ok &&
    last.label === 'PROXY' &&
    Number.isFinite(last.coefficients?.Cl) &&
    Number.isFinite(last.coefficients?.Cd) &&
    Number.isFinite(last.coefficients?.Cm) &&
    Array.isArray(last.pressureMap) &&
    last.pressureMap.length >= 32 &&
    Array.isArray(last.alphaCurve) &&
    last.alphaCurve.length >= 12 &&
    (last.coefficients?.panelCount || 0) >= 2000 &&
    (last.pressureMap?.length || 0) >= 64 &&
    (last.coefficients?.chordPts || 0) >= 48;
  gates.V5 = {
    name: 'Aerodynamics panel CFD PROXY (multi-α)',
    pass,
    measured: {
      samples,
      Cl: last.coefficients?.Cl,
      Cd: last.coefficients?.Cd,
      Cm: last.coefficients?.Cm,
      CdInduced: last.coefficients?.CdInduced,
      L_D: last.coefficients?.L_D,
      panelCount: last.coefficients?.panelCount,
      clMax: last.clMax,
      alphaStallProxy: last.alphaStallProxy,
      alphaCurvePoints: last.alphaCurve?.length ?? 0,
      latencyMs: last.ms,
      sweepMs: last.sweepMs,
      pressureMapCount: last.pressureMap?.length,
      meshVerts: last.mesh?.vertexCount,
      meshTris: last.mesh?.triangleCount,
      chordPts: last.coefficients?.chordPts,
      spanPts: last.coefficients?.spanPts,
      camber: last.coefficients?.camber,
    },
    honesty: last.honesty,
  };
  fs.writeFileSync(path.join(PROOF_DIR, 'v5-aero.json'), JSON.stringify({ samples, last: { ...last, mesh: { ...last.mesh, positions: undefined, indices: undefined } } }, null, 2));
}

// ── V6 Cert pack itself ───────────────────────────────────────
{
  const requiredFiles = [
    'server/lib/conkay/verticals/molecular-cad.js',
    'server/lib/conkay/verticals/hospital-ops.js',
    'server/lib/conkay/verticals/prosthetics.js',
    'server/lib/conkay/verticals/aerodynamics.js',
    'server/lib/conkay/verticals/studio.js',
    'server/routes/conkay-verticals.js',
    'concord-frontend/scripts/conkay-industry-verticals-cert.mjs',
    'concord-frontend/components/conkay/ConKayVerticalsBar.tsx',
  ];
  const missing = requiredFiles.filter((f) => !fs.existsSync(path.join(REPO, f)));
  const vPass = ['V1', 'V2', 'V3', 'V4', 'V5'].every((k) => gates[k]?.pass);
  gates.V6 = {
    name: 'Cert pack artifacts',
    pass: missing.length === 0 && vPass,
    measured: {
      missing,
      proofDir: PROOF_DIR,
      jsonOut: JSON_OUT,
      mdOut: MD_OUT,
      priorGatesPass: vPass,
    },
  };
}

const allPass = Object.values(gates).every((g) => g.pass);
const status = allPass ? 'CERTIFIED' : 'NOT_CERTIFIED';
const sha = gitSha();
const disk = diskFreeGb();
const needDutch = [];
if (!gates.V4?.measured?.liveGlb) {
  needDutch.push('Optional: confirm design-glb live path under auth for Studio GLB (packet path already PASS)');
}
needDutch.push('Physical ISO CMM / FDA / clinical deployment — out of scope (NEED_DUTCH)');
needDutch.push('Full MD / ANSYS-class CFD — design-target, not LIVE');

const report = {
  status,
  certified: allPass,
  at: new Date().toISOString(),
  atET: new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' ET',
  gitSha: sha,
  branch: 'handoff-cherry-pick',
  diskFreeGb: disk,
  proofDir: PROOF_DIR,
  gates,
  overclaimsRejected,
  needDutch,
  honesty: {
    bio: 'structural molecular geometry + biocompatible polymer geometry only',
    hospital: 'SYNTHETIC patients only — not clinical advice',
    prosthetics: 'synthetic socket + G-code stub — not FDA',
    aero: 'panel PROXY — not ANSYS/Fluent',
    studio: 'shot packet + existing design-glb hook',
  },
};

fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));

const md = `# ConKay INDUSTRY VERTICALS CERT — ${status}

- **When:** ${report.atET}
- **Git SHA:** \`${sha || 'unknown'}\`
- **Branch:** handoff-cherry-pick
- **Disk free (GB):** ${disk}
- **Proof dir:** \`${PROOF_DIR}\`

## Gates

| Gate | Name | Result | Key measurements |
|------|------|--------|------------------|
| V1 | Molecular CAD PROXY+relax | ${gates.V1.pass ? 'PASS' : 'FAIL'} | p50=${gates.V1.measured.latencyMs_p50}ms · atoms=${gates.V1.measured.atomCount} · bonds=${gates.V1.measured.bondCount} · relax=${gates.V1.measured.mdRelax?.steps} · ΔE=${gates.V1.measured.mdRelax?.deltaE?.toFixed?.(3)} · caffeineAtoms=${gates.V1.measured.caffeineAtoms} · apiLive=${gates.V1.measured.apiLive} |
| V2 | Hospital SYNTHETIC triage | ${gates.V2.pass ? 'PASS' : 'FAIL'} | n=${gates.V2.measured.n} · ratio_local=${gates.V2.measured.compressionRatio_localPackets?.toFixed?.(3)} · brotli=${gates.V2.measured.brotliPacketRatio?.toFixed?.(3)} · dhtpWS=${gates.V2.measured.dhtpWorkingSetSize} · live=${gates.V2.measured.concordLive} · p50=${gates.V2.measured.latencyMs?.p50}ms |
| V3 | Prosthetics toolpath | ${gates.V3.pass ? 'PASS' : 'FAIL'} | metrology=${gates.V3.measured.metrologyPass} · residual=${gates.V3.measured.absMaxResidualMm}mm · gcodeBytes=${gates.V3.measured.gcodeBytes} |
| V4 | Studio shot packet | ${gates.V4.pass ? 'PASS' : 'FAIL'} | archetype=${gates.V4.measured.archetype} · frames=${gates.V4.measured.frames} · liveGlb=${gates.V4.measured.liveGlb} |
| V5 | Aero panel PROXY multi-α | ${gates.V5.pass ? 'PASS' : 'FAIL'} | Cl=${gates.V5.measured.Cl} · Cd=${gates.V5.measured.Cd} · Cm=${gates.V5.measured.Cm} · panels=${gates.V5.measured.panelCount} · αpts=${gates.V5.measured.alphaCurvePoints} · clMax=${gates.V5.measured.clMax} |
| V6 | Cert pack | ${gates.V6.pass ? 'PASS' : 'FAIL'} | missing=${(gates.V6.measured.missing || []).join(',') || 'none'} |

## Overclaims rejected
${overclaimsRejected.map((x) => `- ${x}`).join('\n')}

## NEED_DUTCH
${needDutch.map((x) => `- ${x}`).join('\n')}

## Honesty
- Molecular / polymer: **PROXY** equations (LJ, bond stretch, density, damped-Verlet relax) — not full MD
- Hospital: **SYNTHETIC ONLY** — not clinical advice / not FDA / not deployed clinical
- Prosthetics: digital AABB/axis fit + G-code — **not** ISO CMM lab / not FDA
- Aero: richer panel **PROXY** + multi-α curve + induced-drag/Cm — not ANSYS/Fluent
- Compression: hospital gate quotes **local packet ratio** only; DHTP HASH path ratio is separate and must not be marketed as EHR compression
`;

fs.writeFileSync(MD_OUT, md);

const doc = `# ConKay Industry Verticals — designed vs LIVE

Updated: ${report.atET}
Status: **${status}**
Cert: \`~/.zuko/remaining-work/conkay-industry-verticals-cert.json\`

## LIVE (this wave)
| Vertical | LIVE surface | Honesty |
|----------|--------------|---------|
| Molecular CAD | \`POST /api/conkay/molecular/build\` + overlay Mol | PROXY LJ/bond/density; structural geometry only |
| Hospital ops | \`POST /api/conkay/hospital/*\` + overlay Hosp | SYNTHETIC patients; triage PROXY; not clinical |
| Prosthetics / bioprint | \`POST /api/conkay/prosthetics/*\` + overlay Pros | Synthetic socket; digital fit; G-code + telemetry stub |
| Studio | \`POST /api/conkay/studio/shot\` + existing design-glb / evo overlay | Shot/timeline packet; GLB via archetype path |
| Aerodynamics | \`POST /api/conkay/aero/panel\` + overlay Aero | Coarse panel Cp / Cl Cd PROXY |

## Designed (not LIVE)
- Full molecular dynamics / DFT / wet-lab
- FDA-cleared clinical decision support / real EHR PHI
- Physical ISO 17025 CMM / implant manufacture
- ANSYS/Fluent-class CFD
- Full NLE studio suite

## Routes
- \`/api/conkay/molecular/build\`
- \`/api/conkay/hospital/intake|compress|triage|run\`
- \`/api/conkay/prosthetics/socket|fit-check|toolpath|run\`
- \`/api/conkay/studio/shot\`
- \`/api/conkay/aero/panel\`
- \`GET /api/conkay/verticals/status\`

## Code
- \`server/lib/conkay/verticals/*\`
- \`server/routes/conkay-verticals.js\`
- \`concord-frontend/components/conkay/ConKayVerticalsBar.tsx\`
- Cert: \`concord-frontend/scripts/conkay-industry-verticals-cert.mjs\`
`;
fs.writeFileSync(DOC_OUT, doc);

console.log(JSON.stringify({ status, allPass, json: JSON_OUT, md: MD_OUT, sha, disk }, null, 2));
process.exit(allPass ? 0 : 1);
