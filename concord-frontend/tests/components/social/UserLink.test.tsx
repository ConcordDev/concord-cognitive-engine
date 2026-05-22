import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// next/link → simple anchor in tests
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode; [k: string]: unknown }) =>
    React.createElement('a', { href, ...rest }, children),
}));

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn().mockResolvedValue({ data: { ok: true, following: [] } }), post: vi.fn() },
}));

import { UserLink } from '@/components/social/UserLink';

function withQuery(node: React.ReactElement, qc: QueryClient) {
  return React.createElement(QueryClientProvider, { client: qc }, node);
}

describe('UserLink', () => {
  let qc: QueryClient;
  beforeEach(() => { qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); });
  afterEach(() => { cleanup(); qc.clear(); });

  it('routes to /profile/:username when username is given', () => {
    const { container } = render(withQuery(
      React.createElement(UserLink, { username: 'alice', displayName: 'Alice' }),
      qc,
    ));
    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe('/profile/alice');
  });

  it('falls back to /profile/:userId when only userId given', () => {
    const { container } = render(withQuery(
      React.createElement(UserLink, { userId: 'u_abc123' }),
      qc,
    ));
    const link = container.querySelector('a');
    expect(link!.getAttribute('href')).toBe('/profile/u_abc123');
  });

  it('renders a plain span when neither identifier present', () => {
    const { container } = render(withQuery(
      React.createElement(UserLink, { displayName: 'Anon' }),
      qc,
    ));
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('span')).not.toBeNull();
  });

  it('renders the @prefix when supplied', () => {
    const { container } = render(withQuery(
      React.createElement(UserLink, { username: 'kai', prefix: '@' }),
      qc,
    ));
    expect(container.textContent).toContain('@kai');
  });
});
