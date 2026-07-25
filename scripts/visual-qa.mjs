#!/usr/bin/env node
/**
 * visual-qa.mjs — a REAL visual-verification harness for the Godot world lens.
 *
 * Until 2026-07-25 every visual claim in world-lens-godot/VISUAL_QA.md was
 * assumed to need human eyes, because `--headless` installs RasterizerDummy and
 * draws literally nothing. That assumption was wrong: Godot renders for real
 * against a virtual X display (Xvfb) on Mesa/llvmpipe, and a SceneTree script
 * can pull the framebuffer back out with `get_texture().get_image()`. This
 * harness turns that into assertions over actual pixels.
 *
 * WHAT IT PROVES / WHAT IT DOES NOT
 * ---------------------------------
 * This is llvmpipe SOFTWARE rasterization. It proves WHAT DRAWS. It proves
 * NOTHING about how fast anything draws — no framerate, hitch, pop-in, LOD
 * smoothness or "feel" claim may ever be settled here. It is also not a real
 * GPU: llvmpipe has no vendor extensions and can differ in precision and
 * shader-feature support, so an effect that silently no-ops under llvmpipe
 * would produce a GREEN assertion that is a FALSE assurance. That is why the
 * assertions below are written to fail loudly when the thing under test stops
 * happening (see `--fault=` — every assertion class is proven capable of
 * failing), and why the doc keeps GPU-only claims in the human queue.
 *
 * ASSERTIONS (objective only — each has a right answer):
 *   render-non-blank      the frame is not a black void / flat fill
 *   ramp-banding          a toon-shaded sphere shows a small number of distinct
 *                         luminance plateaus, not a smooth gradient
 *   saturation-ordering   mean chroma across worlds is monotonic in
 *                         WORLD_SATURATION, with palette held FIXED so the
 *                         saturation dial is the only varying input
 *   scene-geometry        SceneBootstrap.apply_scene spawns N visible regions
 *   scene-honest-empty    an {ok:false} payload draws NO phantom geometry
 *   transform-footprint   scale [w,h,d] + rotationY produce the right footprint
 *                         and the right principal-axis angle (Y-up parity)
 *   golden-diff           downsampled baseline comparison, reporting WHERE
 *
 * Usage:
 *   node scripts/visual-qa.mjs                    # run + assert
 *   node scripts/visual-qa.mjs --update-goldens   # (re)write baselines
 *   node scripts/visual-qa.mjs --fault=no-toon    # prove an assertion can fail
 *   node scripts/visual-qa.mjs --json             # machine-readable report
 *
 * Faults: no-camera | flat-saturation | no-toon | empty-scene | corrupt-golden
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  decodePng,
  encodePngRgb,
  frameStats,
  connectedRegions,
  lumaClusters,
  downsample,
  pixel,
} from './lib/png-read.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = path.join(ROOT, 'world-lens-godot');
const GODOT = process.env.GODOT_BIN || path.join(ROOT, '.godot-runtime/bin/godot');
const OUT_DIR = path.join(PROJECT, '.visual-qa');
const GOLDEN_DIR = path.join(PROJECT, 'tests/goldens');
const SPEC_PATH = path.join(PROJECT, 'art_style.json');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (name, dflt = null) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
/* STRICT ARGV — an unrecognised flag is a hard error, never a silent no-op.
 * Found 2026-07-25 during independent verification: `--fault no-toon` (space
 * instead of `=`) was silently ignored, so the run went 36/36 GREEN while
 * proving nothing. A typo in the exact flag whose job is to prove an
 * assertion CAN fail is the worst possible thing to swallow — it manufactures
 * false confidence in the harness itself. Same class as an inert detector
 * annotation: it looks handled, and isn't. */
