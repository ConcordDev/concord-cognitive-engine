/**
 * FiguresNotebook — notable-person/biography tracking rewired onto the real
 * `history.figure-*` macro family (server/domains/history.js), replacing the
 * old disconnected `useLensData` generic notebook store.
 *
 * Covers: rendering real figures from figure-list, the create flow calling
 * figure-add, a genuine PARTIAL update via figure-update (only the changed
 * field is sent), the delete flow calling figure-delete, and the real
 * event-linkage list rendering both a validated (`found:true`) and a
 * since-deleted (`found:false`) linked event honestly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';

// DataTable's keyboard-focus effect calls scrollIntoView, which jsdom doesn't implement.
Element.prototype.scrollIntoView = vi.fn();

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { FiguresNotebook } from '@/components/history/FiguresNotebook';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}
function fail(error: string) {
  return Promise.resolve({ data: { ok: false, result: null, error } });
}

const ADA = {
  id: 'fig_ada', name: 'Ada Lovelace', role: 'mathematician',
  birthYear: 1815, deathYear: 1852, region: 'europe', bio: 'Wrote the first algorithm.',
  linkedEventCount: 1,
  linkedEvents: [
    { timelineId: 'tl_1', eventId: 'ev_1', found: true, timelineTitle: 'Computing History', eventTitle: 'Analytical Engine notes published', eventYear: 1843 },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const NAPOLEON = {
  id: 'fig_napoleon', name: 'Napoleon Bonaparte', role: 'emperor',
  birthYear: 1769, deathYear: 1821, region: 'europe', bio: '',
  linkedEventCount: 1,
  linkedEvents: [
    { timelineId: 'tl_gone', eventId: 'ev_gone', found: false },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('FiguresNotebook — real history.figure-* backend', () => {
  beforeEach(() => {
    lensRun.mockReset();
    lensRun.mockImplementation((_domain: string, action: string, input: Record<string, unknown>) => {
      switch (action) {
        case 'figure-list':
          return ok({ figures: [ADA, NAPOLEON], count: 2 });
        case 'figure-add':
          return ok({ figure: { ...ADA, id: 'fig_new', name: input.name, linkedEvents: [], linkedEventCount: 0 } });
        case 'figure-update':
          return ok({ figure: { ...ADA, ...input } });
        case 'figure-delete':
          return ok({ deleted: input.id });
        case 'figure-unlink-event':
          return ok({ figure: { ...ADA, linkedEvents: [], linkedEventCount: 0 }, removed: true });
        case 'figure-link-event':
          return ok({ figure: { ...ADA, linkedEvents: [...ADA.linkedEvents, { timelineId: input.timelineId, eventId: input.eventId, found: true, timelineTitle: 'New Timeline', eventTitle: 'New Event', eventYear: 1900 }], linkedEventCount: 2 } });
        case 'timeline-list':
          return ok({ timelines: [{ id: 'tl_2', title: 'Napoleonic Wars', eventCount: 1 }], count: 1 });
        case 'timeline-detail':
          return ok({ timeline: { id: 'tl_2', events: [{ id: 'ev_2', title: 'Battle of Waterloo', year: 1815, dateLabel: '1815' }] } });
        default:
          return fail(`unhandled action: ${action}`);
      }
    });
  });

  it('renders real figures from figure-list (not a client-only mock)', async () => {
    render(React.createElement(FiguresNotebook));
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy());
    expect(screen.getByText('Napoleon Bonaparte')).toBeTruthy();
    expect(lensRun).toHaveBeenCalledWith('history', 'figure-list', {});
  });

  it('the disclosure banner claims real backend persistence, not the old "not backend-validated" framing', async () => {
    render(React.createElement(FiguresNotebook));
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy());
    expect(screen.getByText(/persist server-side per-user/)).toBeTruthy();
    expect(screen.queryByText(/not backend-validated or scored/)).toBeNull();
  });

  it('create flow calls figure-add with the entered fields', async () => {
    render(React.createElement(FiguresNotebook));
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy());

    fireEvent.click(screen.getByText('New figure'));
    fireEvent.change(screen.getByPlaceholderText('Name…'), { target: { value: 'Marie Curie' } });
    fireEvent.change(screen.getByPlaceholderText('Role (e.g. philosopher)'), { target: { value: 'chemist' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('history', 'figure-add', expect.objectContaining({
        name: 'Marie Curie', role: 'chemist',
      }));
    });
  });

  it('edit flow sends a genuine PARTIAL update (only the changed bio field, not a full-object-replace)', async () => {
    render(React.createElement(FiguresNotebook));
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy());

    fireEvent.click(screen.getByText('Ada Lovelace'));
    const bioBox = await screen.findByLabelText(/Bio \(autosaves on blur\)/);
    fireEvent.change(bioBox, { target: { value: 'Wrote the first published algorithm for the Analytical Engine.' } });
    fireEvent.blur(bioBox);

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('history', 'figure-update', {
        id: 'fig_ada',
        bio: 'Wrote the first published algorithm for the Analytical Engine.',
      });
    });
    // Must NOT resend name/role/birthYear/deathYear/region — a partial update only.
    const call = lensRun.mock.calls.find((c) => c[1] === 'figure-update');
    expect(call?.[2]).not.toHaveProperty('name');
    expect(call?.[2]).not.toHaveProperty('birthYear');
  });

  it('delete flow calls figure-delete for the selected figure', async () => {
    render(React.createElement(FiguresNotebook));
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy());

    fireEvent.click(screen.getByText('Ada Lovelace'));
    const deleteBtn = await screen.findByLabelText('Delete Ada Lovelace');
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('history', 'figure-delete', { id: 'fig_ada' });
    });
  });

  it('renders a validated linked event (found:true) with real title/year/timeline', async () => {
    render(React.createElement(FiguresNotebook));
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy());
    fireEvent.click(screen.getByText('Ada Lovelace'));

    await waitFor(() => {
      expect(screen.getByText('Analytical Engine notes published')).toBeTruthy();
      expect(screen.getByText('1843')).toBeTruthy();
    });
  });

  it('renders a since-deleted linked event honestly as found:false, never as if it were still valid', async () => {
    render(React.createElement(FiguresNotebook));
    await waitFor(() => expect(screen.getByText('Napoleon Bonaparte')).toBeTruthy());
    fireEvent.click(screen.getByText('Napoleon Bonaparte'));

    await waitFor(() => {
      expect(screen.getByText(/no longer exists/)).toBeTruthy();
    });
  });

  it('unlink action calls figure-unlink-event with the figure/timeline/event ids', async () => {
    render(React.createElement(FiguresNotebook));
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy());
    fireEvent.click(screen.getByText('Ada Lovelace'));

    const unlinkBtn = await screen.findByLabelText('Unlink event');
    fireEvent.click(unlinkBtn);

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('history', 'figure-unlink-event', {
        figureId: 'fig_ada', timelineId: 'tl_1', eventId: 'ev_1',
      });
    });
  });

  it('link picker sources timelines/events from real timeline-list + timeline-detail calls, then links via figure-link-event', async () => {
    render(React.createElement(FiguresNotebook));
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeTruthy());
    fireEvent.click(screen.getByText('Ada Lovelace'));

    fireEvent.click(await screen.findByText('Link an event'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('history', 'timeline-list', {}));

    const timelineSelect = await screen.findByDisplayValue('select timeline…');
    fireEvent.change(timelineSelect, { target: { value: 'tl_2' } });

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('history', 'timeline-detail', { id: 'tl_2' });
    });

    const eventSelect = await screen.findByDisplayValue('select event…');
    fireEvent.change(eventSelect, { target: { value: 'ev_2' } });

    const linkPanel = eventSelect.closest('div')!.parentElement!;
    fireEvent.click(within(linkPanel).getByText('Link'));

    await waitFor(() => {
      expect(lensRun).toHaveBeenCalledWith('history', 'figure-link-event', {
        figureId: 'fig_ada', timelineId: 'tl_2', eventId: 'ev_2',
      });
    });
  });
});
