#!/usr/bin/env node
/**
 * ConKay INDUSTRIAL_CLASS certification harness (Mac OCC / cadquery-ocp).
 * Writes:
 *   ~/.zuko/remaining-work/conkay-industrial-class-cert.json
 *   ~/.zuko/remaining-work/CONKAY_INDUSTRIAL_CLASS_CERT.md
 *
 * CERTIFIED only when ALL gates I1–I6 PASS.
 *
 * Honesty:
 *   - industrial-class kernel capabilities proved
 *   - NOT physical ISO 17025 / ISO CMM lab certification (NEED_DUTCH for physical CMM)
 *   - NOT 1:1 SolidWorks UI parity
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const HOME = os.homedir();
const OUT_DIR = path.join(HOME, '.zuko', 'remaining-work');
const PROOF_DIR = path.join(OUT_DIR, 'conkay-industrial-class-proof', `run-${process.pid}`);
const PYTHON = process.env.CONKAY_OCC_PYTHON || path.join(HOME, '.zuko', 'venvs', 'cad-occ', 'bin', 'python');
const CLI = process.env.CONKAY_OCC_CLI || path.join(HOME, '.zuko', 'venvs', 'cad-occ', 'bin', 'conkay_occ_cli.py');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(PROOF_DIR, { recursive: true });

const LOCK = path.join(OUT_DIR, 'conkay-industrial-class-cert.lock');
let lockFd;
if (process.env.CONKAY_CERT_NO_LOCK === '1') {
  lockFd = null;
} else {
  try {
    lockFd = fs.openSync(LOCK, 'wx');
    fs.writeSync(lockFd, `${process.pid} ${new Date().toISOString()}\n`);
  } catch (e) {
    if (e && e.code === 'EEXIST') {
      const ageMs = Date.now() - fs.statSync(LOCK).mtimeMs;
      // Treat missing/negative/very-fresh locks as stale races (duplicate runners).
      if (ageMs >= 5000 && ageMs < 180000) {
        console.error(JSON.stringify({ ok: false, reason: 'cert_locked', ageMs, lock: LOCK }));
        process.exit(2);
      }
      try { fs.unlinkSync(LOCK); } catch { /* ignore */ }
      try {
        lockFd = fs.openSync(LOCK, 'wx');
        fs.writeSync(lockFd, `${process.pid} ${new Date().toISOString()}\n`);
      } catch (e2) {
        // Last writer wins for proof runs
        lockFd = null;
      }
    } else {
      throw e;
    }
  }
}
const releaseLock = () => {
  try { if (lockFd != null) fs.closeSync(lockFd); } catch { /* ignore */ }
  try { fs.unlinkSync(LOCK); } catch { /* ignore */ }
};
process.on('exit', releaseLock);
process.on('SIGINT', () => { releaseLock(); process.exit(130); });
process.on('SIGTERM', () => { releaseLock(); process.exit(143); });

function runCli(cmd, payload) {
  const r = spawnSync(PYTHON, [CLI, cmd, JSON.stringify(payload)], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    timeout: 180000,
  });
  const stdout = String(r.stdout || '');
  const stderr = String(r.stderr || '');
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  let parsed = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith('{')) continue;
    try {
      parsed = JSON.parse(lines[i]);
      break;
    } catch {
      /* continue */
    }
  }
  if (!parsed) {
    return {
      ok: false,
      reason: 'cli_no_json',
      status: r.status,
      stdout: stdout.slice(-800),
      stderr: stderr.slice(-800),
      error: r.error ? String(r.error.message || r.error) : undefined,
    };
  }
  return parsed;
}

function gate(id, name, pass, detail = {}) {
  return { id, name, status: pass ? 'PASS' : 'FAIL', ...detail };
}

function gitSha() {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' });
  return String(r.stdout || '').trim() || null;
}

function diskFreeGb() {
  const r = spawnSync('df', ['-g', HOME], { encoding: 'utf8' });
  const lines = String(r.stdout || '').trim().split('\n');
  if (lines.length < 2) return null;
  const parts = lines[1].split(/\s+/);
  // mac df -g: Filesystem Size Used Avail ...
  const avail = Number(parts[3]);
  return Number.isFinite(avail) ? avail : null;
}

function fileExists(rel) {
  return fs.existsSync(path.join(REPO, rel));
}

const startedAt = new Date().toISOString();
const gates = [];

