import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { AISearchBar } from '@/components/realestate/AISearchBar';

describe('AISearchBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });
  });

  it('renders header and disabled parse button when query empty', () => {
    render(<AISearchBar />);
    expect(screen.getByText('Conversational search')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Parse/ })).toBeDisabled();
  });

  it('does not call lensRun when submitting an empty query', () => {
    render(<AISearchBar />);
    fireEvent.submit(screen.getByPlaceholderText('Describe what you want…').closest('form')!);
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('parses a populated query and shows multiple parsed fields and tags', async () => {
    const onParsed = vi.fn();
    lensRun.mockResolvedValue({
      data: {
        ok: true,
        result: {
          filters: { minPrice: 300000, kinds: ['condo', 'townhouse'] },
          tags: ['garage', 'pool'],
          query: '3 bed condo',
          parsedFieldCount: 2,
        },
      },
    });
    render(<AISearchBar onParsed={onParsed} />);
    fireEvent.change(screen.getByPlaceholderText('Describe what you want…'), { target: { value: '3 bed condo' } });
    fireEvent.click(screen.getByRole('button', { name: /Parse/ }));
    expect(await screen.findByText(/Parsed → 2 fields/)).toBeInTheDocument();
    expect(screen.getByText('minPrice:')).toBeInTheDocument();
    expect(screen.getByText('condo, townhouse')).toBeInTheDocument();
    expect(screen.getByText('garage')).toBeInTheDocument();
    expect(screen.getByText('pool')).toBeInTheDocument();
    await waitFor(() => expect(onParsed).toHaveBeenCalled());
    expect(lensRun).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'parse-search-query', input: { query: '3 bed condo' } }),
    );
  });

  it('renders singular field label when parsedFieldCount is 1 and no tags', async () => {
    lensRun.mockResolvedValue({
      data: { ok: true, result: { filters: { city: 'Austin' }, tags: [], query: 'Austin', parsedFieldCount: 1 } },
    });
    render(<AISearchBar />);
    fireEvent.change(screen.getByPlaceholderText('Describe what you want…'), { target: { value: 'Austin' } });
    fireEvent.click(screen.getByRole('button', { name: /Parse/ }));
    expect(await screen.findByText(/Parsed → 1 field$/)).toBeInTheDocument();
    expect(screen.queryByText('tags:')).not.toBeInTheDocument();
  });

  it('does not render parsed block when result has no payload', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: undefined } });
    render(<AISearchBar />);
    fireEvent.change(screen.getByPlaceholderText('Describe what you want…'), { target: { value: 'xyz' } });
    fireEvent.click(screen.getByRole('button', { name: /Parse/ }));
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
    expect(screen.queryByText(/Parsed →/)).not.toBeInTheDocument();
  });

  it('tolerates a rejected parse request', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<AISearchBar />);
    fireEvent.change(screen.getByPlaceholderText('Describe what you want…'), { target: { value: 'q' } });
    fireEvent.click(screen.getByRole('button', { name: /Parse/ }));
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
    expect(screen.queryByText(/Parsed →/)).not.toBeInTheDocument();
  });

  it('trims whitespace-only input and skips the call', () => {
    render(<AISearchBar />);
    fireEvent.change(screen.getByPlaceholderText('Describe what you want…'), { target: { value: '   ' } });
    fireEvent.submit(screen.getByPlaceholderText('Describe what you want…').closest('form')!);
    expect(lensRun).not.toHaveBeenCalled();
  });
});
