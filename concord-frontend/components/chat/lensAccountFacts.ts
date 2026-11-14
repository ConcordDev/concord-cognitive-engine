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
 *
 * R1 (re-review Addendum 4 — A19/A20): the provider's reads mirror the
 * surface cards' OWN calls and derivations verbatim (same helper, same
 * arguments, same fallback expression), because a paraphrased read can
 * land on a different store's number. A source counts as unreadable only
 * when its fetch fails (or returns a shape the surface itself could not
 * render); on a successful fetch the fact takes the card's displayed
 * value INCLUDING the card's own defaulting — the Overview paints 0 for
 * an absent summary, so 0 is the grounded fact, not a decline. The block
 * also disqualifies conversation-context DTU counts (retrieved/harvested
 * tallies injected by the chat pipeline) as account totals.
 * A domain with no provider yields an empty block: behaviour for that domain
 * is exactly what it was before this module existed.
 */

import { api, apiHelpers, lensRun } from '@/lib/api/client';
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
  /** Display name for the block heading (default 'Analytics'). */
  lensLabel?: string;
  /** The closing instruction (default: the Analytics decline rule). */
  rule?: string;
}

/** A finite number from an unknown payload field, or undefined. Never coerces. */
function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

interface ProfileShape {
  userId?: string;
  id?: string;
  stats?: { citationCount?: number; followerCount?: number };
}

