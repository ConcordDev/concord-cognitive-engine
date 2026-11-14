/**
 * FIX-council-008 rider — SOURCE pin (named as such, same form and
 * rationale as tests/components/CouncilExplicitMembership.test.tsx):
 * CouncilChamber's render harness needs the whole lens stack; the
 * behavioural half of the rider (refusal, no implicit join, member
 * authors, leave revokes) is pinned server-side in
 * server/tests/front15-council-rider.test.js. This pin holds the FE
 * wiring the ruling needs:
 *  - the composer tells a signed-in guest that authoring is for
 *    members, pointing at the Join control;
 *  - a refused create SPEAKS — handleCreateProposal stores the
 *    server's refusal in createError instead of returning silently;
 *  - the refusal renders as an alert inside the composer.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const src = fs.readFileSync(
  path.join(process.cwd(), 'components/council/CouncilChamber.tsx'),
  'utf8',
);

describe('council authoring rider wiring (FIX-council-008 rider)', () => {
  it('the composer carries the guest authoring note keyed on membership', () => {
    expect(src).toContain('!viewerIsCouncilMember');
    expect(src).toContain('authoring is');
    expect(src).toContain('for council members');
  });

  it('a refused create is stored, not swallowed', () => {
    const i = src.indexOf('handleCreateProposal');
    const j = src.indexOf('setCreateError(r.data.error', i);
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
  });

  it('the refusal renders as an alert in the composer', () => {
    expect(src).toContain('{createError && (');
    expect(src).toMatch(/role="alert"[\s\S]{0,200}?\{createError\}/);
  });
});
