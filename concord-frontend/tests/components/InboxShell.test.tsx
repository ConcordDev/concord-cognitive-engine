import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Virtuoso renders through a windowing engine jsdom can't drive — replace
// with a plain map so itemContent (the real thread-row markup) still runs.
// Same shim pattern already used in tests/feed-lens-states.test.tsx.
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({
    data,
    itemContent,
  }: {
    data?: unknown[];
    itemContent: (index: number, item: unknown) => React.ReactNode;
  }) =>
    React.createElement(
      'div',
      { 'data-testid': 'virtuoso' },
      (data || []).map((d, i) => React.createElement('div', { key: i }, itemContent(i, d))),
    ),
}));

import { InboxShell, type InboxLabel, type InboxThread } from '@/components/message/InboxShell';

const labels: InboxLabel[] = [
  { id: 'inbox', label: 'Inbox', count: 3, icon: 'inbox' },
  { id: 'starred', label: 'Starred', count: 1, icon: 'starred' },
  { id: 'sent', label: 'Sent', icon: 'sent' },
];

const threads: InboxThread[] = [
  {
    id: 't1', from: 'Aria',  subject: 'Royalty cascade',
    snippet: 'Your style earned 12 CC...', timestamp: new Date().toISOString(), unread: true,
  },
  {
    id: 't2', from: 'Mira', subject: 'Co-author?',
    snippet: 'Want to take it from gen 2?', timestamp: new Date(Date.now() - 86400000).toISOString(),
    starred: true,
  },
];

describe('InboxShell', () => {
  it('renders all labels with their counts', () => {
    render(
      <InboxShell labels={labels} threads={threads} activeLabelId="inbox">
        <div />
      </InboxShell>
    );
    expect(screen.getByText('Inbox')).toBeInTheDocument();
    expect(screen.getByText('Starred')).toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('renders thread subjects + senders', () => {
    render(
      <InboxShell labels={labels} threads={threads} activeLabelId="inbox" activeThreadId="t1">
        <div />
      </InboxShell>
    );
    expect(screen.getByText('Royalty cascade')).toBeInTheDocument();
    expect(screen.getByText('Co-author?')).toBeInTheDocument();
    expect(screen.getByText('Aria')).toBeInTheDocument();
    expect(screen.getByText('Mira')).toBeInTheDocument();
  });

  it('calls onSelectLabel when a label is clicked', () => {
    const onSelectLabel = vi.fn();
    render(
      <InboxShell labels={labels} threads={threads} activeLabelId="inbox" onSelectLabel={onSelectLabel}>
        <div />
      </InboxShell>
    );
    fireEvent.click(screen.getByText('Starred'));
    expect(onSelectLabel).toHaveBeenCalledWith(expect.objectContaining({ id: 'starred' }));
  });

  it('calls onSelectThread when a thread row is clicked', () => {
    const onSelectThread = vi.fn();
    render(
      <InboxShell labels={labels} threads={threads} activeLabelId="inbox" onSelectThread={onSelectThread}>
        <div />
      </InboxShell>
    );
    fireEvent.click(screen.getByText('Royalty cascade'));
    expect(onSelectThread).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }));
  });

  it('renders the children reading pane', () => {
    render(
      <InboxShell labels={labels} threads={threads} activeLabelId="inbox" activeThreadId="t1">
        <div data-testid="reading-pane">Body of t1</div>
      </InboxShell>
    );
    expect(screen.getByTestId('reading-pane')).toBeInTheDocument();
  });

  // Regression coverage for a real bug fix: Reply/Forward/Archive used to
  // render unconditionally with no onClick at all (pure dead-click
  // scaffolding). Now they're opt-in — only render, and only fire, when
  // the caller supplies a real handler.
  describe('reading-pane header actions (opt-in, real bug fix)', () => {
    it('renders no header action row at all when no handlers are supplied', () => {
      render(
        <InboxShell labels={labels} threads={threads} activeLabelId="inbox" activeThreadId="t1">
          <div />
        </InboxShell>
      );
      expect(screen.queryByText('Reply')).not.toBeInTheDocument();
      expect(screen.queryByText('Forward')).not.toBeInTheDocument();
      expect(screen.queryByText('Archive')).not.toBeInTheDocument();
    });

    it('renders only the buttons whose handler was supplied, and calls them with the real active thread', () => {
      const onReply = vi.fn();
      const onForward = vi.fn();
      render(
        <InboxShell labels={labels} threads={threads} activeLabelId="inbox" activeThreadId="t1" onReply={onReply} onForward={onForward}>
          <div />
        </InboxShell>
      );
      expect(screen.queryByTestId('inbox-header-archive')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('inbox-header-reply'));
      expect(onReply).toHaveBeenCalledWith(expect.objectContaining({ id: 't1', from: 'Aria' }));

      fireEvent.click(screen.getByTestId('inbox-header-forward'));
      expect(onForward).toHaveBeenCalledWith(expect.objectContaining({ id: 't1', subject: 'Royalty cascade' }));
    });

    it('renders Archive when a real handler is supplied for it', () => {
      const onArchive = vi.fn();
      render(
        <InboxShell labels={labels} threads={threads} activeLabelId="inbox" activeThreadId="t2" onArchive={onArchive}>
          <div />
        </InboxShell>
      );
      fireEvent.click(screen.getByTestId('inbox-header-archive'));
      expect(onArchive).toHaveBeenCalledWith(expect.objectContaining({ id: 't2', from: 'Mira' }));
    });
  });
});
