/**
 * Lens account facts for the Chat analyst (Product Review 4 — Analytics F1).
 *
 * Finding F1: arriving in Chat with ?context=analytics used to give the
 * answering model a context LABEL and nothing else ("Current domain context:
 * analytics. Use domain-specific knowledge and terminology."), so it invented
 * account numbers ("About 43 DTUs") instead of reading the account. The spec
 * of record (analytics.md §8 Q2): account answers are composed from the lens's
 * own live values, citing the card/value they came from — or the analyst
 * declines with "the surface doesn't give me that". Never an estimate.
 *
 * This module is the seam: a per-domain provider map. Each provider reads the
 * SAME endpoints the lens's own surface renders, at send time (facts must be
 * current at ask time — the acceptance flows re-ask after in-pass creations),
 * and the builder formats them into a system-prompt block that:
 *   - states the values are live and OVERRIDE any examples or earlier numbers,
 *   - cites each fact's surface card + endpoint,
 *   - renders a present 0 as 0 (a real zero is a fact, never "missing"),
 *   - NAMES any source that could not be read (never zero-fills a failure),
 *   - instructs the model to answer only from these facts, else decline.
 * A domain with no provider yields an empty block: behaviour for that domain
 * is exactly what it was before this module existed.
 */

import { api, apiHelpers } from '@/lib/api/client';
import { formatNumber } from '@/lib/utils';

export interface AccountFact {
  /** The surface card's name, as the user sees it. */
  label: string;
  /** Formatted value, exactly as grounded (0 stays "0"). */
  value: string;
  /** Where the value came from: card + endpoint. */
  source: string;
}

export interface LensFactsResult {
  facts: AccountFact[];
  /** Human-readable names of sources that could not be read. */
  unreadable: string[];
}

/** A finite number from an unknown payload field, or undefined. Never coerces. */
function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

interface ProfileShape {
  userId?: string;
  id?: string;
  stats?: { citationCount?: number };
}

