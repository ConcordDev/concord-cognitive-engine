import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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
});