// ── I1 — Multi-DOF constraint solver ─────────────────────────────────────
{
  const out = path.join(PROOF_DIR, 'i1-mate-dof.step');
  const res = runCli('mate-solve-dof', {
    bodies: [
      { id: 'cylA', kind: 'cylinder', params: { r: 5, h: 30 }, position: { x: 0, y: 0, z: 0 }, fixed: true },
      {
        id: 'cylB',
        kind: 'cylinder',
        params: { r: 5, h: 30 },
        position: { x: 12, y: 8, z: 2 },
        rotation: { rz_deg: 8 },
        lock: ['rx', 'ry'],
      },
      {
        id: 'plate',
        kind: 'plate',
        params: { dx: 40, dy: 40, dz: 4 },
        position: { x: -10, y: -10, z: 45 },
        lock: ['rx', 'ry', 'rz'],
      },
    ],
    mates: [
      { type: 'concentric', a: 0, b: 1 },
      { type: 'distance', a: 0, b: 2, axis: 'z', distance: 22, centered: true },
      { type: 'parallel', a: 0, b: 1, on: 'axis' },
    ],
    out,
    tol_mm: 1e-3,
    tol_rad: 1e-3,
    max_iter: 80,
    include_mesh: false,
  });
  const maxAbs = Number(res?.remeasure_after_trsf?.max_abs ?? res?.residual?.max_abs ?? 1e9);
  const pass = !!(res?.ok && res?.pass && res?.bodyCount >= 3 && maxAbs < 1e-3 && res?.export?.advanced_brep !== false);
  fs.writeFileSync(path.join(PROOF_DIR, 'i1.json'), JSON.stringify(res, null, 2));
  gates.push(
    gate('I1', 'Multi-DOF constraint solver (OCC gp_Trsf)', pass, {
      bodyCount: res?.bodyCount,
      mateCount: res?.mateCount,
      residual_max_abs: maxAbs,
      remeasure: res?.remeasure_after_trsf,
      placements: res?.placements,
      honesty: res?.honesty,
      reason: res?.reason,
      error: res?.error,
    }),
  );
}

// ── I2 — Feature breadth ─────────────────────────────────────────────────
{
  const out = path.join(PROOF_DIR, 'i2-advanced.step');
  const features = [
    { type: 'box', dx: 40, dy: 24, dz: 16 },
    { type: 'shell', thickness: 1.5 },
    { type: 'chamfer', distance: 0.4 },
    { type: 'union', tool: { type: 'cylinder', r: 4, h: 18, position: { x: 20, y: 12, z: -1 } } },
    { type: 'circular_pattern', count: 3, angle: 360, axis: 'z' },
    {
      type: 'revolve',
      angle: 360,
      sketch: { type: 'rect', x: 2, y: 0, w: 2, h: 4 },
      position: { x: 0, y: -40, z: 0 },
    },
  ];
  const res = runCli('feature-rebuild', {
    partId: 'ind_cert_i2',
    features,
    out,
    mesh_summary_only: true,
  });
  const notes = res?.notes || [];
  const advancedOps = ['revolve', 'chamfer', 'shell', 'draft', 'linear_pattern', 'circular_pattern', 'union'];
  const found = advancedOps.filter((op) => notes.some((n) => String(n).toLowerCase().includes(op)));
  const pass = !!(res?.ok && res?.export?.advanced_brep && found.length >= 4);
  fs.writeFileSync(path.join(PROOF_DIR, 'i2.json'), JSON.stringify(res, null, 2));
  gates.push(
    gate('I2', 'SolidWorks-class feature breadth (OCC B-rep ops)', pass, {
      notes,
      advancedOpsFound: found,
      advanced_brep: !!res?.export?.advanced_brep,
      solids: res?.solids,
      reason: res?.reason,
      error: res?.error,
      honesty: {
        note: 'Advanced OCC feature ops proved on one part. NOT SolidWorks feature/UI parity.',
      },
    }),
  );
}

