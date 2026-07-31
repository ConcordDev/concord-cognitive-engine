/**
 * E2E HTTP-level test — Universal Move System Pillar 2 (availability) +
 * Pillar 3 (cross-world potency), exercised through the REAL live combat
 * route, not just the pure functions in isolation.
 *
 * Context (V1.2 Wave D grounding audit): `server/lib/cross-world-potency.js`
 * (`isAvailableIn` / `worldAffinity` / `crossWorldPotency`) was already
 * unit-tested directly (`tests/cross-world-potency.test.js`,
 * `tests/cross-world-potency-wireup.test.js`) — but nobody had proven the
 * differentiation holds when exercised through the real
 * POST /api/worlds/:worldId/combat/attack route against real, content-seeded
 * worlds (crime/cyber/fantasy/tunya/superhero — content/world/*\/meta.json).
 *
 * Two real gaps were found and fixed while building this test (see the task
 * report for detail); this suite pins both:
 *
 *   1. `isAvailableIn` (Pillar 2 — hard forbid) had ZERO live callsites
 *      anywhere in the server before this change. `crossWorldPotency`
 *      (Pillar 3) WAS wired into routes/worlds.js's combat/attack route, but
 *      isAvailableIn was not. Fixed by wiring it in right before the
 *      resource-bar consumption (routes/worlds.js).
 *   2. Even the ALREADY-wired `crossWorldPotency` call was operating on an
 *      empty `rule_modulators` DB row for every real content world:
 *      content-seeder.js#upsertWorldRow only copied `meta.rule_modulators`
 *      (a distinct, separately-authored key — combatLethality/climate/etc.)
 *      into the DB, silently dropping the TOP-LEVEL `magic_level` /
 *      `tech_level` / `skill_affinity` / `material_availability` fields real
 *      worlds actually author (see content/world/crime/meta.json etc.).
 *      `worldAffinity()`/`isAvailableIn()` read those fields off
 *      `worlds.rule_modulators` — so before this fix, no real seeded world
 *      could ever trigger a Pillar-2 forbid or genuine Pillar-3 scaling
 *      through the DB-backed live path; only the SEPARATE in-memory
 *      `cross-world-effectiveness.js` registry (fed directly from the raw
 *      meta.json object, not through the DB column) ever saw them.
 *   3. Also fixed: `isAvailableIn`'s forbid check only recognized a literal
 *      numeric `0` for magic_level/tech_level. Every real authored world
 *      encodes the level as a string enum ("none"/"trace"/"abundant"/…) —
 *      never a bare number — so the numeric check could never fire against
 *      real content either. `isZeroLevel()` now also treats the
 *      case-insensitive string "none" as the hard-forbid floor.
 *
 * This suite spawns the real server (so real content-seeding runs), grabs
 * real seeded NPCs via the real `/api/worlds/:worldId/npcs` route, inserts a
 * real skill DTU (the shape move-descriptor.js stamps at mint), and calls
 * the real combat/attack HTTP endpoint — then compares the numbers the route
 * echoes back against calling `isAvailableIn`/`crossWorldPotency` directly on
 * the exact same DB-read world row, proving the live route and the pure
 * functions agree.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

import { isAvailableIn, crossWorldPotency, worldAffinity } from '../../lib/cross-world-potency.js';
import { armOrphanGuard } from '../lib/e2e-orphan-guard.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_JS = join(__dirname, '../../server.js');
const SERVER_CWD = join(__dirname, '../..');

// ── Boilerplate (same shape as tests/e2e/time-loop-routes.test.js /
// tests/e2e/repair-console-routes.test.js) ──────────────────────────────────

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function spawnServer(port, dataDir, extraEnv, timeoutMs) {
  timeoutMs = timeoutMs || 90000;
  extraEnv = extraEnv || {};
  return new Promise((resolve, reject) => {
    const env = Object.assign({}, process.env, {
      PORT: String(port),
      NODE_ENV: 'e2e-test',
      CONCORD_NO_LISTEN: 'false',
      // lib/request-admission.js sheds requests with an immediate 503 when
      // event-loop lag exceeds 300ms for roughly the first ~20s of boot, and
      // full-suite parallelism (many test files each spawning their own
      // server.js concurrently) compounds that well past isolated-run levels
      // -- observed directly on this exact shared spawnServer() shape wholesale
      // failing under full-suite contention while passing 13/13 in isolation.
      // Disable shedding for e2e spawns; they exist to test real behaviour,
      // not admission control.
      CONCORD_LOAD_SHED_ENABLED: '0',
      DATA_DIR: dataDir,
      LOG_LEVEL: 'info',
      LOG_FORMAT: 'json',
      OPENAI_API_KEY: '',
      ANTHROPIC_API_KEY: '',
    }, extraEnv);

    // The spawned server MUST derive its own DB/state from DATA_DIR above.
    // `Object.assign({}, process.env, ...)` inherits everything we do not
    // explicitly override, and tests/preload/no-egress.mjs sets DB_PATH +
    // STATE_PATH on THIS (parent) process for per-test-file isolation. Those
    // are absolute paths that take precedence over DATA_DIR, so leaving them
    // in the child env silently points the spawned server at the PARENT's
    // throwaway database -- defeating the isolation this dataDir exists to
    // provide, and making parent and child write the same file concurrently.
    // Found 2026-07-25: cross-world-potency-routes went 6/6 -> 1/6 the moment
    // the preload's isolation started actually taking effect, because the
    // child booted against an empty inherited DB instead of seeding its own.
    delete env.DB_PATH;
    delete env.STATE_PATH;

    const child = spawn(process.execPath, [SERVER_JS], {
      env: env,
      cwd: SERVER_CWD,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // The after() hook below tears this child (and dataDir) down on the happy
    // path, but it never runs when `node --test` SIGTERMs a file that blew its
    // --test-timeout — which orphans a real, CPU-burning server process and
    // strands its migrated SQLite tree. See tests/lib/e2e-orphan-guard.js.
    armOrphanGuard(child, dataDir);

    let resolved = false;
    const timer = setTimeout(function () {
      if (!resolved) {
        child.kill('SIGKILL');
        reject(new Error('Server on port ' + port + ' did not become ready within ' + timeoutMs + 'ms'));
      }
    }, timeoutMs);

    function checkLine(line) {
      if (
        line.indexOf('server_listening') !== -1 ||
        line.indexOf('http://localhost:' + port) !== -1 ||
        line.indexOf('"url":"http://localhost:' + port + '"') !== -1 ||
        line.indexOf('Listening on port ' + port) !== -1 ||
        line.indexOf('listening on') !== -1
      ) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve(child);
        }
      }
    }

    let stdoutBuf = '';
    child.stdout.on('data', function (chunk) {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop();
      lines.forEach(checkLine);
    });

    let stderrBuf = '';
    child.stderr.on('data', function (chunk) {
      stderrBuf += chunk.toString();
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop();
      lines.forEach(checkLine);
    });

    child.on('exit', function (code, signal) {
      if (!resolved) {
        clearTimeout(timer);
        reject(new Error('Server exited early (code=' + code + ' signal=' + signal + ')'));
      }
    });

    child.on('error', function (err) {
      if (!resolved) {
        clearTimeout(timer);
        reject(err);
      }
    });
  });
}

function stopServer(child) {
  if (!child || child.killed) return Promise.resolve();
  return new Promise(function (resolve) {
    child.kill('SIGTERM');
    const t = setTimeout(function () { child.kill('SIGKILL'); resolve(); }, 5000);
    child.on('exit', function () { clearTimeout(t); resolve(); });
  });
}

async function apiFetch(base, path, options) {
  options = options || {};
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, 8000);
  try {
    const res = await fetch(base + path, Object.assign({}, options, { signal: controller.signal }));
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function getJSON(base, path, headers) {
  const res = await apiFetch(base, path, { headers: headers || {} });
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  return { status: res.status, body: body };
}

async function postJSON(base, path, payload, headers) {
  payload = payload || {};
  const res = await apiFetch(base, path, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: JSON.stringify(payload),
  });
  let body = null;
  try { body = await res.json(); } catch (_) { body = null; }
  return { status: res.status, body: body };
}

/** Insert a real skill DTU (the shape move-descriptor.js#stampMoveMeta stamps
 *  at mint/evolve into a recipe's meta_json) directly into the spawned
 *  server's real sqlite file. The combat/attack route reads it back via
 *  `SELECT data, skill_level FROM dtus WHERE id = ?` with no ownership
 *  check, so any real row id works. */
