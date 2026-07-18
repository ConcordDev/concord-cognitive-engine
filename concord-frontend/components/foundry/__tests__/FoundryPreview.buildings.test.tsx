/// <reference types="@testing-library/jest-dom/vitest" />
// Asset Studio Increment 2-A — authored buildings in the standalone Foundry
// preview surface.
//
// Two concerns, one file (vitest's `include` covers components/** but NOT lib/**,
// so the pure-mapper assertions live here alongside the component behaviour):
//
//   1. mapWorldBuildingToRendererDTU produces the exact renderer DTU shape,
//      threading archetype/feature through ONLY when the row carries them —
//      mirrors app/lenses/world/__tests__/building-dtu-mapping.test.tsx so the
//      standalone canonical copy can't silently drift from the page's sibling.
//   2. FoundryPreview fetches the compiled preview world's buildings from the
//      correct /api/worlds/:worldId/buildings URL, maps them (server→scene frame
//      via worldToScene, then row→DTU) and mounts the headless BuildingRenderer3D
//      with the mapped array on success — and with an EMPTY array on fetch
//      failure (honest terrain-only, never fabricated rows).
//
// ConcordiaScene + BuildingRenderer3D use WebGL; they're mocked to inspect props
// rather than rendered in jsdom. next/dynamic is mocked to resolve its loader so
// those mocks actually mount.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import {
  mapWorldBuildingToRendererDTU,
  coerceMaterial,
  type WorldBuildingRow,
} from '@/lib/world-lens/world-building-dto';

// ── Hoisted test doubles ─────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  previewWorld: vi.fn(),
  endPreview: vi.fn(() => Promise.resolve({ ok: true })),
  // Captures the LAST props BuildingRenderer3D was mounted with.
  lastBuildingProps: { current: null as null | Record<string, unknown> },
}));

vi.mock('@/lib/foundry/api', () => ({
  previewWorld: h.previewWorld,
  endPreview: h.endPreview,
}));

// next/dynamic → resolve the loader and render the (mocked) underlying module,
// so ConcordiaScene / BuildingRenderer3D mocks below actually mount.
vi.mock('next/dynamic', () => ({
  default: (
    loader: () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>,
    opts?: { loading?: () => React.ReactNode },
  ) => {
    const Dyn = (props: Record<string, unknown>) => {
      const [Comp, setComp] = React.useState<React.ComponentType<Record<string, unknown>> | null>(null);
      React.useEffect(() => {
        let alive = true;
        Promise.resolve(loader()).then((m) => {
          if (alive) setComp(() => (m && 'default' in m ? m.default : (m as unknown as React.ComponentType<Record<string, unknown>>)));
        });
        return () => { alive = false; };
      }, []);
      if (Comp) return React.createElement(Comp, props);
      return opts?.loading ? React.createElement(React.Fragment, null, opts.loading()) : null;
    };
    return Dyn;
  },
}));

vi.mock('@/components/world-lens/ConcordiaScene', () => ({
  default: (props: Record<string, unknown>) =>
    React.createElement('div', { 'data-testid': 'concordia-scene', 'data-district': props.districtId as string }),
}));

vi.mock('@/components/world-lens/BuildingRenderer3D', () => ({
  default: (props: Record<string, unknown>) => {
    h.lastBuildingProps.current = props;
    const buildings = (props.buildings as unknown[]) ?? [];
    return React.createElement('div', {
      'data-testid': 'building-renderer',
      'data-count': String(buildings.length),
      'data-view-mode': props.viewMode as string,
    });
  },
}));

import { FoundryPreview } from '@/components/foundry/FoundryPreview';

// ── Fixtures (mirror building-dtu-mapping.test.tsx) ──────────────────────────
const legacyRow: WorldBuildingRow = {
  id: 'b-legacy-1',
  building_type: 'tavern',
  name: 'Old Tavern',
  x: 12,
  y: 0,
  z: 34,
  width: 14,
  depth: 10,
  height: 9,
  material: 'brick',
  is_seed: 1,
};
const authoredRow: WorldBuildingRow = {
  id: 'b-authored-1',
  building_type: 'archive',
  name: "Kestrel's Archive",
  x: 100,
  y: 0,
  z: 200,
  width: 18,
  depth: 16,
  height: 12,
  material: 'stone',
  is_seed: 0,
  archetype: 'archive',
  feature: 'dome',
};

