import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Pin test (FIX-agents-007): the floating 'New agent' button used a bare
// bottom-8, which put its lower edge under the phone bottom bar
// (h-14 + safe-area inset). The fix gives it the platform's fixed-CTA
// clearance on phones while keeping bottom-8 from md up. Source-level pin:
// the button is inline in the page, and the defect was a class string.
const src = readFileSync(join(__dirname, 'page.tsx'), 'utf8');
const fab = src.match(/title="New agent \(N\)"\s+className="([^"]+)"/);

describe("Agents 'New agent' FAB mobile clearance (FIX-agents-007)", () => {
  it('the FAB exists with the New agent title', () => {
    expect(fab).not.toBeNull();
  });

  it('clears the phone bottom bar below md', () => {
    expect(fab![1]).toContain('bottom-[calc(4rem+env(safe-area-inset-bottom,0px))]');
    expect(fab![1]).toContain('right-4');
  });

  it('keeps the desktop placement from md up', () => {
    expect(fab![1]).toContain('md:bottom-8');
    expect(fab![1]).toContain('md:right-8');
  });

  it('does not carry the old bare bottom-8 / right-8 base placement', () => {
    const base = fab![1].replace(/md:(bottom|right)-8/g, '');
    expect(base).not.toContain('bottom-8');
    expect(base).not.toContain('right-8');
  });
});
