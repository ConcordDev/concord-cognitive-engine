/**
 * FIX-household-005 — the household editor's numeric fields (Servings,
 * Prep, Minutes, Points, Est. Cost, Amount, Weight) accepted negative
 * values with no validation message: -5 stored and submitted silently.
 * The save now refuses a negative (or non-finite) value for those fields
 * and names the field; the inputs also carry min={0}.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const createSpy = vi.fn(async () => ({}));
const updateSpy = vi.fn(async () => ({}));

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: [], isLoading: false, isError: false, error: null,
    refetch: vi.fn(), create: createSpy, update: updateSpy, remove: vi.fn(),
  }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({ useRunArtifact: () => vi.fn(async () => ({})) }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => ({}) }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useRealtimeLens', () => ({ useRealtimeLens: () => ({ isLive: false, lastUpdated: null }) }));
vi.mock('@/components/lens/NorthStarFrame', () => ({
  NorthStarFrame: (props: {
    tabs: { id: string; label: string }[]; activeTab: string; onTab: (id: string) => void;
    cta?: { label: string; onClick: () => void }; children: React.ReactNode;
  }) => (
    <div>
      {props.tabs.map((t) => (
        <button key={t.id} onClick={() => props.onTab(t.id)}>{t.label}</button>
      ))}
      {props.cta && <button onClick={props.cta.onClick}>{props.cta.label}</button>}
      {props.children}
    </div>
  ),
}));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/lens/DraftedTextarea', () => ({
  DraftedTextarea: (p: { onValueChange: (v: string) => void }) => (
    <textarea onChange={(e) => p.onValueChange(e.target.value)} />
  ),
}));
vi.mock('@/components/household/BarcodeLookup', () => ({ BarcodeLookup: () => null }));
vi.mock('@/components/household/HouseholdActionPanel', () => ({ HouseholdActionPanel: () => null }));
vi.mock('@/components/household/ChoreRotation', () => ({ ChoreRotation: () => null }));
vi.mock('@/components/household/ChoreBoard', () => ({ ChoreBoard: () => null }));
vi.mock('@/components/household/FamilyCalendar', () => ({ FamilyCalendar: () => null }));
vi.mock('@/components/household/MealPlanner', () => ({ MealPlanner: () => null }));
vi.mock('@/components/household/AllowanceTracker', () => ({ AllowanceTracker: () => null }));
vi.mock('@/components/household/MemberNotifications', () => ({ MemberNotifications: () => null }));
vi.mock('@/components/household/SharedShoppingLists', () => ({ SharedShoppingLists: () => null }));
vi.mock('@/components/household/RecurringTemplates', () => ({ RecurringTemplates: () => null }));
vi.mock('@/components/household/ExpenseSplitter', () => ({ ExpenseSplitter: () => null }));
vi.mock('@/components/panel-polish', () => ({ PipingProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('framer-motion', () => {
  const ProxyDiv = new Proxy({}, { get: () => (p: Record<string, unknown>) => <div {...p} /> });
  return { motion: ProxyDiv };
});

import { HouseholdHome } from '@/components/household/HouseholdHome';

function openMealEditor() {
  fireEvent.click(screen.getByRole('button', { name: 'Meals' }));
  fireEvent.click(screen.getByRole('button', { name: 'Plan a meal' }));
}

describe('FIX-household-005 — negative numeric fields refused with the field named', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('a negative Servings refuses the save and names the field; a valid value saves', async () => {
    render(<HouseholdHome />);
    openMealEditor();
    fireEvent.change(screen.getByPlaceholderText('Title...'), { target: { value: 'Soup night' } });
    const servings = screen.getByText('Servings').parentElement!.querySelector('input') as HTMLInputElement;
    expect(servings.min).toBe('0');
    fireEvent.change(servings, { target: { value: '-3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Servings can't be negative");
    expect(createSpy).not.toHaveBeenCalled();
    fireEvent.change(servings, { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
  });
});
