// Behavior test for PhilosophyCuration's cross-cutting library Search
// tab — the closure of docs/WAVE4_INVENTORY.md's "philosophy" gap
// (philosophy-search was registered + tested backend-side but had no
// UI caller). Covers: channel-result rendering, block-result rendering
// (with kind + excerpt + owning-channel lookup), the honest
// empty-query and no-results states, and the block-result deep-link
// into the Image Grid tab.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));

import { PhilosophyCuration } from '@/components/philosophy/PhilosophyCuration';

function mockBackend() {
  lensRun.mockImplementation(async (_domain: string, action: string, input: Record<string, unknown> = {}) => {
    if (action === 'channel-list') {
      return {
        data: {
          ok: true,
          result: {
            channels: [
              { id: 'ch_1', title: 'Free Will', description: 'On free will', blockCount: 1 },
              { id: 'ch_2', title: 'Ethics', description: 'Moral philosophy', blockCount: 1 },
            ],
          },
        },
      };
    }
    if (action === 'philosophy-search') {
      const q = String(input?.query || '').toLowerCase();
      if (q === 'free will') {
        return {
          data: {
            ok: true,
            result: {
              channels: [{ id: 'ch_1', title: 'Free Will', description: 'On free will', createdAt: '2026-01-01' }],
              blocks: [],
              count: 1,
            },
          },
        };
      }
      if (q === 'libertarianism') {
        return {
          data: {
            ok: true,
            result: {
              channels: [],
              blocks: [{
                id: 'bk_2', kind: 'quote',
                excerpt: 'Libertarianism about free will, filed under Ethics.',
                channelIds: ['ch_2'],
              }],
              count: 1,
            },
          },
        };
      }
      // Any other query (including the "no results" probe) — honest empty result.
      return { data: { ok: true, result: { channels: [], blocks: [], count: 0 } } };
    }
    if (action === 'block-grid') {
      const cid = String(input?.channelId || '');
      const content = cid === 'ch_2' ? 'Ethics-channel block content.' : 'Free-Will-channel block content.';
      return {
        data: {
          ok: true,
          result: {
            channelId: cid,
            blocks: [{ id: `bk_of_${cid}`, kind: 'text', content, imageUrl: null, source: null, channelCount: 1, createdAt: '2026-01-01' }],
            count: 1,
          },
        },
      };
    }
    return { data: { ok: true, result: {} } };
  });
}

async function openSearchTab() {
  render(<PhilosophyCuration />);
  await waitFor(() => expect(lensRun).toHaveBeenCalledWith('philosophy', 'channel-list', {}));
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  return screen.getByPlaceholderText('Search your library…');
}

async function search(input: HTMLElement, query: string) {
  fireEvent.change(input, { target: { value: query } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(lensRun).toHaveBeenCalledWith('philosophy', 'philosophy-search', { query }));
}

describe('PhilosophyCuration — Search tab', () => {
  beforeEach(() => {
    lensRun.mockReset();
    mockBackend();
  });

  it('shows an honest prompt before any query is submitted', async () => {
    await openSearchTab();
    expect(screen.getByText(/Type a query and press Enter/i)).toBeInTheDocument();
  });

  it('calls philosophy-search and renders a matching channel result', async () => {
    const input = await openSearchTab();
    await search(input, 'free will');
    expect(await screen.findByText('Channels (1)')).toBeInTheDocument();
    expect(screen.getByText('Free Will')).toBeInTheDocument();
    expect(screen.getByText('On free will')).toBeInTheDocument();
  });

  it('calls philosophy-search and renders a matching block result with kind + owning channel', async () => {
    const input = await openSearchTab();
    await search(input, 'libertarianism');
    expect(await screen.findByText('Blocks (1)')).toBeInTheDocument();
    expect(screen.getByText('Libertarianism about free will, filed under Ethics.')).toBeInTheDocument();
    expect(screen.getByText('quote')).toBeInTheDocument();
    // The block's channelIds is ['ch_2'] — the UI must resolve that id
    // to the real channel title via the channels already loaded from
    // channel-list, not just echo the raw id.
    expect(screen.getByText('in Ethics')).toBeInTheDocument();
  });

  it('renders an honest "no results" state for a query with zero matches (not a blank/broken screen)', async () => {
    const input = await openSearchTab();
    await search(input, 'nonexistent-topic-xyz');
    expect(await screen.findByText(/No results for/i)).toBeInTheDocument();
    expect(screen.getByText(/nonexistent-topic-xyz/)).toBeInTheDocument();
    expect(screen.queryByText(/Channels \(/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Blocks \(/)).not.toBeInTheDocument();
  });

  it('deep-links from a block result into the Image Grid tab, focused on its owning channel', async () => {
    render(<PhilosophyCuration />);
    // Land on the default Image Grid tab first and let it settle on its
    // default-selected channel (ch_1, the first from channel-list) —
    // proves what follows is a real override, not just an unraced default.
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('philosophy', 'block-grid', { channelId: 'ch_1' }));
    expect(await screen.findByText('Free-Will-channel block content.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const input = screen.getByPlaceholderText('Search your library…');
    await search(input, 'libertarianism');
    const blockResult = await screen.findByText('Libertarianism about free will, filed under Ethics.');

    fireEvent.click(blockResult);

    // The click must switch tabs to Image Grid AND override the
    // default channel selection with the block's own channel (ch_2) —
    // proving this is a real deep-link, not just a no-op tab switch.
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('philosophy', 'block-grid', { channelId: 'ch_2' }));
    expect(await screen.findByText('Ethics-channel block content.')).toBeInTheDocument();
    expect(screen.queryByText('Free-Will-channel block content.')).not.toBeInTheDocument();
  });
});
