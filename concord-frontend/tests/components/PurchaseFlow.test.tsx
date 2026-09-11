import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useSearchParams: vi.fn(() => ({
    get: vi.fn(() => null),
  })),
}));

// Mock framer-motion
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: import('react').ReactNode }) => children,
  motion: {
    // eslint-disable-next-line react/display-name
    div: React.forwardRef(({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>, ref: React.Ref<HTMLDivElement>) =>
      React.createElement('div', { ...props, ref }, children)
    ),
    // eslint-disable-next-line react/display-name
    button: React.forwardRef(({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>, ref: React.Ref<HTMLButtonElement>) =>
      React.createElement('button', { ...props, ref }, children)
    ),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => React.createElement(React.Fragment, null, children),
}));

// Mock the api client
vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

// Mock design-system
vi.mock('@/lib/design-system', () => ({
  ds: {
    heading2: 'heading2-class',
    heading3: 'heading3-class',
    textMuted: 'text-muted-class',
    label: 'label-class',
    input: 'input-class',
    btnPrimary: 'btn-primary-class',
    btnSecondary: 'btn-secondary-class',
    btnBase: 'btn-base-class',
  },
}));

import { PurchaseFlow } from '@/components/wallet/PurchaseFlow';
import { api } from '@/lib/api/client';

const mockedApi = api as unknown as {
  post: ReturnType<typeof vi.fn>;
};

describe('PurchaseFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.post.mockResolvedValue({
      data: { ok: true, checkoutUrl: 'https://checkout.stripe.com/test' },
    });
    // Prevent actual location change
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { href: '' },
    });
  });

  it('renders preset amount buttons', () => {
    render(<PurchaseFlow />);
    expect(screen.getByText('10')).toBeDefined();
    expect(screen.getByText('50')).toBeDefined();
    expect(screen.getByText('100')).toBeDefined();
    expect(screen.getByText('500')).toBeDefined();
    expect(screen.getByText('1,000')).toBeDefined();
  });

  it('preset amount selection highlights the selected amount', () => {
    render(<PurchaseFlow />);
    const button100 = screen.getByText('100').closest('button')!;
    fireEvent.click(button100);

    // Active button should have highlighted style
    expect(button100.className).toContain('neon-blue');
  });

  it('custom amount input works', () => {
    render(<PurchaseFlow />);

    const customInput = screen.getByPlaceholderText(/\d+\s*-\s*[\d,]+/) as HTMLInputElement;
    fireEvent.change(customInput, { target: { value: '250' } });
    expect(customInput.value).toBe('250');
  });

  it('custom amount input validation rejects non-numeric', () => {
    render(<PurchaseFlow />);

    const customInput = screen.getByPlaceholderText(/\d+\s*-\s*[\d,]+/) as HTMLInputElement;
    fireEvent.change(customInput, { target: { value: 'abc' } });
    expect(customInput.value).toBe('');
  });

  it('USD equivalent display for preset', () => {
    render(<PurchaseFlow />);
    // Each preset shows USD equivalent (1:1 peg)
    expect(screen.getByText('$10')).toBeDefined();
    expect(screen.getByText('$50')).toBeDefined();
    expect(screen.getByText('$100')).toBeDefined();
    expect(screen.getByText('$500')).toBeDefined();
    expect(screen.getByText('$1,000')).toBeDefined();
  });

  it('shows 1 CC = $1.00 USD label', () => {
    render(<PurchaseFlow />);
    expect(screen.getByText(/1 CC = \$1\.00/)).toBeDefined();
  });

  it('buy button calls Stripe checkout API', async () => {
    render(<PurchaseFlow />);

    // Select a preset amount
    fireEvent.click(screen.getByText('100').closest('button')!);

    // Click buy button - match the button text "Buy 100 CC for $100"
    const buyBtn = screen.getByText(/buy \d+ cc for/i);
    fireEvent.click(buyBtn);

    await waitFor(() => {
      expect(mockedApi.post).toHaveBeenCalledWith('/api/economy/buy/checkout', {
        tokens: 100,
      });
    });
  });

  it('buy button redirects to Stripe checkout URL', async () => {
    render(<PurchaseFlow />);

    fireEvent.click(screen.getByText('50').closest('button')!);
    fireEvent.click(screen.getByText(/buy \d+ cc for/i));

    await waitFor(() => {
      expect(window.location.href).toBe('https://checkout.stripe.com/test');
    });
  });

  it('error handling on API failure', async () => {
    mockedApi.post.mockRejectedValue(new Error('Checkout failed'));

    render(<PurchaseFlow />);

    fireEvent.click(screen.getByText('100').closest('button')!);
    fireEvent.click(screen.getByText(/buy \d+ cc for/i));

    await waitFor(() => {
      // The error state shows "Something Went Wrong" heading
      expect(screen.getByText('Something Went Wrong')).toBeDefined();
    });
  });

  it('error handling on API error response', async () => {
    mockedApi.post.mockResolvedValue({
      data: { ok: false, error: 'insufficient_funds' },
    });

    render(<PurchaseFlow />);

    fireEvent.click(screen.getByText('100').closest('button')!);
    fireEvent.click(screen.getByText(/buy \d+ cc for/i));

    await waitFor(() => {
      // The component converts underscores to spaces: "insufficient funds"
      expect(screen.getByText(/insufficient funds/i)).toBeDefined();
    });
  });

  it('selecting preset clears custom amount', () => {
    render(<PurchaseFlow />);

    const customInput = screen.getByPlaceholderText(/\d+\s*-\s*[\d,]+/) as HTMLInputElement;
    fireEvent.change(customInput, { target: { value: '250' } });
    expect(customInput.value).toBe('250');

    // Selecting a preset should clear custom
    fireEvent.click(screen.getByText('100').closest('button')!);
    expect(customInput.value).toBe('');
  });

  it('typing custom amount deselects preset', () => {
    render(<PurchaseFlow />);

    // Select preset
    const btn100 = screen.getByText('100').closest('button')!;
    fireEvent.click(btn100);
    expect(btn100.className).toContain('neon-blue');

    // Type custom amount
    const customInput = screen.getByPlaceholderText(/\d+\s*-\s*[\d,]+/);
    fireEvent.change(customInput, { target: { value: '75' } });

    // Preset should no longer be highlighted
    expect(btn100.className).not.toContain('neon-blue');
  });

  it('renders Buy CC Tokens header', () => {
    render(<PurchaseFlow />);
    expect(screen.getByText(/buy cc tokens/i)).toBeDefined();
  });

  it('initialAmount prop pre-selects amount', () => {
    render(<PurchaseFlow initialAmount={500} />);
    const btn500 = screen.getByText('500').closest('button')!;
    expect(btn500.className).toContain('neon-blue');
  });
});
