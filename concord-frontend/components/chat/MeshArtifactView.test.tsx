import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@react-three/fiber', () => ({
  Canvas: () => <div data-testid="webgl" />,
}));
vi.mock('@react-three/drei', () => ({
  Bounds: ({ children }: { children?: unknown }) => children,
  Edges: () => null,
  OrbitControls: () => null,
  Grid: () => null,
}));

import MeshArtifactView from './MeshArtifactView';

const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0];
const indices = [0, 1, 2];

describe('MeshArtifactView scale chrome', () => {
  it('shows the millimetre bbox, grid and scale bar', () => {
    render(
      <MeshArtifactView
        positions={positions}
        indices={indices}
        units="mm"
        geometryUnits="m"
        bbox_mm={{ length: 405, height: 880, width: 330 }}
        partList={[{ name: 'torso', size_mm: [180, 320, 220] }]}
      />,
    );
    expect(screen.getByTestId('mesh-dimensions').textContent).toBe('405 × 880 × 330 mm (long × tall × wide)');
    expect(screen.getByTestId('mesh-unit-grid').textContent).toBe('grid 100 mm');
    expect(screen.getByTestId('mesh-scale-bar').textContent).toBe('200 mm');
    expect(screen.getByTestId('mesh-part-sizes').textContent).toMatch(/torso/);
    expect(screen.getByTestId('webgl')).toBeTruthy();
  });

  it('labels a unitless mesh without inventing millimetres', () => {
    render(
      <MeshArtifactView
        positions={positions}
        indices={indices}
        units="unitless"
        geometryUnits="unitless"
        scaleNote="unitless (not to scale)"
      />,
    );
    expect(screen.getByTestId('mesh-dimensions').textContent).toBe('unitless (not to scale)');
    expect(screen.getByTestId('mesh-scale-bar').textContent).toBe('mesh units');
    expect(screen.getByTestId('mesh-artifact').textContent).not.toMatch(/\d+\s*mm/);
  });
});
