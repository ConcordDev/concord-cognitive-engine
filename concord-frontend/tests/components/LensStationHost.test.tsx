// Lens-as-Station keep-alive host — walking away hides the lens but keeps its
// iframe (and state) mounted; walking back reveals the SAME iframe element. No
// mocks: real components, real DOM-node-identity assertions.

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LensStationHost } from '@/components/world/LensStationHost';

function station(id: string, building_type: string) {
  return { building: { id, building_type, x: 0, z: 0 }, worldId: 'w1' };
}

describe('LensStationHost — keep-alive', () => {
  it('renders nothing until a lens station is opened', () => {
    const { container } = render(<LensStationHost active={null} onClose={() => {}} />);
    expect(container.querySelector('iframe')).toBeNull();
  });

  it('keeps the SAME iframe element mounted when you walk away and back (state survives)', () => {
    const { container, rerender } = render(
      <LensStationHost active={station('b1', 'code_terminal')} onClose={() => {}} />,
    );
    const iframe1 = container.querySelector('iframe');
    expect(iframe1).toBeTruthy();
    expect(iframe1!.getAttribute('src')).toContain('/lenses/code');

    // Walk away: active → null. The iframe must still be in the DOM (kept warm),
    // just hidden.
    rerender(<LensStationHost active={null} onClose={() => {}} />);
    const iframeAway = container.querySelector('iframe');
    expect(iframeAway).toBe(iframe1); // SAME node — not remounted
    const kept = container.querySelector('[data-station-kept="b1"]') as HTMLElement;
    expect(kept.getAttribute('aria-hidden')).toBe('true');
    expect(kept.style.display).toBe('none');

    // Walk back: same station active again → same iframe, now visible.
    rerender(<LensStationHost active={station('b1', 'code_terminal')} onClose={() => {}} />);
    const iframeBack = container.querySelector('iframe');
    expect(iframeBack).toBe(iframe1); // still the very same element → state preserved
    const keptBack = container.querySelector('[data-station-kept="b1"]') as HTMLElement;
    expect(keptBack.getAttribute('aria-hidden')).toBe('false');
  });

  it('keeps multiple stations warm; only the active one is visible', () => {
    const { container, rerender } = render(
      <LensStationHost active={station('b1', 'code_terminal')} onClose={() => {}} />,
    );
    rerender(<LensStationHost active={station('b2', 'clinic')} onClose={() => {}} />);

    const iframes = container.querySelectorAll('iframe');
    expect(iframes.length).toBe(2); // both kept mounted

    const code = container.querySelector('[data-station-kept="b1"]') as HTMLElement;
    const clinic = container.querySelector('[data-station-kept="b2"]') as HTMLElement;
    expect(code.style.display).toBe('none');           // walked away from code
    expect(clinic.getAttribute('aria-hidden')).toBe('false'); // clinic is active
  });

  it('caps how many iframes stay warm (LRU eviction)', () => {
    const { container, rerender } = render(
      <LensStationHost active={station('b1', 'code_terminal')} onClose={() => {}} />,
    );
    for (const [id, type] of [['b2', 'clinic'], ['b3', 'courthouse'], ['b4', 'music_booth'], ['b5', 'trading_floor']] as const) {
      rerender(<LensStationHost active={station(id, type)} onClose={() => {}} />);
    }
    // MAX_KEPT = 4 → the oldest (b1) is evicted.
    expect(container.querySelectorAll('iframe').length).toBe(4);
    expect(container.querySelector('[data-station-kept="b1"]')).toBeNull();
    expect(container.querySelector('[data-station-kept="b5"]')).toBeTruthy();
  });

  it('ignores a non-lens-station active (bespoke overlays handle those)', () => {
    const { container } = render(<LensStationHost active={station('x', 'bedroom')} onClose={() => {}} />);
    expect(container.querySelector('iframe')).toBeNull();
  });
});