async function fetchAnalyticsFacts(): Promise<LensFactsResult> {
  const facts: AccountFact[] = [];
  const unreadable: string[] = [];

  // Profile first: it carries Citations and the userId the followers and
  // creator reads key off — the same order AnalyticsDeskPanel resolves them.
  let userId = '';
  let profileFollowerCount: number | undefined;
  try {
    const res = await api.get('/api/social/profile');
    // Mirror the card exactly (AnalyticsDeskPanel): the profile lives at
    // res.data.profile and the account key is its userId — no fallback to
    // a bare-body shape or a secondary id field. A profile without a
    // userId leaves the keyed reads (followers, creator) honestly
    // unreadable below rather than keying them off a guessed id
    // (deploy-lane flag GB-0083, "client userId fallback").
    const profile = res.data?.profile as ProfileShape | undefined;
    userId = profile?.userId || '';
    profileFollowerCount = num(profile?.stats?.followerCount);
    if (profile) {
      // The card renders `stats?.citationCount || 0`: on a successful fetch
      // an absent stat IS the displayed 0, so 0 is the grounded fact.
      const citations = num(profile.stats?.citationCount) ?? 0;
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
    // The card's verbatim call and derivation (AnalyticsDeskPanel):
    // myDtus({ limit: 100, offset: 0 }), then `data?.total || dtus.length`.
    // A limit-1 paraphrase of this read is how a grounded fact can land on
    // a different number than the card shows (A19) — never paraphrase it.
    const res = await apiHelpers.dtus.myDtus({ limit: 100, offset: 0 });
    const data = res.data as { total?: number; dtus?: unknown[] } | undefined;
    // The fetch succeeded, so the card paints a number: `total || dtus.length`
    // with the panel's [] default — the fact is that number, exactly.
    const total = num(data?.total) ||
      (Array.isArray(data?.dtus) ? data.dtus.length : 0);
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
    // The card defaults an absent summary to { total: 0 } and paints 0 —
    // on a successful fetch that 0 is the grounded fact (A20's rule).
    const total = num(res.data?.summary?.total) ?? 0;
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
      // The card's chain: endpoint count, then the profile stat, then 0 —
      // on a successful fetch the fact is wherever that chain lands.
      const count = num(res.data?.count) ??
        (Array.isArray(res.data?.followers)
          ? res.data.followers.length
          : profileFollowerCount ?? 0);
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

/**
 * ConKay (Review 3 F2 — the origin-labelling rule's sharpest instance):
 * arriving with ?context=conkay, the analyst denied the user's open study
 * existed and quoted an ENGINEERING frame DTU from the shared store as
 * "the most recent FEA result". The reads below mirror the workspace's
 * own calls (useConKayWorkspace.reload / the Models rail), so "current
 * model" and "most recent result" answer from the study itself.
 */
async function fetchConkayFacts(): Promise<LensFactsResult> {
  const facts: AccountFact[] = [];
  const unreadable: string[] = [];
  const STUDY_SOURCE = 'ConKay workspace study — POST /api/lens/run engineering.beamStudy-get';

  try {
    const r = await lensRun<{ study: Record<string, unknown> | null }>('engineering', 'beamStudy-get', {});
    if (r.data?.ok === false) {
      unreadable.push('Current study (engineering.beamStudy-get)');
    } else {
      const s = r.data?.result?.study;
      if (!s) {
        facts.push({ label: 'Current study', value: 'No study has been solved or saved in this workspace yet.', source: STUDY_SOURCE });
      } else {
        const dims = (s.dims ?? {}) as Record<string, unknown>;
        const mat = (s.materialInfo ?? {}) as { label?: string };
        const sum = (s.summary ?? {}) as Record<string, unknown>;
        const dimLine = ['length', 'height', 'flangeWidth', 'flangeThickness', 'webThickness']
          .map((k) => num(dims[k])).filter((v) => v !== undefined);
        facts.push({
          label: 'Current study',
          value: `“${String(s.name || 'I-beam study')}” — ${dimLine.length === 5 ? `L ${dimLine[0]} mm, D ${dimLine[1]} mm, W ${dimLine[2]} mm, t_f ${dimLine[3]} mm, t_w ${dimLine[4]} mm, ` : ''}${String(s.support || '')}, point load ${num(s.loadN) !== undefined ? `${(num(s.loadN)! / 1000).toFixed(1)} kN` : '—'}, material ${mat.label || String(s.material || '')}`,
          source: STUDY_SOURCE,
        });
        const stress = num(sum.maxStressMPa), defl = num(sum.maxDeflectionMm), util = num(sum.utilization), sf = num(sum.safetyFactor);
        if (stress !== undefined && defl !== undefined && util !== undefined) {
          facts.push({
            label: 'Most recent FEA result',
            value: `max stress ${stress.toFixed(1)} MPa, deflection ${defl.toFixed(3)} mm, utilization ${(util * 100).toFixed(1)}%${sf !== undefined ? `, safety factor ${sf.toFixed(2)}` : ''}${typeof sum.pass === 'boolean' ? (sum.pass ? ', within yield' : ', EXCEEDS yield') : ''} (job ${String(s.jobId || '—')})`,
            source: STUDY_SOURCE,
          });
        }
        facts.push({
          label: 'Kept as DTU',
          value: s.dtuId ? String(s.dtuId) : 'Not kept — the current study has not been kept as a DTU.',
          source: STUDY_SOURCE,
        });
      }
    }
  } catch {
    unreadable.push('Current study (engineering.beamStudy-get)');
  }

  try {
    const r = await lensRun<{ parts: Array<{ name?: string }> }>('engineering', 'listParts', {});
    if (r.data?.ok === false) {
      unreadable.push('Saved models (engineering.listParts)');
    } else {
      const parts = r.data?.result?.parts ?? [];
      const names = parts.slice(0, 5).map((p) => `“${String(p?.name || '')}”`).filter((n) => n !== '“”');
      facts.push({
        label: 'Saved models',
        value: parts.length === 0 ? 'None saved yet.' : `${parts.length} saved${names.length ? `: ${names.join(', ')}${parts.length > names.length ? ', …' : ''}` : ''}`,
        source: 'ConKay Models rail — POST /api/lens/run engineering.listParts',
      });
    }
  } catch {
    unreadable.push('Saved models (engineering.listParts)');
  }

  return {
    facts,
    unreadable,
    lensLabel: 'ConKay',
    rule:
      'Rule: the user\'s current model and most recent FEA result are the study facts above — answer those questions ONLY from them, and name the source you used. '
      + 'The DTU store is shared across lenses: a record found there (for example an Engineering frame or simulation) is NOT the user\'s ConKay study, even when it is the newest record. '
      + 'If you cite a store record, name the lens it came from. If a value is not listed above, say the surface doesn\'t give you that — never estimate or invent one.',
  };
}

async function fetchUxSuiteFacts(): Promise<LensFactsResult> {
  const facts: AccountFact[] = [];
  const unreadable: string[] = [];
  const CATALOG_SOURCE = 'UX Suite Component Workbench catalog — POST /api/lens/run ux-suite.catalog';
  const FAVOURITES_SOURCE = 'UX Suite Component Workbench starred list — POST /api/lens/run ux-suite.favourites-list';

  // Mirror the workbench's own load (ComponentWorkbench): the same two
  // calls, the same success test (r.data?.ok && r.data.result), the same
  // fields it renders — the catalog's component/group counts and the
  // caller's starred names. Nothing else is quoted.
  try {
    const r = await lensRun<{
      components?: unknown[];
      groups?: Array<{ id?: string; label?: string; count?: number }>;
      source?: string;
    }>('ux-suite', 'catalog', {});
    if (r.data?.ok === false || !r.data?.result) {
      unreadable.push('Component catalog (ux-suite.catalog)');
    } else {
      const components = Array.isArray(r.data.result.components) ? r.data.result.components : [];
      const groups = Array.isArray(r.data.result.groups) ? r.data.result.groups : [];
      const groupLine = groups
        .map((g) => `${String(g?.label || g?.id || '')} ${num(g?.count) ?? 0}`)
        .filter((s) => s.trim() !== '')
        .join(', ');
      facts.push({
        label: 'Catalogued components',
        value: `${components.length} components across ${groups.length} groups${groupLine ? ` — ${groupLine}` : ''}`,
        source: CATALOG_SOURCE,
      });
      const source = typeof r.data.result.source === 'string' ? r.data.result.source : '';
      if (source) {
        facts.push({ label: 'Catalog source', value: source, source: CATALOG_SOURCE });
      }
    }
  } catch {
    unreadable.push('Component catalog (ux-suite.catalog)');
  }

  try {
    const r = await lensRun<{ favourites?: string[] }>('ux-suite', 'favourites-list', {});
    if (r.data?.ok === false || !r.data?.result) {
      unreadable.push('Starred components (ux-suite.favourites-list)');
    } else {
      const favourites = Array.isArray(r.data.result.favourites) ? r.data.result.favourites : [];
      const names = favourites.slice(0, 5).map((n) => `“${String(n)}”`);
      facts.push({
        label: 'Your starred components',
        value: favourites.length === 0
          ? 'None starred yet.'
          : `${favourites.length} starred${names.length ? `: ${names.join(', ')}${favourites.length > names.length ? ', …' : ''}` : ''}`,
        source: FAVOURITES_SOURCE,
      });
    }
  } catch {
    unreadable.push('Starred components (ux-suite.favourites-list)');
  }

  return {
    facts,
    unreadable,
    lensLabel: 'UX Suite',
    rule:
      'Rule: answer questions about this lens ONLY from the facts above, and name the source you used. ' +
      'The catalog is the workbench\'s live component directory — component counts, group counts, and the ' +
      'user\'s starred components are the figures above, exactly as stated. If a value is not listed above, ' +
      'say the surface doesn\'t give you that — never estimate or invent a number.',
  };
}

/**
 * Defense facts (FIX-defense-006) — the Ask from Defense answered with
 * generic web-search results because the analyst had a context label and
 * none of the lens's readiness inputs. The reads mirror the Defense
 * surface's own DashboardStats verbatim (the same four lensRun boards,
 * the same success test — data.ok with a result), which are exactly the
 * readiness inputs the ticket names.
 */
async function fetchDefenseFacts(): Promise<LensFactsResult> {
  const facts: AccountFact[] = [];
  const unreadable: string[] = [];

  const [assetsR, threatsR, personnelR, supplyR] = await Promise.all([
    lensRun('defense', 'asset-rollup', {}).catch(() => null),
    lensRun('defense', 'threat-board', {}).catch(() => null),
    lensRun('defense', 'personnel-roster', {}).catch(() => null),
    lensRun('defense', 'supply-board', {}).catch(() => null),
  ]);

  const assets = assetsR?.data?.ok ? (assetsR.data.result as Record<string, unknown> | undefined) : undefined;
  const fleetReadiness = num(assets?.fleetReadiness);
  const inService = num(assets?.inService);
  const assetsTotal = num(assets?.total);
  if (fleetReadiness !== undefined && inService !== undefined && assetsTotal !== undefined) {
    const availability = num(assets?.availabilityPct);
    facts.push({
      label: 'Fleet readiness',
      value: `${formatNumber(fleetReadiness)}% across ${formatNumber(inService)} in-service assets (${formatNumber(assetsTotal)} total${availability !== undefined ? `, ${formatNumber(availability)}% available` : ''})`,
      source: 'Defense Dashboard stats — defense.asset-rollup',
    });
  } else unreadable.push('the asset rollup');

  const threats = threatsR?.data?.ok ? (threatsR.data.result as Record<string, unknown> | undefined) : undefined;
  const threatsTotal = num(threats?.total);
  if (threatsTotal !== undefined) {
    const highest = typeof threats?.highestSeverity === 'string' ? threats.highestSeverity : 'none';
    const activeWatch = num(threats?.activeWatch);
    facts.push({
      label: 'Threat picture',
      value: `${formatNumber(threatsTotal)} tracked threats — highest severity ${highest}${activeWatch !== undefined ? `, ${formatNumber(activeWatch)} on active watch` : ''}`,
      source: 'Defense Dashboard stats — defense.threat-board',
    });
  } else unreadable.push('the threat board');

  const personnel = personnelR?.data?.ok ? (personnelR.data.result as Record<string, unknown> | undefined) : undefined;
  const rosterTotal = num(personnel?.total);
  if (rosterTotal !== undefined) {
    const deployable = num(personnel?.deployable);
    facts.push({
      label: 'Personnel',
      value: `${formatNumber(rosterTotal)} on the roster${deployable !== undefined ? `, ${formatNumber(deployable)} available to deploy` : ''}`,
      source: 'Defense Dashboard stats — defense.personnel-roster',
    });
  } else unreadable.push('the personnel roster');

  const supply = supplyR?.data?.ok ? (supplyR.data.result as Record<string, unknown> | undefined) : undefined;
  const supplyTotal = num(supply?.total);
  if (supplyTotal !== undefined) {
    const openCount = num(supply?.openCount);
    const fulfillment = num(supply?.fulfillmentPct);
    facts.push({
      label: 'Supply',
      value: `${formatNumber(supplyTotal)} supply requests${openCount !== undefined ? ` — ${formatNumber(openCount)} open` : ''}${fulfillment !== undefined ? `, fulfillment ${formatNumber(fulfillment)}%` : ''}`,
      source: 'Defense Dashboard stats — defense.supply-board',
    });
  } else unreadable.push('the supply board');

  return {
    facts,
    unreadable,
    lensLabel: 'Defense',
    rule:
      'Rule: answer questions about Defense readiness ONLY from the facts above, and name the source you used. ' +
      'If a readiness input is not listed above, say the Defense surface doesn\'t give you that right now — never ' +
      'describe readiness, threats, personnel, or supply from general knowledge or web results.',
  };
}

/**
 * Attention facts (FIX-attention-005, grounding leg) — the Ask from
 * Attention punted ("Which lens are you looking at?") because the analyst
 * had a label and none of the lens's live state. The reads mirror the
 * Attention desks' own calls: the attention status (the Focus desk), and
 * the thread list (the Threads desk), read the way AttentionThreads
 * reads them.
 */
async function fetchAttentionFacts(): Promise<LensFactsResult> {
  const facts: AccountFact[] = [];
  const unreadable: string[] = [];

  const statusR = await lensRun('attention', 'status', {}).catch(() => null);
  const status = statusR?.data?.ok ? (statusR.data.result as Record<string, unknown> | undefined) : undefined;
  if (status && typeof status === 'object') {
    const activeThreads = Array.isArray(status.activeThreads)
      ? status.activeThreads.length
      : num(status.activeThreads);
    const queue = num(status.queueLength) ?? num(status.queueDepth);
    const stats = status.stats as Record<string, unknown> | undefined;
    const completed = num(stats?.threadsCompleted) ?? num(status.totalCompleted);
    const focus = typeof status.focus === 'string' ? status.focus : undefined;
    if (activeThreads !== undefined || queue !== undefined) {
      facts.push({
        label: 'Attention state',
        value: `${formatNumber(activeThreads ?? 0)} active threads, ${formatNumber(queue ?? 0)} queued${focus ? ` — current focus: ${focus}` : ''}${completed !== undefined ? `, ${formatNumber(completed)} completed` : ''}`,
        source: 'Attention Focus desk — attention.status',
      });
    }
  }
  if (facts.length === 0) unreadable.push('the attention status');

  const threadsR = await lensRun('attention', 'list_threads', {}).catch(() => null);
  const threadsData = threadsR?.data?.ok ? threadsR.data.result : undefined;
  const threads = Array.isArray(threadsData)
    ? threadsData
    : ((threadsData as { threads?: unknown[] } | undefined)?.threads ?? []);
  const top = threads[0] as Record<string, unknown> | undefined;
  const topDesc = typeof top?.description === 'string' ? top.description : undefined;
  if (topDesc) {
    facts.push({
      label: 'Top thread',
      value: topDesc,
      source: 'Attention Threads desk — attention.list_threads',
    });
  }

  return {
    facts,
    unreadable,
    lensLabel: 'Attention',
    rule:
      'Rule: answer questions about the Attention lens ONLY from the facts above, and name the source you used. ' +
      'You are answering about the Attention lens — never ask which lens the user means when the facts above are ' +
      'present. If a value is not listed above, say the Attention surface doesn\'t give you that right now.',
  };
}

/**
 * Feed facts (FIX-feed-009, answer leg) — the Ask from Feed answered
 * about another lens because a reused thread's history was the only
 * context the analyst had: the facts block is built for the launch's
 * domain on every send, so these live values are the counterweight.
 * The reads mirror the Feed surface's own timeline hook (useFeedPosts):
 * the For You endpoint's first page, the scheduler's scheduled list,
 * and the caller's bookmark set.
 */
async function fetchFeedFacts(): Promise<LensFactsResult> {
  const facts: AccountFact[] = [];
  const unreadable: string[] = [];

  try {
    const res = await api.get('/api/social/feed/foryou', { params: { limit: 20, offset: 0 } });
    const posts = (res.data as { posts?: unknown[] } | undefined)?.posts;
    if (Array.isArray(posts)) {
      facts.push({
        label: 'For You timeline',
        value: `${formatNumber(posts.length)} posts on the first page`,
        source: 'Feed timeline — GET /api/social/feed/foryou',
      });
    } else unreadable.push('the For You timeline');
  } catch {
    unreadable.push('the For You timeline');
  }

  try {
    const res = await api.get('/api/social/scheduled');
    const data = res.data as { scheduled?: unknown[]; posts?: unknown[] } | unknown[] | undefined;
    const rows = Array.isArray(data) ? data : (data?.scheduled ?? data?.posts);
    if (Array.isArray(rows)) {
      facts.push({
        label: 'Scheduled posts',
        value: `${formatNumber(rows.length)} scheduled`,
        source: 'Feed scheduler — GET /api/social/scheduled',
      });
    }
  } catch { /* the scheduled count is an extra; its absence is not a decline trigger */ }

  try {
    const res = await api.get('/api/social/bookmarks', { params: { limit: 500 } });
    const data = res.data as unknown[] | { bookmarks?: unknown[]; ids?: unknown[] } | undefined;
    const rows = Array.isArray(data) ? data : (data?.bookmarks ?? data?.ids);
    if (Array.isArray(rows)) {
      facts.push({
        label: 'Bookmarks',
        value: `${formatNumber(rows.length)} bookmarked posts`,
        source: 'Feed bookmarks — GET /api/social/bookmarks',
      });
    }
  } catch { /* as above */ }

  return {
    facts,
    unreadable,
    lensLabel: 'Feed',
    rule:
      'Rule: answer questions about the Feed lens ONLY from the facts above, and name the source you used. ' +
      'You are answering about the Feed lens and the user\'s own feed state — never describe another lens\'s ' +
      'contents in its place. If a value is not listed above, say the Feed surface doesn\'t give you that right now.',
  };
}

/**
 * Hypothesis facts (FIX-hypothesis-006, answer leg) — the Ask from
 * Hypothesis answered about another lens for the same reason: no facts
 * for the launch's domain. The reads mirror HypothesisLab's own hyp()
 * calls verbatim (hypothesis list + metrics, read off data.result the
 * way the lab reads them), and the average confidence renders exactly
 * as the lab renders it ((avgConfidence * 100).toFixed(0) + '%').
 */
async function fetchHypothesisFacts(): Promise<LensFactsResult> {
  const facts: AccountFact[] = [];
  const unreadable: string[] = [];

  const metricsR = await lensRun('hypothesis', 'metrics', {}).catch(() => null);
  const metrics = metricsR?.data?.ok ? (metricsR.data.result as Record<string, unknown> | undefined) : undefined;
  const total = num(metrics?.total);
  if (total !== undefined) {
    const byStatus = (metrics?.byStatus ?? {}) as Record<string, unknown>;
    const parts = ['proposed', 'testing', 'confirmed', 'rejected', 'refined', 'archived']
      .map((s) => ({ s, n: num(byStatus[s]) ?? 0 }))
      .filter((p) => p.n > 0)
      .map((p) => `${formatNumber(p.n)} ${p.s}`);
    const avg = num(metrics?.avgConfidence);
    facts.push({
      label: 'Hypotheses',
      value: `${formatNumber(total)} tracked${parts.length ? ` — ${parts.join(', ')}` : ''}${avg !== undefined ? `; average confidence ${(avg * 100).toFixed(0)}%` : ''}`,
      source: 'Hypothesis lab — hypothesis.metrics',
    });
    const factDtus = num(metrics?.factDTUsCreated);
    const rejectionDtus = num(metrics?.rejectionDTUsCreated);
    if (factDtus !== undefined && rejectionDtus !== undefined) {
      facts.push({
        label: 'Outcomes',
        value: `${formatNumber(factDtus)} fact DTUs created, ${formatNumber(rejectionDtus)} rejection DTUs`,
        source: 'Hypothesis lab — hypothesis.metrics',
      });
    }
  } else unreadable.push('the hypothesis metrics');

  const listR = await lensRun('hypothesis', 'list', {}).catch(() => null);
  const listData = listR?.data?.ok ? listR.data.result : undefined;
  const rows = Array.isArray(listData) ? listData : ((listData as { hypotheses?: unknown[] } | undefined)?.hypotheses ?? []);
  const first = rows[0] as { machine?: { hypothesis?: { statement?: unknown; status?: unknown } } } | undefined;
  const statement = typeof first?.machine?.hypothesis?.statement === 'string' ? first.machine.hypothesis.statement : undefined;
  if (statement) {
    facts.push({
      label: 'Most recent hypothesis',
      value: statement,
      source: 'Hypothesis lab — hypothesis.list',
    });
  }

  return {
    facts,
    unreadable,
    lensLabel: 'Hypothesis',
    rule:
      'Rule: answer questions about the Hypothesis lens ONLY from the facts above, and name the source you used. ' +
      'You are answering about the Hypothesis lens — never describe another lens\'s contents in its place. ' +
      'If a value is not listed above, say the Hypothesis surface doesn\'t give you that right now.',
  };
}

const PROVIDERS: Record<string, () => Promise<LensFactsResult>> = {
  analytics: fetchAnalyticsFacts,
  conkay: fetchConkayFacts,
  'ux-suite': fetchUxSuiteFacts,
  defense: fetchDefenseFacts,
  attention: fetchAttentionFacts,
  feed: fetchFeedFacts,
  hypothesis: fetchHypothesisFacts,
};

const DECLINE_RULE =
  'Rule: answer questions about this account ONLY from the facts above, and name the source you used. ' +
  'If a value is not listed above, say the surface doesn\'t give you that — never estimate, ' +
  'never round into an approximation, and never reuse an example or placeholder number. ' +
  'Counts of DTUs retrieved or harvested as conversation context are NOT account totals and must ' +
  'never be quoted as how many DTUs the user has — for that, the only citable figure is the ' +
  'Total DTUs fact above, exactly as stated; do not reconcile it against any other number.';

const CONTEXT_COUNT_RULE =
  'Counts of DTUs retrieved or harvested as conversation context are NOT account totals — ' +
  'never quote one as how many DTUs the user has.';

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

  const lensLabel = result.lensLabel || 'Analytics';
  if (result.facts.length === 0) {
    return [
      `ACCOUNT FACTS — ${lensLabel} could not be read just now (the live surface did not answer).`,
      'Rule: if the user asks about this account\'s values (DTU counts, citations, followers, reach, totals), ' +
        'say the surface doesn\'t give you that right now — never estimate or invent a number.',
      CONTEXT_COUNT_RULE,
    ].join('\n');
  }

  const lines = [
    `ACCOUNT FACTS — ${lensLabel}, read live from the ${lensLabel} surface just now. ` +
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
  lines.push(result.rule || DECLINE_RULE);
  return lines.join('\n');
}
