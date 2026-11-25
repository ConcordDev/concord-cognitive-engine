/**
 * FIX-animation-006 — the Animation lens's Lighthouse a11y bundle:
 * unlabeled selects, unnamed buttons, heading order, touch targets.
 *
 * DOM pins render the real surfaces; a source sweep covers the
 * data-gated controls (layer visibility, share-link copy) that only
 * mount with a loaded animation.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import * as fs from 'node:fs';
import * as path from 'node:path';

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({
    data: {
      ok: true,
      result: {
        animations: [],
        presets: [{ id: 'p1', label: 'HD', width: 1920, height: 1080 }],
        templates: [],
        exports: [],
        tracks: [],
        brushes: [],
        bones: [],
      },
    },
  })),
  api: {
    get: vi.fn(async () => ({ data: { media: [] } })),
    post: vi.fn(async () => ({ data: null })),
  },
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, isLoading: false, isAuthenticated: true }),
}));

import { AnimationStudioSection } from '@/components/animation/AnimationStudioSection';
import { CanvasPanel, RigPanel, TweenPanel, BrushPanel } from '@/components/animation/AnimToolsPanel';
import { ExportDesk } from '@/components/animation/table/ExportDesk';
import { AnimationReferenceImages } from '@/components/animation/AnimationReferenceImages';

const ANIM = {
  id: 'a1',
  title: 'Test shot',
  frames: [{ id: 'f1', layers: [] }],
  audio: [],
} as never;

describe('FIX-animation-006 — animation a11y bundle', () => {
  it('studio gallery: the canvas preset select is named; the section title is h2', async () => {
    render(<AnimationStudioSection />);
    expect(await screen.findByLabelText('Canvas preset')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Your shots' })).toBeTruthy();
  });

  it('tool drawers: export/easing/rig/brush selects are named and section titles are h3', async () => {
    const { unmount } = render(<ExportDesk anim={ANIM} />);
    expect(screen.getByLabelText('Export format')).toBeTruthy();
    expect(screen.getByLabelText('Export size')).toBeTruthy();
    unmount();

    const canvas = render(<CanvasPanel anim={ANIM} onChange={() => {}} />);
    expect(screen.getByLabelText(/Symmetry/)).toBeTruthy();
    const h3s = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(h3s).toContain('Canvas size presets');
    expect(h3s).toContain('Frame rate');
    expect(screen.queryByRole('heading', { level: 4 })).toBeNull();
    canvas.unmount();

    const rig = render(<RigPanel anim={ANIM} onChange={() => {}} />);
    expect(await screen.findByLabelText('Parent bone')).toBeTruthy();
    expect(screen.getByLabelText('Pose frame')).toBeTruthy();
    rig.unmount();

    const tween = render(<TweenPanel anim={ANIM} onChange={() => {}} />);
    expect(await screen.findByLabelText('Easing')).toBeTruthy();
    tween.unmount();

    render(<BrushPanel />);
    expect(await screen.findByLabelText(/Tool/)).toBeTruthy();
  });

  it('reference images: the section title is h2 under the page h1', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <AnimationReferenceImages />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('heading', { level: 2, name: 'Reference images' })).toBeTruthy();
  });

  it('source sweep: named icon controls + no h4 left in the animation tree', () => {
    const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
    const studio = read('components/animation/AnimStudio.tsx');
    expect(studio).toContain('Hide layer ${l.name}');
    expect(studio).toContain('aria-label="Add layer"');
    const tools = read('components/animation/AnimToolsPanel.tsx');
    expect(tools).toContain('aria-label="Copy share link"');
    for (const f of ['AnimStudio.tsx', 'AnimToolsPanel.tsx', 'AnimationMotionToolkit.tsx', 'AnimationReference.tsx', 'AnimationReferenceImages.tsx', 'AnimationStudioSection.tsx']) {
      expect(read(`components/animation/${f}`).includes('<h4'), `${f}: h4 remains`).toBe(false);
    }
  });
});
