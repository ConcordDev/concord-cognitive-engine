/**
 * Compile same-origin AudioWorklet modules.
 * Vite 8 does not ship esbuild. The capture tap has no imports, so tsc is enough.
 * The pitch processor imports the pure core; this script inlines that file so
 * public/worklets/pitch-tap.js has no import and does not call eval.
 * Usage: node scripts/build-worklets.mjs [--check]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsc = path.join(root, 'node_modules/typescript/bin/tsc');

function compile(entry) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'concord-worklet-'));
  try {
    execFileSync(tsc, [
      entry,
      '--outDir', dir,
      '--module', 'es2022',
      '--target', 'es2022',
      '--moduleResolution', 'bundler',
      '--skipLibCheck',
      '--strict',
      '--lib', 'es2022,dom',
    ], { stdio: 'pipe' });
  } catch (err) {
    const out = err.stdout ? err.stdout.toString() : '';
    const e2 = err.stderr ? err.stderr.toString() : '';
    console.error(out || e2 || err.message);
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  const outName = `${path.basename(entry, '.ts')}.js`;
  const js = fs.readFileSync(findFile(dir, outName), 'utf8').replace(/\r\n/g, '\n');
  return { dir, js };
}

function compileCapture() {
  const entry = path.join(root, 'lib/daw/worklets/capture-tap.ts');
  const banner = '/* Generated from lib/daw/worklets/capture-tap.ts by scripts/build-worklets.mjs. Do not edit. */\n';
  const { dir, js } = compile(entry);
  fs.rmSync(dir, { recursive: true, force: true });
  return banner + js;
}

function findFile(dir, name) {
  const hits = [];
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name === name) hits.push(p);
    }
  };
  walk(dir);
  if (hits.length !== 1) throw new Error(`expected one ${name}, found ${hits.length}`);
  return hits[0];
}

/** Drop import/export syntax so the worklet is one module with no network imports. */
function stripModuleSyntax(code) {
  return code
    .replace(/^import\s+[\s\S]*?;\s*$/gm, '')
    .replace(/^export\s+\{[^}]*\};?\s*$/gm, '')
    .replace(/^export\s+/gm, '');
}

function compilePitch() {
  const entry = path.join(root, 'lib/daw/worklets/pitch-tap.ts');
  const banner = '/* Generated from lib/daw/worklets/pitch-tap.ts and lib/daw/dsp/pitch/core.ts by scripts/build-worklets.mjs. Do not edit. */\n';
  const { dir, js } = compile(entry);
  const core = fs.readFileSync(findFile(dir, 'core.js'), 'utf8').replace(/\r\n/g, '\n');
  fs.rmSync(dir, { recursive: true, force: true });
  const body = `${stripModuleSyntax(core).trim()}\n${stripModuleSyntax(js).trim()}\n`;
  if (/\bimport\s+/.test(body) || /\bexport\s+/.test(body)) {
    throw new Error('pitch worklet bundle still has import or export');
  }
  return banner + body;
}

const outputs = [
  [path.join(root, 'public/worklets/capture-tap.js'), compileCapture()],
  [path.join(root, 'public/worklets/pitch-tap.js'), compilePitch()],
];

if (process.argv.includes('--check')) {
  let stale = false;
  for (const [outFile, body] of outputs) {
    const cur = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').replace(/\r\n/g, '\n') : '';
    if (cur !== body) {
      console.error(`${path.relative(root, outFile)} is stale. Run: node scripts/build-worklets.mjs`);
      stale = true;
    }
  }
  if (stale) process.exit(1);
} else {
  for (const [outFile, body] of outputs) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, body);
    console.log('wrote', path.relative(root, outFile));
  }
}
