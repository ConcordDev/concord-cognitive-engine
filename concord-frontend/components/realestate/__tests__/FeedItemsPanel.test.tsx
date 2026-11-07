/**
 * FeedItemsPanel — F4: the home-value feed's items are inspectable
 * and its source is named in standing copy. Review 5's first pass
 * found the feed "unverifiable by construction": a real Census ACS
 * ingestion whose items no surface listed and whose source no panel
 * named. These tests pin the panel's two halves of the repair.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FeedItemsPanel } from '../FeedItemsPanel';

const hoisted = vi.hoisted(() => ({ mode: 'items' as 'items' | 'empty' }));

vi.mock('@/lib/api/client', () => ({
  lensRun: async (domain: string, action: string) => {
    if (domain === 'realestate' && action === 'feed-items') {
      return {
        data: {
          ok: true,
          result: hoisted.mode === 'items'
            ? {
                items: [{ id: 'acs_homevalue_36_2023', title: 'Median home value: New York (2023)', state: 'New York', medianValue: 384100, year: 2023 }],
                source: 'US Census Bureau — American Community Survey 1-Year, variable B25077_001E (median owner-occupied home value by state)',
              }
            : { items: [], source: 'US Census Bureau — American Community Survey 1-Year, variable B25077_001E (median owner-occupied home value by state)' },
        },
      };
    }
    return { data: { ok: true, result: {} } };
  },
}));

describe('FeedItemsPanel — F4', () => {
  beforeEach(() => { hoisted.mode = 'items'; });

  it('lists the ingested values with the Census source named in standing copy', async () => {
    render(<FeedItemsPanel />);
    expect(await screen.findByText('New York')).toBeTruthy();
    expect(screen.getByText(/\$384,100/)).toBeTruthy();
    expect(screen.getByText(/Census Bureau/)).toBeTruthy();
  });

  it('before any pull it says so, and still names the source', async () => {
    hoisted.mode = 'empty';
    render(<FeedItemsPanel />);
    expect(await screen.findByText(/Nothing ingested yet/)).toBeTruthy();
    expect(screen.getByText(/Census Bureau/)).toBeTruthy();
  });
});
