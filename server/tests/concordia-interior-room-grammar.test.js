'use strict';
/*
 * CP-INT-01 — InteriorRoomGrammar (S9) mirror validation.
 *
 * The deliverable is a Unity C# pure model; this suite validates the SHIPPED
 * artefact by extracting its data tables (plans, rooms, doors, RoomKind enum)
 * from the .cs source and re-running the grammar's own validity rules in JS:
 * >=3 rooms, unique ids, entry is a room, door endpoints are rooms, no
 * self/duplicate doors, every room reachable from the entry. It also pins the
 * assembled chain: the grammar's plan set must equal the plan set
 * BuildingInterior.Furnish switches on, plus "hall" for its default case.
 *
 * The Unity EditMode execution itself is NOT run here (no Unity on this
 * host) — it rides the desk route; this suite is the seat-side gate.
 * GRAMMAR_ROOT overrides the tree root (pristine-control runs).
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.GRAMMAR_ROOT || path.join(__dirname, '..', '..');
const GRAMMAR = path.join(ROOT, 'apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/World/InteriorRoomGrammar.cs');
const INTERIOR = path.join(ROOT, 'apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/BuildingInterior.cs');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('ok -', name); }
  catch (e) { fail++; console.log('FAIL -', name, '::', e.message); }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion'); }

const src = fs.readFileSync(GRAMMAR, 'utf8');

function extractKinds() {
  const m = src.match(/public enum RoomKind\s*\{([^}]*)\}/);
  assert(m, 'RoomKind enum not found');
  return m[1].split(',').map(s => s.trim()).filter(Boolean);
}
function extractPlans() {
  const m = src.match(/public static readonly string\[\] Plans =\s*\{([^}]*)\}/);
  assert(m, 'Plans array not found');
  return [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]);
}
function extractGraph(plan) {
  // One static method per plan: new RoomGraph("plan", "entry", rooms, doors)
  const re = new RegExp('new RoomGraph\\("' + plan + '",\\s*"([^"]+)",([\\s\\S]*?)\\);');
  const m = src.match(re);
  assert(m, 'RoomGraph for plan not found: ' + plan);
  const rooms = [...m[2].matchAll(/R\("([^"]+)",\s*RoomKind\.(\w+)\)/g)].map(x => ({ id: x[1], kind: x[2] }));
  const doors = [...m[2].matchAll(/"([a-z_]+>[a-z_]+)"/g)].map(x => x[1]);
  return { plan, entry: m[1], rooms, doors };
}
function validate(g, kinds) {
  assert(g.rooms.length >= 3, g.plan + ': fewer than three rooms');
  const ids = new Set();
  for (const r of g.rooms) {
    assert(!ids.has(r.id), g.plan + ': duplicate room id ' + r.id);
    ids.add(r.id);
    assert(kinds.includes(r.kind), g.plan + ': unknown RoomKind ' + r.kind);
  }
  assert(ids.has(g.entry), g.plan + ': entry is not a room');
  const adj = new Map([...ids].map(id => [id, []]));
  const seen = new Set();
  for (const d of g.doors) {
    const [a, b] = d.split('>');
    assert(a !== b, g.plan + ': self door ' + d);
    assert(ids.has(a) && ids.has(b), g.plan + ': door endpoint not a room: ' + d);
    const key = [a, b].sort().join('>');
    assert(!seen.has(key), g.plan + ': duplicate door ' + d);
    seen.add(key);
    adj.get(a).push(b); adj.get(b).push(a);
  }
  const reached = new Set([g.entry]);
  const q = [g.entry];
  while (q.length) {
    const cur = q.shift();
    for (const n of adj.get(cur)) if (!reached.has(n)) { reached.add(n); q.push(n); }
  }
  assert(reached.size === ids.size, g.plan + ': unreachable room(s): ' + [...ids].filter(i => !reached.has(i)).join(','));
}

test('grammar declares exactly the six building plans', () => {
  const plans = extractPlans();
  assert(JSON.stringify(plans) === JSON.stringify(['tavern', 'forge', 'archive', 'market', 'tower', 'hall']),
    'plans differ: ' + plans.join(','));
});

test('plan set matches BuildingInterior.Furnish switch + hall for its default', () => {
  const interior = fs.readFileSync(INTERIOR, 'utf8');
  const cases = [...interior.matchAll(/case "([a-z]+)":/g)].map(x => x[1]);
  assert(interior.includes('default:'), 'BuildingInterior has no default case to map to hall');
  const plans = extractPlans();
  for (const c of cases) assert(plans.includes(c), 'BuildingInterior plan missing from grammar: ' + c);
  const extra = plans.filter(p => !cases.includes(p));
  assert(JSON.stringify(extra) === JSON.stringify(['hall']), 'grammar plans beyond the switch + hall: ' + extra.join(','));
});

test('every plan graph is valid under the grammar rules', () => {
  const kinds = extractKinds();
  for (const plan of extractPlans()) validate(extractGraph(plan), kinds);
});

test('every graph has exactly one Entry-kind room and it is the entry', () => {
  for (const plan of extractPlans()) {
    const g = extractGraph(plan);
    const entries = g.rooms.filter(r => r.kind === 'Entry');
    assert(entries.length === 1, plan + ': Entry-kind rooms = ' + entries.length);
    assert(entries[0].id === g.entry, plan + ': entry id is not the Entry-kind room');
  }
});

test('unknown plans fall back to the hall graph (For default)', () => {
  assert(/default:\s*return Hall\(\);/.test(src), 'For() default does not return Hall()');
  assert(/case "tavern": return Tavern\(\);/.test(src), 'tavern dispatch missing');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
