import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  ListingVerificationBadge,
  getListingVerification,
} from '@/components/marketplace/ListingVerificationBadge';

/**
 * ListingVerificationBadge — the honest per-listing marketplace verification
 * indicator (V1.2 Wave C). It is a pure function of the `listing` prop,
 * which mirrors the REAL shape `marketplace.myListings` forwards
 * (server.js) — `feaVerified`/`feaSummary`, sourced verbatim from
 * server/lib/asset-gen/asset-marketplace.js#mintGeneratedAssetAsDtu's DTU
 * `meta`. Nothing here is a guess: a listing with no verification data must
 * render "Not verified", NEVER a fabricated "Verified".
 */

describe('getListingVerification — pure classification', () => {
  it('classifies a genuinely FEA-passed listing as fea_verified', () => {
    const v = getListingVerification({
      feaVerified: true,
      feaSummary: { ok: true, maxUtilization: 0.55, safetyFactor: 1.8, material: 'steel' },
    });
    expect(v.state).toBe('fea_verified');
    expect(v.verified).toBe(true);
    expect(v.label).toBe('FEA Verified');
    expect(v.feaSummary?.material).toBe('steel');
  });

  it('classifies an honestly-labeled unverified (FEA-failed) listing as fea_failed, never verified', () => {
    const v = getListingVerification({
      feaVerified: false,
      feaSummary: { ok: false, maxUtilization: 1.6, safetyFactor: 0.6 },
    });
    expect(v.state).toBe('fea_failed');
    expect(v.verified).toBe(false);
    expect(v.label).toMatch(/Unverified/);
  });

  it('classifies a listing with no FEA data at all as no_data — the honest default', () => {
    expect(getListingVerification({}).state).toBe('no_data');
    expect(getListingVerification(null).state).toBe('no_data');
    expect(getListingVerification(undefined).state).toBe('no_data');
    expect(getListingVerification({ feaSummary: null }).state).toBe('no_data');
  });

  it('never treats verified:false-with-ok:true as a contradiction — trusts feaSummary.ok', () => {
    // A malformed/mismatched mirror flag must never flip a genuine failure
    // into looking verified.
    const v = getListingVerification({
      feaVerified: true, // inconsistent mirror flag
      feaSummary: { ok: false, maxUtilization: 1.2 },
    });
    expect(v.state).toBe('fea_failed');
    expect(v.verified).toBe(false);
  });

  it('reads meta.feaSummary (full-DTU shape) identically to a flattened listing row', () => {
    const v = getListingVerification({ meta: { feaVerified: true, feaSummary: { ok: true, maxUtilization: 0.4 } } });
    expect(v.state).toBe('fea_verified');
    expect(v.verified).toBe(true);
  });
});

describe('ListingVerificationBadge — honest rendering, never defaults to verified', () => {
  it('renders "FEA Verified" for a genuinely passed check', () => {
    render(
      <ListingVerificationBadge
        listing={{ feaVerified: true, feaSummary: { ok: true, maxUtilization: 0.5, safetyFactor: 2 } }}
      />
    );
    expect(screen.getByText(/FEA Verified/)).toBeInTheDocument();
  });

  it('renders "Unverified (FEA failed)" for a real-but-failing check, and does not say plain "Verified"', () => {
    render(
      <ListingVerificationBadge
        listing={{ feaVerified: false, feaSummary: { ok: false, maxUtilization: 1.4, safetyFactor: 0.7 } }}
      />
    );
    expect(screen.getByText(/Unverified \(FEA failed\)/)).toBeInTheDocument();
    expect(screen.queryByText(/^FEA Verified$/)).toBeNull();
  });

  it('renders "Not verified" when no listing/verification data is supplied', () => {
    render(<ListingVerificationBadge listing={null} />);
    expect(screen.getByText(/Not verified/)).toBeInTheDocument();
  });

  it('renders "Not verified" when the listing prop is omitted entirely (ordinary music/art/plugin listings)', () => {
    render(<ListingVerificationBadge />);
    expect(screen.getByText(/Not verified/)).toBeInTheDocument();
  });

  it('never renders a fabricated confidence/percentage figure', () => {
    render(
      <ListingVerificationBadge listing={{ feaVerified: true, feaSummary: { ok: true, maxUtilization: 0.5 } }} />
    );
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('exposes the real classification state as a data attribute for the no_data case, not a placeholder', () => {
    const { container } = render(<ListingVerificationBadge listing={{}} />);
    const badge = container.querySelector('[data-listing-verification-state]');
    expect(badge?.getAttribute('data-listing-verification-state')).toBe('no_data');
  });
});
