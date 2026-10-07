import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.hoisted(() => ({ data: undefined as unknown, isLoading: false, isError: false, refetch: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => query }));
vi.mock('@/lib/api/client', () => ({ api: { get: vi.fn() } }));
vi.mock('@/components/meta/meta-shared', () => ({
  baseName: (path: string) => path.split('/').at(-1),
  cardVariants: {},
  tabContentVariants: {},
  StatCard: ({ label, value }: { label: string; value: number }) => <div>{label}: {value}</div>,
  LoadingSpinner: ({ message }: { message: string }) => <div>{message}</div>,
  EmptyState: ({ message }: { message: string }) => <div>{message}</div>,
}));

import { OverviewPanel } from '@/components/meta/OverviewPanel';

describe('Meta OverviewPanel', () => {
  beforeEach(() => {
    query.data = undefined;
    query.isLoading = false;
    query.isError = false;
    query.refetch.mockReset();
  });

  it('retries an inventory error', () => {
    query.isError = true;
    render(<OverviewPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(query.refetch).toHaveBeenCalled();
  });

  it('renders populated and empty inventory lists with pluralized imports', () => {
    query.data = {
      totalComponents: 2, totalLenses: 3, totalServerLibs: 4, totalRoutes: 5, orphanedCount: 1,
      largestFiles: [{ path: 'server/server.js', lineCount: 10 }],
      mostImportedComponents: [
        { path: 'components/One.tsx', usedByCount: 1 },
        { path: 'components/Many.tsx', usedByCount: 3 },
      ],
    };
    const { rerender } = render(<OverviewPanel />);
    expect(screen.getByText('server/server.js')).toBeInTheDocument();
    expect(screen.getByText(/1 lens/)).toBeInTheDocument();
    expect(screen.getByText(/3 lenses/)).toBeInTheDocument();

    query.data = { ...query.data, largestFiles: [], mostImportedComponents: [] };
    rerender(<OverviewPanel />);
    expect(screen.getByText('No file data available.')).toBeInTheDocument();
    expect(screen.getByText('No import data available.')).toBeInTheDocument();
  });
});
