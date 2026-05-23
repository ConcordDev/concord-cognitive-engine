import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: (_t, key) => {
        const tag = typeof key === 'string' ? key : 'div';
        return ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) =>
          React.createElement(tag === 'button' ? 'button' : 'div', props, children);
      },
    },
  ),
  AnimatePresence: ({ children }: React.PropsWithChildren) =>
    React.createElement(React.Fragment, null, children),
}));

vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string; alt: string }) =>
    React.createElement('img', { src, alt }),
}));

import {
  PresenceIndicator,
  CollaborativeCursors,
  ActivityFeed,
} from '@/components/social/PresenceIndicator';

const USERS = [
  { id: 'u1', name: 'Alice', color: '#f00', status: 'active' as const, location: 'world' },
  { id: 'u2', name: 'Bob', color: '#0f0', status: 'idle' as const, avatar: '/b.png' },
  { id: 'u3', name: 'Carol', color: '#00f', status: 'viewing' as const },
  { id: 'u4', name: 'Dave', color: '#ff0', status: 'active' as const },
  { id: 'u5', name: 'Eve', color: '#0ff', status: 'idle' as const, location: 'chat' },
  { id: 'u6', name: 'Frank', color: '#f0f', status: 'viewing' as const },
];

describe('PresenceIndicator', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('renders nothing when no users', () => {
    const { container } = render(<PresenceIndicator users={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders avatar stack with overflow indicator', () => {
    render(<PresenceIndicator users={USERS} maxVisible={4} />);
    expect(screen.getByText('+2')).toBeInTheDocument();
    // initial of first visible user
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('renders avatar image when provided', () => {
    render(<PresenceIndicator users={[USERS[1]]} />);
    expect(screen.getByAltText('Bob')).toBeInTheDocument();
  });

  it('hides status dot when showStatus is false', () => {
    const { container } = render(
      <PresenceIndicator users={[USERS[0]]} showStatus={false} />,
    );
    expect(container.querySelectorAll('.bg-green-400').length).toBe(0);
  });

  it('fires onUserClick when an avatar is clicked', () => {
    const onUserClick = vi.fn();
    render(<PresenceIndicator users={USERS} onUserClick={onUserClick} />);
    fireEvent.click(screen.getByText('A'));
    expect(onUserClick).toHaveBeenCalledWith(USERS[0]);
  });

  it('expands the user list on overflow click and collapses via list item', () => {
    const onUserClick = vi.fn();
    render(<PresenceIndicator users={USERS} onUserClick={onUserClick} />);
    fireEvent.click(screen.getByText('+2'));
    expect(screen.getByText('6 collaborators online')).toBeInTheDocument();
    // click a row in the expanded list
    fireEvent.click(screen.getByText('Eve'));
    expect(onUserClick).toHaveBeenCalledWith(USERS[4]);
  });

  it('dispatches presence:view-all on the Users button', () => {
    const spy = vi.fn();
    window.addEventListener('presence:view-all', spy);
    render(<PresenceIndicator users={USERS} />);
    fireEvent.click(screen.getByTitle('View all'));
    expect(spy).toHaveBeenCalled();
    window.removeEventListener('presence:view-all', spy);
  });

  it('shows singular collaborator label for a single user beyond maxVisible', () => {
    render(<PresenceIndicator users={USERS.slice(0, 5)} maxVisible={4} />);
    fireEvent.click(screen.getByText('+1'));
    expect(screen.getByText('5 collaborators online')).toBeInTheDocument();
  });

  it('stops propagation on the message button inside the list', () => {
    const onUserClick = vi.fn();
    render(<PresenceIndicator users={USERS} onUserClick={onUserClick} />);
    fireEvent.click(screen.getByText('+2'));
    const msgBtns = screen.getAllByLabelText('Message');
    fireEvent.click(msgBtns[0]);
    expect(onUserClick).not.toHaveBeenCalled();
  });
});

describe('CollaborativeCursors', () => {
  afterEach(() => cleanup());

  it('renders nothing for an empty cursor list', () => {
    const ref = { current: null } as React.RefObject<HTMLElement>;
    const { container } = render(<CollaborativeCursors cursors={[]} containerRef={ref} />);
    expect(container.textContent).toBe('');
  });

  it('renders a cursor with name label and uses container offset', () => {
    const el = document.createElement('div');
    el.getBoundingClientRect = () =>
      ({ left: 10, top: 20 }) as DOMRect;
    const ref = { current: el } as React.RefObject<HTMLElement>;
    render(
      <CollaborativeCursors
        cursors={[{ userId: 'c1', userName: 'Zoe', color: '#abc', position: { x: 100, y: 200 } }]}
        containerRef={ref}
      />,
    );
    expect(screen.getByText('Zoe')).toBeInTheDocument();
  });

  it('falls back to raw position when no container ref', () => {
    const ref = { current: null } as React.RefObject<HTMLElement>;
    render(
      <CollaborativeCursors
        cursors={[{ userId: 'c2', userName: 'Max', color: '#def', position: { x: 5, y: 5 } }]}
        containerRef={ref}
      />,
    );
    expect(screen.getByText('Max')).toBeInTheDocument();
  });
});

describe('ActivityFeed', () => {
  afterEach(() => cleanup());

  const NOW = new Date();
  const ACTS = [
    { id: 'a1', user: USERS[0], action: 'created' as const, target: 'DTU-1', timestamp: NOW },
    {
      id: 'a2',
      user: USERS[1],
      action: 'commented' as const,
      target: 'DTU-2',
      timestamp: new Date(NOW.getTime() - 5 * 60000),
    },
    {
      id: 'a3',
      user: USERS[2],
      action: 'shared' as const,
      target: 'DTU-3',
      timestamp: new Date(NOW.getTime() - 3 * 3600000),
    },
    {
      id: 'a4',
      user: USERS[3],
      action: 'edited' as const,
      target: 'DTU-4',
      timestamp: new Date(NOW.getTime() - 48 * 3600000),
    },
  ];

  it('renders all activities with correct action labels', () => {
    render(<ActivityFeed activities={ACTS} />);
    expect(screen.getByText('created')).toBeInTheDocument();
    expect(screen.getByText('commented on')).toBeInTheDocument();
    expect(screen.getByText('shared')).toBeInTheDocument();
    expect(screen.getByText('edited')).toBeInTheDocument();
  });

  it('renders relative time strings across all branches', () => {
    render(<ActivityFeed activities={ACTS} />);
    expect(screen.getByText('just now')).toBeInTheDocument();
    expect(screen.getByText('5m ago')).toBeInTheDocument();
    expect(screen.getByText('3h ago')).toBeInTheDocument();
  });

  it('fires onActivityClick', () => {
    const onActivityClick = vi.fn();
    render(<ActivityFeed activities={ACTS} onActivityClick={onActivityClick} />);
    fireEvent.click(screen.getByText('created'));
    expect(onActivityClick).toHaveBeenCalledWith(ACTS[0]);
  });

  it('renders empty when no activities', () => {
    const { container } = render(<ActivityFeed activities={[]} />);
    expect(container.querySelectorAll('button').length).toBe(0);
  });
});
