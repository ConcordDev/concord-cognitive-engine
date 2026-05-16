/**
 * Stripe.js loader — script-injection pattern, no @stripe/stripe-js
 * npm dependency. Loads the official Stripe.js from js.stripe.com/v3,
 * memoizes by publishable key.
 *
 * Why no @stripe/stripe-js? It's a thin wrapper over this same script
 * tag, and adding it would trigger the "new top-level dependency"
 * escalation per CLAUDE.md. The Stripe.js global API is stable and
 * directly callable without the wrapper.
 *
 * Usage:
 *   const stripe = await loadStripeJs(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);
 *   const elements = stripe.elements({ clientSecret });
 *   const paymentElement = elements.create('payment');
 *   paymentElement.mount('#payment-element');
 */

const STRIPE_V3_SRC = 'https://js.stripe.com/v3/';

interface StripeJsGlobal {
  // Minimal subset of Stripe.js v3 API we use. The real Stripe global
  // has many more methods; we only type the ones the form touches.
  elements: (opts: { clientSecret?: string; appearance?: object }) => StripeElementsGroup;
  confirmPayment: (opts: {
    elements: StripeElementsGroup;
    confirmParams?: { return_url?: string };
    redirect?: 'always' | 'if_required';
  }) => Promise<{ error?: { type: string; message?: string; code?: string }; paymentIntent?: { id: string; status: string } }>;
  retrievePaymentIntent: (clientSecret: string) => Promise<{ paymentIntent?: { id: string; status: string }; error?: { message?: string } }>;
}

interface StripeElementsGroup {
  create: (kind: 'payment' | 'card', options?: object) => StripeElement;
  getElement: (kind: 'payment' | 'card') => StripeElement | null;
}

interface StripeElement {
  mount: (selectorOrNode: string | HTMLElement) => void;
  unmount: () => void;
  destroy: () => void;
  on: (event: string, handler: (ev: unknown) => void) => void;
}

declare global {
  interface Window {
    Stripe?: (publishableKey: string) => StripeJsGlobal;
  }
}

// Module-level cache keyed by publishable key. loadStripeJs is safe
// to call concurrently — the second caller awaits the same promise.
const stripeByKey = new Map<string, Promise<StripeJsGlobal | null>>();

let scriptInjectPromise: Promise<void> | null = null;

function injectStripeScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Stripe.js only loads in the browser'));
  if (window.Stripe) return Promise.resolve();
  if (scriptInjectPromise) return scriptInjectPromise;

  scriptInjectPromise = new Promise<void>((resolve, reject) => {
    // Reuse an existing script tag (e.g. from a prior page navigation)
    const existing = document.querySelector(`script[src="${STRIPE_V3_SRC}"]`);
    if (existing) {
      if (window.Stripe) return resolve();
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Stripe.js failed to load')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = STRIPE_V3_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Stripe.js failed to load'));
    document.head.appendChild(script);
  });
  return scriptInjectPromise;
}

export async function loadStripeJs(publishableKey: string): Promise<StripeJsGlobal | null> {
  if (!publishableKey) return null;
  const cached = stripeByKey.get(publishableKey);
  if (cached) return cached;
  const promise = (async () => {
    try {
      await injectStripeScript();
      if (!window.Stripe) return null;
      return window.Stripe(publishableKey);
    } catch (_e) {
      return null;
    }
  })();
  stripeByKey.set(publishableKey, promise);
  return promise;
}

export type { StripeJsGlobal, StripeElementsGroup, StripeElement };
