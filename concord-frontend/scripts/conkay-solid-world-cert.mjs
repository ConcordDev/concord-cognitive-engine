#!/usr/bin/env node
/**
 * ConKay FULL SOLID WORLD certification harness (Mac OCC / cadquery-ocp).
 * Writes:
 *   ~/.zuko/remaining-work/conkay-solid-world-cert.json
 *   ~/.zuko/remaining-work/CONKAY_SOLID_WORLD_CERT.md
 *
 * CERTIFIED only when ALL gates A–F PASS.
 * Honesty: NOT SolidWorks feature-parity. NOT ISO CMM lab certification.
 * Gate D is a geometry verification harness.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const HOME = os.homedir();
const OUT_DIR = path.join(HOME, '.zuko', 'remaining-work');
const PROOF_DIR = path.join(OUT_DIR, 'conkay-solid-world-proof', `run-${process.pid}`);
const PYTHON = process.env.CONKAY_OCC_PYTHON || path.join(HOME, '.zuko', 'venvs', 'cad-occ', 'bin', 'python');
const CLI = process.env.CONKAY_OCC_CLI || path.join(HOME, '.zuko', 'venvs', 'cad-occ', 'bin', 'conkay_occ_cli.py');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(PROOF_DIR, { recursive: true });

// Single-flight: concurrent cert runs race OCC STEP writers and flake gates.
const LOCK = path.join(OUT_DIR, 'conkay-solid-world-cert.lock');
let lockFd;
try {
  lockFd = fs.openSync(LOCK, 'wx');
  fs.writeSync(lockFd, `${process.pid} ${new Date().toISOString()}\n`);
} catch (e) {
  if (e && e.code === 'EEXIST') {
    const ageMs = Date.now() - fs.statSync(LOCK).mtimeMs;
    if (ageMs < 180000) {
      console.error(JSON.stringify({ ok: false, reason: 'cert_locked', ageMs, lock: LOCK }));
      process.exit(2);
    }
    try { fs.unlinkSync(LOCK); } catch { /* ignore */ }
    lockFd = fs.openSync(LOCK, 'wx');
    fs.writeSync(lockFd, `${process.pid} ${new Date().toISOString()}\n`);
  } else {
    throw e;
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
    timeout: 120000,
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
  return {
    id,
    name,
    status: pass ? 'PASS' : 'FAIL',
    ...detail,
  };
}

const startedAt = new Date().toISOString();
const gates = [];

// ── Gate A — feature tree ────────────────────────────────────────────────
{
  const out = path.join(PROOF_DIR, 'gate-a-feature.step');
  const res = runCli('feature-rebuild', {
    partId: 'cert_gate_a',
    features: [
      { type: 'box', dx: 40, dy: 30, dz: 20 },
      {
        type: 'cut',
        tool: { type: 'cylinder', r: 5, h: 30, position: { x: 20, y: 15, z: -5 } },
      },
      { type: 'fillet', radius: 1.0 },
    ],
    out,
    include_mesh: true,
    mesh_summary_only: true,
  });
  const advanced = !!res.export?.advanced_brep;
  const ops = res.notes || [];
  const hasCut = ops.some((o) => String(o).startsWith('cut'));
  const hasFillet = ops.some((o) => String(o).startsWith('fillet'));
  const meshOk = (res.mesh?.triangleCount || 0) > 0 || res.mesh?.vertexCount > 0;
  // mesh_summary_only returns counts only
  const meshSummaryOk = (res.mesh?.triangleCount || 0) > 0;
  const pass =
    !!res.ok &&
    advanced &&
    hasCut &&
    hasFillet &&
    (meshSummaryOk || meshOk) &&
    fs.existsSync(out);
  gates.push(
    gate('A', 'Parametric solid feature tree (OCC)', pass, {
      advanced_brep: advanced,
      notes: ops,
      solids: res.solids,
      mesh: res.mesh,
      stepPath: out,
      stepBytes: res.export?.bytes,
      unityApplyPath: 'mesh from feature-rebuild → Unity apply_mesh / part mesh',
      reason: res.reason || res.error,
      api: ['feature_create', 'feature_append', 'feature_rebuild', 'feature_list', 'feature_undo'],
    }),
  );
}

