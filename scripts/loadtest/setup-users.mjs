#!/usr/bin/env node
// Concord — load-test user pool provisioner.
// ---------------------------------------------------------------------------
// Registers (or logs in) N throwaway test accounts and writes their JWTs to a
// tokens file that k6-mix.js reads for the authed scenarios (Concordia / chat).
//
// ⚠️  These are REAL accounts on the target server. Point this at a STAGING
//     box, or accept that N test users + their writes land in your prod DB.
//     Only needed when you opt into ENABLE_CONCORDIA / ENABLE_CHAT.
//
//   node scripts/loadtest/setup-users.mjs --url https://concord-os.org -n 200 -o tokens.json
//
// Flags:
//   --url  base URL            (default http://localhost:5050)
//   -n     number of users     (default 100)
//   -o     output tokens file  (default tokens.json)
//   --prefix  username prefix  (default loadtest)
// ---------------------------------------------------------------------------

import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
function flag(name, def) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const BASE = flag('--url', process.env.BASE_URL || 'http://localhost:5050').replace(/\/$/, '');
const N = Number(flag('-n', '100'));
const OUT = flag('-o', 'tokens.json');
const PREFIX = flag('--prefix', 'loadtest');
const RUN = Date.now().toString(36);

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json = {};
  try { json = await res.json(); } catch (_e) { /* non-json */ }
  return { status: res.status, json };
}

async function provisionOne(i) {
  const username = `${PREFIX}_${RUN}_${i}`;
  const email = `${username}@loadtest.invalid`;
  const password = `LoadTest!${RUN}${i}aA`;

  // Try register; if the username/email already exists, fall back to login.
  // dateOfBirth is required by the 18+ age gate — use a fixed adult date.
  let r = await post('/api/auth/register', { username, email, password, dateOfBirth: '1990-01-01' });
  let token = r.json?.token;
  if (!token) {
    const l = await post('/api/auth/login', { email, password });
    token = l.json?.token;
    if (!token) {
      return { ok: false, status: r.status, reason: r.json?.error || l.json?.error || 'no token (cookie-only auth?)' };
    }
  }
  return { ok: true, token, userId: r.json?.user?.id || username, username };
}

async function main() {
  console.log(`\n  Provisioning ${N} test users → ${BASE}`);
  console.log(`  ⚠️  These are real accounts. Use a staging box if you can.\n`);

  const tokens = [];
  let fails = 0;
  // Provision in batches so we don't hammer the auth rate-limiter.
  const BATCH = 10;
  for (let i = 0; i < N; i += BATCH) {
    const batch = [];
    for (let j = i; j < Math.min(i + BATCH, N); j++) batch.push(provisionOne(j));
    const results = await Promise.all(batch);
    for (const r of results) {
      if (r.ok) tokens.push({ token: r.token, userId: r.userId });
      else { fails++; if (fails <= 5) console.log(`   ✗ ${r.status} ${r.reason}`); }
    }
    process.stdout.write(`\r  provisioned ${tokens.length}/${N}  (failed ${fails})   `);
    await new Promise((r) => setTimeout(r, 250)); // gentle on the rate limiter
  }

  console.log('\n');
  if (!tokens.length) {
    console.log('  ✗ No tokens obtained. Common causes:');
    console.log('    - ALLOW_REGISTRATION=false on the server');
    console.log('    - Auth is cookie-only (no token in the JSON body)');
    console.log('    - Rate limiter blocked the burst (lower -n, retry)');
    process.exit(1);
  }
  writeFileSync(OUT, JSON.stringify(tokens, null, 2));
  console.log(`  ✓ Wrote ${tokens.length} tokens → ${OUT}`);
  console.log(`\n  Now run the authed scenarios:`);
  console.log(`    ENABLE_CONCORDIA=1 TOKENS_FILE=${OUT} BASE_URL=${BASE} k6 run scripts/loadtest/k6-mix.js\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