const KNOWN_FLAGS = new Set(['--update-goldens', '--json']);
const KNOWN_OPTS = new Set(['fault', 'timeout']);
for (const a of argv) {
  if (KNOWN_FLAGS.has(a)) continue;
  const m = /^--([a-z-]+)=/.exec(a);
  if (m && KNOWN_OPTS.has(m[1])) continue;
  console.error(JSON.stringify({
    ok: false,
    reason: 'unknown_argument',
    argument: a,
    hint: KNOWN_OPTS.has(a.replace(/^--/, ''))
      ? `"${a}" takes a value — write --${a.replace(/^--/, '')}=<value>, not a space-separated one`
      : `known: ${[...KNOWN_FLAGS].join(', ')}, ${[...KNOWN_OPTS].map((o) => `--${o}=<value>`).join(', ')}`,
  }));
  process.exit(2);
}

const UPDATE_GOLDENS = has('--update-goldens');
const JSON_OUT = has('--json');
const FAULT = opt('fault', '');
const TIMEOUT_S = Number(opt('timeout', '300'));

/* Golden baselines are stored DOWNSAMPLED (144x81 RGB, ~1-3 KB each) rather
 * than as full 1152x648 frames. Rationale: a full-frame baseline set would be
 * hundreds of KB of binary churn per visual change, and the harness's real
 * regression signal is "did a region of the frame change", not "is every pixel
 * identical" — which llvmpipe cannot promise across driver versions anyway.
 * The full-frame content hash is recorded in the manifest as INFORMATION only,
 * never as an assertion. */
const GOLDEN_W = 144;
const GOLDEN_H = 81;
const GOLDEN_TOL = 5; // per-channel mean abs delta per tile, 0..255
const GOLDEN_TILE = 9; // tile size in golden pixels for the "where" report

function die(reason, extra = {}) {
  const payload = { ok: false, reason, ...extra };
  if (JSON_OUT) console.log(JSON.stringify(payload, null, 2));
  else console.error(`\n[visual-qa] FAILED: ${reason}\n${JSON.stringify(extra, null, 2)}`);
  process.exit(1);
}

/* ── Preflight ─────────────────────────────────────────────────────────── */

if (!fs.existsSync(GODOT)) {
  die('godot_binary_missing', { expected: GODOT, fix: 'node scripts/fetch-godot.mjs' });
}
const xvfb = spawnSync('which', ['xvfb-run'], { encoding: 'utf8' });
if (xvfb.status !== 0) {
  die('xvfb_missing', { fix: 'apt-get install xvfb (a virtual display is required — headless draws nothing)' });
}
if (!fs.existsSync(SPEC_PATH)) {
  die('art_spec_missing', { expected: path.relative(ROOT, SPEC_PATH), fix: 'node scripts/gen-art-style-spec.mjs' });
}
const SPEC = JSON.parse(fs.readFileSync(SPEC_PATH, 'utf8'));
const WORLDS = SPEC.canonWorlds;
const SATURATION = SPEC.worldSaturation;
const RAMP_BANDS = SPEC.artStyle.RAMP_BANDS;

/* ── Scene fixtures ────────────────────────────────────────────────────── */

/* A `concord-scene/v1` FIXTURE — the format constant + field shape are taken
 * from server/lib/scene-export.js, but this is not a live server frame. The
 * live-gateway path stays in the human/integration queue on purpose; what is
 * under test here is world/scene_bootstrap.gd's spawn + transform mapping
 * rendered by a real rasterizer. */
const SCENE_OK = {
  ok: true,
  format: 'concord-scene/v1',
  count: 3,
  nodes: [
    { id: 'b1', transform: { translation: [-9, 3, 0], rotationY: 0, scale: [4, 6, 4] } },
    { id: 'b2', transform: { translation: [0, 2, 0], rotationY: 0, scale: [4, 4, 4] } },
    { id: 'b3', transform: { translation: [9, 4, 0], rotationY: 0, scale: [4, 8, 4] } },
  ],
};

const SCENE_FAIL = { ok: false, reason: 'world_not_found' };

/* Controlled transform fixture, read top-down + orthographic so `scale` and
 * `rotationY` become measurable pixel facts.
 *   t0: 8 x 2 footprint, unrotated  -> wide
 *   t1: same box at rotationY=PI/2  -> deep (magnitude of the Y rotation)
 *   t2: same box at rotationY=PI/6  -> principal axis at a signed angle
 *       (a bbox is symmetric under +/-θ, so only the principal axis can
 *        catch an inverted rotation sign / a swapped axis). */
