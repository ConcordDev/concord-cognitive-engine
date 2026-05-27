import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Mock lensRun before importing the component
const lensRunMock = vi.fn().mockResolvedValue({
  data: { ok: true, result: { materialKind: 'wood', seed: 1, channels: { color: null, normal: null, roughness: null, ao: null } } },
});

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { PublishAsTextureDialog } from '@/components/art/PublishAsTextureDialog';

describe('PublishAsTextureDialog', () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    lensRunMock.mockClear();
    canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    // jsdom canvas may not support 2d context; force toDataURL to work
    canvas.toDataURL = () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  });

  it('renders with all 8 material kinds in the dropdown', () => {
    render(<PublishAsTextureDialog canvas={canvas} onClose={() => undefined} />);
    const expectedKinds = ['stone', 'wood', 'brick', 'cloth', 'metal', 'leather', 'thatch', 'dirt'];
    for (const k of expectedKinds) {
      expect(screen.getByRole('option', { name: k })).toBeTruthy();
    }
  });

  it('shows all 4 PBR channels as toggle buttons', () => {
    const { container } = render(<PublishAsTextureDialog canvas={canvas} onClose={() => undefined} />);
    // The 4 channel buttons live inside the grid-cols-4 layout; query
    // by visible label to avoid clashing with Publish / Cancel / close.
    const channelButtons = Array.from(container.querySelectorAll('button'))
      .filter((b) => ['color', 'normal', 'roughness', 'ao'].includes(b.firstChild?.textContent?.trim() ?? ''));
    expect(channelButtons.length).toBe(4);
  });

  it('fetches coverage on mount', async () => {
    render(<PublishAsTextureDialog canvas={canvas} onClose={() => undefined} />);
    await waitFor(() => {
      expect(lensRunMock).toHaveBeenCalled();
    });
    const calls = lensRunMock.mock.calls;
    expect(calls.some((c) => c[0] === 'art' && c[1] === 'published-texture-coverage')).toBe(true);
  });

  it('clicking Publish calls art.publish-as-texture with canvas.toDataURL', async () => {
    lensRunMock.mockImplementation((_domain: string, name: string) => {
      if (name === 'published-texture-coverage') {
        return Promise.resolve({ data: { ok: true, result: { materialKind: 'wood', seed: 1, channels: { color: null, normal: null, roughness: null, ao: null } } } });
      }
      if (name === 'publish-as-texture') {
        return Promise.resolve({
          data: {
            ok: true,
            result: {
              assetId: 'asset_xyz',
              created: true,
              sourceId: 'material:wood:1:color',
              materialKind: 'wood',
              seed: 1,
              channel: 'color',
              sizeBytes: 100,
              resolveUrl: '/api/evo-asset/resolve?source=authored&sourceId=material%3Awood%3A1%3Acolor',
            },
          },
        });
      }
      return Promise.resolve({ data: { ok: false, error: 'unknown macro' } });
    });

    render(<PublishAsTextureDialog canvas={canvas} onClose={() => undefined} />);
    const publishBtn = screen.getByRole('button', { name: /^Publish$/ });
    fireEvent.click(publishBtn);
    await waitFor(() => {
      const publishCall = lensRunMock.mock.calls.find((c) => c[1] === 'publish-as-texture');
      expect(publishCall).toBeTruthy();
      expect(publishCall?.[2]).toMatchObject({
        materialKind: 'wood',
        seed: 1,
        channel: 'color',
        imageDataUrl: expect.stringMatching(/^data:image\/png;base64,/),
      });
    });
  });

  it('renders error from server', async () => {
    lensRunMock.mockImplementation((_domain: string, name: string) => {
      if (name === 'published-texture-coverage') {
        return Promise.resolve({ data: { ok: true, result: { materialKind: 'wood', seed: 1, channels: { color: null, normal: null, roughness: null, ao: null } } } });
      }
      return Promise.resolve({ data: { ok: false, error: 'authentication required' } });
    });
    render(<PublishAsTextureDialog canvas={canvas} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /^Publish$/ }));
    await waitFor(() => {
      expect(screen.getByText(/authentication required/i)).toBeTruthy();
    });
  });

  it('closes when the backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<PublishAsTextureDialog canvas={canvas} onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalled();
  });

  it('renders successfully with no canvas (preview becomes a placeholder)', () => {
    render(<PublishAsTextureDialog canvas={null} onClose={() => undefined} />);
    expect(screen.getByText(/no canvas/i)).toBeTruthy();
    // Publish button is disabled
    const btn = screen.getByRole('button', { name: /^Publish$/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
