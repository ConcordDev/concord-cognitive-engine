import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkspaceTabs, splitTabs, type WorkspaceTab } from './WorkspaceTabs';

const TABS: WorkspaceTab[] = [
  { id: 'chat', label: 'Chat', path: '/lenses/chat' },
  { id: 'threads', label: 'Threads', path: '/lenses/threads' },
  { id: 'forum', label: 'Forum', path: '/lenses/forum' },
  { id: 'daily', label: 'Daily', path: '/lenses/daily' },
  { id: 'governance', label: 'Governance', path: '/lenses/governance' },
  { id: 'anonymous', label: 'Anonymous', path: '/lenses/anonymous' },
  { id: 'voice', label: 'Voice', path: '/lenses/voice' },
  { id: 'feed', label: 'Feed', path: '/lenses/feed' },
  { id: 'news', label: 'News', path: '/lenses/news' },
];

describe('splitTabs', () => {
  it('caps the strip and puts the rest in overflow', () => {
    const { visible, overflow } = splitTabs(TABS, '/lenses/chat', 4);
    expect(visible.map((t) => t.id)).toEqual(['chat', 'threads', 'forum', 'daily']);
    expect(overflow).toHaveLength(5);
  });
  it('always swaps the active tab into the visible set', () => {
    const { visible, overflow } = splitTabs(TABS, '/lenses/voice', 4);
    expect(visible.map((t) => t.id)).toContain('voice');
    expect(overflow.map((t) => t.id)).not.toContain('voice');
    expect(visible).toHaveLength(4);
  });
  it('promotes a remembered overflow tab without evicting the active one', () => {
    const { visible } = splitTabs(TABS, '/lenses/news', 4, 'feed');
    const ids = visible.map((t) => t.id);
    expect(ids).toContain('news');
    expect(ids).toContain('feed');
    expect(ids).toContain('chat'); // the core tab is never evicted
    expect(visible).toHaveLength(4);
  });
  it('is a no-op without maxVisible or when the strip fits', () => {
    expect(splitTabs(TABS, '/lenses/chat').overflow).toHaveLength(0);
    expect(splitTabs(TABS.slice(0, 3), '/lenses/chat', 4).overflow).toHaveLength(0);
  });
});

describe('WorkspaceTabs overflow menu', () => {
  it('shows at most 4 tabs plus a More menu holding the rest', () => {
    render(<WorkspaceTabs tabs={TABS} activePath="/lenses/chat" label="Chat workspace navigation" maxVisible={4} />);
    expect(screen.getByText('Chat')).toBeTruthy();
    expect(screen.queryByText('Voice')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /More/ }));
    expect(screen.getByText('Voice')).toBeTruthy();
    expect(screen.getByText('News')).toBeTruthy();
  });
  it('renders every tab and no More button when maxVisible is not set', () => {
    render(<WorkspaceTabs tabs={TABS} activePath="/lenses/chat" label="Chat workspace navigation" />);
    expect(screen.getByText('News')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /More/ })).toBeNull();
  });
});
