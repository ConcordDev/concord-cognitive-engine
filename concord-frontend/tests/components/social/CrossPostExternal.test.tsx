import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: () => (props: React.PropsWithChildren<Record<string, unknown>>) =>
        React.createElement('div', props, props.children),
    },
  ),
  AnimatePresence: ({ children }: React.PropsWithChildren) =>
    React.createElement(React.Fragment, null, children),
}));

import { CrossPostExternal } from '@/components/social/CrossPostExternal';

describe('CrossPostExternal', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  const openSpy = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, { clipboard: { writeText } });
    window.open = openSpy;
  });
  afterEach(() => cleanup());

  it('renders the Share trigger collapsed by default', () => {
    render(<CrossPostExternal postId="p1" title="Hello" content="body" />);
    expect(screen.getByText('Share')).toBeInTheDocument();
    expect(screen.queryByText('X / Twitter')).toBeNull();
  });

  it('expands the dropdown listing all platforms', () => {
    render(<CrossPostExternal postId="p1" title="Hello" content="body" />);
    fireEvent.click(screen.getByText('Share'));
    expect(screen.getByText('X / Twitter')).toBeInTheDocument();
    expect(screen.getByText('Instagram Caption')).toBeInTheDocument();
    expect(screen.getByText('LinkedIn')).toBeInTheDocument();
    expect(screen.getByText('Copy Link')).toBeInTheDocument();
  });

  it('Copy Link writes the share URL to the clipboard', async () => {
    render(<CrossPostExternal postId="abc" title="Hello" content="body" />);
    fireEvent.click(screen.getByText('Share'));
    fireEvent.click(screen.getByText('Copy Link'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/post/abc')));
  });

  it('X share copies formatted text and opens an intent URL', async () => {
    render(
      <CrossPostExternal
        postId="p2"
        title="Big news"
        content="details"
        tags={['rust', 'ai']}
        authorName="Kai"
      />,
    );
    fireEvent.click(screen.getByText('Share'));
    fireEvent.click(screen.getByText('X / Twitter'));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining('twitter.com/intent/tweet'),
      '_blank',
      expect.any(String),
    );
  });

  it('Instagram share copies a caption but does not open a window', async () => {
    render(<CrossPostExternal postId="p3" title="Pic" content="cap" tags={['photo']} />);
    fireEvent.click(screen.getByText('Share'));
    fireEvent.click(screen.getByText('Instagram Caption'));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('toggles the dropdown closed on a second trigger click', () => {
    render(<CrossPostExternal postId="p4" title="t" content="c" />);
    fireEvent.click(screen.getByText('Share'));
    expect(screen.getByText('LinkedIn')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Share'));
    expect(screen.queryByText('LinkedIn')).toBeNull();
  });
});
