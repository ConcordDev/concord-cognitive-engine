import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const apiPost = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/client', () => ({
  api: { post: apiPost },
}));

import { QuotablePanel } from '@/components/daily/QuotablePanel';

const quote = { id: 'q1', content: 'Stay hungry.', author: 'Steve Jobs', tags: ['wisdom'] };

function reply(data: Record<string, unknown>) {
  apiPost.mockResolvedValue({ data: { ok: true, quotes: [quote], ...data } });
}

describe('QuotablePanel provenance', () => {
  beforeEach(() => {
    apiPost.mockReset();
  });

  it('renders the real source from the reply, not a hardcoded Quotable footer', async () => {
    reply({ source: 'Quotable' });
    render(<QuotablePanel domain="daily" />);
    expect(await screen.findByText('Source: Quotable')).toBeInTheDocument();
    expect(screen.queryByText(/unavailable/)).not.toBeInTheDocument();
    expect(screen.queryByText(/filter not applied/)).not.toBeInTheDocument();
  });

  it('notes the fallback source when the reply is degraded', async () => {
    reply({ source: 'ZenQuotes', degraded: true, degradedReason: 'quotable_unreachable' });
    render(<QuotablePanel domain="daily" />);
    expect(
      await screen.findByText('Quotable is unavailable; showing a quote from ZenQuotes.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Source: ZenQuotes')).toBeInTheDocument();
  });

  it("notes Concord's built-in list when the local fallback answered", async () => {
    reply({ source: 'local', degraded: true, degradedReason: 'quotable_unreachable' });
    render(<QuotablePanel domain="daily" />);
    expect(
      await screen.findByText("Quotable is unavailable; showing a quote from Concord's built-in list."),
    ).toBeInTheDocument();
  });

  it('says the author/tag filter was not applied when filtersIgnored is non-empty', async () => {
    reply({ source: 'ZenQuotes', degraded: true, filtersIgnored: ['tag'] });
    render(<QuotablePanel domain="daily" tag="wisdom" />);
    expect(await screen.findByText('author/tag filter not applied')).toBeInTheDocument();
  });
});
