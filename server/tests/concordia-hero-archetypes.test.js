'use strict';
/*
 * CP-09 — HeroArchetypes mirror validation.
 *
 * Validates the SHIPPED C# tables against independent sources:
 *  - the preset list must equal the real hero-mesh census (the .glb files in
 *    concord-frontend/public/meshes/heroes/) minus the legend placeholders;
 *  - the excluded list must be exactly the census's _archetype_legend* stems;
 *  - the Ruins bindings must be the 4 KayKit mappings of record
 *    (undead/zombie/wraith/lich -> Skeleton_Warrior/Minion/Rogue/Mage),
 *    all bound to sovereign-ruins, with plague_bearer reusing `undead`.
 * The Unity EditMode execution is NOT run here (no Unity on this host).
 * ARCHETYPES_ROOT overrides the tree root (pristine-control runs).
 */
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ARCHETYPES_ROOT || path.join(__dirname, '..', '..');
const CS = path.join(ROOT, 'apps/concordia-living-world/unity-client/Assets/Concordia/Scripts/Aura/HeroArchetypes.cs');
const HEROES = path.join(ROOT, 'concord-frontend/public/meshes/heroes');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('ok -', name); }
  catch (e) { fail++; console.log('FAIL -', name, '::', e.message); }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion'); }

const src = fs.readFileSync(CS, 'utf8');
function extractArray(name) {
  const m = src.match(new RegExp('string\\[\\] ' + name + ' =\\s*\\{([\\s\\S]*?)\\};'));
  assert(m, name + ' array not found');
  return [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]);
}
function census() {
  return fs.readdirSync(HEROES).filter(f => f.endsWith('.glb')).map(f => f.slice(0, -4)).sort();
}

test('presets equal the hero census minus the legend placeholders', () => {
  const all = census();
  const expected = all.filter(s => !s.startsWith('_archetype_legend')).sort();
  const presets = [...extractArray('Presets')].sort();
  assert(JSON.stringify(presets) === JSON.stringify(expected),
    'preset/census mismatch: only-in-cs=' + presets.filter(p => !expected.includes(p)).join(',') +
    ' only-in-census=' + expected.filter(p => !presets.includes(p)).join(','));
  assert(presets.length === 50, 'preset count is ' + presets.length + ', expected 50');
});

test('excluded list is exactly the 7 legend placeholders of the census', () => {
  const legends = census().filter(s => s.startsWith('_archetype_legend')).sort();
  assert(legends.length === 7, 'census legend count is ' + legends.length);
  const excluded = [...extractArray('ExcludedLegendPlaceholders')].sort();
  assert(JSON.stringify(excluded) === JSON.stringify(legends),
    'excluded list differs from census legends');
});

test('no legend placeholder is selectable as a preset', () => {
  const presets = extractArray('Presets');
  assert(!presets.some(p => p.startsWith('_archetype_legend')), 'a legend is in Presets');
});

test('Ruins bindings are the 4 KayKit mappings of record, all bound to sovereign-ruins', () => {
  const rows = [...src.matchAll(/new RuinsBinding\("([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\)/g)]
    .map(x => ({ a: x[1], mesh: x[2], land: x[3] }));
  assert(rows.length === 4, 'binding rows = ' + rows.length);
  const expect = { undead: 'Skeleton_Warrior', zombie: 'Skeleton_Minion', wraith: 'Skeleton_Rogue', lich: 'Skeleton_Mage' };
  for (const r of rows) {
    assert(expect[r.a] === r.mesh, r.a + ' bound to ' + r.mesh + ', expected ' + expect[r.a]);
    assert(r.land === 'sovereign-ruins', r.a + ' bound to ' + r.land);
  }
  assert(new Set(rows.map(r => r.mesh)).size === 4, 'revenant meshes are not distinct');
  assert(/PlagueBearerReuses = "undead"/.test(src), 'plague_bearer reuse is not recorded as undead');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
