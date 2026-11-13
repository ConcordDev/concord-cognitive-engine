/**
 * FIX-music-002 — Studio (DAW) at 390px.
 *
 * The editor was a desktop-only layout: the TransportBar was one fixed
 * h-12 row of ~1,300px of controls, putting the tempo field at x≈752 —
 * off the viewport entirely; and the workspace row totalled ~1,056px
 * (browser 224 + centre 576 + inspector 256) inside a sideways
 * scroller, so panes clipped and the Mixer tab sat off-screen.
 *
 * Fixes: the transport wraps below lg (single row returns at lg); the
 * workspace stacks vertically below sm (browser becomes a full-width
 * strip, the centre takes the full width, the inspector stacks below),
 * restoring the row at sm+. The transport is pinned rendered; the pane
 * contracts are source-pinned (the full editor mounts only with the
 * audio engine + project stack, the gallery-build precedent) — the
 * desk's live re-walk verifies the rendered fit.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';

vi.mock('@/lib/daw/playback-engine', () => ({
  getStudioEngine: () => ({ ctx: { sampleRate: 48000 }, resume: async () => {}, getBeat: () => 0 }),
}));

import { TransportBar } from '@/components/studio/daw/TransportBar';
import { createProject } from '@/lib/daw/project';

function transportProps() {
  return {
    project: createProject('Mobile Song', 120),
    transport: 'stopped' as const,
    recording: false,
    metronome: false,
    countInBars: 1,
    save: { status: 'saved' as const, at: null, error: null },
    canUndo: false,
    canRedo: false,
    onBack: vi.fn(), onPlay: vi.fn(), onStop: vi.fn(), onRecord: vi.fn(),
    onToggleLoop: vi.fn(), onToggleMetronome: vi.fn(), onCountIn: vi.fn(),
    onBpm: vi.fn(), onTimeSignature: vi.fn(), onSwing: vi.fn(),
    onKeyScale: vi.fn(), onDetectKey: vi.fn(async () => { throw new Error('no clip'); }),
    onRename: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(), onSaveNow: vi.fn(),
    onVersions: vi.fn(), onAutoMix: vi.fn(), onExport: vi.fn(),
    onPublish: vi.fn(), onAskProducer: vi.fn(),
  };
}

describe('FIX-music-002 — transport at 390px', () => {
  it('wraps below lg and the tempo field is present and editable', () => {
    const props = transportProps();
    const { container } = render(<TransportBar {...props} />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).toContain('flex-wrap');
    expect(bar.className).toContain('lg:flex-nowrap');
    const tempo = screen.getByLabelText('Tempo (BPM)') as HTMLInputElement;
    expect(tempo.value).toBe('120');
    fireEvent.change(tempo, { target: { value: '128' } });
    expect(props.onBpm).toHaveBeenCalledWith(128);
    expect(screen.getByTestId('studio-play')).toBeTruthy();
    expect(screen.getByTestId('studio-export')).toBeTruthy();
  });
});

describe('FIX-music-002 — workspace pane contracts', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
  it('stacks the workspace below sm and restores the row at sm+', () => {
    const editor = read('components/studio/daw/Editor.tsx');
    expect(editor).toContain('flex-col overflow-y-auto sm:flex-row');
    expect(editor).toContain('min-h-[480px] w-full shrink-0');
    expect(editor).not.toContain('w-[36rem]');
  });
  it('browser and inspector go full-width below sm', () => {
    const browser = read('components/studio/daw/BrowserPanel.tsx');
    expect(browser).toContain('h-52 w-full');
    expect(browser).toContain('sm:w-56');
    const inspector = read('components/studio/daw/Inspector.tsx');
    expect(inspector).toContain('w-full flex-shrink-0');
    expect(inspector).toContain('sm:w-64');
  });
});
