/// <reference types="@testing-library/jest-dom/vitest" />
// concord-frontend/components/conkay/panels/ArtifactViewerPanel.test.tsx
//
// Unit F9 (K5) — pins the Artifact Viewer panel's honest surface:
//   (a) no artifact yet → an explicit worded empty state (NOT a placeholder 3D);
//   (b) a real artifact in the store → header (kind + real part count +
//       provenance) + the ArtifactViewer, and no empty state;
//   (c) the store is the single writer: setLastArtifact drives the panel;
//   (d) belt-and-suspenders: ConKayOverlay#executeMacro is the ONE capture site
//       — it imports detectArtifact and mirrors the result via setLastArtifact,
//       and the panel/registry are wired.
//
// Seeds the REAL conkayHudStore (same approach as ForwardSimPanel.test.tsx) and
// mocks ArtifactViewer to a marker (its adapters pull in Three.js/iframe that
// jsdom's absent WebGL would fight) — this unit owns the store-read + empty
// state; ArtifactViewer/its adapters have their own coverage.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ArtifactViewerPanel } from './ArtifactViewerPanel';
import { useConkayHudStore } from '../conkayHudStore';
import type { ConkayArtifact } from '@/lib/conkay/artifact-kinds';

vi.mock('../artifacts/ArtifactViewer', () => ({
  ArtifactViewer: (props: { artifact: ConkayArtifact }) => (
    <div data-testid="mock-artifact-viewer" data-kind={props.artifact.kind} />
  ),
}));

const AR_ARTIFACT: ConkayArtifact = {
  kind: 'ar-render',
  title: 'Lattice beacon',
  drawList: [
    { id: 'core', kind: 'model', transform: { position: { x: 1, y: 0, z: 0 }, scale: 1 } },
    { id: 'ring', kind: 'primitive', transform: { position: { x: -1, y: 0, z: 0 }, scale: 1 } },
  ],
  components: [
    { id: 'core', label: 'core', kind: 'model' },
    { id: 'ring', label: 'ring', kind: 'primitive' },
  ],
  sourceDomain: 'ar',
  sourceMacro: 'render',
};

beforeEach(() => {
  useConkayHudStore.getState().reset();
});

describe('ArtifactViewerPanel', () => {
  it('(a) renders an honest worded empty state — not a placeholder 3D — when no artifact has landed', () => {
    render(<ArtifactViewerPanel />);
    expect(screen.getByTestId('ck-artifact-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('ck-artifact-present')).toBeNull();
    expect(screen.queryByTestId('mock-artifact-viewer')).toBeNull();
  });

  it('(b) renders the header (kind + real part count + provenance) + the viewer when a real artifact is present', () => {
    useConkayHudStore.getState().setLastArtifact(AR_ARTIFACT);
    render(<ArtifactViewerPanel />);

    expect(screen.getByTestId('ck-artifact-present')).toBeInTheDocument();
    expect(screen.getByTestId('ck-artifact-header').getAttribute('data-kind')).toBe('ar-render');
    expect(screen.getByTestId('ck-artifact-partcount')).toHaveTextContent('2 parts');
    expect(screen.getByTestId('ck-artifact-header')).toHaveTextContent('ar.render');
    expect(screen.getByTestId('mock-artifact-viewer').getAttribute('data-kind')).toBe('ar-render');
    expect(screen.queryByTestId('ck-artifact-empty')).toBeNull();
  });

  it('(c) is driven by the store single-writer: setLastArtifact(null) returns to the empty state', () => {
    const { rerender } = render(<ArtifactViewerPanel />);
    act(() => useConkayHudStore.getState().setLastArtifact(AR_ARTIFACT));
    rerender(<ArtifactViewerPanel />);
    expect(screen.getByTestId('ck-artifact-present')).toBeInTheDocument();

    act(() => useConkayHudStore.getState().setLastArtifact(null));
    rerender(<ArtifactViewerPanel />);
    expect(screen.getByTestId('ck-artifact-empty')).toBeInTheDocument();
  });

  it('(d) ConKayOverlay#executeMacro is the one capture site — imports detectArtifact + mirrors via setLastArtifact', () => {
    const overlay = readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../ConKayOverlay.tsx'),
      'utf8',
    );
    expect(overlay).toMatch(/import\s*\{\s*detectArtifact\s*\}\s*from\s*'@\/lib\/conkay\/artifact-kinds'/);
    expect(overlay).toMatch(/detectArtifact\(domain,\s*macro,\s*inputObj,\s*data\?\.result\)/);
    expect(overlay).toMatch(/setLastArtifact\(artifact\)/);
    // The existing FEA path must remain untouched (ForwardSimPanel depends on it).
    expect(overlay).toMatch(/setLastFea\(fea\)/);
  });
});