async function fetchAnalyticsFacts(): Promise<LensFactsResult> {
  const facts: AccountFact[] = [];
  const unreadable: string[] = [];

  // Profile first: it carries Citations and the userId the followers and
  // creator reads key off — the same order AnalyticsDeskPanel resolves them.
  let userId = '';
  try {
    const res = await api.get('/api/social/profile');
    const profile = (res.data?.profile ?? res.data) as ProfileShape | undefined;
    userId = profile?.userId || profile?.id || '';
    const citations = num(profile?.stats?.citationCount);
    if (citations !== undefined) {
      facts.push({
        label: 'Citations',
        value: formatNumber(citations),
        source: 'Analytics Overview "Citations" card — GET /api/social/profile',
      });
    } else {
      unreadable.push('Citations (GET /api/social/profile)');
    }
  } catch {
    unreadable.push('Citations (GET /api/social/profile)');
  }

  try {
    const res = await apiHelpers.dtus.myDtus({ limit: 1, offset: 0 });
    const data = res.data as { total?: number; dtus?: unknown[] } | undefined;
    const total = num(data?.total) ??
      (Array.isArray(data?.dtus) ? data.dtus.length : undefined);
    if (total !== undefined) {
      facts.push({
        label: 'Total DTUs',
        value: formatNumber(total),
        source: 'Analytics Overview "Total DTUs" card — GET /api/dtus/mine',
      });
    } else {
      unreadable.push('Total DTUs (GET /api/dtus/mine)');
    }
  } catch {
    unreadable.push('Total DTUs (GET /api/dtus/mine)');
  }

  try {
    const res = await api.get('/api/economy/transactions');
    const total = num(res.data?.summary?.total);
    if (total !== undefined) {
      facts.push({
        label: 'Total CC moved',
        value: formatNumber(total),
        source: 'Analytics Overview "Total CC" card — GET /api/economy/transactions',
      });
    } else {
      unreadable.push('Total CC (GET /api/economy/transactions)');
    }
  } catch {
    unreadable.push('Total CC (GET /api/economy/transactions)');
  }

  if (userId) {
    try {
      const res = await api.get(`/api/social/followers/${userId}`);
      const count = num(res.data?.count) ??
        (Array.isArray(res.data?.followers) ? res.data.followers.length : undefined);
      if (count !== undefined) {
        facts.push({
          label: 'Followers',
          value: formatNumber(count),
          source: 'Analytics Overview "Followers" card — GET /api/social/followers/:userId',
        });
      } else {
        unreadable.push('Followers (GET /api/social/followers/:userId)');
      }
    } catch {
      unreadable.push('Followers (GET /api/social/followers/:userId)');
    }

    try {
      const res = await api.get('/api/social/analytics/creator', {
        params: { userId },
      });
      const data = res.data as
        | {
            overview?: { totalReach?: number; engagementRate?: number };
            totalReach?: number;
            engagementRate?: number;
          }
        | undefined;
      // CreatorAnalytics renders this endpoint nested under `overview`;
      // the flat read is kept as a fallback for the endpoint's other shape.
      const reach = num(data?.overview?.totalReach) ?? num(data?.totalReach);
      if (reach !== undefined) {
        facts.push({
          label: 'Total Reach',
          value: formatNumber(reach),
          source: 'Analytics Overview "Total Reach" card — GET /api/social/analytics/creator',
        });
      } else {
        unreadable.push('Total Reach (GET /api/social/analytics/creator)');
      }
      const rate = num(data?.overview?.engagementRate) ?? num(data?.engagementRate);
      if (rate !== undefined) {
        facts.push({
          label: 'Engagement Rate',
          value: `${rate.toFixed(1)}%`,
          source: 'Analytics Overview "Engagement Rate" card — GET /api/social/analytics/creator',
        });
      } else {
        unreadable.push('Engagement Rate (GET /api/social/analytics/creator)');
      }
    } catch {
      unreadable.push('Total Reach (GET /api/social/analytics/creator)');
      unreadable.push('Engagement Rate (GET /api/social/analytics/creator)');
    }
  } else {
    unreadable.push('Followers (needs the signed-in profile)');
    unreadable.push('Total Reach (needs the signed-in profile)');
    unreadable.push('Engagement Rate (needs the signed-in profile)');
  }

  // Total DTUs leads: it is the account question the analyst got wrong.
  facts.sort((a, b) => {
    if (a.label === 'Total DTUs') return -1;
    if (b.label === 'Total DTUs') return 1;
    return 0;
  });

  return { facts, unreadable };
}

const PROVIDERS: Record<string, () => Promise<LensFactsResult>> = {
  analytics: fetchAnalyticsFacts,
};

const DECLINE_RULE =
  'Rule: answer questions about this account ONLY from the facts above, and name the source you used. ' +
  'If a value is not listed above, say the surface doesn\'t give you that — never estimate, ' +
  'never round into an approximation, and never reuse an example or placeholder number.';

/**
 * Build the grounded-facts system-prompt block for a chat domain context.
 * Returns '' for domains without a provider (prior behaviour, unchanged).
 * Never throws: a failed read becomes a decline instruction, not a guess.
 */
export async function buildLensFactsBlock(domain: string): Promise<string> {
  const provider = domain ? PROVIDERS[domain] : undefined;
  if (!provider) return '';

  let result: LensFactsResult;
  try {
    result = await provider();
  } catch {
    result = { facts: [], unreadable: ['the lens account data'] };
  }

  if (result.facts.length === 0) {
    return [
      'ACCOUNT FACTS — Analytics could not be read just now (the live surface did not answer).',
      'Rule: if the user asks about this account\'s values (DTU counts, citations, followers, reach, totals), ' +
        'say the surface doesn\'t give you that right now — never estimate or invent a number.',
    ].join('\n');
  }

  const lines = [
    'ACCOUNT FACTS — Analytics, read live from the Analytics surface just now. ' +
      'These are the account\'s real values; they override any examples, placeholders, ' +
      'or numbers mentioned earlier in this conversation:',
    ...result.facts.map((f) => `- ${f.label}: ${f.value} (source: ${f.source})`),
  ];
  if (result.unreadable.length > 0) {
    lines.push(
      `Not readable just now: ${result.unreadable.join('; ')}. ` +
        'If asked about those, say the surface doesn\'t give you that right now.',
    );
  }
  lines.push(DECLINE_RULE);
  return lines.join('\n');
}
