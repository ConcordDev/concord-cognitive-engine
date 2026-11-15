/**
 * FIX-mentorship-004 — the Mentorship lens's Lighthouse a11y bundle:
 * unlabeled selects, contrast, touch targets, heading order.
 * (The bundle's Tab leg is the app-shell skip-link rider.)
 *
 * Heading order, verified against the page's composition — one tab
 * panel per view under the frame h1, most panels with a detail
 * branch and a list branch: each branch's title is h2, its form/section
 * subsections h3; the Requests panel's Incoming/Outgoing are h2
 * siblings; GroupSessions nests inside the Sessions view as an h2
 * section; the Feed title was already h2.
 * All 6 selects are pinned (all were unlabeled).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
  api: { get: vi.fn(async () => ({ data: null })), post: vi.fn(async () => ({ data: null })) },
}));

import { MentorshipRequestsPanel } from '@/components/mentorship/MentorshipRequestsPanel';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

/** Opening tag of the element at `start`, skipping '>' inside { }. */
function openingTag(src: string, start: number): string {
  let depth = 0;
  for (let k = start; k < src.length; k++) {
    const c = src[k];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return src.slice(start, k + 1);
  }
  return src.slice(start);
}

describe('FIX-mentorship-004 — mentorship a11y bundle', () => {
  it('MentorshipRequestsPanel: Incoming and Outgoing are h2 siblings', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MentorshipRequestsPanel />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('heading', { level: 2, name: /Incoming requests/ })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: /Outgoing requests/ })).toBeTruthy();
    // The Feed renders only when its community flag is on; pin it in source.
    const feed = read('components/mentorship/MentorshipFeed.tsx');
    expect(feed).toContain('aria-label="Subreddit"');
    expect(feed).toContain('aria-label="Time window"');
    expect(feed).toContain('<h2');
  });

  it('no panel title remains at h3 and no subsection remains at h4', () => {
    const panels = ['MentorDirectoryPanel.tsx', 'GroupSessionsPanel.tsx', 'MentorshipActionPanel.tsx', 'MentorshipGoalsPanel.tsx', 'MentorshipMessagesPanel.tsx', 'MentorshipProgramPanel.tsx', 'MentorshipRequestsPanel.tsx', 'MentorshipSessionsPanel.tsx'];
    for (const f of panels) {
      const src = read(`components/mentorship/${f}`);
      expect(src.includes('<h4'), `${f}: h4 remains`).toBe(false);
      expect(src.includes('<h2'), `${f}: no h2 title`).toBe(true);
    }
    // subsection h3s stand under the promoted titles (spot-pins)
    expect(read('components/mentorship/MentorDirectoryPanel.tsx')).toContain('<h3');
    expect(read('components/mentorship/MentorshipSessionsPanel.tsx')).toContain('<h3');
  });

  it('source sweep: every mentorship select is named and floored', () => {
    const files = [
      ...fs.readdirSync(path.join(process.cwd(), 'components', 'mentorship')).filter((x) => x.endsWith('.tsx')).map((x) => `components/mentorship/${x}`),
      'app/lenses/mentorship/page.tsx',
    ];
    let count = 0;
    for (const f of files) {
      const src = read(f);
      let i = 0;
      for (;;) {
        const j = src.indexOf('<select', i);
        if (j < 0) break;
        count++;
        const tag = openingTag(src, j);
        const pre = src.slice(0, j);
        const wrapped = pre.lastIndexOf('<label') > pre.lastIndexOf('</label>');
        expect(tag.includes('aria-label') || wrapped, `${f}: select without a name`).toBe(true);
        expect(tag, `${f}: select without the target floor`).toContain('min-h-11');
        i = j + tag.length;
      }
    }
    expect(count).toBe(6);
  });
});
