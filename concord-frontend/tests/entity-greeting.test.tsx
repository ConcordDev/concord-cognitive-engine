/**
 * Entity page northstar greeting.
 *
 * The Entities concept (docs/lens-northstar/20) opens on the serif
 * headline "Who is in the graph, Ramaj" above the entity list. This
 * pins the page header carrying it with the signed-in username. The
 * registry/workbench panels are mocked away — the greeting lives in
 * the page's own header.
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
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/entity/SwarmRegistryPanel', () => ({ SwarmRegistryPanel: () => null }));
vi.mock('@/components/entity/MindsPanel', () => ({ MindsPanel: () => null }));
vi.mock('@/components/entity/KnowledgeGraphWorkbench', () => ({ KnowledgeGraphWorkbench: () => null }));
vi.mock('@/components/entity/WikidataSearch', () => ({ WikidataSearch: () => null }));
vi.mock('@/components/entity/AgentStatusPanel', () => ({ AgentStatusPanel: () => null }));

import EntityLensPage from '@/app/lenses/entity/page';

describe('Entity page greeting', () => {
  it('opens on the concept headline addressed to the signed-in user', () => {
    render(<EntityLensPage />);
    const greeting = screen.getByTestId('entity-greeting');
    expect(greeting.textContent).toBe('Who is in the graph, ramaj');
    expect(greeting.className).toContain('font-vault');
  });
});