// ── Gate B — sketch → solid ──────────────────────────────────────────────
{
  const out = path.join(PROOF_DIR, 'gate-b-sketch.step');
  const res = runCli('sketch-extrude', {
    sketch: { type: 'rect', x: 0, y: 0, w: 40, h: 30 },
    distance: 20,
    out,
    include_mesh: false,
  });
  const pass =
    !!res.ok &&
    (!!res.export?.advanced_brep || fs.existsSync(out)) &&
    !!res.proof?.sketch_rect_extrude_is_box_like &&
    Math.abs((res.bbox?.dx || 0) - 40) < 0.05 &&
    Math.abs((res.bbox?.dz || 0) - 20) < 0.05;
  gates.push(
    gate('B', 'Sketch → solid (rect extrude = box)', pass, {
      advanced_brep: res.export?.advanced_brep,
      proof: res.proof,
      bbox: res.bbox,
      stepPath: out,
      reason: res.reason || res.error,
    }),
  );
}

// ── Gate C — assembly constraints on solids ──────────────────────────────
{
  const out = path.join(PROOF_DIR, 'gate-c-mate.step');
  const res = runCli('mate-solids', {
    a: { kind: 'box', params: { dx: 10, dy: 10, dz: 10 }, position: { x: 0, y: 0, z: 0 } },
    b: { kind: 'box', params: { dx: 5, dy: 5, dz: 5 }, position: { x: 20, y: 0, z: 0 } },
    mate: { type: 'distance', axis: 'x', offset: 15 },
    out,
    include_mesh: false,
  });
  const stronger = !!res.honesty?.stronger_than_mesh_mates_v2;
  const placed = res.b?.placement?.center;
  // A box 0..10 center=5; distance offset 15 along x → B center = 20
  const pass2 =
    !!res.ok &&
    stronger &&
    (!!res.export?.advanced_brep || fs.existsSync(out)) &&
    Number.isFinite(placed?.x) &&
    Math.abs(placed.x - 20) < 0.51;
  gates.push(
    gate('C', 'Assembly constraints on solids (OCC placement)', pass2, {
      mate: res.mate,
      placement: res.b?.placement,
      stronger_than_mesh_mates_v2: stronger,
      honesty: res.honesty,
      stepPath: out,
      reason: res.reason || res.error,
      note: 'Solid AABB/face-normal proxies — NOT full industrial multi-DOF solver',
    }),
  );
}

// ── Gate D — GD&T geometry verification harness ──────────────────────────
{
  const length = runCli('measure', {
    features: [
      { type: 'box', dx: 40, dy: 30, dz: 20 },
      { type: 'cylinder', r: 5, h: 20, position: { x: 10, y: 10, z: 0 } },
    ],
    callout: { kind: 'length', axis: 'x', nominal: 40, tolPlus: 0.2, tolMinus: 0.2 },
  });
  const dia = runCli('measure', {
    features: [
      { type: 'box', dx: 40, dy: 30, dz: 20 },
      { type: 'cylinder', r: 5, h: 20 },
    ],
    callout: { kind: 'diameter', nominal: 10, tolPlus: 0.1, tolMinus: 0.1 },
  });
  const harnessWording =
    String(length.honesty?.harness || '').includes('geometry verification') ||
    String(length.honesty?.note || '').includes('NOT ISO CMM');
  const pass =
    !!length.ok &&
    length.pass === true &&
    !!dia.ok &&
    dia.pass === true &&
    dia.source === 'cylinder_feature' &&
    harnessWording;
  gates.push(
    gate('D', 'GD&T geometry verification harness', pass, {
      length: { pass: length.pass, measured: length.measured, nominal: length.nominal, source: length.source },
      diameter: { pass: dia.pass, measured: dia.measured, nominal: dia.nominal, source: dia.source },
      honesty: length.honesty,
      reason: length.reason || dia.reason || length.error || dia.error,
      not: 'ISO CMM lab certification',
    }),
  );
}

