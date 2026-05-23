import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('next/image', () => ({
  default: ({ alt, ...rest }: { alt?: string; [k: string]: unknown }) =>
    React.createElement('img', { alt, ...rest }),
}));
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: () => (props: React.PropsWithChildren<Record<string, unknown>>) =>
        React.createElement('div', props, props.children),
    },
  ),
}));

import { SocialCommerceTag } from '@/components/social/SocialCommerceTag';

const LISTING = { listingId: 'L1', title: 'Brass Ring', price: 12, imageUrl: 'http://x/i.png' };

describe('SocialCommerceTag', () => {
  afterEach(() => cleanup());

  it('renders title, price and default CC currency', () => {
    render(<SocialCommerceTag listing={{ listingId: 'L2', title: 'Wool Hat', price: 8 }} />);
    expect(screen.getByText('Wool Hat')).toBeInTheDocument();
    expect(screen.getByText(/8 CC/)).toBeInTheDocument();
  });

  it('renders the listing image when imageUrl present', () => {
    const { container } = render(<SocialCommerceTag listing={LISTING} />);
    expect(container.querySelector('img')).not.toBeNull();
  });

  it('renders the placeholder icon when no imageUrl', () => {
    const { container } = render(
      <SocialCommerceTag listing={{ listingId: 'L3', title: 'No Image', price: 1 }} />,
    );
    expect(container.querySelector('img')).toBeNull();
  });

  it('shows earnings badge only when earnings > 0', () => {
    const { unmount } = render(<SocialCommerceTag listing={LISTING} earnings={50} />);
    expect(screen.getByText(/Earned/)).toBeInTheDocument();
    unmount();
    render(<SocialCommerceTag listing={LISTING} earnings={0} />);
    expect(screen.queryByText(/Earned/)).toBeNull();
  });

  it('uses a custom currency when provided', () => {
    render(
      <SocialCommerceTag
        listing={{ listingId: 'L4', title: 'USD item', price: 5, currency: 'USD' }}
      />,
    );
    expect(screen.getByText(/5 USD/)).toBeInTheDocument();
  });

  it('Buy click calls onBuy with the listingId', () => {
    const onBuy = vi.fn();
    render(<SocialCommerceTag listing={LISTING} onBuy={onBuy} />);
    fireEvent.click(screen.getByText('Buy'));
    expect(onBuy).toHaveBeenCalledWith('L1');
  });

  it('Buy click falls back to onNavigateToListing when no onBuy', () => {
    const onNav = vi.fn();
    render(<SocialCommerceTag listing={LISTING} onNavigateToListing={onNav} />);
    fireEvent.click(screen.getByText('Buy'));
    expect(onNav).toHaveBeenCalledWith('L1');
  });

  it('title button calls onNavigateToListing', () => {
    const onNav = vi.fn();
    render(<SocialCommerceTag listing={LISTING} onNavigateToListing={onNav} />);
    fireEvent.click(screen.getByText('Brass Ring'));
    expect(onNav).toHaveBeenCalledWith('L1');
  });
});
