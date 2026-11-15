/**
 * FIX-aviation-007 (panel half) + FIX-aviation-008 — two silent surfaces:
 * the Action Result panel opened empty for a no-data Flight Summary, and
 * the records bench showed first-run "No flights yet / create your
 * first" copy when a status filter simply matched nothing.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import { ActionResultPanel } from '@/components/aviation/ActionResultPanel';
import { ArtifactBench } from '@/components/aviation/ArtifactBench';

describe('ActionResultPanel flight summary (FIX-aviation-007)', () => {
  it('a no-data summary renders its message instead of an empty panel', () => {
    render(
      <ActionResultPanel
        result={{ totalFlights: 0, totalHours: 0, averageDuration: 0, longestFlight: 0, totalFuelConsumed: 0, avgFuelPerHour: 0, message: 'No flight data available.' }}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId('flight-summary-result')).toBeTruthy();
    expect(screen.getByText('No flight data available.')).toBeTruthy();
  });
});

function benchProps(overrides: Record<string, unknown> = {}) {
  return {
    label: 'Flights',
    typeLabel: 'Flight',
    statuses: ['scheduled', 'completed'],
    items: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {},
    searchQuery: '',
    setSearchQuery: vi.fn(),
    statusFilter: '',
    setStatusFilter: vi.fn(),
    onNew: () => {},
    actionButtons: null,
    actionResult: null,
    onClearResult: () => {},
    showEditor: false,
    editingId: null,
    onCloseEditor: () => {},
    onSave: () => {},
    onDelete: () => {},
    editor: null,
    renderCard: () => null,
    ...overrides,
  } as unknown as React.ComponentProps<typeof ArtifactBench>;
}

describe('ArtifactBench empty states (FIX-aviation-008)', () => {
  it('a status filter with no matches says so and offers to clear it — not first-run copy', () => {
    const props = benchProps({ statusFilter: 'completed' });
    render(<ArtifactBench {...props} />);
    expect(screen.getByText('No flights match')).toBeTruthy();
    expect(screen.getByText(/Nothing on this bench is marked completed/)).toBeTruthy();
    expect(screen.queryByText('No flights yet')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(props.setStatusFilter).toHaveBeenCalledWith('');
    expect(props.setSearchQuery).toHaveBeenCalledWith('');
  });

  it('a search with no matches names the search text', () => {
    render(<ArtifactBench {...benchProps({ searchQuery: 'KPOU' })} />);
    expect(screen.getByText('No flights match')).toBeTruthy();
    expect(screen.getByText(/Nothing on this bench matches "KPOU"/)).toBeTruthy();
  });

  it('an unfiltered empty bench keeps the first-run state', () => {
    render(<ArtifactBench {...benchProps()} />);
    expect(screen.getByText('No flights yet')).toBeTruthy();
    expect(screen.getByText(/Create your first flight/)).toBeTruthy();
  });
});