// ── Gate E — drawing pack pulls feature dims ─────────────────────────────
{
  let pass = false;
  let detail = {};
  try {
    const drawingPath = path.join(REPO, 'server/lib/conkay/assembly-drawing.js');
    const src = fs.readFileSync(drawingPath, 'utf8');
    const hasBuilder = src.includes('export function buildFeatureDimensions');
    const wired = src.includes('buildFeatureDimensions(feats') || src.includes('buildFeatureDimensions(opts.features');
    // Execute builder via dynamic import
    const mod = await import(pathToFileURL(drawingPath).href);
    const feats = [
      { type: 'box', dx: 40, dy: 30, dz: 20, id: 'b1' },
      { type: 'cylinder', r: 5, h: 20, id: 'c1' },
    ];
    const dims = mod.buildFeatureDimensions(feats, 'front');
    const hasBoxDx = dims.some((d) => d.fromFeature && /box\.dx|dx/i.test(d.label || '') && Math.abs(d.value - 40) < 1e-6);
    const hasDia = dims.some((d) => d.fromFeature && (d.label || '').includes('⌀') && Math.abs(d.value - 10) < 1e-6);
    // Drawing pack already LIVE: dims + GD&T + PDF + explode
    const pdfFn = typeof mod.exportAssemblyDrawingPdf === 'function';
    const explodePath = path.join(REPO, 'server/lib/conkay/assembly-explode.js');
    const explodeLive = fs.existsSync(explodePath);
    pass = hasBuilder && wired && hasBoxDx && hasDia && pdfFn && explodeLive;
    detail = {
      hasBuilder,
      wired,
      featureDimCount: dims.length,
      sampleLabels: dims.map((d) => d.label).slice(0, 6),
      pdfExport: pdfFn,
      explodeLive,
      note: 'Dims + GD&T + PDF already LIVE; now pulls dimensions from solid features when present',
    };
  } catch (e) {
    detail = { error: e instanceof Error ? e.message : String(e) };
  }
  gates.push(gate('E', 'Drawing pack complete (feature dims)', pass, detail));
}

// ── Gate F — this cert pack itself ───────────────────────────────────────
{
  const jsonPath = path.join(OUT_DIR, 'conkay-solid-world-cert.json');
  const mdPath = path.join(OUT_DIR, 'CONKAY_SOLID_WORLD_CERT.md');
  // Gate F passes if harness writes both artifacts (checked after write) + script exists
  const scriptExists = fs.existsSync(path.join(REPO, 'concord-frontend/scripts/conkay-solid-world-cert.mjs'));
  gates.push(
    gate('F', 'Certification pack', scriptExists, {
      script: 'concord-frontend/scripts/conkay-solid-world-cert.mjs',
      jsonPath,
      mdPath,
      note: 'Artifacts written at end of this run',
    }),
  );
}

const allPass = gates.every((g) => g.status === 'PASS');
// If F was provisional, confirm after write — update F after files land
const failing = gates.filter((g) => g.status !== 'PASS').map((g) => g.id);

let gitSha = 'unknown';
try {
  const g = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' });
  if (g.status === 0) gitSha = String(g.stdout).trim();
} catch {
  /* ignore */
}

let diskFreeGb = null;
try {
  const df = spawnSync('df', ['-g', '/'], { encoding: 'utf8' });
  const line = String(df.stdout || '').trim().split('\n')[1] || '';
  const parts = line.split(/\s+/);
  // macOS df -g: Filesystem Size Used Avail ...
  diskFreeGb = Number(parts[3]);
} catch {
  /* ignore */
}

const report = {
  status: allPass ? 'CERTIFIED' : 'PARTIAL',
  certified: allPass,
  startedAt,
  finishedAt: new Date().toISOString(),
  gitSha,
  diskFreeGb,
  machine: 'Mac.lan',
  kernel: 'cadquery-ocp / OCP',
  honesty: {
    note: 'Claims only what this harness proves.',
    not: [
      'SolidWorks feature-parity',
      'ISO CMM lab certification',
      'Full industrial multi-DOF mate solver',
    ],
    gateD: 'geometry verification harness',
  },
  gates,
  failingGateIds: failing,
};