function insertSkillDtu(dbHandle, { skillKind, skillType, element = 'arcane', nativeWorld, skillLevel = 1, resourceBar = 'mana', barCost = 5, basePower = 20, maxDamage = 1000 }) {
  const id = 'e2e-potency-skill-' + randomUUID();
  const data = JSON.stringify({
    skill_kind: skillKind,
    skill_type: skillType,
    element,
    nativeWorld,
    resource_bar: resourceBar,
    bar_cost: barCost,
    base_power: basePower,
    max_damage: maxDamage,
  });
  dbHandle.prepare(`INSERT INTO dtus (id, data, skill_level) VALUES (?, ?, ?)`).run(id, data, skillLevel);
  return id;
}

describe('E2E — Universal Move System Pillar 2/3 through the real combat/attack route', { timeout: 120000 }, function () {
  let base;
  let serverProc;
  let dataDir;
  let authHeaders;

  before(async function () {
    const port = await getFreePort();
    dataDir = mkdtempSync(join(tmpdir(), 'concord-e2e-xwpotency-'));
    base = 'http://127.0.0.1:' + port;
    serverProc = await spawnServer(port, dataDir, { AUTH_MODE: 'public' }, 90000);

    const reg = await postJSON(base, '/api/auth/register', {
      username: 'xwpotencye2e' + Date.now(),
      email: 'xwpotencye2e' + Date.now() + '@example.com',
      password: 'CorrectHorseBattery9!',
      dateOfBirth: '1990-01-01',
      _t: Date.now() - 5000,
    });
    if (reg.status !== 201 || !reg.body || !reg.body.token) {
      throw new Error('Setup failed: could not register a test user: ' + JSON.stringify(reg));
    }
    authHeaders = { Authorization: 'Bearer ' + reg.body.token };
  });

  after(function () {
    const done = stopServer(serverProc);
  // Remove the spawned server's data dir. Each of these e2e tests boots a
  // REAL server against a fresh mkdtemp dir, which migrates a full ~118MB
  // SQLite DB. Without this the dir survives the run, so a full suite
  // stranded ~800MB in /tmp and eventually filled the disk mid-run.
  // force:true so a missing dir can never fail teardown.
  rmSync(dataDir, { recursive: true, force: true });
    return done;
  });

  /** Fetch a real, live NPC id in a real content-seeded world via the real
   *  GET /api/worlds/:worldId/npcs route (proves the world is really seeded,
   *  not something this test fabricates). */
  async function realNpcIdIn(worldId) {
    const res = await getJSON(base, '/api/worlds/' + worldId + '/npcs', authHeaders);
    assert.equal(res.status, 200, worldId + ' /npcs should be reachable: ' + JSON.stringify(res.body));
    const npcs = res.body && res.body.npcs;
    assert.ok(Array.isArray(npcs) && npcs.length > 0, worldId + ' should have real seeded NPCs, got: ' + JSON.stringify(res.body));
    return npcs[0].id;
  }

  it('sanity: crime/cyber/fantasy are real content-seeded worlds with real NPCs', async function () {
    const crimeNpc = await realNpcIdIn('crime');
    const cyberNpc = await realNpcIdIn('cyber');
    const fantasyNpc = await realNpcIdIn('fantasy');
    assert.ok(crimeNpc && cyberNpc && fantasyNpc);
  });

  it('Pillar 2 — a real no-magic world (crime, magic_level:"none") genuinely rejects a real spell cast over real HTTP, and the live route\'s reason agrees exactly with calling isAvailableIn() directly on the same DB-read world row', async function () {
    const npcId = await realNpcIdIn('crime');
    const db = new Database(join(dataDir, 'concord.db'));
    let skillDtuId, worldRow;
    try {
      skillDtuId = insertSkillDtu(db, { skillKind: 'spell', skillType: 'magic', nativeWorld: 'fantasy', skillLevel: 50 });
      worldRow = db.prepare('SELECT rule_modulators FROM worlds WHERE id = ?').get('crime');
    } finally {
      db.close();
    }
    assert.ok(worldRow && worldRow.rule_modulators, 'expected a real seeded crime world row');
    const parsed = JSON.parse(worldRow.rule_modulators);
    assert.equal(parsed.magic_level, 'none', 'sanity: crime is really authored as magic_level "none"');

    // What the pure function predicts against the EXACT same DB row.
    const direct = isAvailableIn(worldRow, { skillKind: 'spell' });
    assert.equal(direct.available, false, 'isAvailableIn should itself predict a forbid for crime + spell');

    // What the real live HTTP route actually does.
    const res = await postJSON(base, '/api/worlds/crime/combat/attack', { npcId, skillDtuId }, authHeaders);
    assert.equal(res.status, 422, 'expected a real 422 rejection casting a spell in crime, got: ' + JSON.stringify(res));
    assert.equal(res.body?.ok, false);
    assert.equal(res.body?.error, 'power_forbidden_in_world');
    assert.equal(res.body?.reason, direct.reason, 'the live route\'s reason string must be the exact isAvailableIn() output, not a re-derived one');
  });

  it('Pillar 2 control — the SAME no-magic world (crime) does NOT forbid a tech/cyber power (magic_level and tech_level gate independently, not a blanket combat refusal)', async function () {
    const npcId = await realNpcIdIn('crime');
    const db = new Database(join(dataDir, 'concord.db'));
    let skillDtuId, worldRow;
    try {
      skillDtuId = insertSkillDtu(db, { skillKind: 'cyber_ability', skillType: 'tech', element: 'energy', nativeWorld: 'cyber', skillLevel: 50, resourceBar: 'stamina' });
      worldRow = db.prepare('SELECT rule_modulators FROM worlds WHERE id = ?').get('crime');
    } finally {
      db.close();
    }
    const direct = isAvailableIn(worldRow, { skillKind: 'cyber_ability' });
    assert.equal(direct.available, true, 'sanity: crime is modern tech_level, tech powers should be available');

    const res = await postJSON(base, '/api/worlds/crime/combat/attack', { npcId, skillDtuId }, authHeaders);
    assert.notEqual(res.body?.error, 'power_forbidden_in_world', 'a tech ability must not be caught by the magic-forbid gate: ' + JSON.stringify(res.body));
    assert.notEqual(res.status, 422, 'expected the tech ability to proceed past the availability gate, got: ' + JSON.stringify(res));
  });

  it('Pillar 3 — a real foreign, low-affinity world (cyber, magic affinity 0.1) genuinely dampens a novice spell over real HTTP, and the exact potency number the live route echoes back matches calling crossWorldPotency() directly on the same DB-read world row', async function () {
    const npcId = await realNpcIdIn('cyber');
    const db = new Database(join(dataDir, 'concord.db'));
    let skillDtuId, worldRow;
    try {
      // Native world = fantasy (foreign to cyber) — this is what makes
      // Pillar 3 activate at all (crossWorldPotency is a no-op when
      // nativeWorld === targetWorld). Level 1 = novice, so the mastery
      // floor barely claws back the low cyber magic affinity.
      skillDtuId = insertSkillDtu(db, { skillKind: 'spell', skillType: 'magic', nativeWorld: 'fantasy', skillLevel: 1 });
      worldRow = db.prepare('SELECT rule_modulators FROM worlds WHERE id = ?').get('cyber');
    } finally {
      db.close();
    }
    assert.ok(worldRow, 'expected a real seeded cyber world row');
    const affinity = worldAffinity(worldRow, 'magic');
    assert.ok(affinity > 0 && affinity < 0.2, 'sanity: cyber should really author a low magic affinity, got ' + affinity);

    const predicted = crossWorldPotency({
      skillLevel: 1, skillKind: 'spell', nativeWorldId: 'fantasy', targetWorldId: 'cyber', targetWorld: worldRow,
    });
    assert.ok(predicted > 0 && predicted < 0.2, 'sanity: predicted potency should genuinely sag near the cyber magic floor, got ' + predicted);

    const res = await postJSON(base, '/api/worlds/cyber/combat/attack', { npcId, skillDtuId }, authHeaders);
    assert.equal(res.status, 200, 'a spell in cyber should be DAMPENED, not rejected outright: ' + JSON.stringify(res));
    assert.equal(res.body?.ok, true);
    assert.equal(
      res.body?.damageResult?.crossWorldPotency, predicted,
      'the live route must echo back the EXACT crossWorldPotency() value computed on the same real world row: ' + JSON.stringify(res.body?.damageResult),
    );
  });

  it('Pillar 3 — a real world with FULL magic affinity (fantasy, magic affinity 1.0) is neither rejected nor dampened for a foreign novice caster, proving the live route does not apply a blanket cross-world penalty', async function () {
    const npcId = await realNpcIdIn('fantasy');
    const db = new Database(join(dataDir, 'concord.db'));
    let skillDtuId, worldRow;
    try {
      // Native world = tunya (a DIFFERENT foreign world, and one where the
      // "magic" domain affinity is 0 — tunya's magic works through
      // fire/ice bloodlines, not the generic magic domain). If the live
      // route applied a blanket "foreign = penalized" rule, this would
      // wrongly dampen too. It shouldn't: fantasy's OWN affinity for magic
      // is what governs, and it's 1.0.
      skillDtuId = insertSkillDtu(db, { skillKind: 'spell', skillType: 'magic', nativeWorld: 'tunya', skillLevel: 1 });
      worldRow = db.prepare('SELECT rule_modulators FROM worlds WHERE id = ?').get('fantasy');
    } finally {
      db.close();
    }
    assert.ok(worldRow, 'expected a real seeded fantasy world row');
    const affinity = worldAffinity(worldRow, 'magic');
    assert.equal(affinity, 1.0, 'sanity: fantasy should really author a full magic affinity');

    const predicted = crossWorldPotency({
      skillLevel: 1, skillKind: 'spell', nativeWorldId: 'tunya', targetWorldId: 'fantasy', targetWorld: worldRow,
    });
    assert.equal(predicted, 1.0, 'sanity: predicted potency should be full in a fully-favorable world regardless of the caster\'s mastery level');

    const res = await postJSON(base, '/api/worlds/fantasy/combat/attack', { npcId, skillDtuId }, authHeaders);
    assert.equal(res.status, 200, 'a spell in fantasy must not be rejected: ' + JSON.stringify(res));
    assert.equal(res.body?.ok, true);
    // The route only sets damageResult.crossWorldPotency when potency !== 1.0
    // (routes/worlds.js: `if (potency !== 1.0) { ...set finalDamage & crossWorldPotency }`)
    // — so its ABSENCE here is itself the proof no reduction was silently applied.
    assert.equal(
      res.body?.damageResult?.crossWorldPotency, undefined,
      'full potency (1.0) must not be echoed as a reduction field: ' + JSON.stringify(res.body?.damageResult),
    );
    assert.ok(Number(res.body?.damageResult?.finalDamage) > 0, 'expected a real, positive computed hit: ' + JSON.stringify(res.body?.damageResult));
  });

  // Control: a genuinely bogus world id should behave like "no forbid data"
  // (isAvailableIn degrades to available:true on an unparseable/empty world)
  // rather than crashing the route — proves the availability gate is
  // best-effort as documented, not a hard dependency on the world existing.
  it('control: an unknown worldId does not crash the availability gate (best-effort degrade, not a 500)', async function () {
    const db = new Database(join(dataDir, 'concord.db'));
    let skillDtuId;
    try {
      skillDtuId = insertSkillDtu(db, { skillKind: 'spell', skillType: 'magic', nativeWorld: 'fantasy', skillLevel: 1 });
    } finally {
      db.close();
    }
    const res = await postJSON(base, '/api/worlds/this-world-does-not-exist-xyz/combat/attack', { npcId: 'no-such-npc', skillDtuId }, authHeaders);
    assert.notEqual(res.status, 500, 'an unknown world must not crash the route: ' + JSON.stringify(res));
    assert.notEqual(res.body?.error, 'power_forbidden_in_world', 'an unknown world (no modulators) must not be treated as a forbid: ' + JSON.stringify(res.body));
  });
});
