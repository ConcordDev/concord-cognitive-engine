/**
 * CreatureStudioPanel — pins the Creature Studio authoring form:
 *  - the form renders (topology picker, species-name field, coat colour,
 *    variant, live preview, Publish action) before anything is published;
 *  - Publish calls `lensRun('creatures', 'creature-publish', ...)` with the
 *    EXACT param shape the backend contract specifies (slugified speciesId +
 *    topology + coatColor) — a shape drift on either side fails loudly here;
 *  - an honest backend failure renders the real `error` string, never a
 *    silently-swallowed or fabricated "success";
 *  - the "my creatures" list loads via creature-list-mine and shows its own
 *    honest empty state.
 *
 * CreaturePreview (mounted inside the form) tries to build a real WebGL
 * context, which jsdom doesn't provide — it's mocked here to an inert stub
 * so the test never touches three/WebGL and stays focused on the form.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// Mock the 3D preview + mesh builder so WebGL/three never run in jsdom.
vi.mock('@/components/game-design/CreaturePreview', () => ({
  CreaturePreview: () => React.createElement('div', { 'data-testid': 'creature-preview' }),
}));
vi.mock('@/lib/world-lens/creature-mesh-builder', () => ({
  createCreatureMesh: vi.fn(),
}));

// Import AFTER the mocks are registered.
import { CreatureStudioPanel } from '@/components/game-design/CreatureStudioPanel';

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

describe('CreatureStudioPanel — form renders honestly before anything is published', () => {
  it('renders the topology picker, species-name field, coat colour, and Publish action', async () => {
    mockDispatch({ 'creatures.creature-list-mine': () => runOk({ creatures: [] }) });
    const { getByText, getByLabelText, findByText } = render(<CreatureStudioPanel gameId="g1" onChange={() => {}} />);

    // Species name input.
    expect(getByLabelText('Species name')).toBeInTheDocument();
    // Topology tiles — a sample across the 11 real options.
    for (const label of ['Quadruped', 'Winged biped', 'Serpentine', 'Shark', 'Cephalopod', 'Humanoid']) {
      expect(getByText(label)).toBeInTheDocument();
    }
    // Coat colour + variant controls.
    expect(getByLabelText('Coat colour')).toBeInTheDocument();
    expect(getByLabelText('Variant label')).toBeInTheDocument();
    // Publish action + the honest not-paid-yet note.
    expect(getByText('Publish blueprint')).toBeInTheDocument();
    expect(getByText(/does not earn money/i)).toBeInTheDocument();

    // My authored creatures list loads via creature-list-mine and shows its
    // own honest empty state (never a fabricated placeholder row).
    await findByText(/No creatures published yet/i);
    expect(lensRunMock).toHaveBeenCalledWith('creatures', 'creature-list-mine', {});
  });

  it('Publish is disabled until a species name is present', async () => {
    mockDispatch({ 'creatures.creature-list-mine': () => runOk({ creatures: [] }) });
    const { getByText, findByText } = render(<CreatureStudioPanel gameId="g1" onChange={() => {}} />);
    await findByText(/No creatures published yet/i);
    expect(getByText('Publish blueprint').closest('button')).toBeDisabled();
  });
});

describe('CreatureStudioPanel — Publish calls the exact creature-publish param shape', () => {
  it('sends { speciesId (slugified), name, topology, coatColor } and renders the real returned dtuId', async () => {
    mockDispatch({
      'creatures.creature-list-mine': () => runOk({ creatures: [] }),
      'creatures.creature-publish': () => runOk({ dtuId: 'dtu-abc', creatureId: null, spawned: false, species_id: 'ember_stalker' }),
    });
    const { getByText, getByLabelText, findByText } = render(<CreatureStudioPanel gameId="g1" onChange={() => {}} />);
    await findByText(/No creatures published yet/i);

    fireEvent.change(getByLabelText('Species name'), { target: { value: 'Ember Stalker' } });
    fireEvent.click(getByText('Serpentine'));

    fireEvent.click(getByText('Publish blueprint'));

    await waitFor(() => expect(getByText(/Published as a blueprint/i)).toBeInTheDocument());

    expect(lensRunMock).toHaveBeenCalledWith('creatures', 'creature-publish', {
      speciesId: 'ember_stalker',
      name: 'Ember Stalker',
      topology: 'serpentine',
      coatColor: '#8b5e3c',
    });
    // Shows the real returned identifier, not a fabricated one.
    expect(getByText(/dtu-abc/)).toBeInTheDocument();
  });

  it('includes variant only when the creator actually fills it in', async () => {
    mockDispatch({
      'creatures.creature-list-mine': () => runOk({ creatures: [] }),
      'creatures.creature-publish': () => runOk({ dtuId: 'dtu-var', spawned: false, species_id: 'magma_wyrm' }),
    });
    const { getByText, getByLabelText, findByText } = render(<CreatureStudioPanel gameId="g1" onChange={() => {}} />);
    await findByText(/No creatures published yet/i);

    fireEvent.change(getByLabelText('Species name'), { target: { value: 'Magma Wyrm' } });
    fireEvent.change(getByLabelText('Variant label'), { target: { value: 'magma' } });
    fireEvent.click(getByText('Publish blueprint'));

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('creatures', 'creature-publish', expect.objectContaining({
      speciesId: 'magma_wyrm',
      variant: 'magma',
    })));
  });
});

describe('CreatureStudioPanel — honest failure states', () => {
  it('renders the real backend reason on a rejection, never a fabricated success', async () => {
    mockDispatch({
      'creatures.creature-list-mine': () => runOk({ creatures: [] }),
      'creatures.creature-publish': () => runReject('auth_required'),
    });
    const { getByText, getByLabelText, findByText, queryByText } = render(<CreatureStudioPanel gameId="g1" onChange={() => {}} />);
    await findByText(/No creatures published yet/i);

    fireEvent.change(getByLabelText('Species name'), { target: { value: 'Ghost Fox' } });
    fireEvent.click(getByText('Publish blueprint'));

    const alert = await findByText(/Publish failed: auth_required/i);
    expect(alert).toBeInTheDocument();
    expect(queryByText(/Published as a blueprint/i)).toBeNull();
    expect(queryByText(/Published and spawned/i)).toBeNull();
  });

  it('never calls the macro when the species name is empty (client-side validation, not a silent no-op)', async () => {
    mockDispatch({ 'creatures.creature-list-mine': () => runOk({ creatures: [] }) });
    const { getByText, findByText } = render(<CreatureStudioPanel gameId="g1" onChange={() => {}} />);
    await findByText(/No creatures published yet/i);
    // Publish is disabled with no species name — clicking a disabled button
    // fires no onClick, so this pins that no publish call happens.
    fireEvent.click(getByText('Publish blueprint'));
    expect(lensRunMock).not.toHaveBeenCalledWith('creatures', 'creature-publish', expect.anything());
  });

  it('renders the real reason when loading authored creatures fails', async () => {
    mockDispatch({ 'creatures.creature-list-mine': () => runReject('database unavailable') });
    const { findByText } = render(<CreatureStudioPanel gameId="g1" onChange={() => {}} />);
    expect(await findByText(/database unavailable/i)).toBeInTheDocument();
  });
});

describe('CreatureStudioPanel — my authored creatures list renders from the backend', () => {
  it('renders each creature from creature-list-mine with its real fields', async () => {
    mockDispatch({
      'creatures.creature-list-mine': () => runOk({
        creatures: [{
          dtuId: 'dtu-1', name: 'Ember Stalker', species_id: 'ember_stalker',
          topology: 'serpentine', massKg: 12, variant: 'magma', visibility: 'public', spawnCount: 2,
        }],
      }),
    });
    const { findByText, getByText } = render(<CreatureStudioPanel gameId="g1" onChange={() => {}} />);
    expect(await findByText('Ember Stalker')).toBeInTheDocument();
    expect(getByText('ember_stalker')).toBeInTheDocument();
    expect(getByText(/2 live/)).toBeInTheDocument();
  });
});
