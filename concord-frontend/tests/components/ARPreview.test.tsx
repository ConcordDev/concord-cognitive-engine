// ARPreview — Track 4 real-WebXR refactor.
//
// The immersive-ar path needs AR hardware to exercise, but the honest
// feature-detection + fallback IS verifiable headless: jsdom exposes no
// navigator.xr, so the component must resolve to the "AR Not Available Here"
// panel (no fake camera, no simulated tracking) and never throw.

import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ARPreview from '@/components/world-lens/ARPreview';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, '..', '..', 'components', 'world-lens', 'ARPreview.tsx');

const DTU = { name: 'Test Tower', dimensions: { width: 4, height: 12, depth: 4 } };

describe('ARPreview — honest WebXR fallback', () => {
  it('renders the unsupported fallback when navigator.xr is absent (no crash)', async () => {
    render(<ARPreview dtuId="dtu-1" dtuData={DTU} />);
    await waitFor(() => expect(screen.getByText(/AR Not Available Here/i)).toBeTruthy());
  });

  it('renders the unsupported fallback immediately when supported={false}', async () => {
    render(<ARPreview dtuId="dtu-2" dtuData={DTU} supported={false} />);
    await waitFor(() => expect(screen.getByText(/AR Not Available Here/i)).toBeTruthy());
  });

  it('detects immersive-ar support and shows the real Enter AR launcher', async () => {
    // Stub a supporting navigator.xr (detection only — we don't start a session).
    const orig = (navigator as unknown as { xr?: unknown }).xr;
    Object.defineProperty(navigator, 'xr', {
      configurable: true,
      value: { isSessionSupported: async (m: string) => m === 'immersive-ar' },
    });
    try {
      render(<ARPreview dtuId="dtu-3" dtuData={DTU} />);
      await waitFor(() => expect(screen.getByText(/Enter AR/i)).toBeTruthy());
    } finally {
      Object.defineProperty(navigator, 'xr', { configurable: true, value: orig });
    }
  });
});

describe('ARPreview — no fabricated AR data (source contract)', () => {
  const source = readFileSync(FILE, 'utf8');
  it('removed the fake AR_CAPTURE base64 stub', () => {
    // The fabrication was `data:image/png;base64,AR_CAPTURE_${...}` — assert the
    // actual constructed string is gone (the header comment may still name it).
    expect(source).not.toMatch(/base64,AR_CAPTURE/);
  });
  it('requests a real immersive-ar session and uses hit-test placement', () => {
    expect(source).toMatch(/requestSession\(\s*['"]immersive-ar['"]/);
    expect(source).toMatch(/requestHitTestSource/);
  });
  it('captures from the real canvas, not a synthesized string', () => {
    expect(source).toMatch(/toDataURL/);
  });
  it('releases GPU + hit-test resources on session end (no leak)', () => {
    expect(source).toMatch(/hitTestSourceRef\.current\?\.cancel/);
    expect(source).toMatch(/\.dispose\?\.\(\)/);          // renderer.dispose
    expect(source).toMatch(/disposablesRef/);             // geometry/material disposal
    expect(source).toMatch(/setFoveation/);               // perf best practice
  });
});
