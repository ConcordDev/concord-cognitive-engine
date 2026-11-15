import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Pin test (FIX-deities-007, name leg): a composed deity name can be one
// 80-char token. The card and detail headings carried no wrap strategy and
// no min-w-0, so a long name broke the layout mid-token. The fix lets the
// name wrap inside its own box ([overflow-wrap:anywhere]) and keeps the
// pilgrim count from being squeezed (shrink-0). Source-level pins: the
// defect was absent classes on data-driven markup.
const page = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
const panel = readFileSync(join(__dirname, '../../../components/deities/DeityDetailPanel.tsx'), 'utf8');

describe('Deity long-name wrapping (FIX-deities-007)', () => {
  it('card name wraps inside its box', () => {
    expect(page).toContain('[overflow-wrap:anywhere]">{d.name}');
  });

  it('card name column can shrink and the count column cannot', () => {
    expect(page).toContain('<div className="min-w-0">');
    expect(page).toContain('<div className="shrink-0 text-right">');
  });

  it('detail heading and commune heading wrap the name too', () => {
    expect(panel).toContain('[overflow-wrap:anywhere]">{deity.name}');
    expect(panel).toContain('[overflow-wrap:anywhere]">Commune with {deity.name}');
    expect(panel).toContain('<div className="min-w-0">');
  });
});
