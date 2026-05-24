'use client';

/**
 * CitePicker — citation-aware DTU picker.
 *
 * Wraps DTUPickerModal with citation-specific filters (license type,
 * authority, freshness) and routes the selection through the consent
 * gate. If the chosen parent DTU's `allowCitation` is false and the
 * caller has no purchased license, surfaces CitationConsentModal
 * instead of completing the citation. Otherwise calls onCite() with
 * the parent DTU + a registerCitation-ready payload.
 */

import React, { useMemo, useState } from 'react';

import { DTUPickerModal } from './DTUPickerModal';
import { CitationConsentModal, type CitationConsentParent } from './CitationConsentModal';
import type { DTU } from '@/lib/api/generated-types';

export type CiteAuthority = 'any' | 'human' | 'ai' | 'institutional';
export type CiteFreshness = 'any' | '7d' | '30d' | '90d' | '1y';

export interface CitePickerProps {
  open: boolean;
  /** Lens id for context (defaults to 'studio'). */
  lens?: string;
  /** Drafted child DTU id, if known — informs consent context message. */
  childId?: string;
  childTitle?: string;
  onClose: () => void;
  /** Called when consent is satisfied. Caller posts registerCitation. */
  onCite: (parent: DTU) => void;
  /** Optional pre-set authority filter. */
  initialAuthority?: CiteAuthority;
  /** Optional pre-set freshness filter. */
  initialFreshness?: CiteFreshness;
}

interface DTUMetaShape {
  allowCitation?: boolean;
  authority?: string;
  source?: string;
  model?: string;
  licenseKind?: string;
  licensePriceCc?: number;
  ownerName?: string;
  ownerAvatar?: string;
  hasPurchasedLicense?: boolean;
}

function authorityMatches(dtu: DTU, want: CiteAuthority): boolean {
  if (want === 'any') return true;
  const meta = (dtu.meta || {}) as DTUMetaShape;
  const auth = (meta.authority || '').toLowerCase();
  const source = (meta.source || '').toLowerCase();
  if (want === 'institutional') return auth.includes('institution') || auth.includes('verified');
  if (want === 'human') {
    return auth === 'human' || source.includes('user') || source.includes('manual');
  }
  if (want === 'ai') {
    return source.includes('autogen') || source.includes('meta-derivation') || /brain|llava|llama|mistral|phi|gemma/.test((meta.model || '').toLowerCase());
  }
  return true;
}

function freshnessMatches(dtu: DTU, want: CiteFreshness): boolean {
  if (want === 'any') return true;
  const ts = dtu.timestamp ? new Date(dtu.timestamp).getTime() : 0;
  if (!ts) return false;
  const days = (Date.now() - ts) / 86_400_000;
  switch (want) {
    case '7d': return days <= 7;
    case '30d': return days <= 30;
    case '90d': return days <= 90;
    case '1y': return days <= 365;
  }
}

function consentSatisfied(dtu: DTU): boolean {
  const meta = (dtu.meta || {}) as DTUMetaShape;
  if (meta.hasPurchasedLicense) return true;
  if (meta.allowCitation) return true;
  const visibility = (dtu as { visibility?: string }).visibility;
  if (visibility === 'public' || visibility === 'published' || visibility === 'global') {
    return true;
  }
  return false;
}

function toConsentParent(dtu: DTU): CitationConsentParent {
  const meta = (dtu.meta || {}) as DTUMetaShape;
  return {
    id: dtu.id,
    title: dtu.title,
    tier: dtu.tier,
    creator: {
      id: dtu.ownerId,
      displayName: meta.ownerName,
      avatarUrl: meta.ownerAvatar,
    },
    licensePriceCc: meta.licensePriceCc,
    reason: 'citation_consent_not_granted',
  };
}

