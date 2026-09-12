import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import NativeWorldPlayer from '@/components/world/NativeWorldPlayer';

vi.mock('@/lib/auth-bridge', () => ({
  getInjectedJwt: () => null,
}));

describe('NativeWorldPlayer', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('iframes Unity when /unity-client/index.html returns HTML', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => 'text/html; charset=utf-8' },
      }),
    );
    render(
      <NativeWorldPlayer worldId="concordia-hub">
        <div data-testid="three-fallback">three</div>
      </NativeWorldPlayer>,
    );
    expect(await screen.findByTestId('native-world-player')).toBeInTheDocument();
    expect(screen.queryByTestId('three-fallback')).not.toBeInTheDocument();
    const iframe = screen.getByTitle('Concordia Unity');
    expect(iframe.getAttribute('src')).toContain('/unity-client/index.html');
    expect(iframe.getAttribute('src')).toContain('CONCORD_WORLD_ID=concordia-hub');
    expect(iframe.getAttribute('allow')).toContain('pointer-lock');
  });

  it('does not mount Three.js children when the export is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        headers: { get: () => 'application/json' },
        json: async () => ({ ok: false, reason: 'unity_web_export_not_built' }),
      }),
    );
    render(
      <NativeWorldPlayer worldId="concordia-hub">
        <div data-testid="three-fallback">three</div>
      </NativeWorldPlayer>,
    );
    expect(await screen.findByTestId('native-world-missing')).toBeInTheDocument();
    expect(screen.getByTestId('native-world-missing').getAttribute('data-reason')).toBe(
      'unity_web_export_not_built',
    );
    expect(screen.queryByTestId('three-fallback')).not.toBeInTheDocument();
    expect(screen.queryByTestId('native-world-player')).not.toBeInTheDocument();
  });
});
