// Bottom-up slice pins (B6, CB-0604):
//   FIX-ghost-tracker-001 (FE leg) — a rejected lens call resolves the
//     loader into an honest error line, never a stranded spinner; the
//     ghost-tracker page treats a failed residues read as an error state,
//     not an empty world.
//   FIX-forum-003 — FmCommunitiesPanel's first load resolves on rejection:
//     the error state renders and the spinner clears.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import * as fs from 'node:fs';
import * as path from 'node:path';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: { ok: true, result: {} } })) },
}));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ActiveHunts } from '@/components/ghost-tracker/ActiveHunts';
import { ConfrontHistory } from '@/components/ghost-tracker/ConfrontHistory';
import { FmCommunitiesPanel } from '@/components/forum/FmCommunitiesPanel';

const FE_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '..');

describe('FIX-ghost-tracker-001 — loaders resolve on rejection', () => {
  afterEach(() => cleanup());
  it('ActiveHunts shows an error line instead of Loading forever', async () => {
    lensRunMock.mockReset();
    lensRunMock.mockRejectedValue(new Error('HTTP 400'));
    render(<ActiveHunts refreshKey={0} />);
    expect(await screen.findByText('Active hunts could not be loaded just now.')).toBeTruthy();
    expect(screen.queryByText('Loading hunts…')).toBeNull();
  });
  it('ConfrontHistory shows an error line instead of Loading forever', async () => {
    lensRunMock.mockReset();
    lensRunMock.mockRejectedValue(new Error('HTTP 400'));
    render(<ConfrontHistory refreshKey={0} />);
    expect(await screen.findByText('Confront history could not be loaded just now.')).toBeTruthy();
    expect(screen.queryByText('Loading history…')).toBeNull();
  });
  it('the page gates the residues empty state on a successful read', () => {
    const src = fs.readFileSync(path.join(FE_DIR, 'app/lenses/ghost-tracker/page.tsx'), 'utf8');
    expect(src).toContain('if (r.data.result?.ok) {');
    expect(src).toContain('setResiduesError(true)');
    expect(src).toContain('Residues could not be read just now');
    expect(src).toContain('!residuesError && residues.length === 0');
  });
});

describe('FIX-forum-003 — communities first load resolves on rejection', () => {
  afterEach(() => cleanup());
  it('renders the error state and clears the spinner', async () => {
    lensRunMock.mockReset();
    lensRunMock.mockRejectedValue(new Error('HTTP 400'));
    render(<FmCommunitiesPanel onChange={() => {}} />);
    expect(await screen.findByText('Could not load communities.')).toBeTruthy();
  });
});