const ROT_30 = Math.PI / 6;
const SCENE_XFORM = {
  ok: true,
  format: 'concord-scene/v1',
  count: 3,
  nodes: [
    { id: 't0', transform: { translation: [-12, 0, -10], rotationY: 0, scale: [8, 1, 2] } },
    { id: 't1', transform: { translation: [12, 0, -10], rotationY: Math.PI / 2, scale: [8, 1, 2] } },
    { id: 't2', transform: { translation: [0, 0, 10], rotationY: ROT_30, scale: [8, 1, 2] } },
  ],
};
const ORTHO_SIZE = 60;

/* ── Job ───────────────────────────────────────────────────────────────── */

const shots = [];
for (const w of WORLDS) {
  shots.push({ name: `art_${w}`, kind: 'art_world', worldId: w, fault: FAULT });
}
for (const w of WORLDS) {
  shots.push({ name: `sat_${w}`, kind: 'saturation_dial', worldId: w, fault: FAULT });
}
/* The ramp probe: same three reference spheres, dial pinned to 1.0. RAMP_BANDS
 * is a GLOBAL rule (docs/ART_STYLE_GUIDE.md: "no 2-band here and 5-band there"),
 * so it is measured once under a fixed dial rather than once per world — the
 * dial compresses the gradient's luminance separation, which would confound the
 * measurement rather than test anything. */
shots.push({
  name: 'ramp_probe',
  kind: 'saturation_dial',
  worldId: 'concordia-hub',
  saturationOverride: 1.0,
  fault: FAULT,
});
shots.push({ name: 'scene_ok', kind: 'scene_bootstrap', payload: SCENE_OK, fault: FAULT });
shots.push({ name: 'scene_fail', kind: 'scene_bootstrap', payload: SCENE_FAIL, fault: FAULT });
shots.push({
  name: 'scene_xform',
  kind: 'scene_transform',
  payload: SCENE_XFORM,
  orthoSize: ORTHO_SIZE,
  fault: FAULT,
});

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });
const jobPath = path.join(os.tmpdir(), `concord-vqa-job-${process.pid}.json`);
fs.writeFileSync(jobPath, JSON.stringify({ outDir: OUT_DIR, settleFrames: 12, shots }, null, 2));

/* ── Render ────────────────────────────────────────────────────────────── */

const started = Date.now();
const run = spawnSync(
  'xvfb-run',
  [
    '-a',
    '-s',
    '-screen 0 1280x720x24',
    GODOT,
    '--display-driver',
    'x11',
    '--rendering-driver',
    'opengl3',
    '--path',
    PROJECT,
    '--script',
    'res://tools/visual_probe.gd',
  ],
  {
    encoding: 'utf8',
    timeout: TIMEOUT_S * 1000,
    env: { ...process.env, CONCORD_VQA_JOB: jobPath },
    maxBuffer: 32 * 1024 * 1024,
  }
);
const renderMs = Date.now() - started;
fs.writeFileSync(path.join(OUT_DIR, 'engine.log'), `${run.stdout || ''}\n${run.stderr || ''}`);
fs.rmSync(jobPath, { force: true });

if (run.error && run.error.code === 'ETIMEDOUT') {
  die('render_timeout', { timeoutSeconds: TIMEOUT_S, log: path.relative(ROOT, path.join(OUT_DIR, 'engine.log')) });
}
const resultPath = path.join(OUT_DIR, 'result.json');
if (!fs.existsSync(resultPath)) {
  die('probe_produced_no_result', {
    exitStatus: run.status,
    log: path.relative(ROOT, path.join(OUT_DIR, 'engine.log')),
    tail: String(run.stdout || '').split('\n').slice(-12).join('\n'),
  });
}
const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
const failedShots = result.shots.filter((s) => !s.ok);
if (failedShots.length) die('shot_capture_failed', { failedShots });

/* ── Measure ───────────────────────────────────────────────────────────── */

