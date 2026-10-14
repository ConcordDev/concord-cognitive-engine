/**
 * F2 — Found kingdom stays disabled for whitespace-only name.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import React from 'react';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ ok: true, kingdoms: [] }),
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

vi.mock('@/components/lens/DraftedTextarea', () => ({
  DraftedTextarea: (props: { onValueChange?: (v: string) => void; className?: string }) => (
    <textarea
      data-testid="polygon-advanced"
      className={props.className}
      onChange={(e) => props.onValueChange?.(e.target.value)}
    />
  ),
}));

vi.mock('@/components/kingdoms/RegionPolygonEditor', () => ({
  RegionPolygonEditor: () => <div data-testid="visual-editor" />,
}));

import { KingdomCreatePanel } from '@/components/kingdoms/KingdomCreatePanel';

describe('kingdoms F2 create trim gate', () => {
  it('whitespace-only name keeps Found kingdom disabled and posts nothing', async () => {
    render(<KingdomCreatePanel onCreated={() => {}} />);
    const name = await screen.findByPlaceholderText(/Kingdom of/i);
    fireEvent.change(name, { target: { value: '   ' } });
    const submit = screen.getByRole('button', { name: /found kingdom/i });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    const posts = fetchMock.mock.calls.filter(
      (c) => c[0] === '/api/kingdoms' && c[1]?.method === 'POST',
    );
    expect(posts).toHaveLength(0);
  });
});