// ── I3 — Sketch constraints ──────────────────────────────────────────────
{
  const out = path.join(PROOF_DIR, 'i3-sketch.step');
  const res = runCli('sketch-solve', {
    sketch: {
      points: [
        { id: 'p0', x: 0, y: 0 },
        { id: 'p1', x: 12, y: 0.8 },
        { id: 'p2', x: 11.5, y: 9.2 },
        { id: 'p3', x: 0.4, y: 8.5 },
      ],
      locked: ['p0.x', 'p0.y'],
      segments: [
        { type: 'line', a: 'p0', b: 'p1' },
        { type: 'line', a: 'p1', b: 'p2' },
        { type: 'line', a: 'p2', b: 'p3' },
        { type: 'line', a: 'p3', b: 'p0' },
      ],
      constraints: [
        { type: 'horizontal', a: 'p0', b: 'p1' },
        { type: 'vertical', a: 'p0', b: 'p3' },
        { type: 'horizontal', a: 'p3', b: 'p2' },
        { type: 'vertical', a: 'p1', b: 'p2' },
      ],
      dimensions: [
        { a: 'p0', b: 'p1', value: 20, axis: 'x' },
        { a: 'p0', b: 'p3', value: 10, axis: 'y' },
      ],
    },
    distance: 15,
    out,
    mesh_summary_only: true,
  });
  const pass = !!(res?.ok && res?.pass && res?.geometry_changed && res?.export?.advanced_brep);
  fs.writeFileSync(path.join(PROOF_DIR, 'i3.json'), JSON.stringify(res, null, 2));
  gates.push(
    gate('I3', 'Sketch constraints (H/V/coincident + driven dims)', pass, {
      geometry_changed: !!res?.geometry_changed,
      solved_rms: res?.solved_rms,
      bbox_solved: res?.bbox_solved,
      bbox_underconstrained: res?.bbox_underconstrained,
      reason: res?.reason,
      error: res?.error || res?.extrude_error,
    }),
  );
}

// ── I4 — Digital GD&T ────────────────────────────────────────────────────
{
  const res = runCli('gdt-digital', {
    features: [
      { type: 'box', dx: 40, dy: 30, dz: 20 },
      { type: 'cut', tool: { type: 'cylinder', r: 5, h: 30, position: { x: 20, y: 15, z: -5 } } },
    ],
    checks: [
      { type: 'flatness', tol: 0.05 },
      { type: 'perpendicularity', tol: 0.5 },
      { type: 'position', tol: 0.1, mode: 'cylinder_axis', axes: 'xy', nominal: { x: 20, y: 15, z: -5 } },
      { type: 'cylindricity', tol: 0.05 },
    ],
  });
  const checks = res?.checks || [];
  const kinds = new Set(checks.map((c) => c.type));
  const need = ['flatness', 'perpendicularity', 'position', 'cylindricity'];
  const pass = !!(
    res?.ok &&
    res?.pass &&
    res?.harness === 'digital_asme_y14_5_harness' &&
    need.every((k) => kinds.has(k)) &&
    checks.every((c) => c.pass)
  );
  fs.writeFileSync(path.join(PROOF_DIR, 'i4.json'), JSON.stringify(res, null, 2));
  gates.push(
    gate('I4', 'Digital ASME Y14.5-style GD&T (software metrology)', pass, {
      harness: res?.harness,
      checks,
      faceSummary: res?.faceSummary,
      honesty: res?.honesty,
      reason: res?.reason,
      error: res?.error,
    }),
  );
}

// ── I5 — Authoring surface ───────────────────────────────────────────────
{
  const overlay = fileExists('concord-frontend/components/conkay/ConKayOverlay.tsx');
  const helpers = fileExists('concord-frontend/lib/conkay/assembly-to-world.ts');
  const bridge = fileExists('server/lib/conkay/occ-bridge.js');
  const routes = fileExists('server/routes/conkay-assembly.js');
  const industrialMod = fileExists('server/scripts/conkay_occ_industrial.py');
  let overlayOk = false;
  let helpersOk = false;
  let routesOk = false;
  try {
    const ov = fs.readFileSync(path.join(REPO, 'concord-frontend/components/conkay/ConKayOverlay.tsx'), 'utf8');
    overlayOk = ['ck-mate-solve-dof', 'ck-gdt-digital', 'ck-industrial-cert', 'ck-add-feature'].every((s) => ov.includes(s));
    const hp = fs.readFileSync(path.join(REPO, 'concord-frontend/lib/conkay/assembly-to-world.ts'), 'utf8');
    helpersOk = ['mateSolveDof', 'gdtDigital', 'sketchSolve', 'occFeatureList'].every((s) => hp.includes(s));
    const rt = fs.readFileSync(path.join(REPO, 'server/routes/conkay-assembly.js'), 'utf8');
    routesOk = ['/occ/mate-solve-dof', '/occ/gdt-digital', '/occ/sketch-solve'].every((s) => rt.includes(s));
  } catch {
    /* ignore */
  }
  const probe = runCli('probe', {});
  const cmds = probe?.commands || [];
  const cmdOk = ['mate-solve-dof', 'gdt-digital', 'sketch-solve'].every(
    (c) => cmds.includes(c) || cmds.includes(c.replace(/-/g, '_')),
  );
  const pass = !!(overlay && helpers && bridge && routes && industrialMod && overlayOk && helpersOk && routesOk && cmdOk && probe?.ok);
  gates.push(
    gate('I5', 'Authoring surface (overlay + API + CLI)', pass, {
      overlay,
      helpers,
      bridge,
      routes,
      industrialMod,
      overlayOk,
      helpersOk,
      routesOk,
      cmdOk,
      probeCommands: cmds.filter((c) => /mate|gdt|sketch|feature/.test(String(c))),
    }),
  );
}