const byName = new Map();
for (const s of result.shots) {
  const img = decodePng(s.path);
  byName.set(s.name, { shot: s, img, stats: frameStats(img) });
}

const checks = [];
const check = (id, subject, ok, detail) => checks.push({ id, subject, ok: !!ok, ...detail });

/* 1. render-non-blank — catches missing assets, null materials, dead shaders,
 *    a camera that sees nothing: the entire class headless CANNOT see. */
for (const w of WORLDS) {
  const { stats } = byName.get(`art_${w}`);
  const ok = stats.lumaStdDev > 0.02 && stats.distinctColors >= 8 && stats.nonBlackRatio > 0.5;
  check('render-non-blank', `art_${w}`, ok, {
    lumaStdDev: +stats.lumaStdDev.toFixed(4),
    distinctColors: stats.distinctColors,
    nonBlackRatio: +stats.nonBlackRatio.toFixed(3),
    requires: 'lumaStdDev>0.02 && distinctColors>=8 && nonBlackRatio>0.5',
  });
}

/* 2. ramp-banding — the saturation_dial shot puts 3 toon spheres on a flat
 *    background, so connected-region detection hands us exact per-sphere ROIs.
 *    A curved surface under an N-band ramp lands its pixels on a few luminance
 *    plateaus; a smooth (unbanded) material spreads them continuously. */
{
  const { img } = byName.get('ramp_probe');
  const { regions } = connectedRegions(img, { tol: 26, minArea: 2000 });
  const spheres = regions.slice(0, 3);
  const perSphere = spheres.map((r) => lumaClusters(img, r).clusters.length);
  // Exactly RAMP_BANDS plateaus, +1 tolerated for the anti-aliased rim pixels.
  // The lower bound is the load-bearing half: a SMOOTH (un-banded) material
  // measures 2 here, because a continuous gradient leaves no empty histogram
  // bins to split the run — which is precisely the "the cel shader silently
  // no-opped under this rasterizer" failure this check exists to catch.
  // Proven by `--fault=no-toon`.
  const ok =
    spheres.length === 3 && perSphere.every((n) => n >= RAMP_BANDS && n <= RAMP_BANDS + 1);
  check('ramp-banding', 'ramp_probe', ok, {
    spheresFound: spheres.length,
    clustersPerSphere: perSphere,
    requires: `3 spheres, each with ${RAMP_BANDS}..${RAMP_BANDS + 1} luminance plateaus (RAMP_BANDS=${RAMP_BANDS}, dial pinned to 1.0)`,
  });
}

/* Informational, NOT an assertion: per-world plateau counts. These legitimately
 * drop to 2 on the low-saturation worlds (crime 0.62, concord-link-frontier
 * 0.95) because desaturating compresses the gradient stops' luminance
 * separation until two plateaus merge. That is a real property of the palette
 * maths, not a rendering defect, so it is reported rather than asserted —
 * asserting it would mean widening the window until it always passed, which
 * would also stop it catching a dead shader. */
const perWorldBands = {};
for (const w of WORLDS) {
  const { img } = byName.get(`sat_${w}`);
  const { regions } = connectedRegions(img, { tol: 26, minArea: 2000 });
  perWorldBands[w] = regions.slice(0, 3).map((r) => lumaClusters(img, r).clusters.length);
}

/* 3. saturation-ordering — palette is held FIXED across these shots; the only
 *    varying input is saturation_for_world(). Mean chroma must therefore be
 *    monotonic in WORLD_SATURATION. Relative ordering, not absolute thresholds:
 *    llvmpipe + tonemapping shift absolutes, they do not reorder them. */
const satRows = WORLDS.map((w) => ({
  world: w,
  spec: SATURATION[w],
  measured: byName.get(`sat_${w}`).stats.meanChroma,
})).sort((a, b) => a.spec - b.spec);

