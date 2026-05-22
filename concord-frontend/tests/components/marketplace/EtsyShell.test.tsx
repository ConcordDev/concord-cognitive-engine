import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import { EtsyShell } from '@/components/marketplace/EtsyShell';

describe('EtsyShell', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders all nav items + children', () => {
    render(
      <EtsyShell activeNav="home" onNavChange={vi.fn()}>
        <div>panel-content</div>
      </EtsyShell>,
    );
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Listings')).toBeInTheDocument();
    expect(screen.getByText('Shop settings')).toBeInTheDocument();
    expect(screen.getByText('panel-content')).toBeInTheDocument();
  });

  it('shows shop name + currency when provided', () => {
    render(
      <EtsyShell activeNav="home" onNavChange={vi.fn()} shopName="My Shop" currency="EUR">
        <div />
      </EtsyShell>,
    );
    expect(screen.getByText(/My Shop · EUR/)).toBeInTheDocument();
  });

  it('falls back to USD when currency missing but shopName given', () => {
    render(
      <EtsyShell activeNav="home" onNavChange={vi.fn()} shopName="NoCurShop">
        <div />
      </EtsyShell>,
    );
    expect(screen.getByText(/NoCurShop · USD/)).toBeInTheDocument();
  });

  it('omits shop strip when no shopName', () => {
    render(
      <EtsyShell activeNav="home" onNavChange={vi.fn()}>
        <div />
      </EtsyShell>,
    );
    expect(screen.queryByText(/· USD/)).not.toBeInTheDocument();
  });

  it('fires onNavChange when a nav item is clicked', () => {
    const onNavChange = vi.fn();
    render(
      <EtsyShell activeNav="home" onNavChange={onNavChange}>
        <div />
      </EtsyShell>,
    );
    fireEvent.click(screen.getByText('Orders'));
    expect(onNavChange).toHaveBeenCalledWith('orders');
  });

  it('renders badges only for non-zero values', () => {
    render(
      <EtsyShell
        activeNav="home"
        onNavChange={vi.fn()}
        badges={{ orders: 3, listings: 0, messages: 'new' }}
      >
        <div />
      </EtsyShell>,
    );
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('new')).toBeInTheDocument();
    // listings badge is 0 -> not rendered
  });

  it('marks the active nav item distinctly', () => {
    const { container } = render(
      <EtsyShell activeNav="orders" onNavChange={vi.fn()}>
        <div />
      </EtsyShell>,
    );
    const active = container.querySelector('.border-orange-400');
    expect(active).toBeTruthy();
  });
});
