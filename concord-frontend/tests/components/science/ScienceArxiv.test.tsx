import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';


vi.mock('@/components/dtu/SaveAsDtuButton', () => ({
  SaveAsDtuButton: (props: Record<string, unknown>) =>
    React.createElement('button', { 'data-testid': 'save-dtu', 'data-title': props.title }, 'Save'),
}));

import { ScienceArxiv } from '@/components/science/ScienceArxiv';

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.0001</id>
    <title>A   Quantum   Paper</title>
    <summary>Some    long summary here</summary>
    <author><name>Alice Smith</name></author>
    <author><name>Bob Jones</name></author>
    <published>2024-01-15T00:00:00Z</published>
    <link rel="alternate" href="http://arxiv.org/abs/2401.0001"/>
    <category term="physics"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2401.0002</id>
    <title>Second Paper</title>
    <summary>Other summary</summary>
    <published>2024-01-10T00:00:00Z</published>
  </entry>
</feed>`;

function renderArxiv() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ScienceArxiv /></QueryClientProvider>);
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('ScienceArxiv', () => {
  it('renders header and pulling state initially', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    renderArxiv();
    expect(screen.getByText('Real-world science papers')).toBeInTheDocument();
    expect(screen.getByText(/Pulling/)).toBeInTheDocument();
  });

  it('renders papers on a successful fetch (populated path)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => ATOM })));
    renderArxiv();
    await waitFor(() => expect(screen.getByText('A Quantum Paper')).toBeInTheDocument(), { timeout: 15000 });
    // 2 papers counted
    expect(screen.getByText('2')).toBeInTheDocument();
    // newest date (appears both in the stat row and the paper list)
    expect(screen.getAllByText('2024-01-15').length).toBeGreaterThan(0);
    // save button visible when list populated
    expect(screen.getByTestId('save-dtu')).toBeInTheDocument();
  });

  it('shows error banner when arxiv unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => '' })));
    renderArxiv();
    await waitFor(() => expect(screen.getByText('arXiv unreachable.')).toBeInTheDocument(), { timeout: 15000 });
  });

  it('shows empty state when feed has no entries', async () => {
    const empty = '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => empty })));
    renderArxiv();
    await waitFor(() => expect(screen.getByText('No papers.')).toBeInTheDocument(), { timeout: 15000 });
    // newest fallback dash
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('changes category via select and re-fetches', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, text: async () => ATOM }));
    vi.stubGlobal('fetch', fetchMock);
    renderArxiv();
    await waitFor(() => expect(screen.getByText('A Quantum Paper')).toBeInTheDocument(), { timeout: 15000 });
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'math' } });
    await waitFor(() => {
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('cat:math'))).toBe(true);
    }, { timeout: 15000 });
  });
});