export function CitePicker({
  open,
  lens,
  childId,
  childTitle,
  onClose,
  onCite,
  initialAuthority = 'any',
  initialFreshness = 'any',
}: CitePickerProps) {
  const [authority, setAuthority] = useState<CiteAuthority>(initialAuthority);
  const [freshness, setFreshness] = useState<CiteFreshness>(initialFreshness);
  const [consentParent, setConsentParent] = useState<CitationConsentParent | null>(null);
  const [pendingDtu, setPendingDtu] = useState<DTU | null>(null);

  const handleSelect = (dtu: DTU) => {
    if (!authorityMatches(dtu, authority) || !freshnessMatches(dtu, freshness)) return;
    if (consentSatisfied(dtu)) {
      onCite(dtu);
      onClose();
      return;
    }
    setPendingDtu(dtu);
    setConsentParent(toConsentParent(dtu));
  };

  const consentContext = useMemo(() => {
    if (!childTitle && !childId) return undefined;
    return `Citing in ${childTitle ?? `your draft ${childId?.slice(0, 8) ?? ''}`.trim()}`;
  }, [childId, childTitle]);

  if (!open) return null;

  return (
    <>
      <CitePickerInner
        lens={lens}
        authority={authority}
        freshness={freshness}
        onAuthorityChange={setAuthority}
        onFreshnessChange={setFreshness}
        onClose={onClose}
        onSelect={handleSelect}
      />
      <CitationConsentModal
        open={!!consentParent}
        parent={consentParent}
        context={consentContext}
        onClose={() => {
          setConsentParent(null);
          setPendingDtu(null);
        }}
        onLicenseGranted={() => {
          if (pendingDtu) {
            onCite(pendingDtu);
            onClose();
          }
        }}
        onConsentRequested={() => {
          // Don't auto-cite — creator must approve out-of-band first.
          // Modal close handles UI cleanup; CitePicker stays mounted in
          // case the user wants to pick a different parent.
        }}
      />
    </>
  );
}

interface CitePickerInnerProps {
  lens?: string;
  authority: CiteAuthority;
  freshness: CiteFreshness;
  onAuthorityChange: (v: CiteAuthority) => void;
  onFreshnessChange: (v: CiteFreshness) => void;
  onClose: () => void;
  onSelect: (dtu: DTU) => void;
}

function CitePickerInner({
  lens,
  authority,
  freshness,
  onAuthorityChange,
  onFreshnessChange,
  onClose,
  onSelect,
}: CitePickerInnerProps) {
  return (
    <div className="fixed inset-0 z-40">
      <DTUPickerModal lens={lens} title="Cite a DTU" onClose={onClose} onSelect={onSelect} />
      {/* Render the citation-specific filter strip floating over the picker. */}
      <div
        className="pointer-events-none fixed inset-x-0 top-[calc(50%+9rem)] z-50 flex justify-center px-4"
        aria-hidden="true"
      >
        <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-full border border-lattice-border/60 bg-lattice-bg/90 px-3 py-1.5 shadow-md backdrop-blur">
          <label className="text-[10px] uppercase tracking-wider text-gray-400">
            Authority
            <select
              value={authority}
              onChange={(e) => onAuthorityChange(e.target.value as CiteAuthority)}
              className="ml-1 rounded border border-lattice-border bg-lattice-surface/40 px-1.5 py-0.5 text-xs text-white"
            >
              <option value="any">any</option>
              <option value="human">human</option>
              <option value="ai">ai</option>
              <option value="institutional">institutional</option>
            </select>
          </label>
          <label className="text-[10px] uppercase tracking-wider text-gray-400">
            Freshness
            <select
              value={freshness}
              onChange={(e) => onFreshnessChange(e.target.value as CiteFreshness)}
              className="ml-1 rounded border border-lattice-border bg-lattice-surface/40 px-1.5 py-0.5 text-xs text-white"
            >
              <option value="any">any</option>
              <option value="7d">last 7d</option>
              <option value="30d">last 30d</option>
              <option value="90d">last 90d</option>
              <option value="1y">last year</option>
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}

export default CitePicker;
