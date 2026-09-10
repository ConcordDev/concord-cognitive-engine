'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { lensRun } from '@/lib/api/client';
import type { TimelineEvent } from '@/components/viz';

export const DOMAIN = 'inheritance';

export interface Listing {
  id: number;
  dying_npc_id: string;
  npc_name?: string;
  mentor_user_id: string;
  heir_slot_price_cc: number;
  listed_at: number;
}
export interface Beneficiary {
  id: string; name: string; relationship: string; sharePct: number;
  contingent: boolean; contingentOn: string | null; acceptanceStatus?: string;
  heirUserId?: string | null;
}
export interface WillVersion {
  version: number; title: string; kind: string; status: string;
  authoredAt: number; bodyPreview?: string; body?: string; restoredFrom?: number;
}
export interface Asset {
  id: string; label: string; category: string; valueCc: number;
  location: string; notes: string;
}
export interface Executor {
  id: string; name: string; role: string; consentStatus: string;
  invitedAt: number; respondedAt: number | null;
}
export interface Lock {
  id: string; listingId: number | null; npcName: string; priceCc: number;
  status: string; lockedAt: number; amendedAt: number | null;
}
export interface Notice {
  id: string; kind: string; message: string; status: string;
  acceptance?: string; sharePct?: number | null; createdAt: number;
}
export interface Overview {
  beneficiaryCount: number; assetCount: number; willCount: number;
  executorCount: number; lockCount: number; totalSharePct: number;
  shareBalanced: boolean; totalAssetValueCc: number; activeWillVersion: number | null;
  executorsConsented: number;
}

export type Tab = 'overview' | 'beneficiaries' | 'wills' | 'assets' | 'executors' | 'probate' | 'notices' | 'market' | 'intestacy';

export const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'beneficiaries', label: 'Beneficiaries' },
  { id: 'wills', label: 'Will & Directives' },
  { id: 'assets', label: 'Asset Inventory' },
  { id: 'executors', label: 'Executors' },
  { id: 'probate', label: 'Probate Timeline' },
  { id: 'notices', label: 'My Notices' },
  { id: 'market', label: 'Heir-Slot Market' },
  { id: 'intestacy', label: 'Intestacy Reference' },
];

export interface IntestacyStateSummary { state: string; stateCode: string; propertyRegime?: string }
export interface IntestacyScenario { survivedBy: string; share: string }
export interface IntestacyLookupResult {
  covered: boolean;
  state?: string;
  stateCode?: string;
  propertyRegime?: string;
  citation?: string;
  source?: string;
  summary?: string;
  scenarios?: IntestacyScenario[];
  message?: string;
  statesCovered: IntestacyStateSummary[];
  representativeSubset: boolean;
  disclaimer: string;
}

export async function run(name: string, params: Record<string, unknown> = {}) {
  const r = await lensRun(DOMAIN, name, params);
  return r.data;
}