beforeEach(() => {
  vi.clearAllMocks();
  h.lastBuildingProps.current = null;
  h.endPreview.mockResolvedValue({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('world-building-dto — row → renderer DTU mapping', () => {
  it('a row WITHOUT archetype/feature maps to the base shape (no archetype/feature keys)', () => {
    const dtu = mapWorldBuildingToRendererDTU(legacyRow);
    expect(dtu).toEqual({
      id: 'b-legacy-1',
      name: 'Old Tavern',
      position: { x: 12, y: 0, z: 34 },
      dimensions: { width: 14, height: 9, depth: 10 },
      floors: 1,
      material: 'brick',
      style: 'colonial',
      building_type: 'tavern',
      structure: {
        columns: { count: 0, spacing: 0, radius: 0 },
        beams: { count: 0, height: 0 },
        roofType: 'gable',
        hasBasement: false,
        windowRows: 1,
        windowsPerRow: 2,
      },
    });
    expect('archetype' in dtu).toBe(false);
    expect('feature' in dtu).toBe(false);
  });

  it('a row WITH archetype+feature threads them through unmodified', () => {
    const dtu = mapWorldBuildingToRendererDTU(authoredRow) as Record<string, unknown>;
    expect(dtu.archetype).toBe('archive');
    expect(dtu.feature).toBe('dome');
    expect(dtu.id).toBe('b-authored-1');
    expect(dtu.building_type).toBe('archive');
    expect(dtu.dimensions).toEqual({ width: 18, height: 12, depth: 16 });
  });

  it('a falsy (empty-string) archetype/feature is omitted, not passed through', () => {
    const dtu = mapWorldBuildingToRendererDTU({ ...legacyRow, archetype: '', feature: '' });
    expect('archetype' in dtu).toBe(false);
    expect('feature' in dtu).toBe(false);
  });

  it('coerceMaterial re-exports the canonical building-silhouette behaviour', () => {
    // Known materials pass through; unknown → stone; thatch → wood (the REAL
    // helper the page uses, not a divergent copy).
    expect(coerceMaterial('brick')).toBe('brick');
    expect(coerceMaterial('stone')).toBe('stone');
    expect(coerceMaterial('thatch')).toBe('wood');
    expect(coerceMaterial('nonsense')).toBe('stone');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('FoundryPreview — authored buildings into the 3D preview', () => {
  it('fetches /api/worlds/:previewWorldId/buildings and mounts BuildingRenderer3D with the mapped buildings', async () => {
    h.previewWorld.mockResolvedValue({ ok: true, previewWorldId: 'preview-xyz', skippedStubs: [] });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ buildings: [legacyRow, authoredRow] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<FoundryPreview foundryWorldId="fw_1" worldName="Alpha" onClose={() => {}} />);

    // The scene mounts against the real compiled preview world id.
    const scene = await screen.findByTestId('concordia-scene');
    expect(scene).toHaveAttribute('data-district', 'preview-xyz');

    // Buildings fetched from the correct per-world endpoint.
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/worlds/preview-xyz/buildings',
        expect.objectContaining({ signal: expect.anything() }),
      ),
    );

    // BuildingRenderer3D mounts with the 2 mapped buildings, view mode normal.
    const renderer = await screen.findByTestId('building-renderer');
    await waitFor(() => expect(renderer).toHaveAttribute('data-count', '2'));
    expect(renderer).toHaveAttribute('data-view-mode', 'normal');

    // The mapping ran end-to-end: worldToScene shifted the server frame by −1000
    // in x/z, then row→DTU carried archetype/feature through.
    const props = h.lastBuildingProps.current as { buildings: Array<Record<string, unknown>> };
    const authored = props.buildings.find((b) => b.id === 'b-authored-1')!;
    expect((authored.position as { x: number; z: number })).toMatchObject({ x: -900, z: -800 });
    expect(authored.archetype).toBe('archive');
    expect(authored.feature).toBe('dome');
    const legacy = props.buildings.find((b) => b.id === 'b-legacy-1')!;
    expect('archetype' in legacy).toBe(false);

    vi.unstubAllGlobals();
  });

  it('renders NO buildings (empty array) when the buildings fetch fails — honest terrain-only, never fabricated rows', async () => {
    h.previewWorld.mockResolvedValue({ ok: true, previewWorldId: 'preview-fail', skippedStubs: [] });
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    render(<FoundryPreview foundryWorldId="fw_2" worldName="Beta" onClose={() => {}} />);

    // Scene still mounts (preview world compiled) …
    await screen.findByTestId('concordia-scene');
    // … and BuildingRenderer3D mounts with zero buildings — no fabricated stand-in.
    const renderer = await screen.findByTestId('building-renderer');
    await waitFor(() => expect(renderer).toHaveAttribute('data-count', '0'));

    const props = h.lastBuildingProps.current as { buildings: unknown[] };
    expect(props.buildings).toEqual([]);

    vi.unstubAllGlobals();
  });

  it('treats a non-array buildings payload as empty (no fabricated rows)', async () => {
    h.previewWorld.mockResolvedValue({ ok: true, previewWorldId: 'preview-weird', skippedStubs: [] });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ buildings: null }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<FoundryPreview foundryWorldId="fw_3" worldName="Gamma" onClose={() => {}} />);

    const renderer = await screen.findByTestId('building-renderer');
    await waitFor(() => expect(renderer).toHaveAttribute('data-count', '0'));

    vi.unstubAllGlobals();
  });
});
