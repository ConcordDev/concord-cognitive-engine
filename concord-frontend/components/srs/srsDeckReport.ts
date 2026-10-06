/**
 * An SRS deck report exists because the SRS domain's `deck-list`,
 * `card-list`, `srs-dashboard`, and `study-stats` macros returned the real
 * deck, its cards, and the study aggregate. This module turns exactly that
 * result into a sentence, saves it as a private DTU, reads that DTU back,
 * and hands it to Thread as a draft.
 *
 * Every figure below comes from a macro response. A figure the backend did
 * not return is reported as missing, never invented. Nothing here publishes
 * anything: a Thread draft is a draft until the user posts it themselves.
 */

import {
  dtuRecordId,
  dtuReadBackCall,
  dtuReadBackMatches,
  type ReceiptCall,
} from '@/components/wallet/walletReceipt';

export interface SrsDeck {
  id: string;
  name: string;
  description?: string;
  cardCount?: number;
  newCount?: number;
  dueCount?: number;
  studyCount?: number;
}

export interface SrsDashboard {
  decks: number;
  totalCards: number;
  newCards: number;
  dueCards: number;
  matureCards: number;
  suspendedCards: number;
  reviewsLogged: number;
}

export interface SrsStats {
  totalReviews: number;
  accuracy: number;
  ratingBreakdown?: Record<string, number>;
}

export interface SrsFacts {
  deck: SrsDeck | null;
  dashboard: SrsDashboard | null;
  stats: SrsStats | null;
  cardCount: number;
}

/**
 * The deck sentence, built only from the real data. Null when there is no
 * deck at all.
 */
export function deckSentence(facts: SrsFacts): string | null {
  const d = facts.deck;
  const id = String(d?.id || '').trim();
  const name = String(d?.name || '').trim();
  if (!id || !name) return null;

  const parts: string[] = [];
  const cards = facts.cardCount > 0 ? facts.cardCount : (d?.cardCount ?? 0);
  if (cards > 0) parts.push(`${cards} cards`);
  if (d?.dueCount && d.dueCount > 0) parts.push(`${d.dueCount} due`);
  if (d?.newCount && d.newCount > 0) parts.push(`${d.newCount} new`);
  const stats = facts.stats;
  if (stats && stats.totalReviews > 0) {
    parts.push(`${stats.totalReviews} reviews`);
    if (Number.isFinite(stats.accuracy) && stats.accuracy > 0) {
      parts.push(`${Math.round(stats.accuracy * 100)}% accuracy`);
    }
  }
  const dash = facts.dashboard;
  if (dash && dash.matureCards > 0) parts.push(`${dash.matureCards} mature`);

  return `${name}: ${parts.length > 0 ? parts.join(', ') : 'no cards yet'}.`;
}

/** The full body saved as the DTU. Empty when there is nothing honest to save. */
export function deckBody(facts: SrsFacts): string {
  const sentence = deckSentence(facts);
  if (!sentence) return '';
  const lines = [sentence];
  const d = facts.deck;
  if (d?.description) lines.push(`Description: ${d.description}.`);
  if (d?.cardCount != null) lines.push(`Cards: ${d.cardCount} total, ${d.newCount ?? 0} new, ${d.dueCount ?? 0} due, ${d.studyCount ?? 0} studied.`);
  const dash = facts.dashboard;
  if (dash) {
    lines.push(`Dashboard: ${dash.decks} decks, ${dash.totalCards} total cards, ${dash.dueCards} due, ${dash.matureCards} mature, ${dash.reviewsLogged} reviews logged.`);
  }
  const stats = facts.stats;
  if (stats && stats.totalReviews > 0) {
    lines.push(`Study stats: ${stats.totalReviews} total reviews, ${Math.round(stats.accuracy * 100)}% accuracy.`);
    if (stats.ratingBreakdown) {
      const brk = Object.entries(stats.ratingBreakdown).map(([k, v]) => `${k}: ${v}`).join(', ');
      if (brk) lines.push(`Rating breakdown: ${brk}.`);
    }
  }
  lines.push('Every figure here came from the SRS domain in Concord. Nothing was published by saving this.');
  return lines.join('\n');
}

/** The machine payload — the same data, structured. */
export function deckMachine(facts: SrsFacts): Record<string, unknown> | null {
  if (!deckSentence(facts)) return null;
  const d = facts.deck;
  const dash = facts.dashboard;
  const stats = facts.stats;
  return {
    kind: 'srs_deck_report',
    deckId: String(d?.id || ''),
    deckName: String(d?.name || ''),
    cardCount: facts.cardCount || d?.cardCount || 0,
    dueCount: d?.dueCount ?? 0,
    newCount: d?.newCount ?? 0,
    matureCards: dash?.matureCards ?? 0,
    reviewsLogged: dash?.reviewsLogged ?? 0,
    totalReviews: stats?.totalReviews ?? 0,
    accuracy: stats && Number.isFinite(stats.accuracy) ? Number(stats.accuracy) : 0,
  };
}

/** The private DTU that records this deck. Null when nothing can be saved. */
export function deckReportDtuCall(facts: SrsFacts): ReceiptCall | null {
  const body = deckBody(facts);
  const sentence = deckSentence(facts);
  const machine = deckMachine(facts);
  if (!body || !sentence || !machine) return null;
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: sentence.slice(0, 80),
      tags: ['srs', 'deck-report', String(facts.deck?.id || 'deck').toLowerCase()],
      source: 'srs-lens:deck-report',
      human: { summary: body },
      core: { definitions: [sentence], claims: [body.slice(0, 240)] },
      machine,
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'srs',
        srs: {
          deckId: String(facts.deck?.id || ''),
          deckName: String(facts.deck?.name || ''),
        },
      },
    },
  };
}

export { dtuRecordId, dtuReadBackCall, dtuReadBackMatches };

/**
 * The Thread draft carrying that deck report. Thread stores a draft — it
 * does not publish. Null when there is no real DTU id to cite.
 */
export function deckThreadDraftCall(
  facts: SrsFacts,
  dtuId: string,
  platform = 'x',
): ReceiptCall | null {
  const id = String(dtuId || '').trim();
  const sentence = deckSentence(facts);
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !sentence) return null;
  return {
    domain: 'thread',
    action: 'thread-draft',
    input: {
      title: String(facts.deck?.name || 'SRS deck').slice(0, 120),
      content: deckBody(facts),
      platform,
      citedDtuId: id,
    },
  };
}

export interface DeckDraftResult {
  draftId: string;
  status: string;
  citedDtuId: string;
}

/** What the screen may claim about a Thread draft. Null when it did not land. */
export function deckThreadDraftOutcome(
  data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined,
  dtuId: string,
): DeckDraftResult | null {
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
export function indexDeckDrafts(details: unknown): Record<string, string> {
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