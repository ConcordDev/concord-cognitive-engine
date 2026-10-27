import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const apiPost = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api/client', () => ({
  api: { post: apiPost },
}));

import { QuotablePanel } from '@/components/daily/QuotablePanel';

const quote = { id: 'q1', content: 'Stay hungry.', author: 'Steve Jobs', tags: ['wisdom'] };

/**
 * Mirrors the real /api/lens/run envelope: the body is { ok, result } and the
 * macro's own reply (quotes, source, degraded...) sits under `result`.
 */
function reply(result: Record<string, unknown>) {
  apiPost.mockResolvedValue({ data: { ok: true, result: { ok: true, quotes: [quote], ...result } } });
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

describe('QuotablePanel envelope unwrap', () => {
  beforeEach(() => {
    apiPost.mockReset();
  });

  it('renders the quote text and author from result.quotes', async () => {
    reply({ source: 'ZenQuotes' });
    render(<QuotablePanel domain="daily" />);
    expect(await screen.findByText(/Stay hungry\./)).toBeInTheDocument();
    expect(screen.getByText('— Steve Jobs')).toBeInTheDocument();
    expect(screen.getByText('Source: ZenQuotes')).toBeInTheDocument();
  });

  it('shows the reason when the envelope is ok:false', async () => {
    apiPost.mockResolvedValue({ data: { ok: false, reason: 'rate_limited' } });
    render(<QuotablePanel domain="daily" />);
    expect(await screen.findByText(/Quotable unreachable \(rate_limited\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Stay hungry/)).not.toBeInTheDocument();
  });

  it('shows the reason when the macro result is ok:false', async () => {
    apiPost.mockResolvedValue({ data: { ok: true, result: { ok: false, reason: 'quotable_unreachable' } } });
    render(<QuotablePanel domain="daily" />);
    expect(await screen.findByText(/Quotable unreachable \(quotable_unreachable\)/)).toBeInTheDocument();
  });

  it('falls back to fetch_failed when the request throws', async () => {
    apiPost.mockRejectedValue(new Error('network down'));
    render(<QuotablePanel domain="daily" />);
    expect(await screen.findByText(/Quotable unreachable \(fetch_failed\)/)).toBeInTheDocument();
  });

  it('renders quotes with null ids (ZenQuotes/local) without a key collision', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const nullIdQuotes = [
      { id: null, content: 'First line.', author: 'A', tags: [] },
      { id: null, content: 'Second line.', author: 'B', tags: [] },
    ];
    apiPost.mockResolvedValue({
      data: { ok: true, result: { ok: true, source: 'ZenQuotes', quotes: nullIdQuotes } },
    });
    render(<QuotablePanel domain="daily" />);
    expect(await screen.findByText(/First line\./)).toBeInTheDocument();
    expect(screen.getByText(/Second line\./)).toBeInTheDocument();
    const keyWarnings = errorSpy.mock.calls.filter((args) => String(args[0]).includes('same key'));
    expect(keyWarnings).toHaveLength(0);
    errorSpy.mockRestore();
  });
});
