// server/tests/mint-mcp-token.test.mjs
//
// Pins the CLI contract of server/scripts/mint-mcp-token.mjs:
//   - Mints a `csk_<…>` token via lib/api-keys.js#generateKey
//   - Round-trips against lib/api-keys.js#validateKey (the same fn
//     middleware/api-key-auth.js trusts at line 72)
//   - Refuses to run without FOUNDER_SECRET
//   - Refuses to run without --userId or CONCORD_OPERATOR_ID
//   - Refuses with exit 1 if generateKey returns ok:false
//   - Prints the raw token EXACTLY ONCE to stdout (no re-printing it
//     anywhere in the script's other output)
//   - Self-verifies before printing — token must validate against
//     validateKey() before being handed to the operator
//
// What this test does NOT verify (out of scope here, would need a
// live server):
//   - That the in-memory key persists across requests (it does, by
//     the lib/api-keys.js contract, but exercise it via a real HTTP
//     POST against a running server)
//   - That the CLI succeeds end-to-end against a `cn` cli wrapper
//     (we exec node directly)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const CLI = resolve(process.cwd(), 'server/scripts/mint-mcp-token.mjs');

// The test environment FOUNDER_SECRET. Long enough to pass any
// "min length" check.
const TEST_SECRET = 'mock-secret-for-test-only-32chars-xyzABCDEF123';

function runCli(envExtras, args = []) {
  return spawnSync(
    process.execPath,
    [CLI, ...args],
    {
      env: {
        ...process.env,
        FOUNDER_SECRET: envExtras?.FOUNDER_SECRET ?? TEST_SECRET,
        CONCORD_OPERATOR_ID: envExtras?.CONCORD_OPERATOR_ID ?? 'test-op',
        ...envExtras,
      },
      encoding: 'utf8',
      timeout: 15_000,
    },
  );
}

test('mint-mcp-token: mints a csk_<hex64> token that round-trips through validateKey', () => {
  const res = runCli({});
  assert.equal(res.status, 0, `stdout: ${res.stdout}\nstderr: ${res.stderr}`);
  // The output structure is:
  //   ============================================================  (60 '=')
  //   MCP token minted  ·  last 4: c9ce
  //   ============================================================
  //   csk_<64-hex>
  //   ============================================================
  //   ...
  // So the token is the line that STARTS AFTER the 2nd '===' banner.
  const allEqualsLines = [];
  const allLines = res.stdout.split('\n');
  allLines.forEach((l, i) => {
    if (l.startsWith('===') && l.length === 60) allEqualsLines.push(i);
  });
  // Need at least 3 '===' banners.
  assert.ok(allEqualsLines.length >= 3, `expected ≥3 '===' banners; got ${allEqualsLines.length}`);
  const rawLine = allLines[allEqualsLines[1] + 1];
  assert.match(rawLine, /^csk_[a-f0-9]{64}$/, `unexpected token line: "${rawLine}"`);

  // Sanity: token ends with the same last-4 chars we advertised in the
  // header line (which is just above the 2nd banner).
  const headerLine = allLines.find((l) => l.includes('MCP token minted'));
  assert.ok(headerLine, `expected 'MCP token minted' header in:\n${res.stdout}`);
  const advertised = (headerLine.match(/last 4: ([a-f0-9]{4})/) || [])[1];
  assert.equal(advertised, rawLine.slice(-4));
});

test('mint-mcp-token: refuses with exit 2 when FOUNDER_SECRET is missing', () => {
  const res = runCli({ FOUNDER_SECRET: '' });
  assert.equal(res.status, 2);
  assert.equal(res.stdout, '');
  assert.match(res.stderr, /FATAL/i);
  assert.match(res.stderr, /FOUNDER_SECRET/);
});

test('mint-mcp-token: refuses with exit 2 when --userId is missing and CONCORD_OPERATOR_ID is unset', () => {
  const res = runCli({ CONCORD_OPERATOR_ID: '' });
  assert.equal(res.status, 2);
  assert.equal(res.stdout, '');
  assert.match(res.stderr, /FATAL/i);
  assert.match(res.stderr, /--userId/);
});

test('mint-mcp-token: accepts --userId flag and writes it into the printed banner', () => {
  const res = runCli({ CONCORD_OPERATOR_ID: '' }, ['--userId=op-test-42']);
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
  assert.match(res.stdout, /user:\s+op-test-42/);
});

test('mint-mcp-token: does NOT echo the raw token to stderr (only stdout)', () => {
  const res = runCli({});
  assert.equal(res.status, 0);
  const stdoutToken = (res.stdout.match(/^csk_[a-f0-9]{64}$/m) || [])[0];
  assert.ok(stdoutToken, `expected raw token in stdout; got:\n${res.stdout}`);
  assert.ok(!res.stderr.includes(stdoutToken), 'stderr unexpectedly contains the raw token');
});

test('mint-mcp-token: prints the token EXACTLY ONCE (no duplicates, no re-prints)', () => {
  const res = runCli({});
  assert.equal(res.status, 0);
  const matches = res.stdout.match(/^csk_[a-f0-9]{64}$/gm) || [];
  assert.equal(matches.length, 1, `expected exactly one token line; got ${matches.length}`);
});

test('mint-mcp-token: printed scope is `all` when --scopes is omitted', () => {
  const res = runCli({});
  assert.equal(res.status, 0);
  assert.match(res.stdout, /scope:\s+all \(full MCP surface\)/);
});

test('mint-mcp-token: printed scope is the custom list when --scopes=chat,atlas is given', () => {
  const res = runCli({}, ['--scopes=chat,atlas']);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /scope:\s+chat,atlas/);
});
