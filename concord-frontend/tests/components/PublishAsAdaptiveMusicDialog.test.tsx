import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { PublishAsAdaptiveMusicDialog } from '@/components/studio/PublishAsAdaptiveMusicDialog';

function makeBuffer(durationSec = 2, sampleRate = 48000, channels = 2): AudioBuffer {
  // jsdom doesn't ship AudioBuffer; stub via OfflineAudioContext if present,
  // else build a minimal shape that the dialog inspects.
  const length = Math.max(1, Math.floor(sampleRate * durationSec));
  const data = Array.from({ length: channels }, () => new Float32Array(length));
  return {
    length,
    sampleRate,
    numberOfChannels: channels,
    duration: durationSec,
    getChannelData: (i: number) => data[i],
  } as unknown as AudioBuffer;
}

describe('PublishAsAdaptiveMusicDialog', () => {
  beforeEach(() => { lensRunMock.mockReset(); });

  it('renders region + intensity rows + mood field + title', () => {
    const { container } = render(
      <PublishAsAdaptiveMusicDialog
        projectId="p1"
        projectTitle="Forest demo"
        manifest={{}}
        referenceBuffer={makeBuffer()}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByDisplayValue('Forest demo')).toBeTruthy();
    const regionButtons = Array.from(container.querySelectorAll('button'))
      .filter((b) => ['tavern', 'archive', 'forge', 'market', 'tower', 'plaza', 'wilderness', 'arena', 'underground']
        .includes(b.textContent?.trim() ?? ''));
    expect(regionButtons.length).toBe(9);
    const intensityButtons = Array.from(container.querySelectorAll('button'))
      .filter((b) => ['ambient', 'active', 'battle']
        .includes(b.textContent?.trim() ?? ''));
    expect(intensityButtons.length).toBe(3);
    expect(screen.getByPlaceholderText(/calm, cozy/i)).toBeTruthy();
  });

  it('Publish submits a base64 WAV data URL + region + intensity', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true, result: {
      dtuId: 'dtu_1', artifactId: 'a1', region: 'tavern', intensity: 'ambient',
      durationMs: 2000, downloadUrl: '/api/artifacts/a1/download',
      mimeType: 'audio/wav', sizeBytes: 100,
    } } });
    render(
      <PublishAsAdaptiveMusicDialog
        projectId="p1"
        manifest={{ trackCount: 3 }}
        referenceBuffer={makeBuffer()}
        onClose={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Publish$/ }));
    await waitFor(() => {
      const call = lensRunMock.mock.calls.find((c) => c[1] === 'publish-as-adaptive-music');
      expect(call).toBeTruthy();
      expect(call?.[2]).toMatchObject({
        projectId: 'p1',
        soundscapeRegion: 'tavern',
        intensity: 'ambient',
        referenceStemDataUrl: expect.stringMatching(/^data:audio\/wav;base64,/),
        manifest: { trackCount: 3 },
        durationMs: expect.any(Number),
      });
    });
  });

  it('parses comma-separated moodTags into an array, max 6', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: true, result: { dtuId: 'd', artifactId: 'a', region: 'tavern', intensity: 'ambient', durationMs: 0, downloadUrl: '', mimeType: '', sizeBytes: 0 } } });
    render(
      <PublishAsAdaptiveMusicDialog
        projectId="p1"
        manifest={{}}
        referenceBuffer={makeBuffer()}
        onClose={() => undefined}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/calm, cozy/i), {
      target: { value: 'calm, cozy, foreboding, tense, bright, swirling, extra-one, extra-two' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Publish$/ }));
    await waitFor(() => {
      const call = lensRunMock.mock.calls.find((c) => c[1] === 'publish-as-adaptive-music');
      expect((call?.[2] as { moodTags: string[] }).moodTags.length).toBe(6);
    });
  });

  it('disables Publish when referenceBuffer is null', () => {
    render(
      <PublishAsAdaptiveMusicDialog
        projectId="p1"
        manifest={{}}
        referenceBuffer={null}
        onClose={() => undefined}
      />,
    );
    const btn = screen.getByRole('button', { name: /^Publish$/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('shows server error inline', async () => {
    lensRunMock.mockResolvedValue({ data: { ok: false, error: 'manifest required' } });
    render(
      <PublishAsAdaptiveMusicDialog
        projectId="p1"
        manifest={{}}
        referenceBuffer={makeBuffer()}
        onClose={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Publish$/ }));
    await waitFor(() => {
      expect(screen.getByText(/manifest required/i)).toBeTruthy();
    });
  });

  it('backdrop click closes', () => {
    const onClose = vi.fn();
    render(
      <PublishAsAdaptiveMusicDialog
        projectId="p1"
        manifest={{}}
        referenceBuffer={makeBuffer()}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalled();
  });

  it('selecting a different region updates the active state', () => {
    const { container } = render(
      <PublishAsAdaptiveMusicDialog
        projectId="p1" manifest={{}}
        referenceBuffer={makeBuffer()} onClose={() => undefined}
      />,
    );
    const forge = Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === 'forge') as HTMLButtonElement;
    fireEvent.click(forge);
    expect(forge.className).toMatch(/violet/);
  });
});
