/**
 * GB-1539 / FIX-strategic-adds-002 — Track 7's contact + preference
 * graph is built. The panel renders the caller's follow network from
 * the existing social routes (profile + followers + following, the
 * FollowersPanel fetch shape): mutual / following / follower classes,
 * an SVG graph plus the same nodes as a list. With no connections the
 * ticket's second leg governs: an empty state that explains how the
 * graph fills in. Load failure is an error with a retry, never a
 * silent blank.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

vi.mock('lucide-react', async () => {
  const makeMockIcon = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }),
    );
    Icon.displayName = name;
    return Icon;
  };
  return { __esModule: true, Users: makeMockIcon('Users') };
});

import { ContactPreferenceGraph } from '@/components/strategic-adds/ContactPreferenceGraph';

function jsonResponse(body: unknown) {
  return Promise.resolve({ json: () => Promise.resolve(body) } as Response);
}

describe('ContactPreferenceGraph (FIX-strategic-adds-002)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function route(profile: unknown, followers: unknown, following: unknown) {
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/social/profile') return jsonResponse(profile);
      if (url.startsWith('/api/social/followers/')) return jsonResponse(followers);
      if (url.startsWith('/api/social/following/')) return jsonResponse(following);
      return jsonResponse({});
    });
  }

  it('renders mutual, following, and follower contacts with their classes', async () => {
    route(
      { userId: 'u_me' },
      { followers: [{ userId: 'u_mo', displayName: 'Mo Mutual' }, { userId: 'u_fa', displayName: 'Fa Follower' }] },
      { following: [{ userId: 'u_mo', displayName: 'Mo Mutual' }, { userId: 'u_gi', displayName: 'Gi Going' }] },
    );
    render(<ContactPreferenceGraph />);
    expect(await screen.findByText('Mo Mutual')).toBeTruthy();
    expect(screen.getByText('Fa Follower')).toBeTruthy();
    expect(screen.getByText('Gi Going')).toBeTruthy();
    expect(screen.getByText('Mutual')).toBeTruthy();
    expect(screen.getByText('Following')).toBeTruthy();
    expect(screen.getByText('Follows you')).toBeTruthy();
    expect(screen.getByRole('img', { name: /Network graph/ })).toBeTruthy();
  });

  it('an empty network explains how the graph fills in and links to Social', async () => {
    route({ userId: 'u_me' }, { followers: [] }, { following: [] });
    render(<ContactPreferenceGraph />);
    expect(await screen.findByText(/Your network graph is empty/)).toBeTruthy();
    expect(screen.getByText(/Follow a few people in Social/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Find people in Social/ }).getAttribute('href')).toBe('/lenses/social');
    expect(screen.queryByRole('img', { name: /Network graph/ })).toBeNull();
  });

  it('a failed load reads as an error with a working retry', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    render(<ContactPreferenceGraph />);
    expect(await screen.findByText(/couldn't load/)).toBeTruthy();
    route({ userId: 'u_me' }, { followers: [] }, { following: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/Your network graph is empty/)).toBeTruthy();
  });
});
