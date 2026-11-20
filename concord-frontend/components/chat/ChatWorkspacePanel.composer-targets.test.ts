import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Pin test (FIX-chat-013): at 390px the composer + button measured 36x36
// and the mode pill 52x24 — both under the 44px tap-target floor (the Send
// button already measures 44x44). The fix gives the + button a full 44x44
// box and the mode pill a 44px minimum height. Source-level pins: the
// defects were class strings on the composer controls.
const src = readFileSync(join(__dirname, 'ChatWorkspacePanel.tsx'), 'utf8');

describe('Chat composer tap targets (FIX-chat-013)', () => {
  it('the + (attachments and tools) button is a 44x44 box', () => {
    expect(src).toMatch(/className="flex h-11 w-11 items-center justify-center[^"]*"/);
    expect(src).not.toContain('className="p-2 text-white/70 hover:text-white transition-colors"');
  });

  it('the Answer-as pill carries a 44px minimum height', () => {
    // The mode pill became the Notebook's "Answer as" picker; its height
    // lives in the Notebook stylesheet.
    const css = readFileSync(join(__dirname, 'notebook', 'notebook.css'), 'utf8');
    expect(css).toMatch(/\.nb-answer-as \{[^}]*min-height: 44px/);
    expect(src).toContain('<AnswerAsPicker');
  });
});
