/// <reference types="@testing-library/jest-dom/vitest" />
// concord-frontend/components/conkay/artifacts/ArtifactViewer.test.tsx
//
// Unit F9 (K5) — pins the registry-driven viewer's guarantees:
//   (a) THE STOP-POINT — an artifact whose `kind` has no registered adapter
//       renders a plain, explicitly-worded "inspectable soon" label — NOT a
//       crash, NOT a mock/placeholder 3D shape;
//   (b) a registered kind dispatches to its real adapter;
//   (c) source scan: no setInterval/setTimeout (no fake animation driver).
//
// The five real adapters each pull in Three.js / iframe (which jsdom's absent
// WebGL would fight), so they're mocked to markers — this unit owns the
// kind→adapter dispatch + the STOP-POINT, not the adapters' own 3D rendering
// (each wrapped component has its own coverage). Same mocking discipline as
// ForwardSimPanel.test.tsx.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ArtifactViewer } from './ArtifactViewer';
import type { ConkayArtifact } from '@/lib/conkay/artifact-kinds';

vi.mock('./ArAdapter', () => ({ ArAdapter: () => <div data-testid="mock-ar" /> }));
vi.mock('./FeaAdapter', () => ({ FeaAdapter: () => <div data-testid="mock-fea" /> }));
vi.mock('./BuildingAdapter', () => ({ BuildingAdapter: () => <div data-testid="mock-building" /> }));
vi.mock('./FoundryAdapter', () => ({ FoundryAdapter: () => <div data-testid="mock-foundry" /> }));
vi.mock('./ForgeAdapter', () => ({ ForgeAdapter: () => <div data-testid="mock-forge" /> }));

const base = { components: [], sourceDomain: 'd', sourceMacro: 'm' };

describe('ArtifactViewer', () => {
  it('(a) STOP-POINT: an unregistered kind renders the worded label, not a crash or fake shape', () => {
    // Cast a deliberately-unknown kind through the union to exercise the runtime guard.
    const unknown = { ...base, kind: 'hologram-tesseract' } as unknown as ConkayArtifact;
    render(<ArtifactViewer artifact={unknown} />);

    const label = screen.getByTestId('ck-artifact-unregistered-label');
    expect(label).toBeInTheDocument();
    expect(label).toHaveTextContent(/inspectable soon/i);
    // Crucially: NO adapter rendered.
    expect(screen.queryByTestId('mock-ar')).toBeNull();
    expect(screen.queryByTestId('mock-fea')).toBeNull();
    expect(screen.queryByTestId('mock-building')).toBeNull();
    expect(screen.queryByTestId('mock-foundry')).toBeNull();
    expect(screen.queryByTestId('mock-forge')).toBeNull();
  });

  it('(b) dispatches each registered kind to its real adapter', () => {
    const cases: Array<[string, string]> = [
      ['ar-render', 'mock-ar'],
      ['fea-frame', 'mock-fea'],
      ['building', 'mock-building'],
      ['foundry-worldspec', 'mock-foundry'],
      ['forge-app', 'mock-forge'],
    ];
    for (const [kind, testid] of cases) {
      const { unmount } = render(
        <ArtifactViewer artifact={{ ...base, kind } as unknown as ConkayArtifact} />,
      );
      expect(screen.getByTestId(testid)).toBeInTheDocument();
      expect(screen.queryByTestId('ck-artifact-unregistered')).toBeNull();
      unmount();
    }
  });

  it('(c) contains no setInterval/setTimeout — no fabricated animation driver', () => {
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'ArtifactViewer.tsx'),
      'utf8',
    );
    expect(src).not.toMatch(/setInterval/);
    expect(src).not.toMatch(/setTimeout/);
  });
});
