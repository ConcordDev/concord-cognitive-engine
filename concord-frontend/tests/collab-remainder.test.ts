// Collab remainder pins (F-B row 12, D1's lifecycle remainder) —
// source-level contract pins. Behavioural coverage of the new verbs
// lives in server/tests/collab-room-lifecycle.test.js.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8');

const manifest = read('lib/lenses/manifest.ts');
const badge = read('hooks/useDepthBadge.ts');
const page = read('app/lenses/collab/page.tsx');

describe('collab remainder', () => {
  it('the manifest declares REAL_LIVE at the collab entry', () => {
    const i = manifest.indexOf("domain: 'collab'");
    assert.ok(i >= 0);
    assert.match(manifest.slice(i, i + 200), /dataTier: 'REAL_LIVE'/);
  });

  it('the badge override gives the own-records caption', () => {
    const i = badge.indexOf("'collab':");
    assert.ok(i >= 0);
    assert.match(badge.slice(i, i + 700), /your rooms and sessions, kept on your account/);
  });

  it('the note pane follows a selection, not the first-with-note heuristic', () => {
    assert.match(page, /rooms\.find\(\(room\) => room\.id === selectedId\)/);
    assert.doesNotMatch(page, /rooms\.find\(\(room\) => room\.note\)/);
  });

  it('edit runs room-update under the read-back discipline', () => {
    const i = page.indexOf('const saveEdit');
    const seg = page.slice(i, i + 1500);
    assert.match(seg, /'room-update'/);
    assert.match(seg, /did not read it back/);
  });

  it('close is two-step and verifies the room no longer reads back', () => {
    const i = page.indexOf('const closeRoom');
    const seg = page.slice(i, i + 1400);
    assert.match(seg, /if \(!confirmClose\) \{ setConfirmClose\(true\); return; \}/);
    assert.match(seg, /'room-close'/);
    assert.match(seg, /Closed “\$\{selected\.title\}”\./);
  });
});
