import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Pin test (FIX-schema-011): Registry row actions (History/Edit/trash)
// measured ~20px, the field-row req checkbox and remove ✕ were bare, and
// the constraint inputs sat at ~20px — all under the 44px tap floor. The
// fix raises each to min-h-11 / a 44px box; the one px-1.5 py-0.5 element
// left alone is the non-interactive 'new version on save' badge.
// Source-level pins: the defects were class strings on editor markup.
const src = readFileSync(join(__dirname, 'SchemaWorkbench.tsx'), 'utf8');

describe('Schema editor touch targets (FIX-schema-011)', () => {
  it('Registry row actions meet the floor', () => {
    expect(src).toContain('inline-flex min-h-11 items-center rounded border border-zinc-700 px-2 py-1');
    expect(src).toContain('inline-flex min-h-11 items-center rounded border border-cyan-500/30 px-2 py-1');
    expect(src).toContain('inline-flex min-h-11 items-center rounded border border-red-500/30 px-2 py-1');
  });

  it('the field row name/type controls meet the floor', () => {
    expect(src).toContain('min-h-11 flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1');
    expect(src).toContain('min-h-11 rounded border border-zinc-800 bg-zinc-950 px-2 py-1');
  });

  it('the req label is a 44px target and remove is a 44px box', () => {
    expect(src).toContain('flex min-h-11 items-center gap-1.5 px-1 -mx-1');
    expect(src).toContain('type="checkbox" className="h-5 w-5 shrink-0"');
    expect(src).toContain('className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center');
  });

  it('all seven constraint inputs meet the floor; the badge is untouched', () => {
    const hits = src.match(/min-h-11 rounded border border-zinc-800 bg-zinc-950 px-1\.5/g) || [];
    expect(hits.length).toBe(7);
    expect(src).toContain('rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">new version on save');
  });
});
