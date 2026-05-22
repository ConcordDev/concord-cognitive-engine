/** Shared types for the inheritance-pact (death-insurance) lens. */

export interface PactBeneficiary {
  userId: string;
  sharePct: number;
  accepted: boolean;
  respondedAt: number | null;
}

export interface PremiumInstallment {
  amountSparks: number;
  paidAt: number;
}

export interface Pact {
  id: string;
  insuredUserId: string;
  beneficiaries: PactBeneficiary[];
  payoutSparks: number;
  premiumSparks: number;
  premiumFrequency: 'upfront' | 'weekly' | 'monthly';
  autoRenew: boolean;
  requireHandshake: boolean;
  writtenAt: number;
  durationDays: number;
  expiresAt: number;
  armsAt: number;
  status: 'active' | 'expired' | 'revoked' | 'fired';
  armed: boolean;
  renewCount: number;
  premiumPaidSparks: number;
  premiumInstallments?: PremiumInstallment[];
  nextPremiumDueAt: number | null;
  lastRenewedAt?: number;
  myShare?: { sharePct: number; accepted: boolean; respondedAt: number | null };
}

export interface PayoutSplit {
  userId: string;
  sharePct: number;
  sparks: number;
}

export interface Payout {
  id: string;
  pactId: string;
  cause: string;
  firedAt: number;
  totalSparks: number;
  splits: PayoutSplit[];
  insuredUserId?: string;
  mySparks?: number;
  mySharePct?: number;
}

export interface PactNotification {
  kind:
    | 'expiring'
    | 'premium_due'
    | 'handshake_pending'
    | 'handshake_request'
    | 'fired'
    | 'payout_received';
  pactId: string;
  severity: 'low' | 'medium' | 'high';
  at: number;
  message: string;
  autoRenew?: boolean;
}
