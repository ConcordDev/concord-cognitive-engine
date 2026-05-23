import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const apiGet = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { get: (...a: unknown[]) => apiGet(...a) },
}));

import { MentionAutocomplete } from '@/components/social/MentionAutocomplete';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const RESULTS = [
  { userId: 'u1', username: 'alice', displayName: 'Alice A', isFollowing: true },
  { userId: 'u2', username: 'alan', displayName: 'alan', isFollower: true },
  { userId: 'u3', username: 'amy', avatar: '/amy.png' },
];

/** Controlled host that wires the render-prop into a real textarea. */
function Host({ initial = '' }: { initial?: string }) {
  const [text, setText] = React.useState(initial);
  const [mentions, setMentions] = React.useState<string[]>([]);
  return (
    <div>
      <MentionAutocomplete
        value={text}
        onChange={setText}
        mentionedUsers={mentions}
        onMentionedUsersChange={setMentions}
        renderInput={(props) => <textarea aria-label="composer" {...props} />}
      />
      <span data-testid="value">{text}</span>
      <span data-testid="mentions">{mentions.join(',')}</span>
    </div>
  );
}

describe('MentionAutocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiGet.mockResolvedValue({ data: { ok: true, results: RESULTS } });
  });
  afterEach(() => cleanup());

  it('renders the input without a dropdown when no @ token', () => {
    wrap(<Host />);
    const ta = screen.getByLabelText('composer');
    fireEvent.change(ta, { target: { value: 'hello world', selectionStart: 11 } });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('opens the dropdown and lists matching users when @ token typed', async () => {
    wrap(<Host />);
    const ta = screen.getByLabelText('composer') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '@al', selectionStart: 3 } });
    expect(await screen.findByText('@alice', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('mention-search?q=al'));
  });

  it('inserts a username on click and records the mentioned userId', async () => {
    wrap(<Host />);
    const ta = screen.getByLabelText('composer') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'hi @al', selectionStart: 6 } });
    const option = await screen.findByText('@alice', {}, { timeout: 3000 });
    fireEvent.mouseDown(option.closest('button')!);
    await waitFor(() =>
      expect(screen.getByTestId('value').textContent).toBe('hi @alice '),
    );
    expect(screen.getByTestId('mentions').textContent).toBe('u1');
  });

  it('navigates with ArrowDown/ArrowUp and inserts on Enter', async () => {
    wrap(<Host />);
    const ta = screen.getByLabelText('composer') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '@a', selectionStart: 2 } });
    await screen.findByText('@alice', {}, { timeout: 3000 });
    fireEvent.keyDown(ta, { key: 'ArrowDown' });
    fireEvent.keyDown(ta, { key: 'ArrowUp' });
    fireEvent.keyDown(ta, { key: 'Enter' });
    await waitFor(() =>
      expect(screen.getByTestId('value').textContent).toContain('@alice'),
    );
  });

  it('closes the dropdown on Escape', async () => {
    wrap(<Host />);
    const ta = screen.getByLabelText('composer') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '@a', selectionStart: 2 } });
    await screen.findByText('@alice', {}, { timeout: 3000 });
    fireEvent.keyDown(ta, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });

  it('shows the no-match empty state when results are empty', async () => {
    apiGet.mockResolvedValue({ data: { ok: true, results: [] } });
    wrap(<Host />);
    const ta = screen.getByLabelText('composer') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '@zzz', selectionStart: 4 } });
    expect(
      await screen.findByText(/No users match/, {}, { timeout: 3000 }),
    ).toBeInTheDocument();
  });

  it('tolerates an API error and shows no-match', async () => {
    apiGet.mockRejectedValue(new Error('down'));
    wrap(<Host />);
    const ta = screen.getByLabelText('composer') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '@qq', selectionStart: 3 } });
    expect(
      await screen.findByText(/No users match/, {}, { timeout: 3000 }),
    ).toBeInTheDocument();
  });

  it('does not open a dropdown for an email-like @ (preceded by non-space)', () => {
    wrap(<Host />);
    const ta = screen.getByLabelText('composer') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'mail@x', selectionStart: 6 } });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('handleSelect with no caret falls back to value length without opening', () => {
    wrap(<Host initial="plain text" />);
    const ta = screen.getByLabelText('composer') as HTMLTextAreaElement;
    // No @ token anywhere → onSelect detects no active query.
    fireEvent.select(ta, { target: { selectionStart: null } });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('clamps highlight index when results shrink between queries', async () => {
    apiGet.mockResolvedValueOnce({ data: { ok: true, results: RESULTS } });
    wrap(<Host />);
    const ta = screen.getByLabelText('composer') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: '@a', selectionStart: 2 } });
    await screen.findByText('@alice', {}, { timeout: 3000 });
    fireEvent.keyDown(ta, { key: 'ArrowDown' });
    fireEvent.keyDown(ta, { key: 'ArrowDown' });
    // shrink to a single result
    apiGet.mockResolvedValue({ data: { ok: true, results: [RESULTS[0]] } });
    fireEvent.change(ta, { target: { value: '@al', selectionStart: 3 } });
    await waitFor(
      () => expect(screen.getAllByRole('option')).toHaveLength(1),
      { timeout: 3000 },
    );
  });
});
