/// <reference types="@testing-library/jest-dom/vitest" />
// MasonStuff's Wall strength check widget — the second real-computation lens
// this pass mounts the shared honest ComputedResultBadge on (alongside the
// engineering FEA fix). Pins: an honest "Not checked" (no_data) state before
// any check has run, then the real "Wall OK" / "Wall Fails Check" states
// driven entirely by the real masonry.wallStrength macro response — never a
// fabricated verified default.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const runDomain = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a) } },
}));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));

import { MasonStuff } from '@/components/masonry/MasonStuff';

function renderWithQuery() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MasonStuff />
    </QueryClientProvider>
  );
}

// masonry.wallStrength's real transport shape: the macro itself returns
// `{ ok: true, result: {...fields} }`, and that whole object is what lands at
// the HTTP envelope's `.result` — mirrors server/domains/masonry.js exactly.
function wallResponse(fields: Record<string, unknown>) {
  return { data: { ok: true, result: { ok: true, result: fields } } };
}

async function checkWall(utils: ReturnType<typeof render>) {
  const heightAndThickness = utils.getAllByPlaceholderText('e.g. 8');
  fireEvent.change(heightAndThickness[0], { target: { value: '8' } });
  fireEvent.change(heightAndThickness[1], { target: { value: '8' } });
  await act(async () => {
    fireEvent.click(utils.getByText('Check wall'));
  });
}

describe('MasonStuff — Wall strength check honest badge', () => {
  beforeEach(() => {
    runDomain.mockReset();
  });

  it('shows the honest "Not checked" (no_data) badge before any check runs', () => {
    const utils = renderWithQuery();
    expect(utils.getByText('Not checked')).toBeInTheDocument();
    const badges = utils.container.querySelectorAll('[data-computed-result-state]');
    expect(Array.from(badges).some((b) => b.getAttribute('data-computed-result-state') === 'no_data')).toBe(true);
  });

  it('shows "Wall OK" (verified) for a real passing masonry.wallStrength result', async () => {
    runDomain.mockResolvedValue(
      wallResponse({
        heightFeet: 8,
        thicknessInches: 8,
        slendernessRatio: 12,
        maxAllowedRatio: 25,
        passesSlenderness: true,
        reinforced: true,
        loadBearing: true,
        recommendation: 'Wall dimensions are adequate',
      })
    );
    const utils = renderWithQuery();
    await checkWall(utils);
    await waitFor(() => expect(utils.getByText('Wall OK')).toBeInTheDocument());
    const badge = Array.from(utils.container.querySelectorAll('[data-computed-result-state]')).find(
      (b) => b.textContent === 'Wall OK'
    );
    expect(badge?.getAttribute('data-computed-result-state')).toBe('verified');
  });

  it('shows "Wall Fails Check" (failed) for a real failing masonry.wallStrength result, never "Wall OK"', async () => {
    runDomain.mockResolvedValue(
      wallResponse({
        heightFeet: 20,
        thicknessInches: 6,
        slendernessRatio: 40,
        maxAllowedRatio: 25,
        passesSlenderness: false,
        reinforced: true,
        loadBearing: true,
        recommendation: 'Wall too slender — increase thickness or add pilasters',
      })
    );
    const utils = renderWithQuery();
    await checkWall(utils);
    await waitFor(() => expect(utils.getByText('Wall Fails Check')).toBeInTheDocument());
    expect(utils.queryByText('Wall OK')).toBeNull();
    const badge = Array.from(utils.container.querySelectorAll('[data-computed-result-state]')).find(
      (b) => b.textContent === 'Wall Fails Check'
    );
    expect(badge?.getAttribute('data-computed-result-state')).toBe('failed');
  });
});
