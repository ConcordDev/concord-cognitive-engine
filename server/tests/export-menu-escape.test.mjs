// FIX-urban-planning-006 — the shared Export menu must honour Escape:
// first Esc closes the menu and returns focus to its toggle button (the
// menu-button contract). Source pins on the component of record.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', '..', 'concord-frontend', 'components', 'common', 'ExportMenu.tsx'), 'utf8');

test('the menu key handler closes on Escape', () => {
  const handler = src.slice(src.indexOf('const onMenuKeyDown'));
  assert.match(handler, /e\.key === 'Escape'/);
  assert.match(handler, /setIsOpen\(false\)/);
});

test('Escape returns focus to the toggle button', () => {
  assert.match(src, /buttonRef\.current\?\.focus\(\)/);
  assert.match(src, /ref=\{buttonRef\}/);
});

test('the toggle exposes its expanded state', () => {
  assert.match(src, /aria-expanded=\{isOpen\}/);
  assert.match(src, /aria-haspopup="dialog"/);
});
