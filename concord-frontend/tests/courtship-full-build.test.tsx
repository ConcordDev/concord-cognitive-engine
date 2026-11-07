// Declaration + leg pins for the courtship full lens build (F-B row 14).
//
// The declaration was ABSENT entire at premise (F1 P0, genesis form), so
// the legs pin what the build added: the manifest tier, the scoped badge
// caption. The leg pins assert the built forms: partner labels resolve
// name-first with a neutral fallback and never a raw id (S2); the error
// wording map covers the engine's reason set and never renders a raw code
// (S3); the desk reads pregnancies from the server macro and the retired
// localStorage cache module is GONE (S2); the notices inbox + spouses read
// are wired to their shipped verbs (S5); no panel renders a kind:id
// fragment any more (S2).

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { renderHook } from '@testing-library/react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';
import { partnerLabel } from '@/components/courtship/courtship-types';
import { courtshipErrorText } from '@/components/courtship/courtship-errors';

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('courtship declarations (S1)', () => {
  it('manifest carries courtship at REAL_LIVE', () => {
    expect(getLensManifest('courtship')?.dataTier).toBe('REAL_LIVE');
  });

  it('depth badge carries the scoped romance-engine caption', () => {
    const { result } = renderHook(() => useDepthBadge('courtship'));
    expect(result.current.label).toBe('Live');
    expect(result.current.caption).toContain('romance engine');
    expect(result.current.caption).toContain('stay pending until the other player accepts');
    expect(result.current.caption).not.toContain('polled live from an external source');
  });
});

describe('partner labels (S2)', () => {
  it('prefers the resolved name, else a neutral word by kind — never a raw id', () => {
    expect(partnerLabel('npc', 'Lyra')).toBe('Lyra');
    expect(partnerLabel('npc', null)).toBe('An NPC of Concordia');
    expect(partnerLabel('npc', undefined)).toBe('An NPC of Concordia');
    expect(partnerLabel('player', null)).toBe('Another player');
    expect(partnerLabel('player', '')).toBe('Another player');
  });

  it('no courtship surface renders a kind:id fragment any more', () => {
    for (const rel of [
      'components/courtship/CourtshipsPanel.tsx',
      'components/courtship/MarriagesPanel.tsx',
      'components/courtship/FamilyPanel.tsx',
      'components/courtship/PastMarriagesPanel.tsx',
      'app/lenses/courtship/page.tsx',
    ]) {
      const src = read(rel);
      expect(src, rel).not.toContain('slice(0, 14)');
      expect(src, rel).toContain('partnerLabel');
    }
  });
});

describe('error wording (S3)', () => {
  it('affinity_too_low carries its numbers in words', () => {
    expect(courtshipErrorText({ reason: 'affinity_too_low', required: 0.7, got: 0.62 }))
      .toBe('Affinity is 62% — this step needs 70%.');
    expect(courtshipErrorText({ reason: 'affinity_too_low' }))
      .toBe('Affinity is not high enough for that step yet.');
  });

  it('the engine reason set renders in product words', () => {
    expect(courtshipErrorText({ reason: 'must_be_married_to_conceive' })).toContain('active marriage');
    expect(courtshipErrorText({ reason: 'already_pregnant' })).toContain('already under way');
    expect(courtshipErrorText({ reason: 'not_due' })).toContain('not due yet');
    expect(courtshipErrorText({ reason: 'daily_cap' })).toContain('interaction limit');
    expect(courtshipErrorText({ reason: 'cannot_court_self' })).toBe('You cannot court yourself.');
    expect(courtshipErrorText({ reason: 'not_a_party' })).toContain('Only a partner in that marriage');
    expect(courtshipErrorText({ reason: 'consent_required' })).toContain('Both players');
  });

  it('an unmapped machine code never renders raw', () => {
    const words = courtshipErrorText({ reason: 'some_new_engine_code' });
    expect(words).not.toContain('some_new_engine_code');
    expect(words).toContain('could not be completed');
    expect(courtshipErrorText(null)).toContain('could not be completed');
    expect(courtshipErrorText({ reason: null })).toContain('could not be completed');
  });

  it('the desk routes every refusal through the map', () => {
    const src = read('components/courtship/useCourtshipDesk.ts');
    expect(src).toContain('courtshipErrorText');
    expect(src).not.toContain('Action failed: ${');
    expect(src).not.toContain('Could not conceive: ${');
    expect(src).not.toContain('Could not complete birth: ${');
    expect(src).not.toContain('Could not end marriage: ${');
  });
});

describe('pregnancies + notices + spouses wiring (S2/S5)', () => {
  it('the desk reads pregnancies from the server macro; the cache module is retired', () => {
    const src = read('components/courtship/useCourtshipDesk.ts');
    expect(src).toContain("name: 'pregnancies'");
    expect(src).not.toContain('pregnancy-cache');
    expect(fs.existsSync(path.join(ROOT, 'components/courtship/pregnancy-cache.ts'))).toBe(false);
  });

  it('the consent inbox is wired to the shipped accept/decline verbs', () => {
    const src = read('components/courtship/useCourtshipDesk.ts');
    expect(src).toContain("name: 'notices'");
    expect(src).toContain("name: 'spouses'");
    expect(src).toContain("accept ? 'accept' : 'decline'");
    const panel = read('components/courtship/CourtshipsPanel.tsx');
    expect(panel).toContain('courtship-notices');
    expect(panel).toContain('Proposals waiting for you');
    const marriages = read('components/courtship/MarriagesPanel.tsx');
    expect(marriages).toContain('courtship-spouses');
  });
});
