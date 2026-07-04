import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * loadStripeJs is a module-level singleton cache (stripeByKey Map,
 * scriptInjectPromise), so each test needs a fresh module instance —
 * vi.resetModules() + dynamic import per test.
 */
async function freshModule() {
  vi.resetModules();
  return import('@/lib/stripe/load-stripe-js');
}

function mockScriptTag() {
  const listeners: Record<string, () => void> = {};
  return {
    src: '',
    async: false,
    set onload(fn: () => void) { listeners.load = fn; },
    set onerror(fn: () => void) { listeners.error = fn; },
    fireLoad: () => listeners.load?.(),
    fireError: () => listeners.error?.(),
  };
}

describe('loadStripeJs', () => {
  beforeEach(() => {
    // Spies (document.createElement / appendChild) must not leak their
    // mockReturnValue/mockImplementation across tests within this file.
    vi.restoreAllMocks();
    // @ts-expect-error test-only global reset
    delete window.Stripe;
    document.head.innerHTML = '';
  });

  it('returns null immediately for an empty publishable key (no script injected)', async () => {
    const { loadStripeJs } = await freshModule();
    const createSpy = vi.spyOn(document, 'createElement');
    const result = await loadStripeJs('');
    expect(result).toBeNull();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('injects a new script tag, resolves on load, and returns the Stripe instance', async () => {
    const { loadStripeJs } = await freshModule();
    const tag = mockScriptTag();
    vi.spyOn(document, 'createElement').mockReturnValue(tag as unknown as HTMLScriptElement);
    const appendSpy = vi.spyOn(document.head, 'appendChild').mockImplementation(() => tag as unknown as Node);

    const stripeInstance = { elements: vi.fn(), confirmPayment: vi.fn(), retrievePaymentIntent: vi.fn() };
    const stripeFactory = vi.fn().mockReturnValue(stripeInstance);

    const promise = loadStripeJs('pk_test_123');
    // window.Stripe only becomes available once the injected script "runs" —
    // simulate that happening right before the load event fires.
    window.Stripe = stripeFactory;
    tag.fireLoad();

    const result = await promise;
    expect(tag.src).toBe('https://js.stripe.com/v3/');
    expect(appendSpy).toHaveBeenCalledWith(tag);
    expect(stripeFactory).toHaveBeenCalledWith('pk_test_123');
    expect(result).toBe(stripeInstance);
  });

  it('resolves null when the script fails to load', async () => {
    const { loadStripeJs } = await freshModule();
    const tag = mockScriptTag();
    vi.spyOn(document, 'createElement').mockReturnValue(tag as unknown as HTMLScriptElement);
    vi.spyOn(document.head, 'appendChild').mockImplementation(() => tag as unknown as Node);

    const promise = loadStripeJs('pk_test_456');
    tag.fireError();
    const result = await promise;
    expect(result).toBeNull();
  });

  it('caches the promise per publishable key (second call does not re-inject)', async () => {
    const { loadStripeJs } = await freshModule();
    const tag = mockScriptTag();
    const createSpy = vi.spyOn(document, 'createElement').mockReturnValue(tag as unknown as HTMLScriptElement);
    vi.spyOn(document.head, 'appendChild').mockImplementation(() => tag as unknown as Node);

    const first = loadStripeJs('pk_test_same');
    window.Stripe = vi.fn().mockReturnValue({});
    tag.fireLoad();
    await first;

    const second = loadStripeJs('pk_test_same');
    await second;

    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('reuses an existing <script> tag already in the document (no double-inject)', async () => {
    const { loadStripeJs } = await freshModule();
    const listeners: Record<string, () => void> = {};
    const existing = document.createElement('script');
    existing.src = 'https://js.stripe.com/v3/';
    existing.addEventListener = vi.fn((type: string, fn: () => void) => {
      listeners[type] = fn;
    }) as typeof existing.addEventListener;
    document.head.appendChild(existing);
    const createSpy = vi.spyOn(document, 'createElement');

    const promise = loadStripeJs('pk_test_existing');
    window.Stripe = vi.fn().mockReturnValue({});
    listeners.load?.();

    await promise;
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('resolves immediately when window.Stripe is already present alongside an existing tag', async () => {
    const { loadStripeJs } = await freshModule();
    const existing = document.createElement('script');
    existing.src = 'https://js.stripe.com/v3/';
    document.head.appendChild(existing);
    const stripeInstance = {};
    window.Stripe = vi.fn().mockReturnValue(stripeInstance);

    const result = await loadStripeJs('pk_test_ready');
    expect(result).toBe(stripeInstance);
  });
});
