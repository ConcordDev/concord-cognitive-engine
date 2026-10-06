/**
 * An analytics dashboard report exists because the Analytics domain's
 * `event-track` / `analytics-dashboard` / `event-stats` macros returned the
 * real event log and aggregate counts — total events, unique users, events
 * today, distinct event types, and saved funnels. This module turns exactly
 * that result into a sentence, saves it as a private DTU, reads that DTU
 * back, and hands it to Thread as a draft.
 *
 * Every figure below comes from a macro response. A figure the backend did
 * not return is reported as missing, never invented. Nothing here publishes
 * anything: a Thread draft is a draft until the user posts it.
 */

import {
  dtuRecordId,
  dtuReadBackCall,
  dtuReadBackMatches,
  type ReceiptCall,
} from '@/components/wallet/walletReceipt';

export interface AnalyticsDashboardSummary {
  totalEvents: number;
  uniqueUsers: number;
  eventsToday: number;
  eventTypes: number;
  savedFunnels: number;
  savedDashboards?: number;
  savedAlerts?: number;
  behavioralCohorts?: number;
}

export interface AnalyticsReportFacts {
  dashboard: AnalyticsDashboardSummary | null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The dashboard report sentence, built only from the real detail. Null when
 * there is no dashboard or no tracked events at all.
 */
export function analyticsSentence(facts: AnalyticsReportFacts): string | null {
  const d = facts.dashboard;
  if (!d) return null;
  const total = num(d.totalEvents);
  if (total <= 0) return null;
  const users = num(d.uniqueUsers);
  const today = num(d.eventsToday);
  const types = num(d.eventTypes);
  const funnels = num(d.savedFunnels);
  return `${total} events tracked · ${users} unique users · ${today} today · ${types} event types · ${funnels} saved funnels.`;
}

/** The full body saved as the DTU. Empty when there is nothing honest to save. */
export function analyticsBody(facts: AnalyticsReportFacts): string {
  const sentence = analyticsSentence(facts);
  const d = facts.dashboard;
  if (!sentence || !d) return '';
  const lines = [sentence, ''];
  lines.push(`Total events: ${num(d.totalEvents)}`);
  lines.push(`Unique users: ${num(d.uniqueUsers)}`);
  lines.push(`Events today: ${num(d.eventsToday)}`);
  lines.push(`Distinct event types: ${num(d.eventTypes)}`);
  lines.push(`Saved funnels: ${num(d.savedFunnels)}`);
  if (d.savedDashboards != null) lines.push(`Saved dashboards: ${num(d.savedDashboards)}`);
  if (d.savedAlerts != null) lines.push(`Saved alerts: ${num(d.savedAlerts)}`);
  if (d.behavioralCohorts != null) lines.push(`Behavioral cohorts: ${num(d.behavioralCohorts)}`);
  lines.push('');
  lines.push('Every figure here came from the Analytics domain analytics-dashboard macro in Concord. Nothing was published by saving this.');
  return lines.join('\n');
}

/** The machine payload — the same dashboard the macro returned, structured. */
export function analyticsMachine(facts: AnalyticsReportFacts): Record<string, unknown> | null {
  const d = facts.dashboard;
  if (!analyticsSentence(facts) || !d) return null;
  return {
    kind: 'analytics_dashboard_report',
    totalEvents: num(d.totalEvents),
    uniqueUsers: num(d.uniqueUsers),
    eventsToday: num(d.eventsToday),
    eventTypes: num(d.eventTypes),
    savedFunnels: num(d.savedFunnels),
    savedDashboards: num(d.savedDashboards),
    savedAlerts: num(d.savedAlerts),
    behavioralCohorts: num(d.behavioralCohorts),
  };
}

/** The private DTU that records this dashboard. Null when nothing can be saved. */
export function analyticsDtuCall(facts: AnalyticsReportFacts): ReceiptCall | null {
  const body = analyticsBody(facts);
  const sentence = analyticsSentence(facts);
  const machine = analyticsMachine(facts);
  if (!body || !sentence || !machine) return null;
  const tags = ['analytics', 'events', 'dashboard'];
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: sentence.slice(0, 80),
      tags,
      source: 'analytics-lens:dashboard-report',
      human: { summary: body },
      core: { definitions: [sentence], claims: [body.slice(0, 240)] },
      machine,
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'analytics',
      },
    },
  };
}

export { dtuRecordId, dtuReadBackCall, dtuReadBackMatches };

/**
 * The Thread draft carrying that dashboard report. Thread stores a draft —
 * it does not publish. Null when there is no real DTU id to cite.
 */
export function analyticsThreadDraftCall(
  facts: AnalyticsReportFacts,
  dtuId: string,
  platform = 'x',
): ReceiptCall | null {
  const id = String(dtuId || '').trim();
  const sentence = analyticsSentence(facts);
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !sentence) return null;
  return {
    domain: 'thread',
    action: 'thread-draft',
    input: {
      title: 'Analytics dashboard report'.slice(0, 120),
      content: analyticsBody(facts),
      platform,
      citedDtuId: id,
    },
  };
}

export interface AnalyticsDraftResult {
  draftId: string;
  status: string;
  citedDtuId: string;
}

/** What the screen may claim about a Thread draft. Null when it did not land. */
export function analyticsThreadDraftOutcome(
  data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined,
  dtuId: string,
): AnalyticsDraftResult | null {
  if (!data || data.ok === false) return null;
  const result = data.result && typeof data.result === 'object' ? (data.result as Record<string, unknown>) : null;
  const draft = result?.draft && typeof result.draft === 'object' ? (result.draft as Record<string, unknown>) : null;
  if (!draft) return null;
  const draftId = String(draft.id || '').trim();
  const cited = String(draft.citedDtuId || '').trim();
  const status = String(draft.status || '').trim();
  if (!draftId || cited !== String(dtuId).trim() || status !== 'draft') return null;
  return { draftId, status, citedDtuId: cited };
}

/**
 * Index the drafts Thread already holds by the DTU they cite, so a reload
 * shows the same "Drafted in Thread" the send reported.
 */
export function indexAnalyticsDrafts(details: unknown): Record<string, string> {
  const list = Array.isArray(details) ? details : [];
  const out: Record<string, string> = {};
  for (const entry of list) {
    const envelope = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
    if (!envelope || envelope.ok === false) continue;
    const result = envelope.result && typeof envelope.result === 'object' ? (envelope.result as Record<string, unknown>) : envelope;
    const draft = result?.draft && typeof result.draft === 'object' ? (result.draft as Record<string, unknown>) : null;
    if (!draft) continue;
    const draftId = String(draft.id || '').trim();
    const cited = String(draft.citedDtuId || '').trim();
    if (!draftId || !cited || out[cited]) continue;
    out[cited] = draftId;
  }
  return out;
}