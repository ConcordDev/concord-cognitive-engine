/**
 * FIX-agriculture-009 (a11y legs; the delete-confirmation leg belongs
 * to the StickyDeleteConfirm genus and is expressly not in this fix) —
 * the record EditorModal's fields were programmatically unnamed: the
 * Field wrapper rendered a <label> with no htmlFor around a control
 * with no id. Field now generates an id, links the label to it, and
 * composes a placeholder raise (gray-500 -> gray-400) onto every
 * modal control. The lens's remaining dim text instances are raised
 * one step. Verified in code: ds.input's typed text is text-white on
 * the dark lattice surface (#12121a) — the typed-text leg could not
 * be reproduced from code and is left to the desk's live re-walk.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-agriculture-009 — agriculture dialog a11y', () => {
  it('Field links its label to its control and raises placeholders', () => {
    const s = read('components/agriculture/RecordsPanel.tsx');
    expect(s).toContain('htmlFor={id}');
    expect(s).toContain('cloneElement(child, { id, className: cn(child.props.className, \'placeholder:text-gray-400\') })');
    expect(s).toContain('useId()');
  });

  it('no dim gray/zinc-500 text remains in the agriculture panels', () => {
    expect(read('components/agriculture/AgricultureFeedPanel.tsx').includes('text-gray-500')).toBe(false);
    expect(read('components/agriculture/AgricultureActionPanel.tsx').includes('text-zinc-500')).toBe(false);
  });
});
