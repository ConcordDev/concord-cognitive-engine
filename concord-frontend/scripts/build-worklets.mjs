/**
 * Compile the capture worklet to a same-origin ES module.
 * Vite 8 does not ship esbuild. This file has no imports, so tsc is enough.
 * Usage: node scripts/build-worklets.mjs [--check]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'lib/daw/worklets/capture-tap.ts');
const outFile = path.join(root, 'public/worklets/capture-tap.js');
const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
const banner = '/* Generated from lib/daw/worklets/capture-tap.ts by scripts/build-worklets.mjs. Do not edit. */\n';

function compile() {
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
    throw err;
  }
  const js = fs.readFileSync(path.join(dir, 'capture-tap.js'), 'utf8').replace(/\r\n/g, '\n');
  fs.rmSync(dir, { recursive: true, force: true });
  return banner + js;
}

const body = compile();
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').replace(/\r\n/g, '\n') : '';
  if (cur !== body) {
    console.error('public/worklets/capture-tap.js is stale. Run: node scripts/build-worklets.mjs');
    process.exit(1);
  }
} else {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, body);
  console.log('wrote', path.relative(root, outFile));
}
