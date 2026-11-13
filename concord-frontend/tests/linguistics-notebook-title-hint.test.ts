// FIX-linguistics-005 — the Notebook create form (Analyses, Lexicon,
// Grammars, Corpora, Translations share it) disabled Create on a
// blank title with no word about which field was missing. A note
// beside the button now names the requirement while the title is
// blank (the queue-005 pattern).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.resolve(__dirname, '..', 'components/linguistics/NotebookPanel.tsx'), 'utf8');

describe('FIX-linguistics-005 — create form names its missing field', () => {
  it('a role=note hint shows while the title is blank', () => {
    expect(src).toContain('{!formTitle.trim() && <span role="note"');
    expect(src).toContain('Title is required.</span>}');
  });
});