// Finalize Gate F: artifacts about to be written
const fGate = gates.find((g) => g.id === 'F');
if (fGate) {
  fGate.artifactsPending = true;
}

fs.writeFileSync(path.join(OUT_DIR, 'conkay-solid-world-cert.json'), JSON.stringify(report, null, 2));

const mdLines = [
  `# ConKay Solid World Certification`,
  ``,
  `**Status: ${report.status}**`,
  ``,
  `- Finished: ${report.finishedAt}`,
  `- Git SHA: \`${gitSha}\``,
  `- Machine: Mac.lan (OCC cadquery-ocp)`,
  `- Disk free (GB): ${diskFreeGb ?? 'n/a'}`,
  ``,
  `## Honesty`,
  `- NOT SolidWorks feature-parity`,
  `- NOT ISO CMM lab certification`,
  `- Gate D = **geometry verification harness**`,
  `- Mate solver = solid AABB/face-normal proxies (stronger than mesh-only mates v2; not full industrial DOF)`,
  ``,
  `## Gates`,
  ``,
];
for (const g of gates) {
  mdLines.push(`### Gate ${g.id} — ${g.name}: **${g.status}**`);
  mdLines.push(``);
  mdLines.push('```json');
  mdLines.push(JSON.stringify(g, null, 2));
  mdLines.push('```');
  mdLines.push(``);
}
if (!allPass) {
  mdLines.push(`## Failing gates`);
  mdLines.push(``);
  mdLines.push(failing.map((id) => `- Gate ${id}`).join('\n') || '- (none)');
  mdLines.push(``);
} else {
  mdLines.push(`## CERTIFIED`);
  mdLines.push(``);
  mdLines.push(`All gates A–F PASS. Full solid world harness green on Mac OCC.`);
  mdLines.push(``);
}

fs.writeFileSync(path.join(OUT_DIR, 'CONKAY_SOLID_WORLD_CERT.md'), mdLines.join('\n'));

// Confirm F after write
if (fGate) {
  const jsonOk = fs.existsSync(path.join(OUT_DIR, 'conkay-solid-world-cert.json'));
  const mdOk = fs.existsSync(path.join(OUT_DIR, 'CONKAY_SOLID_WORLD_CERT.md'));
  fGate.status = fGate.status === 'PASS' && jsonOk && mdOk ? 'PASS' : jsonOk && mdOk && fGate.status === 'PASS' ? 'PASS' : fGate.status;
  if (!(jsonOk && mdOk)) fGate.status = 'FAIL';
  else if (fGate.status === 'PASS') fGate.artifactsPending = false;
  // Recompute
  const allPass2 = gates.every((g) => g.status === 'PASS');
  report.status = allPass2 ? 'CERTIFIED' : 'PARTIAL';
  report.certified = allPass2;
  report.failingGateIds = gates.filter((g) => g.status !== 'PASS').map((g) => g.id);
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT_DIR, 'conkay-solid-world-cert.json'), JSON.stringify(report, null, 2));
  // rewrite MD status line
  const md2 = fs.readFileSync(path.join(OUT_DIR, 'CONKAY_SOLID_WORLD_CERT.md'), 'utf8').replace(
    /\*\*Status: (CERTIFIED|PARTIAL)\*\*/,
    `**Status: ${report.status}**`,
  );
  fs.writeFileSync(path.join(OUT_DIR, 'CONKAY_SOLID_WORLD_CERT.md'), md2);
}

console.log(
  JSON.stringify(
    {
      status: report.status,
      gates: gates.map((g) => ({ id: g.id, status: g.status })),
      failingGateIds: report.failingGateIds,
      gitSha,
      diskFreeGb,
      json: path.join(OUT_DIR, 'conkay-solid-world-cert.json'),
      md: path.join(OUT_DIR, 'CONKAY_SOLID_WORLD_CERT.md'),
    },
    null,
    2,
  ),
);
process.exit(report.certified ? 0 : 1);
