/**
 * FIX-council-008 — SOURCE pin (named as such): CouncilChamber is a
 * full-page component whose render harness needs the whole lens stack;
 * the behavioural half of the contract (join joins once, leave removes
 * only the caller, reads never join) is pinned server-side in
 * server/tests/council-member-explicit-join.test.js. This pin holds the
 * FE wiring shape the founder ruling requires:
 *  - no effect anywhere in the file calls member-join (the mount
 *    auto-join is retired entire — opening the lens joins nobody);
 *  - member-join is called only from the Join click handler;
 *  - member-leave exists and is called only from the Leave handler;
 *  - both controls render ("Join the council" / "Leave the council").
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const src = fs.readFileSync(
  path.join(process.cwd(), 'components/council/CouncilChamber.tsx'),
  'utf8',
);

describe('council explicit membership wiring (FIX-council-008)', () => {
  it('no effect calls member-join — opening the lens joins nobody', () => {
    expect(src).not.toMatch(/useEffect\s*\([\s\S]{0,600}?member-join/);
  });

  it('member-join is called exactly once, inside the Join handler', () => {
    const calls = src.match(/lensRun\('council', 'member-join'/g) || [];
    expect(calls.length).toBe(1);
    const i = src.indexOf('handleJoinCouncil');
    const j = src.indexOf("lensRun('council', 'member-join'");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
  });

  it('member-leave is called from the Leave handler', () => {
    const i = src.indexOf('handleLeaveCouncil');
    const j = src.indexOf("lensRun('council', 'member-leave'");
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
  });

  it('both explicit controls render', () => {
    expect(src).toContain('Join the council');
    expect(src).toContain('Leave the council');
    expect(src).toContain('opening this page never joins you');
  });
});
