'use client';

/**
 * StripePaymentForm — reusable Stripe Elements payment confirmation
 * surface for retail POS / healthcare copay / any future PaymentIntent
 * flow.
 *
 * Lifecycle:
 *   1. Caller obtains a clientSecret from a server macro (e.g.
 *      retail.cart-create-payment-intent → returns clientSecret).
 *   2. Mount <StripePaymentForm clientSecret={...} onSuccess={...} />.
 *   3. Form loads Stripe.js from CDN, mounts the Payment Element,
 *      and shows a Pay button.
 *   4. On submit: stripe.confirmPayment with redirect:'if_required'.
 *      Cards that need 3DS auto-redirect; cards that don't return
 *      immediately and the form calls onSuccess({paymentIntentId}).
 *   5. Caller's onSuccess handler typically POSTs the corresponding
 *      confirm macro server-side (e.g. retail.cart-confirm-paid-with-intent)
 *      which re-fetches the PaymentIntent from Stripe and captures
 *      the order. The form does NOT trust client-side success alone.
 *
 * Requires NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY env at build time.
 */

import { useEffect, useRef, useState } from 'react';
import { loadStripeJs, type StripeJsGlobal, type StripeElementsGroup } from '@/lib/stripe/load-stripe-js';

export interface StripePaymentFormProps {
  clientSecret: string;
  amountUsd: number;
  description?: string;
  onSuccess: (result: { paymentIntentId: string }) => void;
  onCancel?: () => void;
  submitLabel?: string;
  className?: string;
}

export function StripePaymentForm({
  clientSecret,
  amountUsd,
  description,
  onSuccess,
  onCancel,
  submitLabel,
  className,
}: StripePaymentFormProps) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'submitting' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const stripeRef = useRef<StripeJsGlobal | null>(null);
  const elementsRef = useRef<StripeElementsGroup | null>(null);
  const elementMountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
      if (!publishableKey) {
        if (!cancelled) {
          setStatus('error');
          setErrorMessage('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY env not configured.');
        }
        return;
      }
      const stripe = await loadStripeJs(publishableKey);
      if (cancelled) return;
      if (!stripe) {
        setStatus('error');
        setErrorMessage('Stripe.js failed to load. Check your network + ad-blocker.');
        return;
      }
      stripeRef.current = stripe;
      const elements = stripe.elements({
        clientSecret,
        appearance: {
          theme: 'night',
          variables: {
            colorPrimary: '#06b6d4',
            colorBackground: '#0c0c0d',
            colorText: '#f4f4f5',
            colorDanger: '#f43f5e',
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
            borderRadius: '8px',
          },
        },
      });
      elementsRef.current = elements;
      const paymentElement = elements.create('payment', { layout: 'tabs' });
      if (elementMountRef.current) {
        paymentElement.mount(elementMountRef.current);
        if (!cancelled) setStatus('ready');
      }
    })();
    return () => { cancelled = true; };
  }, [clientSecret]);

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    const stripe = stripeRef.current;
    const elements = elementsRef.current;
    if (!stripe || !elements) return;
    setStatus('submitting');
    setErrorMessage(null);
    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        // if_required: cards that don't need 3DS skip the redirect and
        // return synchronously. Cards that DO need 3DS redirect away;
        // when the user comes back, the page-level PaymentIntent status
        // check should run (caller's responsibility).
        redirect: 'if_required',
      });
      if (error) {
        setStatus('error');
        setErrorMessage(error.message || 'Payment failed. Please try again.');
        return;
      }
      if (paymentIntent && paymentIntent.status === 'succeeded') {
        setStatus('success');
        onSuccess({ paymentIntentId: paymentIntent.id });
      } else {
        setStatus('error');
        setErrorMessage(`Payment status: ${paymentIntent?.status || 'unknown'} — please try again.`);
      }
    } catch (e) {
      setStatus('error');
      setErrorMessage(e instanceof Error ? e.message : 'Unexpected payment error.');
    }
  }

  return (
    <form onSubmit={handleSubmit} className={className ?? 'space-y-4'}>
      <div className="rounded-xl border border-zinc-700 bg-zinc-900/80 p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <span className="text-xs text-zinc-400 uppercase tracking-wider">{description ?? 'Payment'}</span>
          <span className="text-lg font-semibold text-zinc-100">${amountUsd.toFixed(2)}</span>
        </div>
        <div ref={elementMountRef} aria-label="Stripe payment element" />
        {status === 'loading' && <p className="mt-3 text-xs text-zinc-500">Loading secure payment form…</p>}
      </div>
      {errorMessage && (
        <div className="rounded-lg border border-rose-700/50 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
          {errorMessage}
        </div>
      )}
      <div className="flex gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={status === 'submitting'}
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >Cancel</button>
        )}
        <button
          type="submit"
          disabled={status !== 'ready'}
          className="flex-1 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-cyan-950 hover:bg-cyan-400 disabled:opacity-50"
        >
          {status === 'submitting' ? 'Processing…' :
           status === 'success' ? '✓ Paid' :
           submitLabel ?? `Pay $${amountUsd.toFixed(2)}`}
        </button>
      </div>
    </form>
  );
}