const inversions = [];
for (let i = 0; i < satRows.length; i++) {
  for (let j = i + 1; j < satRows.length; j++) {
    if (satRows[j].spec > satRows[i].spec && satRows[j].measured <= satRows[i].measured) {
      inversions.push({
        lower: satRows[i].world,
        higher: satRows[j].world,
        specs: [satRows[i].spec, satRows[j].spec],
        measured: [+satRows[i].measured.toFixed(5), +satRows[j].measured.toFixed(5)],
      });
    }
  }
}
check('saturation-ordering', 'all-worlds', inversions.length === 0, {
  order: satRows.map((r) => `${r.world}(spec ${r.spec} -> chroma ${r.measured.toFixed(4)})`),
  inversions,
  spread: `${satRows[0].world} ${satRows[0].measured.toFixed(4)} .. ${
    satRows[satRows.length - 1].world
  } ${satRows[satRows.length - 1].measured.toFixed(4)}`,
  requires: 'measured mean chroma strictly increasing in WORLD_SATURATION (palette held fixed)',
});

/* 4. scene-geometry — the real client spawn path draws the expected count. */
{
  const { img } = byName.get('scene_ok');
  const { regions } = connectedRegions(img, { tol: 26, minArea: 600 });
  check('scene-geometry', 'scene_ok', regions.length === SCENE_OK.nodes.length, {
    expectedRegions: SCENE_OK.nodes.length,
    foundRegions: regions.length,
    areas: regions.map((r) => r.area),
    requires: 'one visible region per concord-scene/v1 node',
  });
}

/* 5. scene-honest-empty — {ok:false} must draw NOTHING. This is the pixel
 *    proof of the "no phantom geometry" honesty contract in scene_bootstrap.gd. */
{
  const { img, stats } = byName.get('scene_fail');
  const { regions } = connectedRegions(img, { tol: 26, minArea: 600 });
  check('scene-honest-empty', 'scene_fail', regions.length === 0 && stats.lumaStdDev < 0.01, {
    foundRegions: regions.length,
    lumaStdDev: +stats.lumaStdDev.toFixed(5),
    requires: 'zero visible regions and a flat frame for an {ok:false} payload',
  });
}

/* 6. transform-footprint — top-down orthographic, so world units map to pixels
 *    at a known scale. Checks both the footprint (scale [w,h,d]) and the
 *    principal-axis angle (rotationY sign + axis parity). */
{
  const { img } = byName.get('scene_xform');
  const { regions } = connectedRegions(img, { tol: 40, minArea: 400 });
  const pxPerUnit = img.height / ORTHO_SIZE;
  // Identify each fixture node by where it lands: t0 left, t1 right, t2 lower.
  const sorted = [...regions].sort((a, b) => a.minX - b.minX);
  const detail = { pxPerUnit: +pxPerUnit.toFixed(3), regions: regions.length, measurements: [] };
  let ok = regions.length === SCENE_XFORM.nodes.length;
  if (ok) {
    const expectations = [
      { id: 't0', w: 8, d: 2, rotY: 0 },
      { id: 't2', w: 8, d: 2, rotY: ROT_30 },
      { id: 't1', w: 8, d: 2, rotY: Math.PI / 2 },
    ];
    // left→right on screen: t0 (x=-12), t2 (x=0), t1 (x=+12)
    for (let i = 0; i < expectations.length; i++) {
      const e = expectations[i];
      const r = sorted[i];
      const c = Math.abs(Math.cos(e.rotY));
      const s = Math.abs(Math.sin(e.rotY));
      const expW = (e.w * c + e.d * s) * pxPerUnit;
      const expH = (e.w * s + e.d * c) * pxPerUnit;
      const angle = principalAngleDeg(img, r);
      // Screen basis: +x is world +x, screen-up is world -z. A positive Godot
      // rotationY takes world +x toward world -z, i.e. toward screen-up, which
      // is a NEGATIVE angle in image coordinates (y grows downward).
      const expAngle = -(e.rotY * 180) / Math.PI;
      const wErr = Math.abs(r.w - expW) / expW;
      const hErr = Math.abs(r.h - expH) / expH;
      const angErr = e.rotY === Math.PI / 2 ? 0 : angleDeltaDeg(angle, expAngle);
      const nodeOk = wErr < 0.12 && hErr < 0.12 && angErr < 8;
      ok = ok && nodeOk;
      detail.measurements.push({
        node: e.id,
        expectedPx: [+expW.toFixed(1), +expH.toFixed(1)],
        measuredPx: [r.w, r.h],
        errPct: [+(wErr * 100).toFixed(1), +(hErr * 100).toFixed(1)],
        expectedAngleDeg: +expAngle.toFixed(1),
        measuredAngleDeg: +angle.toFixed(1),
        angleErrDeg: +angErr.toFixed(1),
        ok: nodeOk,
      });
    }
  }
  check('transform-footprint', 'scene_xform', ok, {
    ...detail,
    requires: 'footprint within 12% of scale[w,h,d] and principal axis within 8 deg of rotationY',
  });
}

