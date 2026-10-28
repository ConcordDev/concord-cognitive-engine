/**
 * Schema page northstar greeting.
 *
 * The Schema concept (docs/lens-northstar/18) opens on the serif
 * headline "The shape of the data, Ramaj" above the schema cards.
 * This pins the page header carrying it with the signed-in username.
 * The workbench/repos surfaces are mocked away — the greeting lives
 * in the page's own header.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { username: 'ramaj' } }),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/schema/SchemaWorkbench', () => ({
  SchemaWorkbench: () => null,
  SCHEMA_TOOL_TABS: [],
}));
vi.mock('@/components/schema/SchemaRepos', () => ({ SchemaRepos: () => null }));

import SchemaLensPage from '@/app/lenses/schema/page';

describe('Schema page greeting', () => {
  it('opens on the concept headline addressed to the signed-in user', () => {
    render(<SchemaLensPage />);
    const greeting = screen.getByTestId('schema-greeting');
    expect(greeting.textContent).toBe('The shape of the data, ramaj');
    expect(greeting.className).toContain('font-vault');
  });
});
