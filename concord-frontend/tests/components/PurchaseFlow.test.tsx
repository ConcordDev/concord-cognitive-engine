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
  get: ReturnType<typeof vi.fn>;
};

describe('PurchaseFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.post.mockResolvedValue({
      data: { ok: true, checkoutUrl: 'https://checkout.stripe.com/test' },
    });
    // FIX-sponsorship-006: the flow now gates on the server config —
    // the purchase-flow tests run with purchases OPEN.
    mockedApi.get.mockResolvedValue({ data: { ok: true, stripeEnabled: true } });
    // Prevent actual location change
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { href: '' },
    });
  });

  it('renders preset amount buttons', async () => {
    render(<PurchaseFlow />);
    expect(await screen.findByText('10')).toBeDefined();
    expect(screen.getByText('50')).toBeDefined();
    expect(screen.getByText('100')).toBeDefined();
    expect(screen.getByText('500')).toBeDefined();
    expect(screen.getByText('1,000')).toBeDefined();
  });

  it('preset amount selection highlights the selected amount', async () => {
    render(<PurchaseFlow />);
    const button100 = (await screen.findByText('100')).closest('button')!;
    fireEvent.click(button100);

    // Active button should have highlighted style
    expect(button100.className).toContain('neon-blue');
  });

  it('custom amount input works', async () => {
    render(<PurchaseFlow />);

    const customInput = (await screen.findByPlaceholderText(/\d+\s*-\s*[\d,]+/)) as HTMLInputElement;
    fireEvent.change(customInput, { target: { value: '250' } });
    expect(customInput.value).toBe('250');
  });

  it('custom amount input validation rejects non-numeric', async () => {
    render(<PurchaseFlow />);

    const customInput = (await screen.findByPlaceholderText(/\d+\s*-\s*[\d,]+/)) as HTMLInputElement;
    fireEvent.change(customInput, { target: { value: 'abc' } });
    expect(customInput.value).toBe('');
  });

  it('USD equivalent display for preset', async () => {
    render(<PurchaseFlow />);
    // Each preset shows USD equivalent (1:1 peg)
    expect(await screen.findByText('$10')).toBeDefined();
    expect(screen.getByText('$50')).toBeDefined();
    expect(screen.getByText('$100')).toBeDefined();
    expect(screen.getByText('$500')).toBeDefined();
    expect(screen.getByText('$1,000')).toBeDefined();
  });

  it('shows 1 CC = $1.00 USD label', async () => {
    render(<PurchaseFlow />);
    expect(await screen.findByText(/1 CC = \$1\.00/)).toBeDefined();
  });

  it('buy button calls Stripe checkout API', async () => {
    render(<PurchaseFlow />);

    // Select a preset amount
    fireEvent.click((await screen.findByText('100')).closest('button')!);

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

    fireEvent.click((await screen.findByText('50')).closest('button')!);
    fireEvent.click(screen.getByText(/buy \d+ cc for/i));

    await waitFor(() => {
      expect(window.location.href).toBe('https://checkout.stripe.com/test');
    });
  });

  it('error handling on API failure', async () => {
    mockedApi.post.mockRejectedValue(new Error('Checkout failed'));

    render(<PurchaseFlow />);

    fireEvent.click((await screen.findByText('100')).closest('button')!);
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

    fireEvent.click((await screen.findByText('100')).closest('button')!);
    fireEvent.click(screen.getByText(/buy \d+ cc for/i));

    await waitFor(() => {
      // The component converts underscores to spaces: "insufficient funds"
      expect(screen.getByText(/insufficient funds/i)).toBeDefined();
    });
  });

  it('selecting preset clears custom amount', async () => {
    render(<PurchaseFlow />);

    const customInput = (await screen.findByPlaceholderText(/\d+\s*-\s*[\d,]+/)) as HTMLInputElement;
    fireEvent.change(customInput, { target: { value: '250' } });
    expect(customInput.value).toBe('250');

    // Selecting a preset should clear custom
    fireEvent.click(screen.getByText('100').closest('button')!);
    expect(customInput.value).toBe('');
  });

  it('typing custom amount deselects preset', async () => {
    render(<PurchaseFlow />);

    // Select preset
    const btn100 = (await screen.findByText('100')).closest('button')!;
    fireEvent.click(btn100);
    expect(btn100.className).toContain('neon-blue');

    // Type custom amount
    const customInput = await screen.findByPlaceholderText(/\d+\s*-\s*[\d,]+/);
    fireEvent.change(customInput, { target: { value: '75' } });

    // Preset should no longer be highlighted
    expect(btn100.className).not.toContain('neon-blue');
  });

  it('renders Buy CC Tokens header', async () => {
    render(<PurchaseFlow />);
    expect(await screen.findByText(/buy cc tokens/i)).toBeDefined();
  });

  it('gates the purchase surface closed when the server says purchases are off (FIX-sponsorship-006)', async () => {
    mockedApi.get.mockResolvedValue({ data: { ok: true, stripeEnabled: false } });
    render(<PurchaseFlow />);
    expect(await screen.findByText(/purchases aren't open yet/i)).toBeDefined();
    // No amounts, no Stripe copy, no buy path while money is off.
    expect(screen.queryByText('1,000')).toBeNull();
    expect(screen.queryByText(/processed securely by Stripe/i)).toBeNull();
    expect(screen.queryByText(/buy \d+ cc for/i)).toBeNull();
    expect(mockedApi.post).not.toHaveBeenCalled();
  });

  it('fails closed when the config check errors (FIX-sponsorship-006)', async () => {
    mockedApi.get.mockRejectedValue(new Error('network down'));
    render(<PurchaseFlow />);
    expect(await screen.findByText(/purchases aren't open yet/i)).toBeDefined();
    expect(screen.queryByText(/buy \d+ cc for/i)).toBeNull();
  });

  it('initialAmount prop pre-selects amount', async () => {
    render(<PurchaseFlow initialAmount={500} />);
    const btn500 = (await screen.findByText('500')).closest('button')!;
    expect(btn500.className).toContain('neon-blue');
  });
});
