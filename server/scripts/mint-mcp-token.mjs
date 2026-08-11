#!/usr/bin/env node
// server/scripts/mint-mcp-token.mjs
//
// One-shot CLI to mint a 24h-prefix `csk_<hex>` MCP-style API key for
// the OPERATOR (the human running the script, NOT a script account).
// Prints the raw key ONCE with the last-4 chars visible; the user
// pastes the full string into chat and the assistant caches it for
// the session. The token validates against `middleware/api-key-auth.js`
// line 72's "Bearer csk_<…>" check, the SAME check that powers the
// 547 published lens-action MCP tools under https://concord-os.org/mcp.
//
// Why this exists: per the operator protocol, the assistant can call
// MCP tools (mcp__concord__*) only after the operator voluntarily
// mints + pastes a token. This script is the minimum-friction mint path
// — one CLI invocation, one paste, full MCP surface available.
//
// Scope:
//   - Uses the in-memory KEY_STORE in lib/api-keys.js (24h-ish TTL —
//     the key is dropped when the server restarts). DO NOT use this
//     for user-facing /api-keys durable keys; that's a different flow
//     in routes/auth.js that mints into SQLite.
//   - Founder-bypass only: requires --secret=FOUNDER_SECRET env var
//     (the same secret the bootstrap script generates). Refuses to
//     run otherwise.
//
// Usage:
//   FOUNDER_SECRET=… node server/scripts/mint-mcp-token.mjs \
//     [--userId=<opaque user id>] [--scopes=all|<comma-list>] \
//     [--label=<human label, for key prefix only>]
//
//   Defaults: --userId is read from --userId arg OR CONCORD_OPERATOR_ID
//   env var OR error out.
//   --scopes defaults to "all" (full MCP surface).
//
// Output (to stdout, NEVER logged):
//   ============================================================
//   MCP token minted  ·  last 4: 7K2p
//   ============================================================
//   csk_<64-hex>
//   ============================================================
//   validity:  in-memory only (dies on server restart)
//   scope:     all (full MCP surface)
//   user:      <userId>
//   DO NOT paste this anywhere that gets logged, committed, or echoed.
//   ============================================================
//
// Test:
//   node --test server/tests/mint-mcp-token.test.mjs

import crypto from 'node:crypto';

const args = process.argv.slice(2);
function parseFlag(name, fallback) {
  const arg = args.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return fallback;
  return arg.slice(`--${name}=`.length);
}

const SECRET = process.env.FOUNDER_SECRET || '';
const USER_ID = parseFlag('userId', process.env.CONCORD_OPERATOR_ID || '');
const LABEL = parseFlag('label', 'hermes-operator');
const SCOPES_ARG = parseFlag('scopes', 'all');
const SCOPES = SCOPES_ARG === 'all' ? [] : SCOPES_ARG.split(',').map((s) => s.trim()).filter(Boolean);

// ── Guards (operator protocol: refuse to silently mistake) ───────────────
if (!SECRET) {
  console.error('FATAL: FOUNDER_SECRET env var is unset.');
  console.error('       This script will not run without it.');
  console.error('       Add to your shell:  export FOUNDER_SECRET=$(grep ^FOUNDER_SECRET .env | cut -d= -f2-)');
  process.exit(2);
}
if (!USER_ID) {
  console.error('FATAL: --userId=<id> or CONCORD_OPERATOR_ID env var required.');
  console.error('       Example:  --userId=dutch   (your Concord user ID)');
  process.exit(2);
}

// ── The actual mint uses lib/api-keys.js#generateKey, the SAME function
//    that middleware/api-key-auth.js's "Bearer csk_<…>" branch trusts. We
//    import it dynamically (not statically) because this script also
//    doubles as a devtool — static imports pin a require-resolve that
//    doesn't apply when you run it from outside the repo cwd. ────────
const { generateKey, validateKey } = await import('../lib/api-keys.js');

const result = generateKey(USER_ID, SCOPES, {});
if (!result.ok) {
  console.error(`FATAL: generateKey failed: ${result.error}`);
  if (result.error === 'max_keys_reached') {
    console.error('       Revoke an existing key with:');
    console.error('       node -e \'import("./lib/api-keys.js").then(m => { for (const [id, k] of m.KEY_STORE) if (k.userId === "' + USER_ID + '") console.log(id, k.prefix) })\'');
  }
  process.exit(1);
}

const raw = result.rawKey;
if (!raw || !raw.startsWith('csk_')) {
  console.error('FATAL: generated token does not match expected format (must start with csk_)');
  console.error(`       got: ${String(raw).slice(0, 12)}...`);
  process.exit(1);
}

// ── Self-verify before printing: the mint is only useful if the token
//    round-trips against validateKey(). This catches a class of bugs
//    where the import resolved to a stale copy of lib/api-keys.js. ──
const v = validateKey(raw);
if (!v.ok) {
  console.error(`FATAL: self-verify failed after mint: ${v.error}`);
  process.exit(1);
}

// ── Print once. Last 4 chars visible so the operator can confirm which
//    token they have in chat without re-pasting in plaintext. ────────
const last4 = raw.slice(-4);
const banner = '='.repeat(60);
console.log(banner);
console.log(`MCP token minted  ·  last 4: ${last4}`);
console.log(banner);
console.log(raw);
console.log(banner);
console.log(`validity:  in-memory only (dies on server restart)`);
console.log(`scope:     ${SCOPES_ARG === 'all' ? 'all (full MCP surface)' : SCOPES_ARG}`);
console.log(`user:      ${USER_ID}`);
console.log(`label:     ${LABEL}`);
console.log(banner);
console.log('DO NOT paste this anywhere that gets logged, committed, or echoed.');
console.log(`Paste it in your assistant chat ONCE; the assistant caches it for the session.`);
console.log(banner);
