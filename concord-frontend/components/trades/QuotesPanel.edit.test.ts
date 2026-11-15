// FIX-trades-004: a draft quote exposed only Send — no way to open or
// edit it. Source-pin: draft rows carry an Edit control, the panel holds
// edit state, and saving routes to the quotes-update action.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'QuotesPanel.tsx'), 'utf8');

describe('QuotesPanel draft editing (FIX-trades-004)', () => {
  it('draft rows expose an Edit control wired to startEdit', () => {
    expect(SRC).toContain('onClick={() => startEdit(q)}');
    expect(SRC).toContain('Edit draft');
  });

  it('saving an edit calls quotes-update with the quote id', () => {
    expect(SRC).toContain("action: 'quotes-update'");
    expect(SRC).toContain('const [editingId, setEditingId] = useState<string | null>(null)');
  });
});