// ── I6 — Cert pack itself ────────────────────────────────────────────────
{
  const prior = gates.filter((g) => g.id !== 'I6');
  const allPrior = prior.every((g) => g.status === 'PASS');
  const sha = gitSha();
  const disk = diskFreeGb();
  const artifactsWritable = (() => {
    try {
      fs.accessSync(OUT_DIR, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  })();
  const pass = !!(allPrior && sha && artifactsWritable);
  gates.push(
    gate('I6', 'Certification pack', pass, {
      priorAllPass: allPrior,
      sha,
      diskFreeGb: disk,
      artifactsWritable,
      proofDir: PROOF_DIR,
    }),
  );
}

const finishedAt = new Date().toISOString();
const allPass = gates.every((g) => g.status === 'PASS');
const sha = gitSha();
const disk = diskFreeGb();

const report = {
  ok: allPass,
  status: allPass ? 'CERTIFIED' : 'NOT_CERTIFIED',
  tier: 'INDUSTRIAL_CLASS',
  startedAt,
  finishedAt,
  sha,
  diskFreeGb: disk,
  machine: 'Mac.lan',
  kernel: 'cadquery-ocp / OpenCascade',
  gates,
  need_dutch: [
    {
      item: 'physical_iso_17025_cmm_lab',
      reason: 'Physical ISO 17025 CMM lab certification still NEED_DUTCH — software metrology only.',
    },
    {
      item: 'solidworks_ui_parity_polish',
      reason: '1:1 SolidWorks UI parity / polish still NEED_DUTCH — industrial kernel capabilities only.',
    },
  ],
  honesty: {
    certified_means: 'Industrial-class kernel capabilities proved (multi-DOF mates, advanced B-rep features, sketch constraints, digital ASME Y14.5-style GD&T, authoring API/overlay).',
    not: [
      'Physical ISO 17025 / ISO CMM lab certification',
      '1:1 SolidWorks UI parity',
      'Fake ISO CMM lab cert',
    ],
    harness_label: 'digital_asme_y14_5_harness',
  },
};

fs.writeFileSync(path.join(OUT_DIR, 'conkay-industrial-class-cert.json'), JSON.stringify(report, null, 2));

const md = `# ConKay INDUSTRIAL_CLASS Certification

**Status: ${report.status}**

- Finished: ${finishedAt} UTC
- Git SHA: \`${sha || 'unknown'}\`
- Machine: Mac.lan (OCC cadquery-ocp)
- Disk free (GB): ${disk ?? '?'}

## Honesty
- **INDUSTRIAL_CLASS** = industrial-class **kernel** capabilities proved
- still **NOT** physical ISO 17025 / ISO CMM lab certification (physical CMM still NEED_DUTCH)
- still **NOT** 1:1 SolidWorks UI parity
- Gate I4 harness label: \`digital_asme_y14_5_harness\` — software metrology from B-rep/mesh — **never** “ISO CMM certified”

## Gates

${gates
  .map(
    (g) => `### Gate ${g.id} — ${g.name}: **${g.status}**

\`\`\`json
${JSON.stringify(g, null, 2)}
\`\`\`
`,
  )
  .join('\n')}

## NEED_DUTCH
${report.need_dutch.map((n) => `- **${n.item}**: ${n.reason}`).join('\n')}

## Artifacts
- JSON: \`~/.zuko/remaining-work/conkay-industrial-class-cert.json\`
- Proof dir: \`${PROOF_DIR}\`
`;

fs.writeFileSync(path.join(OUT_DIR, 'CONKAY_INDUSTRIAL_CLASS_CERT.md'), md);

console.log(JSON.stringify({ ok: allPass, status: report.status, sha, diskFreeGb: disk, gates: gates.map((g) => ({ id: g.id, status: g.status })) }, null, 2));
process.exit(allPass ? 0 : 1);
