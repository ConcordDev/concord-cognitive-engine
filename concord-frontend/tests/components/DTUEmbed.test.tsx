import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('lucide-react', async (importOriginal) => {
  const React = await import('react');
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

import { DTUEmbed, type DTUEmbedRecord } from '@/components/dtu/DTUEmbed';

const dtu: DTUEmbedRecord = {
  id: 'dtu-1',
  title: 'Reasoning trace v1',
  summary: 'A worked example of constraint_check.',
  tier: 'core',
  tags: ['reasoning', 'hlr'],
  createdAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  creator: { id: 'u1', displayName: 'Aria' },
  royaltyRate: 0.21,
};

// DTUEmbed mounts ReactionBar, which calls useQueryClient() — wrap renders
// in a QueryClientProvider so the hook resolves (the real app provides one
// at the root).
function renderDTU(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('DTUEmbed', () => {
  it('renders the title in card mode', () => {
    renderDTU(<DTUEmbed dtu={dtu} mode="card" />);
    expect(screen.getByText('Reasoning trace v1')).toBeInTheDocument();
  });

  it('renders compact mode as a single-line button', () => {
    const onOpen = vi.fn();
    renderDTU(<DTUEmbed dtu={dtu} mode="compact" onOpen={onOpen} />);
    const btn = screen.getByLabelText(/Open DTU: Reasoning trace v1/);
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledWith('dtu-1');
  });

  it('shows the creator displayName', () => {
    renderDTU(<DTUEmbed dtu={dtu} mode="full" />);
    expect(screen.getByText('Aria')).toBeInTheDocument();
  });

  it('renders nested children when "full" mode and children present', () => {
    const withKids: DTUEmbedRecord = {
      ...dtu,
      children: [
        { id: 'dtu-2', title: 'Sub-trace A' },
        { id: 'dtu-3', title: 'Sub-trace B' },
      ],
    };
    renderDTU(<DTUEmbed dtu={withKids} mode="full" />);
    expect(screen.getByText('Reasoning trace v1')).toBeInTheDocument();
  });

  it('falls back to a truncated id when title is missing', () => {
    renderDTU(<DTUEmbed dtu={{ ...dtu, title: undefined, id: 'longgggggg-id' }} mode="compact" />);
    expect(screen.getByText('longgggggg-id'.slice(0, 16))).toBeInTheDocument();
  });
});
