/**
 * BuildingCollapseVFX — smoke render + real event/VFX-path coverage.
 *
 * A dead `itemsRef = useRef<VFXItem[]>([])` + `itemsRef.current = items`
 * (written every render, never read anywhere in the file) was removed
 * along with the now-unused `useRef` import. Nothing behavioral changed
 * by that diff, but the file had NO test at all before this — the
 * component only renders once a real `concordia:building-state` event
 * has arrived and `getCamera()` returns a projectable camera, so a plain
 * mount-only smoke test exercises almost none of it. This dispatches the
 * real event (both the 'damaged' crack-puff and 'collapsed' debris paths)
 * against a camera placed so the building projects on-screen.
 */

import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import BuildingCollapseVFX from '@/components/world/BuildingCollapseVFX';

const CAMERA = { x: 0, y: 0, z: -10, yaw: 0, pitch: 0, fov: 1.0, width: 800, height: 600 };

function dispatchBuildingState(detail: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(new CustomEvent('concordia:building-state', { detail }));
  });
}

describe('BuildingCollapseVFX', () => {
  it('renders nothing with no active VFX items', () => {
    const { container } = render(
      <BuildingCollapseVFX worldId="tunya" getCamera={() => CAMERA} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when getCamera returns null, even with an event pending', () => {
    const { container } = render(
      <BuildingCollapseVFX worldId="tunya" getCamera={() => null} />,
    );
    dispatchBuildingState({ worldId: 'tunya', buildingId: 'b1', toState: 'damaged', position: { x: 0, y: 0, z: 0 } });
    expect(container.firstChild).toBeNull();
  });

  it('ignores an event for a different world', () => {
    const { container } = render(
      <BuildingCollapseVFX worldId="tunya" getCamera={() => CAMERA} />,
    );
    dispatchBuildingState({ worldId: 'other-world', buildingId: 'b1', toState: 'damaged', position: { x: 0, y: 0, z: 0 } });
    expect(container.firstChild).toBeNull();
  });

  it('renders a crack-puff overlay on a "damaged" transition', () => {
    const { container } = render(
      <BuildingCollapseVFX worldId="tunya" getCamera={() => CAMERA} />,
    );
    dispatchBuildingState({ worldId: 'tunya', buildingId: 'b1', toState: 'damaged', position: { x: 0, y: 0, z: 0 } });
    expect(container.querySelector('[aria-hidden]')).toBeInTheDocument();
    expect(container.querySelectorAll('div').length).toBeGreaterThan(1);
  });

  it('renders the 6-particle debris fall on a "collapsed" transition', () => {
    const { container } = render(
      <BuildingCollapseVFX worldId="tunya" getCamera={() => CAMERA} />,
    );
    dispatchBuildingState({ worldId: 'tunya', buildingId: 'b2', toState: 'collapsed', position: { x: 0, y: 0, z: 0 } });
    // 1 wrapper + 6 debris particles, minimum.
    expect(container.querySelectorAll('div').length).toBeGreaterThanOrEqual(7);
  });

  it('defaults missing position to the origin without throwing', () => {
    const { container } = render(
      <BuildingCollapseVFX worldId="tunya" getCamera={() => CAMERA} />,
    );
    expect(() => dispatchBuildingState({ worldId: 'tunya', buildingId: 'b3', toState: 'damaged' })).not.toThrow();
    expect(container.querySelector('[aria-hidden]')).toBeInTheDocument();
  });
});
