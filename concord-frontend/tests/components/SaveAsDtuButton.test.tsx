import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const create = vi.fn();
const addToast = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiHelpers: { dtus: { create: (...args: unknown[]) => create(...args) } },
}));

vi.mock('@/store/ui', () => ({
  useUIStore: (sel: (s: unknown) => unknown) => sel({ addToast }),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_, tag: string) => (props: Record<string, unknown> & { children?: React.ReactNode }) => {
      // strip framer-motion-only props that React doesn't know
      const { initial: _i, animate: _a, exit: _e, transition: _t, layoutId: _l, ...rest } = props as Record<string, unknown>;
      void _i; void _a; void _e; void _t; void _l;
      return React.createElement(tag, rest, props.children);
    },
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

vi.mock('lucide-react', async (importOriginal) => {
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

import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

function renderWithQuery(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe('SaveAsDtuButton', () => {
  beforeEach(() => {
    create.mockReset();
    addToast.mockReset();
  });

  it('renders labeled pill in default mode', () => {
    renderWithQuery(
      <SaveAsDtuButton
        apiSource="openfda"
        title="Aspirin — FDA Label"
        content="Aspirin is an NSAID."
      />
    );
    expect(screen.getByRole('button', { name: /Save as DTU/i })).toBeInTheDocument();
    expect(screen.getByText('Save as DTU')).toBeInTheDocument();
  });

  it('renders icon-only in compact mode', () => {
    renderWithQuery(
      <SaveAsDtuButton
        apiSource="openfda"
        title="X"
        content="Y"
        compact
      />
    );
    expect(screen.queryByText('Save as DTU')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Save as DTU')).toBeInTheDocument();
  });

  it('saves immediately when confirm=false (one-tap save)', async () => {
    create.mockResolvedValue({ data: { id: 'dtu-new-1' } });
    const onSaved = vi.fn();
    renderWithQuery(
      <SaveAsDtuButton
        apiSource="noaa-tides"
        apiUrl="https://api.tidesandcurrents.noaa.gov/x"
        title="Tide forecast Boston"
        content="High 4.2ft 09:15"
        extraTags={['ocean', 'tides']}
        rawData={{ height: 4.2, when: '09:15' }}
        confirm={false}
        onSaved={onSaved}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Save as DTU/i }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    const arg = create.mock.calls[0][0];
    expect(arg.source).toBe('noaa-tides');
    expect(arg.title).toBe('Tide forecast Boston');
    expect(arg.tags).toEqual(expect.arrayContaining(['real-data', 'noaa-tides', 'ocean', 'tides']));
    expect(arg.meta.apiProvider).toBe('noaa-tides');
    expect(arg.meta.apiUrl).toBe('https://api.tidesandcurrents.noaa.gov/x');
    expect(arg.meta.rawSnapshot).toContain('"height":4.2');
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('dtu-new-1'));
  });

  it('opens confirm modal when confirm=true (default) and saves with edited title', async () => {
    create.mockResolvedValue({ data: { id: 'dtu-new-2' } });
    renderWithQuery(
      <SaveAsDtuButton
        apiSource="courtlistener"
        title="Brown v. Board"
        content="347 U.S. 483"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Save as DTU/i }));
    const titleInput = await screen.findByDisplayValue('Brown v. Board');
    fireEvent.change(titleInput, { target: { value: 'Brown v. Board (1954) — Notes' } });
    fireEvent.click(screen.getByRole('button', { name: /Save DTU/ }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(create.mock.calls[0][0].title).toBe('Brown v. Board (1954) — Notes');
    expect(create.mock.calls[0][0].source).toBe('courtlistener');
  });

  it('shows "Saved" state after success and disables', async () => {
    create.mockResolvedValue({ data: { id: 'dtu-x' } });
    renderWithQuery(
      <SaveAsDtuButton apiSource="foo" title="T" content="C" confirm={false} />
    );
    fireEvent.click(screen.getByRole('button', { name: /Save as DTU/i }));
    await waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Saved as DTU/i })).toBeDisabled();
  });

  it('toasts error on failure', async () => {
    create.mockRejectedValue(new Error('boom'));
    renderWithQuery(
      <SaveAsDtuButton apiSource="foo" title="T" content="C" confirm={false} />
    );
    fireEvent.click(screen.getByRole('button', { name: /Save as DTU/i }));
    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }))
    );
  });

  it('truncates oversized rawData snapshots', async () => {
    create.mockResolvedValue({ data: { id: 'dtu-snap' } });
    const big = { items: new Array(2000).fill({ a: 'aaaaaaaaaaaaaaaaaaaa' }) };
    renderWithQuery(
      <SaveAsDtuButton apiSource="bulk" title="T" content="C" rawData={big} confirm={false} />
    );
    fireEvent.click(screen.getByRole('button', { name: /Save as DTU/i }));
    await waitFor(() => expect(create).toHaveBeenCalled());
    const snap = create.mock.calls[0][0].meta.rawSnapshot;
    expect(snap.length).toBeLessThanOrEqual(8100);
    expect(snap.endsWith('…[truncated]')).toBe(true);
  });
});