/** Principal-axis angle (degrees, image coords, y down) of a region's mask. */
function principalAngleDeg(img, r) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  const bg = [];
  // Foreground = anything materially brighter than the black background.
  const isFg = (x, y) => {
    const [rr, gg, bb] = pixel(img, x, y);
    return rr + gg + bb > 200;
  };
  for (let y = r.minY; y <= r.maxY; y++)
    for (let x = r.minX; x <= r.maxX; x++)
      if (isFg(x, y)) {
        sx += x;
        sy += y;
        n++;
      }
  if (n === 0) return 0;
  const cx = sx / n;
  const cy = sy / n;
  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (let y = r.minY; y <= r.maxY; y++)
    for (let x = r.minX; x <= r.maxX; x++)
      if (isFg(x, y)) {
        xx += (x - cx) ** 2;
        yy += (y - cy) ** 2;
        xy += (x - cx) * (y - cy);
      }
  void bg;
  return (Math.atan2(2 * xy, xx - yy) * 90) / Math.PI; // 0.5*atan2 in degrees
}

/** Smallest angular difference treating θ and θ+180 as the same axis. */
function angleDeltaDeg(a, b) {
  let d = Math.abs(((a - b) % 180) + 180) % 180;
  if (d > 90) d = 180 - d;
  return d;
}

/* ── Goldens ───────────────────────────────────────────────────────────── */

fs.mkdirSync(GOLDEN_DIR, { recursive: true });
const manifestPath = path.join(GOLDEN_DIR, 'manifest.json');
const oldManifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { shots: {} };
const manifest = { _note: 'Downsampled visual-QA baselines. Regenerate: node scripts/visual-qa.mjs --update-goldens', golden: { w: GOLDEN_W, h: GOLDEN_H, tolerance: GOLDEN_TOL }, shots: {} };

