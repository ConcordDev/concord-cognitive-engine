/**
 * PatentSearch — advanced multi-field boolean query builder.
 *
 * Closes docs/lens-specs/law-capability-map.md's "Combined multi-field
 * boolean query builder" gap: `law.uspto-patent-search` previously accepted
 * exactly one `field` at a time. This test pins the frontend half — the new
 * opt-in "Advanced" builder UI assembles `params.filters` + `params.combinator`
 * correctly while the default single-field quick search stays untouched.
 *
 * `useMacroDispatchFeedback` is mocked directly (see
 * tests/mentorship-lens-states.test.tsx for the same convention) so these
 * tests assert exactly what params the component dispatches, without a real
 * network/macro round trip. `SaveAsDtuButton` is stubbed because it pulls in
 * react-query + a portal-rendered modal that's irrelevant to this component's
 * own logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

type Status = 'idle' | 'dispatched' | 'running' | 'done' | 'error';
const hookState: { status: Status; result: Record<string, unknown> | null; error: string | null } = {
  status: 'idle', result: null, error: null,
};
const dispatchSpy = vi.fn(() => Promise.resolve(null));

vi.mock('@/hooks/useMacroDispatchFeedback', () => ({
  useMacroDispatchFeedback: () => ({
    status: hookState.status,
    runId: null,
    domain: 'law',
    action: 'uspto-patent-search',
    result: hookState.result,
    error: hookState.error,
    ms: null,
    stage: null,
    dispatch: dispatchSpy,
    reset: vi.fn(),
  }),
}));

vi.mock('@/components/dtu/SaveAsDtuButton', () => ({
  SaveAsDtuButton: () => React.createElement('button', { 'data-testid': 'save-dtu' }, 'Save'),
}));

import { PatentSearch } from '@/components/law/PatentSearch';

describe('PatentSearch — simple quick search (default, unchanged)', () => {
  beforeEach(() => {
    dispatchSpy.mockClear();
    hookState.status = 'idle';
    hookState.result = null;
    hookState.error = null;
  });

  it('dispatches { query, field, limit } — no filters/combinator keys — matching the pre-existing single-field contract', () => {
    render(React.createElement(PatentSearch));
    const input = screen.getByPlaceholderText(/neural network training/i);
    fireEvent.change(input, { target: { value: 'quantum computing' } });
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledWith('law', 'uspto-patent-search', {
      query: 'quantum computing',
      field: 'title',
      limit: 25,
    });
  });

  it('switching the field radio changes the dispatched field', () => {
    render(React.createElement(PatentSearch));
    fireEvent.change(screen.getByPlaceholderText(/neural network training/i), { target: { value: 'Jane Doe' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Inventor' }));
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

    expect(dispatchSpy).toHaveBeenCalledWith('law', 'uspto-patent-search', {
      query: 'Jane Doe',
      field: 'inventor',
      limit: 25,
    });
  });

  it('the Advanced builder is not shown until toggled on', () => {
    render(React.createElement(PatentSearch));
    expect(screen.queryByLabelText(/advanced multi-field query builder/i)).toBeNull();
  });
});

describe('PatentSearch — advanced multi-field boolean query builder', () => {
  beforeEach(() => {
    dispatchSpy.mockClear();
    hookState.status = 'idle';
    hookState.result = null;
    hookState.error = null;
  });

  function openAdvanced() {
    render(React.createElement(PatentSearch));
    fireEvent.click(screen.getByRole('button', { name: /advanced/i }));
  }

  it('toggling Advanced hides the simple search row and shows the filter builder', () => {
    openAdvanced();
    expect(screen.queryByPlaceholderText(/neural network training/i)).toBeNull();
    expect(screen.getByLabelText(/advanced multi-field query builder/i)).toBeTruthy();
  });

  it('assembles params.filters + params.combinator:"and" (default) from two filter rows', () => {
    openAdvanced();

    const fieldSelects = screen.getAllByLabelText(/^Filter \d+ field$/i) as HTMLSelectElement[];
    const valueInputs = screen.getAllByLabelText(/^Filter \d+ value$/i) as HTMLInputElement[];
    expect(fieldSelects.length).toBe(2);
    expect(valueInputs.length).toBe(2);

    fireEvent.change(fieldSelects[0], { target: { value: 'title' } });
    fireEvent.change(valueInputs[0], { target: { value: 'quantum computing' } });
    fireEvent.change(fieldSelects[1], { target: { value: 'assignee' } });
    fireEvent.change(valueInputs[1], { target: { value: 'IBM' } });

    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect(dispatchSpy).toHaveBeenCalledWith('law', 'uspto-patent-search', {
      filters: [
        { field: 'title', value: 'quantum computing' },
        { field: 'assignee', value: 'IBM' },
      ],
      combinator: 'and',
      limit: 25,
    });
  });

  it('toggling the OR combinator changes the dispatched combinator', () => {
    openAdvanced();
    const fieldSelects = screen.getAllByLabelText(/^Filter \d+ field$/i) as HTMLSelectElement[];
    const valueInputs = screen.getAllByLabelText(/^Filter \d+ value$/i) as HTMLInputElement[];
    fireEvent.change(fieldSelects[0], { target: { value: 'inventor' } });
    fireEvent.change(valueInputs[0], { target: { value: 'Doe' } });
    fireEvent.change(fieldSelects[1], { target: { value: 'assignee' } });
    fireEvent.change(valueInputs[1], { target: { value: 'Acme Corp' } });

    fireEvent.click(screen.getByRole('radio', { name: 'or' }));
    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

    expect(dispatchSpy).toHaveBeenCalledWith('law', 'uspto-patent-search', {
      filters: [
        { field: 'inventor', value: 'Doe' },
        { field: 'assignee', value: 'Acme Corp' },
      ],
      combinator: 'or',
      limit: 25,
    });
  });

  it('"Add filter" appends a row, and empty rows are dropped from the dispatched filters', () => {
    openAdvanced();
    fireEvent.click(screen.getByRole('button', { name: /add filter/i }));

    const fieldSelects = screen.getAllByLabelText(/^Filter \d+ field$/i) as HTMLSelectElement[];
    const valueInputs = screen.getAllByLabelText(/^Filter \d+ value$/i) as HTMLInputElement[];
    expect(valueInputs.length).toBe(3);

    // Only fill the first row; leave rows 2 and 3 blank.
    fireEvent.change(fieldSelects[0], { target: { value: 'abstract' } });
    fireEvent.change(valueInputs[0], { target: { value: 'neural interface' } });

    fireEvent.click(screen.getByRole('button', { name: /^search$/i }));

    expect(dispatchSpy).toHaveBeenCalledWith('law', 'uspto-patent-search', {
      filters: [{ field: 'abstract', value: 'neural interface' }],
      combinator: 'and',
      limit: 25,
    });
  });

  it('removing a filter row drops it from the builder', () => {
    openAdvanced();
    const removeButtons = screen.getAllByLabelText(/^Remove filter \d+$/i);
    expect(removeButtons.length).toBe(2);
    fireEvent.click(removeButtons[1]);
    expect(screen.getAllByLabelText(/^Filter \d+ value$/i).length).toBe(1);
  });

  it('the Search button is disabled when every filter row is empty', () => {
    openAdvanced();
    const searchBtn = screen.getByRole('button', { name: /^search$/i });
    expect(searchBtn).toBeDisabled();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});
