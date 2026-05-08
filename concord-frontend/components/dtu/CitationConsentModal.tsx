'use client';

/**
 * CitationConsentModal — surfaces the citation consent decision for a
 * single parent DTU.
 *
 * Triggered when a citation attempt fails the consent gate in
 * `server/economy/royalty-cascade.js#registerCitation`
 * (error = "citation_consent_not_granted"). The modal explains why and
 * offers three paths: request consent from the creator, buy a usage
 * license in the marketplace, or cancel.
 */

import React, { useEffect, useRef, useState } from 'react';
import { X, Send, ShoppingCart, Info, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { api } from '@/lib/api/client';
import { CreatorBadge } from './CreatorBadge';
import { TierBadge, type DTUTier } from './TierBadge';

export interface CitationConsentParent {
  id: string;
  title?: string;
  tier?: DTUTier | string;
  creator?: {
    id?: string;
    displayName?: string;
    avatarUrl?: string;
  };
  /** Listed price in CC, if available — drives the "Buy license" CTA. */
  licensePriceCc?: number;
  /** Reason consent was denied; raw error code from the cascade. */
  reason?: 'citation_consent_not_granted' | 'parent_not_public' | string;
}

export interface CitationConsentModalProps {
  open: boolean;
  parent: CitationConsentParent | null;
  /** Optional context message — e.g. "Citing in your draft 'Foo'". */
  context?: string;
  onClose: () => void;
  /** Called after a successful "buy license" purchase, with new lineage state. */
  onLicenseGranted?: (parentId: string) => void;
  /** Called after a "request consent" message is sent. */
  onConsentRequested?: (parentId: string) => void;
}

type Step = 'choose' | 'requesting' | 'buying';

export function CitationConsentModal({
  open,
  parent,
  context,
  onClose,
  onLicenseGranted,
  onConsentRequested,
}: CitationConsentModalProps) {
  const [step, setStep] = useState<Step>('choose');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setStep('choose');
      setError(null);
      setNote('');
      return;
    }
    // Initial focus on the dialog for screen readers.
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && step === 'choose') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, step]);

  if (!open || !parent) return null;

  const handleRequest = async () => {
    setStep('requesting');
    setError(null);
    try {
      const body = (
        await api.post<{ ok?: boolean; error?: string }>('/api/lens/run', {
          domain: 'autonomy',
          name: 'request_consent',
          input: {
            kind: 'citation',
            parentId: parent.id,
            parentCreatorId: parent.creator?.id,
            note: note.trim() || undefined,
          },
        })
      ).data;
      if (body?.ok === false && body.error) throw new Error(body.error);
      onConsentRequested?.(parent.id);
      onClose();
    } catch (e) {
      setStep('choose');
      setError(e instanceof Error ? e.message : 'Could not send the consent request.');
    }
  };

  const handleBuy = async () => {
    setStep('buying');
    setError(null);
    try {
      const body = (
        await api.post<{ ok?: boolean; error?: string }>(
          '/api/marketplace/purchaseWithRoyalties',
          {
            dtuId: parent.id,
            licenseKind: 'citation',
          }
        )
      ).data;
      if (body?.ok === false && body.error) throw new Error(body.error);
      onLicenseGranted?.(parent.id);
      onClose();
    } catch (e) {
      setStep('choose');
      setError(e instanceof Error ? e.message : 'Purchase failed. Please try again.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cite-consent-title"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={cn(
          'w-full max-w-md rounded-lg border border-lattice-border bg-lattice-bg shadow-xl',
          'focus:outline-none'
        )}
      >
        <header className="flex items-start justify-between gap-2 border-b border-lattice-border p-4">
          <div className="flex-1">
            <h2 id="cite-consent-title" className="text-base font-semibold text-white">
              Citation requires consent
            </h2>
            <p className="mt-1 text-xs text-gray-400">
              The creator of this DTU hasn&apos;t opened it for citation. Choose how
              you&apos;d like to proceed.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-lattice-surface hover:text-white"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <section className="space-y-4 p-4">
          <div className="rounded-md border border-lattice-border/60 bg-lattice-surface/40 p-3">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="font-medium text-white">{parent.title ?? parent.id.slice(0, 16)}</span>
              {parent.tier && <TierBadge tier={parent.tier as DTUTier} size="sm" />}
            </div>
            <div className="mt-2">
              <CreatorBadge creator={parent.creator} size="sm" />
            </div>
            {context && (
              <p className="mt-2 inline-flex items-start gap-1 text-xs text-gray-400">
                <Info className="mt-0.5 w-3 h-3 flex-shrink-0" aria-hidden="true" />
                {context}
              </p>
            )}
          </div>

          <label className="block">
            <span className="text-xs font-medium text-gray-300">Optional note to creator</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Why you'd like to cite this work…"
              className={cn(
                'mt-1 w-full resize-none rounded-md border border-lattice-border bg-lattice-surface/40 px-2 py-1.5 text-sm text-white',
                'focus:border-neon-cyan/60 focus:outline-none focus:ring-1 focus:ring-neon-cyan/40'
              )}
            />
          </label>

          {error && (
            <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}
        </section>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-lattice-border p-3">
          <button
            type="button"
            onClick={onClose}
            disabled={step !== 'choose'}
            className={cn(
              'rounded-md border border-lattice-border px-3 py-1.5 text-xs text-gray-300',
              'hover:bg-lattice-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-cyan/40',
              'disabled:opacity-50'
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleRequest}
            disabled={step !== 'choose'}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200',
              'hover:bg-cyan-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400',
              'disabled:opacity-50'
            )}
          >
            {step === 'requesting' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            Request consent
          </button>
          {parent.licensePriceCc != null && parent.licensePriceCc > 0 && (
            <button
              type="button"
              onClick={handleBuy}
              disabled={step !== 'choose'}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200',
                'hover:bg-amber-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400',
                'disabled:opacity-50'
              )}
            >
              {step === 'buying' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <ShoppingCart className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              Buy license · {parent.licensePriceCc} CC
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

export default CitationConsentModal;
