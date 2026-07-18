import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// CreaturePortraitThumb fetches server/lib/creature-portrait.js's
// deterministic SVG schematic via the creatures.portrait macro and renders
// it (or an honest placeholder). This suite covers the three real states —
// loading, ready-with-real-svg, and honest-failure — without asserting
// anything about the SVG's internal shape (that's covered server-side by
// server/tests/creatures-portrait.test.js, which tests the pure renderer).

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

function envelope(result: unknown) {
  return Promise.resolve({ data: { ok: true, result, error: null } });
}

describe('CreaturePortraitThumb', () => {
  beforeEach(() => {
    vi.resetModules();
    lensRunMock.mockReset();
  });
  afterEach(() => { vi.clearAllMocks(); });

  it('shows a loading placeholder while the portrait macro is in flight', async () => {
    lensRunMock.mockImplementation(() => new Promise(() => {}));
    const { CreaturePortraitThumb } = await import('@/components/creatures/CreaturePortraitThumb');
    render(React.createElement(CreaturePortraitThumb, { speciesId: 'wolf' }));
    expect(screen.getByRole('status', { name: /loading procedural portrait for wolf/i })).toBeInTheDocument();
  });

  it('renders the real returned SVG once the macro resolves', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Procedural body-plan schematic, quadruped"><ellipse cx="50" cy="50" rx="10" ry="10" fill="#5a4632"/></svg>';
    lensRunMock.mockImplementation((domain: string, action: string, input: Record<string, unknown>) => {
      expect(domain).toBe('creatures');
      expect(action).toBe('portrait');
      expect(input).toMatchObject({ species_id: 'wolf' });
      return envelope({ ok: true, svg, params: { topology: 'quadruped', massKg: 90, heightM: 1.9, partCount: 7 } });
    });
    const { CreaturePortraitThumb } = await import('@/components/creatures/CreaturePortraitThumb');
    const { container } = render(React.createElement(CreaturePortraitThumb, { speciesId: 'wolf' }));
    await waitFor(() => {
      expect(container.querySelector('svg')).toBeInTheDocument();
    });
    expect(container.querySelector('ellipse')).toBeInTheDocument();
  });

  it('renders an honest placeholder (not fabricated art) when the macro fails', async () => {
    lensRunMock.mockImplementation(() => envelope({ ok: false, reason: 'portrait_failed' }));
    const { CreaturePortraitThumb } = await import('@/components/creatures/CreaturePortraitThumb');
    const { container } = render(React.createElement(CreaturePortraitThumb, { speciesId: 'unknown_species' }));
    await waitFor(() => {
      expect(container.querySelector('svg')).not.toBeInTheDocument();
    });
    expect(screen.getByTitle(/no procedural portrait for unknown_species/i)).toBeInTheDocument();
  });

  it('dedupes concurrent fetches for the same species id (one call, two renders)', async () => {
    let callCount = 0;
    lensRunMock.mockImplementation(() => {
      callCount += 1;
      return envelope({ ok: true, svg: '<svg xmlns="http://www.w3.org/2000/svg"><ellipse/></svg>', params: { topology: 'fish' } });
    });
    const { CreaturePortraitThumb } = await import('@/components/creatures/CreaturePortraitThumb');
    render(
      React.createElement('div', null,
        React.createElement(CreaturePortraitThumb, { speciesId: 'trout' }),
        React.createElement(CreaturePortraitThumb, { speciesId: 'trout' }),
      ),
    );
    await waitFor(() => {
      expect(document.querySelectorAll('svg').length).toBe(2);
    });
    expect(callCount).toBe(1);
  });
});
