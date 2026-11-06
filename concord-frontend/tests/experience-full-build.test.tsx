/**
 * experience-full-build.test.tsx — pins for the Experience full lens
 * build (F-C row 23, the family closer): the declaration caption, the
 * suite's lifecycle exits, and the Atlas DTU-ID receipt.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getLensManifest } from '@/lib/lenses/manifest';
import { renderHook } from '@testing-library/react';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('experience declaration', () => {
  it('the manifest declares REAL_LIVE; the badge reads Live with the portfolio caption', () => {
    expect(getLensManifest('experience')?.dataTier).toBe('REAL_LIVE');
    const { result } = renderHook(() => useDepthBadge('experience'));
    expect(result.current.label).toBe('Live');
    expect(result.current.caption).toContain('platform store');
    expect(result.current.caption).toContain('Directory');
  });
  it('the registry entry agrees (REAL_LIVE, substrate-flagged)', () => {
    const registry = read('../server/lib/integration-registry.js');
    const line = registry.split('\n').find((l) => l.includes('experience:')) ?? '';
    expect(line).toContain('REAL_LIVE');
    expect(line).toContain('liveFromSubstrate: true');
  });
});

describe('experience build pins', () => {
  const suite = read('components/experience/UXResearchSuite.tsx');
  const portfolio = read('components/experience/CareerPortfolio.tsx');
  const atlas = read('components/experience/DesignSystemAtlas.tsx');

  it('the suite wires a delete control to every lifecycle verb (S3)', () => {
    for (const verb of ['deleteTest', 'deleteRun', 'deleteHeatmapStudy', 'deleteCardSort',
      'deleteSurvey', 'deleteParticipant', 'deleteClip', 'deleteReel', 'deletePrototype']) {
      expect(suite).toContain(verb);
    }
    expect(suite).toContain('DeleteButton');
  });

  it('the clip form surfaces the server refusal instead of swallowing it (S4)', () => {
    expect(suite).toContain('clipError');
    expect(suite).toContain('res.data?.error');
  });

  it('the portfolio read is owner-selected and carries its exits (F1/F2, S3, S5)', () => {
    expect(portfolio).toContain('p.ownerId === user.id');
    expect(portfolio).not.toContain('items[0]');
    expect(portfolio).toContain('Delete this portfolio and its contents?');
    expect(portfolio).toContain('exportPortfolioJson');
    expect(portfolio).toContain('startEditExperience');
    expect(portfolio).toContain('startEditEducation');
  });

  it('the Atlas save renders the full DTU ID from onSaved (S5/F7)', () => {
    expect(atlas).toContain('onSaved');
    expect(atlas).toContain('savedDtuId');
    expect(atlas).toContain('Saved as DTU');
  });
});
