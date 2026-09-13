#!/usr/bin/env node
/**
 * Copy committed Unity WebGL (public/unity-client) into Next standalone.
 * Next output:'standalone' does not bundle public/; a partial copy that
 * left only export-index.html made /unity-client/index.html 200 and
 * Build/*.wasm 500 — the world lens then looks "missing".
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(repo, 'concord-frontend', 'public', 'unity-client');
const dest = path.join(
  repo,
  'concord-frontend',
  '.next',
  'standalone',
  'public',
  'unity-client',
);

function fail(reason, extra = {}) {
  process.stderr.write(JSON.stringify({ ok: false, reason, ...extra }) + '\n');
  process.exit(1);
}

if (!fs.existsSync(path.join(src, 'Build', 'concordia.wasm.unityweb'))) {
  fail('unity_web_export_not_built', { src });
}

fs.mkdirSync(dest, { recursive: true });
fs.cpSync(src, dest, { recursive: true });

const wasm = path.join(dest, 'Build', 'concordia.wasm.unityweb');
const st = fs.statSync(wasm);
if (st.size < 1_000_000) fail('unity_web_copy_too_small', { bytes: st.size });

process.stdout.write(
  JSON.stringify({
    ok: true,
    dest,
    wasmBytes: st.size,
  }) + '\n',
);
