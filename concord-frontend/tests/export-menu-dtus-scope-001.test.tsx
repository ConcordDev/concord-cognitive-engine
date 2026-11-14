// FIX-dtus-001 — on the DTUs lens, the header Export menu toasted
// 'Nothing to export yet' while the lens listed 72 vault DTU records:
// the menu exports SAVED LENS ITEMS (empty on this lens), and its
// generic 'Full DTU bundle' description promised the very records it
// cannot reach. No vault-DTU export path exists anywhere in-tree
// (leg 1 is the desk's shared-exporter build). The menu now states its
// scope up front, in the menu itself, on this lens — the ticket's
// accepted leg 2 — while other lenses keep their descriptions.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const listMock = vi.fn();
const downloadMock = vi.fn();
const urlMock = vi.fn();
vi.mock('@/lib/api/client', () => ({ apiHelpers: { lens: { list: (...a: unknown[]) => listMock(...a), exportList: (...a: unknown[]) => listMock(...a) } }, lensRun: vi.fn() }));
vi.mock('@/lib/utils', async (orig) => ({ ...(await orig<object>()), downloadFile: (...a: unknown[]) => downloadMock(...a), downloadFromUrl: (...a: unknown[]) => urlMock(...a) }));

// framer-motion: render plain elements so the dropdown mounts
// synchronously under jsdom (the shipped pattern for menu tests).
import * as React from 'react';
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy(
    {},
    { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));

import { ExportMenu } from '@/components/common/ExportMenu';

beforeEach(() => { listMock.mockReset(); downloadMock.mockReset(); urlMock.mockReset(); });

describe('FIX-dtus-001 — ExportMenu scope on the DTUs lens', () => {
  it('states the saved-items scope in the menu before any click', () => {
    render(<ExportMenu domain="dtus" />);
    fireEvent.click(screen.getByTitle('Export (Ctrl+E)'));
    const scoped = screen.getAllByText(/Saved lens items only — DTU vault records are not included/);
    expect(scoped.length).toBe(2); // JSON + CSV options
    expect(screen.queryByText('Full DTU bundle')).toBeNull();
  });

  it('other lenses keep the generic descriptions', () => {
    render(<ExportMenu domain="healthcare" />);
    fireEvent.click(screen.getByTitle('Export (Ctrl+E)'));
    expect(screen.getByText('Full DTU bundle')).toBeTruthy();
    expect(screen.queryByText(/DTU vault records are not included/)).toBeNull();
  });
});
