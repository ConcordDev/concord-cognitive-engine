// Timeline honesty: no empty ".dtu" export (DTUExportButton data={{}}), and
// the manifest only advertises macros server/domains/timeline.js registers —
// not the old replay / diff_timelines / causality_trace copy for features
// that do not exist.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getLensManifest } from '@/lib/lenses/manifest';

const m = getLensManifest('timeline');

describe('Timeline lens honesty', () => {
  it('page renders no empty DTU export', () => {
    const page = readFileSync(join(__dirname, '../app/lenses/timeline/page.tsx'), 'utf8');
    expect(page).not.toContain('DTUExportButton');
    expect(page).not.toMatch(/data=\{\{\}\}/);
  });

  it('every advertised action is registered by server/domains/timeline.js', () => {
    const src = readFileSync(join(__dirname, '../../server/domains/timeline.js'), 'utf8');
    expect((m?.actions || []).length).toBeGreaterThan(0);
    for (const a of m?.actions || []) expect(src, a).toContain(`"timeline", "${a}"`);
  });

  it('copy no longer promises replay / diff / causality features', () => {
    const copy = JSON.stringify([m?.emptyState, m?.firstRunGuide, m?.actions]);
    expect(copy).not.toMatch(/replay|diff_timelines|causality|cluster_events|gap_analysis|annotate/);
  });
});

describe('PostCard author label', () => {
  it("labels the viewer's own posts 'You' instead of a raw user id", () => {
    const card = readFileSync(join(__dirname, '../components/timeline/PostCard.tsx'), 'utf8');
    expect(card).toContain("{isOwner ? 'You' : post.authorId}");
  });
});
