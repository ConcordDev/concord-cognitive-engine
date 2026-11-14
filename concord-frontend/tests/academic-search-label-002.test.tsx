// FIX-research-002 — the academic search surface is search-only (no
// synthesized-answer action exists in the research lens), but nothing
// told the member: a natural-language question silently degraded to
// keyword-matched papers and read as a failed answer. The panel now
// carries the ticket's accepted 'search only' label up front.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ data: { ok: true, result: { results: [] }, error: null } })),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: {},
}));

import { AcademicSearchPanel } from '@/components/research/AcademicSearchPanel';

describe('AcademicSearchPanel search-only label (FIX-research-002)', () => {
  it('states plainly that it searches and does not answer questions', async () => {
    render(<AcademicSearchPanel />);
    expect(await screen.findByText(/Search only — this finds papers by keyword and does not answer questions/)).toBeTruthy();
  });
});
