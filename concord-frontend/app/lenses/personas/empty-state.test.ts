// FIX-personas-012: the My Personas empty state put the sentence directly
// inside a flex container, so each text run and the <strong> became
// separate flex items and the sentence broke apart around the bold word.
// Source-pin: the sentence lives inside a single <p> flex item.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

describe('Personas empty state (FIX-personas-012)', () => {
  it('the sentence is one text flow inside a <p>', () => {
    expect(SRC).toContain('<p>No personas yet. Use the <strong>Create</strong> tab to author your first.</p>');
  });

  it('the bare fragmented form is gone', () => {
    expect(SRC).not.toMatch(/>\s*\n\s*No personas yet\. Use the/);
  });
});