for (const [name, entry] of byName) {
  const small = downsample(entry.img, GOLDEN_W, GOLDEN_H);
  const goldenPath = path.join(GOLDEN_DIR, `${name}.png`);
  manifest.shots[name] = {
    meanChroma: +entry.stats.meanChroma.toFixed(5),
    meanLuma: +entry.stats.meanLuma.toFixed(5),
    lumaStdDev: +entry.stats.lumaStdDev.toFixed(5),
    distinctColors: entry.stats.distinctColors,
  };
  if (UPDATE_GOLDENS) {
    fs.writeFileSync(goldenPath, encodePngRgb(GOLDEN_W, GOLDEN_H, small));
    continue;
  }
  if (!fs.existsSync(goldenPath)) {
    check('golden-diff', name, false, { reason: 'no_baseline', fix: 'node scripts/visual-qa.mjs --update-goldens' });
    continue;
  }
  const base = decodePng(goldenPath);
  if (base.width !== GOLDEN_W || base.height !== GOLDEN_H) {
    check('golden-diff', name, false, { reason: 'baseline_size_mismatch', baseline: [base.width, base.height] });
    continue;
  }
  // Per-tile mean absolute delta → reports WHERE it changed, not just whether.
  const tilesX = Math.ceil(GOLDEN_W / GOLDEN_TILE);
  const tilesY = Math.ceil(GOLDEN_H / GOLDEN_TILE);
  const changed = [];
  let maxTileDelta = 0;
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      let sum = 0;
      let n = 0;
      for (let y = ty * GOLDEN_TILE; y < Math.min(GOLDEN_H, (ty + 1) * GOLDEN_TILE); y++) {
        for (let x = tx * GOLDEN_TILE; x < Math.min(GOLDEN_W, (tx + 1) * GOLDEN_TILE); x++) {
          const i = (y * GOLDEN_W + x) * 3;
          const j = (y * base.width + x) * base.channels;
          sum +=
            Math.abs(small[i] - base.data[j]) +
            Math.abs(small[i + 1] - base.data[j + 1]) +
            Math.abs(small[i + 2] - base.data[j + 2]);
          n += 3;
        }
      }
      const delta = sum / n;
      if (delta > maxTileDelta) maxTileDelta = delta;
      if (delta > GOLDEN_TOL) {
        changed.push({
          tile: [tx, ty],
          regionPct: [
            Math.round(((tx * GOLDEN_TILE) / GOLDEN_W) * 100),
            Math.round(((ty * GOLDEN_TILE) / GOLDEN_H) * 100),
          ],
          meanDelta: +delta.toFixed(2),
        });
      }
    }
  }
  check('golden-diff', name, changed.length === 0, {
    maxTileDelta: +maxTileDelta.toFixed(2),
    tolerance: GOLDEN_TOL,
    changedTiles: changed.slice(0, 12),
    changedTileCount: changed.length,
    hint: changed.length ? 'x%,y% are top-left corners of the changed tiles within the frame' : undefined,
  });
}
if (UPDATE_GOLDENS) {
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
} else if (oldManifest.shots) {
  // Manifest stats are informational drift signal, never an assertion.
  manifest._previous = oldManifest.shots;
}

/* ── Report ────────────────────────────────────────────────────────────── */

const failed = checks.filter((c) => !c.ok);
const report = {
  ok: failed.length === 0,
  renderMs,
  adapter: result.adapter,
  driver: result.driver,
  godot: result.godot?.string || result.godot,
  fault: FAULT || null,
  softwareRendering: true,
  proves: 'what draws',
  provesNot: 'framerate, hitch, pop-in, LOD smoothness, GPU-specific shader behaviour, aesthetics',
  shots: result.shots.length,
  info: {
    perWorldBandPlateaus: perWorldBands,
    perWorldBandNote:
      'informational only — desaturated palettes legitimately merge two plateaus; RAMP_BANDS is asserted once on ramp_probe at a fixed dial',
  },
  checks: checks.length,
  passed: checks.length - failed.length,
  failed: failed.length,
  results: checks,
  outDir: path.relative(ROOT, OUT_DIR),
};

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`\n[visual-qa] ${result.driver} / ${result.adapter}`);
  console.log(`[visual-qa] ${result.shots.length} shots rendered in ${(renderMs / 1000).toFixed(1)}s`);
  if (FAULT) console.log(`[visual-qa] FAULT INJECTED: ${FAULT} (assertions are EXPECTED to fail)`);
  const byId = new Map();
  for (const c of checks) {
    if (!byId.has(c.id)) byId.set(c.id, []);
    byId.get(c.id).push(c);
  }
  for (const [id, group] of byId) {
    const bad = group.filter((c) => !c.ok);
    console.log(`  ${bad.length ? 'FAIL' : 'pass'}  ${id.padEnd(20)} ${group.length - bad.length}/${group.length}`);
    for (const c of bad) console.log(`         ↳ ${c.subject}: ${JSON.stringify(omit(c, ['id', 'subject', 'ok']))}`);
  }
  const sat = checks.find((c) => c.id === 'saturation-ordering');
  if (sat) {
    console.log('\n  saturation dial (palette fixed, dial is the only variable):');
    for (const line of sat.order) console.log(`    ${line}`);
  }
  console.log(
    `\n[visual-qa] ${report.passed}/${report.checks} checks passed` +
      (UPDATE_GOLDENS ? ' (goldens rewritten)' : '')
  );
}

function omit(o, keys) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (!keys.includes(k) && v !== undefined) out[k] = v;
  return out;
}

process.exit(failed.length === 0 ? 0 : 1);
