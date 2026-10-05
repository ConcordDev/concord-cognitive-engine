/**
 * World lens honesty: the DSL editor, the Snap-Build catalog, and the mobile
 * companion's Remote/Chat tabs must not fake work the system can't do.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
}));

import ConcordDSLEditor, { DSL_NOT_SUPPORTED } from '@/components/world-lens/ConcordDSLEditor';
import SnapBuildCatalog from '@/components/world-lens/SnapBuildCatalog';
import MobileCompanion from '@/components/world-lens/MobileCompanion';
import * as snapLib from '@/lib/world-lens/snap-build-templates';

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockResolvedValue({ data: { ok: true, result: {} } });
});

describe('ConcordDSLEditor', () => {
  it('opens empty, with run disabled and an honest not-supported label', () => {
    render(<ConcordDSLEditor />);
    const src = screen.getByLabelText('Concord DSL source') as HTMLTextAreaElement;
    expect(src.value).toBe('');
    expect(screen.getByTestId('dsl-run-disabled')).toBeDisabled();
    expect(screen.getByTestId('dsl-not-supported')).toHaveTextContent(DSL_NOT_SUPPORTED);
    expect(screen.queryByText(/Templates/)).toBeNull();
  });

  it('never claims to parse, compile, validate or publish typed code', () => {
    render(<ConcordDSLEditor />);
    fireEvent.change(screen.getByLabelText('Concord DSL source'), {
      target: { value: 'material Steel {\n}\npublish Steel' },
    });
    fireEvent.click(screen.getByTestId('dsl-run-disabled'));
    const text = document.body.textContent || '';
    expect(text).not.toMatch(/AST generated|Compilation successful|DTUs emitted|Published IDs|Registry updated/);
    expect(text).not.toMatch(/DTU-MAT-|PUB-/);
  });
});

describe('SnapBuildCatalog', () => {
  it('ships no seeded templates', () => {
    expect((snapLib as Record<string, unknown>).SEED_SNAP_TEMPLATES).toBeUndefined();
  });

  it('shows 0 templates and says publishing is not supported yet', () => {
    render(<SnapBuildCatalog />);
    expect(screen.getByText('0 templates available')).toBeInTheDocument();
    expect(screen.getByTestId('snap-build-not-supported')).toHaveTextContent(/not supported yet/);
    expect(document.body.textContent).not.toMatch(/@architect_alex|Craftsman House/);
  });
});

describe('MobileCompanion', () => {
  it('Remote tab has no fake LIVE feed or teleport presets', () => {
    render(<MobileCompanion />);
    fireEvent.click(screen.getByText('Remote'));
    expect(screen.getByTestId('companion-remote-not-supported')).toHaveTextContent(/no live camera stream/);
    expect(screen.queryByText('LIVE')).toBeNull();
    expect(screen.queryByText('Riverside District')).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('Chat tab does not pretend to send messages', () => {
    render(<MobileCompanion />);
    fireEvent.click(screen.getByText('Chat'));
    expect(screen.getByTestId('companion-chat-not-supported')).toHaveTextContent(/not wired to any message service/);
    expect(screen.queryByPlaceholderText('Type a message...')).toBeNull();
  });
});

describe('District editor starting canvas', () => {
  it('is an empty, unsaved local sketch, not a seeded demo district', async () => {
    const seed = await import('@/lib/world-lens/district-seed');
    expect((seed as Record<string, unknown>).DEMO_DISTRICT).toBeUndefined();
    const d = seed.EMPTY_DISTRICT;
    expect(d.name).toBe('Local sketch (not saved)');
    expect(d.buildings).toEqual([]);
    expect(d.zoning.zones).toEqual([]);
    expect(Object.values(d.infrastructure).every((list) => list.length === 0)).toBe(true);
    expect([d.populationCapacity, d.powerCapacity, d.waterCapacity, d.environmentalScore]).toEqual([0, 0, 0, 0]);
    expect(JSON.stringify(d)).not.toMatch(/@[a-z_]+|Pioneer Valley|citations/);
  });
});
