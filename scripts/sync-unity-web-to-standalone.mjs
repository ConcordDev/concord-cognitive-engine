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

const srcWasm = path.join(src, 'Build', 'concordia.wasm.unityweb');
if (!fs.existsSync(srcWasm)) {
  fail('unity_web_export_not_built', { src });
}

// *.unityweb are Git LFS objects. A checkout without `git lfs pull` holds
// ~130-byte pointer files; copying those would ship a broken player. Deploy
// builds pull the bytes first (deploy.yml). CI jobs that build only to test
// (Lighthouse, visual regression, playthrough, lint-and-test) set
// CONCORD_SKIP_UNITY_WEB=1 and skip the copy, saying so.
const head = fs.readFileSync(srcWasm).subarray(0, 64).toString('utf8');
if (head.startsWith('version https://git-lfs.github.com/spec/v1')) {
  if (process.env.CONCORD_SKIP_UNITY_WEB === '1') {
    process.stdout.write(JSON.stringify({ ok: true, skipped: 'unity_web_is_lfs_pointer' }) + '\n');
    process.exit(0);
  }
  fail('unity_web_is_lfs_pointer', {
    hint: 'git lfs pull --include="concord-frontend/public/unity-client/**"',
  });
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
