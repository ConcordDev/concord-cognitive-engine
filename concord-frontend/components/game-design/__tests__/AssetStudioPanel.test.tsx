/**
 * AssetStudioPanel — pins the Increment 1 Asset Studio authoring form:
 *  - the form renders (archetype picker, dimension inputs, feature select,
 *    name field, live preview, Publish action) before anything is published;
 *  - Publish calls `lensRun('game-design', 'building-publish', ...)` with the
 *    EXACT param shape the shared build contract specifies — this is the
 *    frontend<->backend contract test, so a shape drift on either side of
 *    the Unit 1/Unit 2 split fails loudly here instead of silently at runtime;
 *  - an honest backend failure (e.g. an overlap rejection) renders the real
 *    reason, never a silently-swallowed or fabricated "success".
 *
 * BuildingPreview (mounted inside the form) tries to build a real WebGL
 * context, which jsdom doesn't provide — it's expected to fall back to its
 * own honest "preview unavailable" state rather than throw, and this test
 * doesn't assert anything about its rendered pixels.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// Import AFTER the mock is registered.
import { AssetStudioPanel } from '@/components/game-design/AssetStudioPanel';

function runOk(result: unknown) {
  return Promise.resolve({ data: { ok: true, result, error: null } });
}
function runReject(message: string) {
  return Promise.resolve({ data: { ok: false, result: null, error: message } });
}

/** Routes the shared lensRun mock by (domain, action) — mirrors real dispatch. */
function mockDispatch(handlers: Record<string, (input: unknown) => Promise<unknown>>) {
  lensRunMock.mockImplementation((domain: string, action: string, input: unknown) => {
    const key = `${domain}.${action}`;
    if (handlers[key]) return handlers[key](input);
    return runOk(null);
  });
}

beforeEach(() => { lensRunMock.mockReset(); });
afterEach(() => { vi.clearAllMocks(); });

function fillMinimalDraft(getByLabelText: (m: string) => HTMLElement, getByText: (m: string | RegExp) => HTMLElement) {
  fireEvent.click(getByText('Tavern'));
  fireEvent.change(getByLabelText('Building name'), { target: { value: 'Riverside Inn' } });
}

describe('AssetStudioPanel — form renders honestly before anything is published', () => {
  it('renders the archetype picker, dimension inputs, feature select, name field, and Publish action', async () => {
    mockDispatch({ 'game-design.building-list-mine': () => runOk({ buildings: [] }) });
    const { getByText, getByLabelText, findByText } = render(<AssetStudioPanel gameId="g1" onChange={() => {}} />);

    // Archetype tiles — all 5 real options.
    for (const label of ['Tavern', 'Archive', 'Forge', 'Market', 'Tower']) {
      expect(getByText(label)).toBeInTheDocument();
    }
    // Dimension inputs (meters).
    expect(getByLabelText('Width (meters)')).toBeInTheDocument();
    expect(getByLabelText('Height (meters)')).toBeInTheDocument();
    expect(getByLabelText('Depth (meters)')).toBeInTheDocument();
    // Feature select including "None".
    const featureSelect = getByLabelText('Iconic feature') as HTMLSelectElement;
    const optionLabels = Array.from(featureSelect.options).map((o) => o.textContent);
    expect(optionLabels).toEqual(['None', 'Dome', 'Spire', 'Colonnade', 'Belfry']);
    // withInterior toggle + name field.
    expect(getByLabelText('Include interior decor')).toBeInTheDocument();
    expect(getByLabelText('Building name')).toBeInTheDocument();
    // Honest empty preview state before an archetype is chosen.
    expect(getByText(/Pick an archetype to preview the building/i)).toBeInTheDocument();
    // Publish action + the honest royalty-eligible-not-paid-yet note.
    expect(getByText('Publish to Concordia')).toBeInTheDocument();
    expect(getByText(/royalty-eligible/i)).toBeInTheDocument();
    expect(getByText(/does not yet earn money/i)).toBeInTheDocument();

    // My authored buildings list loads via building-list-mine and shows its
    // own honest empty state (never a fabricated placeholder row).
    await findByText(/No buildings published yet/i);
    expect(lensRunMock).toHaveBeenCalledWith('game-design', 'building-list-mine', {});
  });

  it('Publish is disabled until an archetype, name, and positive dimensions are all present', async () => {
    mockDispatch({ 'game-design.building-list-mine': () => runOk({ buildings: [] }) });
    const { getByText } = render(<AssetStudioPanel gameId="g1" onChange={() => {}} />);
    await waitFor(() => expect(getByText(/No buildings published yet/i)).toBeInTheDocument());
    expect(getByText('Publish to Concordia').closest('button')).toBeDisabled();
  });
});

