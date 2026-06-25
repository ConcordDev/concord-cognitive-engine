// LensStationOverlay — the persistent-redirect surface. Mounts the REAL lens
// route as an iframe inside the diegetic shell. No mock UI: the iframe src is the
// actual /lenses/<id> route, carrying world + station context.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LensStationOverlay } from '@/components/world/LensStationOverlay';

function building(building_type: string, extra: Record<string, unknown> = {}) {
  return { id: 'bld-1', building_type, x: 0, z: 0, ...extra };
}

describe('LensStationOverlay', () => {
  it('mounts the real lens route as an iframe with world + station context', () => {
    const { container } = render(
      <LensStationOverlay building={building('code_terminal', { name: 'Hub Terminal' })} worldId="w1" onClose={() => {}} />,
    );
    const iframe = container.querySelector('iframe');
    expect(iframe).toBeTruthy();
    const src = iframe!.getAttribute('src') || '';
    expect(src).toContain('/lenses/code?');
    expect(src).toContain('world=w1');
    expect(src).toContain('station=bld-1');
    expect(iframe!.getAttribute('data-station-lens')).toBe('code');
  });

  it('frames the lens diegetically with the place label + verb', () => {
    render(<LensStationOverlay building={building('clinic')} worldId="w1" onClose={() => {}} />);
    expect(screen.getByText('The Mendery')).toBeTruthy();
    expect(screen.getByText(/Treat a patient/)).toBeTruthy();
  });

  it('renders nothing for a building_type that is not a lens station', () => {
    const { container } = render(
      <LensStationOverlay building={building('bedroom')} worldId="w1" onClose={() => {}} />,
    );
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.textContent).toBe('');
  });
});
