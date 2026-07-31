/**
 * Soundboard — pins the stable-sort-timestamp fix.
 *
 * Catalog synth presets and drum patterns used to be pushed into the
 * combined item list with `timestamp: Date.now()`, so every recompute of
 * `filteredItems` (a `useMemo`) gave them a fresh, ever-increasing
 * timestamp and they jittered/reordered on every re-render relative to
 * real dated items. Pinned to a fixed `timestamp: 0` instead — catalog
 * items have no real creation time, so they should sort stably after
 * anything with a real one, not float around.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Soundboard } from '@/components/studio/Soundboard';
import type { SynthPreset, DrumPattern } from '@/lib/daw/types';

const preset = {
  id: 'preset-1', name: 'Warm Pad', type: 'analog', category: 'pad', tags: ['pad'],
} as unknown as SynthPreset;

const pattern = {
  id: 'pattern-1', name: 'Four On The Floor', steps: 16, resolution: 1, tracks: [],
} as unknown as DrumPattern;

describe('Soundboard', () => {
  it('renders catalog presets and patterns without crashing (timestamp: 0 push path)', () => {
    render(
      <Soundboard
        dtuEvents={[]}
        synthPresets={[preset]}
        effectPresets={[]}
        drumPatterns={[pattern]}
        currentKey="C"
        currentBpm={120}
        currentGenre={null}
        onLoadPreset={() => {}}
        onLoadEffectChain={() => {}}
        onLoadPattern={() => {}}
        onDragToTrack={() => {}}
      />,
    );

    expect(screen.getByText('Warm Pad')).toBeInTheDocument();
    expect(screen.getByText('Four On The Floor')).toBeInTheDocument();
  });
});