describe('AssetStudioPanel — Publish calls the exact building-publish param shape', () => {
  it('sends { name, archetype, feature, withInterior, dimensions, worldId, position, rotationY } exactly', async () => {
    mockDispatch({
      'game-design.building-list-mine': () => runOk({ buildings: [] }),
      'game-design.building-publish': () => runOk({ dtuId: 'dtu-abc', buildingId: 'bld-1', spawned: true }),
    });
    const { getByText, getByLabelText, findByText } = render(<AssetStudioPanel gameId="g1" onChange={() => {}} />);
    await findByText(/No buildings published yet/i);

    fillMinimalDraft(getByLabelText, getByText);
    // Pick a feature and flip the interior toggle so both non-default fields
    // are proven to flow through into the payload, not just the defaults.
    fireEvent.change(getByLabelText('Iconic feature'), { target: { value: 'dome' } });
    fireEvent.click(getByLabelText('Include interior decor'));

    fireEvent.click(getByText('Publish to Concordia'));

    await waitFor(() => expect(getByText(/Published and spawned in Concordia/i)).toBeInTheDocument());

    expect(lensRunMock).toHaveBeenCalledWith('game-design', 'building-publish', {
      name: 'Riverside Inn',
      archetype: 'tavern',
      feature: 'dome',
      withInterior: true,
      dimensions: { width: 8, height: 6, depth: 8 },
      worldId: 'concordia-hub',
      position: { x: 0, y: 0, z: 0 },
      rotationY: 0,
    });
    // Shows the real returned identifiers, not fabricated ones.
    expect(getByText(/dtu-abc/)).toBeInTheDocument();
    expect(getByText(/bld-1/)).toBeInTheDocument();
  });

  it('includes remixOfDtuId only when the creator actually fills it in', async () => {
    mockDispatch({
      'game-design.building-list-mine': () => runOk({ buildings: [] }),
      'game-design.building-publish': () => runOk({ dtuId: 'dtu-remix', buildingId: 'bld-2', spawned: true }),
    });
    const { getByText, getByLabelText, findByText } = render(<AssetStudioPanel gameId="g1" onChange={() => {}} />);
    await findByText(/No buildings published yet/i);

    fillMinimalDraft(getByLabelText, getByText);
    fireEvent.change(getByLabelText('Remix of DTU id'), { target: { value: 'dtu-parent-1' } });
    fireEvent.click(getByText('Publish to Concordia'));

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('game-design', 'building-publish', expect.objectContaining({
      remixOfDtuId: 'dtu-parent-1',
    })));
  });
});

describe('AssetStudioPanel — honest failure states', () => {
  it('renders the real backend reason on an overlap rejection, never a fabricated success', async () => {
    mockDispatch({
      'game-design.building-list-mine': () => runOk({ buildings: [] }),
      'game-design.building-publish': () => runReject('overlap'),
    });
    const { getByText, getByLabelText, findByText, queryByText } = render(<AssetStudioPanel gameId="g1" onChange={() => {}} />);
    await findByText(/No buildings published yet/i);

    fillMinimalDraft(getByLabelText, getByText);
    fireEvent.click(getByText('Publish to Concordia'));

    const alert = await findByText(/Publish failed: overlap/i);
    expect(alert).toBeInTheDocument();
    expect(queryByText(/Published and spawned in Concordia/i)).toBeNull();
  });

  it('never calls the macro when required fields are missing (client-side validation, not a silent no-op)', async () => {
    mockDispatch({ 'game-design.building-list-mine': () => runOk({ buildings: [] }) });
    const { getByText, findByText } = render(<AssetStudioPanel gameId="g1" onChange={() => {}} />);
    await findByText(/No buildings published yet/i);
    // Publish is disabled with no archetype/name — clicking a disabled
    // button fires no onClick, so this pins that no publish call happens.
    fireEvent.click(getByText('Publish to Concordia'));
    expect(lensRunMock).not.toHaveBeenCalledWith('game-design', 'building-publish', expect.anything());
  });

  it('renders the real reason when loading authored buildings fails', async () => {
    mockDispatch({ 'game-design.building-list-mine': () => runReject('database unavailable') });
    const { findByText } = render(<AssetStudioPanel gameId="g1" onChange={() => {}} />);
    expect(await findByText(/database unavailable/i)).toBeInTheDocument();
  });
});
