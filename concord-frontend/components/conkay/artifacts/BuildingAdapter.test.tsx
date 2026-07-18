/// <reference types="@testing-library/jest-dom/vitest" />
// Phase S2-b (building) — "Step inside". The 3D (BuildingRenderer3D + the
// ConcordiaScene walkthrough) can't run in jsdom, so they're mocked to markers;
// this owns the gate + the preview↔walkthrough swap: a published, un-edited
// building offers "Step inside" and swaps to the real-world walkthrough on click;
// an un-published one does not.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { detectArtifact, type ConkayBuildingArtifact } from '@/lib/conkay/artifact-kinds';

vi.mock('@/components/world-lens/BuildingRenderer3D', () => ({ default: () => <div data-testid="mock-renderer" /> }));
vi.mock('./BuildingWalkthrough', () => ({
  BuildingWalkthrough: ({ worldId, onExit }: { worldId: string; onExit: () => void }) => (
    <button data-testid="mock-walkthrough" onClick={onExit}>walk {worldId}</button>
  ),
}));
vi.mock('./BuildingIterateBar', () => ({ BuildingIterateBar: () => <div data-testid="mock-iterate" /> }));
vi.mock('./ArtifactProvenance', () => ({ ArtifactProvenance: () => <div data-testid="mock-provenance" /> }));

import { BuildingAdapter } from './BuildingAdapter';

const INPUT = { archetype: 'tower', name: 'T', position: { x: 0, y: 0, z: 0 }, dimensions: { width: 6, height: 20, depth: 6 } };
const published = detectArtifact('game-design', 'building-publish', { ...INPUT, worldId: 'world_hub' }, {
  ok: true, buildingId: 'b1', dtuId: 'dtu_1',
}) as ConkayBuildingArtifact;
const unpublished = detectArtifact('game-design', 'building-publish', INPUT, { ok: true, buildingId: 'b1' }) as ConkayBuildingArtifact;

describe('BuildingAdapter — Step inside', () => {
  it('published + un-edited: offers "Step inside" and swaps to the real-world walkthrough', () => {
    render(<BuildingAdapter artifact={published} />);
    expect(screen.getByTestId('mock-renderer')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('ck-building-stepin'));
    expect(screen.getByTestId('mock-walkthrough')).toHaveTextContent('world_hub');
    expect(screen.queryByTestId('mock-renderer')).toBeNull(); // preview swapped out

    fireEvent.click(screen.getByTestId('mock-walkthrough')); // onExit
    expect(screen.getByTestId('mock-renderer')).toBeInTheDocument(); // back to preview
  });

  it('un-published (no dtuId/worldId): no "Step inside" affordance', () => {
    render(<BuildingAdapter artifact={unpublished} />);
    expect(screen.queryByTestId('ck-building-stepin')).toBeNull();
  });
});
