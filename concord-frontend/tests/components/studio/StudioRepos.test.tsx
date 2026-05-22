import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { lucideMockFactory, renderWithClient } from './_helpers';

vi.mock('lucide-react', async (orig) => lucideMockFactory(orig as never));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({
  SaveAsDtuButton: (p: { title?: string }) => <button data-testid="save-dtu">{p.title || 'Save'}</button>,
}));

import { StudioRepos } from '@/components/studio/StudioRepos';

const REPOS = [
  { id: 1, full_name: 'acme/daw', html_url: 'http://x/1', description: 'A DAW', stargazers_count: 1200, forks_count: 30, language: 'Rust', license: { spdx_id: 'MIT' } },
  { id: 2, full_name: 'acme/synth', html_url: 'http://x/2', stargazers_count: 800, forks_count: 10 },
];

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('StudioRepos', () => {
  it('renders the repo list and aggregate stats on a successful fetch', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true, status: 200, json: () => Promise.resolve({ items: REPOS }),
    })) as never);
    renderWithClient(<StudioRepos />);
    await waitFor(() => expect(screen.getByText('acme/daw')).toBeInTheDocument());
    expect(screen.getByText('acme/synth')).toBeInTheDocument();
    expect(screen.getByText('2,000')).toBeInTheDocument(); // total stars
    expect(screen.getByText('Rust')).toBeInTheDocument();
  });

  it('shows the error banner when the GitHub fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: false, status: 503, json: () => Promise.resolve({}),
    })) as never);
    renderWithClient(<StudioRepos />);
    await waitFor(() => expect(screen.getByText('GitHub unreachable.')).toBeInTheDocument());
  });

  it('shows the empty state when no repos returned', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true, status: 200, json: () => Promise.resolve({ items: [] }),
    })) as never);
    renderWithClient(<StudioRepos />);
    await waitFor(() => expect(screen.getByText('No repos.')).toBeInTheDocument());
  });

  it('changes the topic select and refetches', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true, status: 200, json: () => Promise.resolve({ items: REPOS }),
    }));
    vi.stubGlobal('fetch', fetchMock as never);
    renderWithClient(<StudioRepos />);
    await waitFor(() => expect(screen.getByText('acme/daw')).toBeInTheDocument());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'midi' } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('topic:midi')));
  });

  it('renders the SaveAsDtuButton when repos are present', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true, status: 200, json: () => Promise.resolve({ items: REPOS }),
    })) as never);
    renderWithClient(<StudioRepos />);
    await waitFor(() => expect(screen.getByTestId('save-dtu')).toBeInTheDocument());
  });
});
