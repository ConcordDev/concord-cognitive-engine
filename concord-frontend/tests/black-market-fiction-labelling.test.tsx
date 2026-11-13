// FIX-black-market-010 — surface labelling pins (source): the Black
// Market surfaces label intercepts as fiction, and the old framing that
// presented them as real users' intercepted Concord Link messages is
// gone. Behavioural pins for the underlying gate live in
// server/tests/black-market-fiction-gate.test.js.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');

describe('black-market fiction labelling (FIX-black-market-010)', () => {
  it('the lens page frames intercepts as fictional NPC traffic', () => {
    const page = read('../app/lenses/black-market/page.tsx');
    expect(page).toMatch(/Fictional NPC intercepts/);
    expect(page).toMatch(/Fiction — NPC message/); // the reveal carries the label
    expect(page).not.toMatch(/Intercepted Concord Link messages, sender and receiver redacted/);
  });

  it("Sael's stall labels the rack as fiction, in words a visitor reads", () => {
    const stall = read('../components/black-market/SaelStall.tsx');
    expect(stall).toMatch(/Fiction — NPC intercepts/);
    expect(stall).toMatch(/no real user's messages are surfaced or sold/i);
  });
});
