'use client';

/**
 * useDepthBadge — read the manifest's dataTier for a lens.
 *
 * Phase 1 of the 10-dimension UX completeness sprint. Wires the
 * IntegrationRegistry (Phase 2) → manifest → in-header chip so a user
 * always knows whether they're looking at live data, free open data,
 * a high-fidelity simulation, or honest demo data.
 *
 * Returns { tier, label, tone } where tone is the colour family the
 * DepthBadge component renders.
 */

import { useMemo } from 'react';
import { getLensManifest } from '@/lib/lenses/manifest';
import type { DataTier } from '@/lib/lenses/manifest';

export interface DepthBadgeInfo {
  tier: DataTier;
  label: string;
  /** Short caption shown on hover. */
  caption: string;
  /** Tone family the DepthBadge maps to a colour. */
  tone: 'live' | 'free' | 'sim' | 'demo';
}

const TIER_INFO: Record<DataTier, DepthBadgeInfo> = {
  REAL_LIVE: {
    tier: 'REAL_LIVE',
    label: 'Live',
    caption: 'Real, polled live from an external source.',
    tone: 'live',
  },
  REAL_FREE: {
    tier: 'REAL_FREE',
    label: 'Real',
    caption: 'Real but static / open-access dataset.',
    tone: 'free',
  },
  SIM_GRADE_A: {
    tier: 'SIM_GRADE_A',
    label: 'Simulated',
    caption: 'High-fidelity simulation grounded against a domain schema. Not real data.',
    tone: 'sim',
  },
  DEMO: {
    tier: 'DEMO',
    label: 'Demo',
    caption: 'Synthetic. This domain requires paywalled feeds we haven’t licensed yet.',
    tone: 'demo',
  },
};

/**
 * Game profile XP, quests, and achievements are the user's own activity.
 * The generic SIM_GRADE_A line ("Not real data") is false for those. The
 * chip names the two surfaces that actually are simulations.
 */
const LENS_DEPTH_OVERRIDE: Record<string, Pick<DepthBadgeInfo, 'label' | 'caption'>> = {
  'event-timeline': {
    label: 'Live',
    // Event-Timeline reads the platform's OWN substrate event log
    // (server/domains/event-timeline.js over event_timeline_log) — real
    // events streamed as they occur, not an external feed, so REAL_LIVE's
    // generic "polled live from an external source" caption would
    // misdescribe the source. Declared REAL_LIVE in the registry under
    // both spellings; the manifest entry now carries the tier.
    caption: 'Live — the platform’s own substrate event log, streamed as events occur.',
  },
  /**
   * Expedition-Journal (S-EJ-1): the canon-world expeditions are simulated,
   * but SIM_GRADE_A's generic "Not real data" caption would misdescribe the
   * other two things on the page — the traveller's own server-kept progress
   * and journal, and the base-camp almanac's real sunrise-sunset data.
   */
  'expedition-journal': {
    label: 'Simulated',
    caption: 'Simulated canon-world expeditions. Your stage progress and journal entries are your own records, kept on the server; the base-camp almanac is real sunrise-sunset data.',
  },
  'collab': {
    label: 'Live',
    // Collab's rooms are the caller's OWN records (title + note kept on
    // the account, dual-stored server-side) and its sessions are live
    // when collaborators join — not an external feed, so REAL_LIVE's
    // generic "polled live from an external source" caption would
    // misdescribe the source. Declared REAL_LIVE in the registry.
    caption: 'Live — your rooms and sessions, kept on your account.',
  },
  /**
   * Plumbing's field-service records are the account's own shop data,
   * persisted server-side — the Simulated declaration was false on its own
   * terms (Review 4's determination: real execution). REAL_LIVE's generic
   * "polled from an external source" caption would be its own falsehood.
   */
  plumbing: {
    label: 'Live',
    caption: 'Your own live shop records: technicians, jobs, invoices, parts and inspections are your account\'s real data, saved as you work.',
  },
  message: {
    label: 'Live',
    caption: 'Your own messaging workspace: channels, direct messages, saves and scheduled sends are your real records in the platform store. Nothing here is polled from an external source.',
  },
  game: {
    label: 'Lab & arcade sim',
    caption: 'Simulated: Design Lab forecasts and mini-game practice XP. Profile XP, quests, and achievements are your real activity.',
  },
  /**
   * Database connections are workspace copies held by Concord — no
   * remote server is contacted, so the generic REAL_LIVE line ("polled
   * live from an external source") is false for this lens (F14).
   */
  database: {
    label: 'Workspace',
    caption: 'Your workspace store: connections and datasets live in Concord’s workspace, not on a remote database server.',
  },
  /**
   * The world vehicle fleet (spawn/mine/inspector) is a real persistent DB
   * store, not a feed polled from an external source (F1) — so the generic
   * REAL_LIVE caption is false here.
   */
  garage: {
    label: 'Live',
    caption: 'Real account + world state: vehicles you spawn are persisted and shared with the 3D world, not demo data.',
  },
  /**
   * Retail's store is the account's own live store — products, orders and
   * stock are the merchant's real records. The generic REAL_FREE line
   * ("static / open-access dataset") was false about the machinery in both
   * directions, and REAL_LIVE's generic caption ("polled live from an
   * external source") would be false too: nothing here is polled.
   */
  retail: {
    label: 'Live',
    caption: 'Your own live store: products, orders and stock are your account’s real records, updated as you sell.',
  },
  /**
   * Emergency Services' registry is the user's own live substrate —
   * units, incidents and agency records persist per account on
   * Concord's backend — so the generic REAL_FREE line ("static /
   * open-access dataset") was false for this lens (F1). The seismic
   * half is a live USGS feed; the caption names both halves.
   */
  'emergency-services': {
    label: 'Live',
    caption: 'Live: units, incidents and agency records are your own data, stored on Concord’s backend and persisted per account. Seismic data is a live USGS feed.',
  },
  /**
   * Masonry's calculators execute for real against published spec tables
   * and the contractor suite's records persist server-side — the generic
   * REAL_LIVE line ("polled live from an external source") would claim a
   * feed this lens does not poll (F1 flip, Review 4 determination
   * 2026-11-01: real execution under a Simulated banner).
   */
  masonry: {
    label: 'Live',
    caption: 'Real execution: the calculators run against published masonry spec tables and your suite records are saved in your own workspace. No external feed is polled.',
  },
  /**
   * Environment is two halves under one tier: per-user records (sites,
   * samples, the GHG inventory) kept live in the workspace, plus live
   * open data (Open-Meteo air quality, USGS, GBIF). The generic REAL_LIVE
   * line ("polled live from an external source") describes only the
   * second half, so the caption names both.
   */
  environment: {
    label: 'Live workspace + open data',
    caption: 'Your sites, samples and GHG inventory, kept live in your workspace — plus live open data: Open-Meteo air quality, USGS water and GBIF species records.',
  },
  /**
   * ConKay's member path is live (determination probe 2026-10-31: solves
   * derive from member inputs, edits re-solve, saves persist); the generic
   * REAL_FREE line describes only its reference/showcase corpus. The
   * declaration is scoped to both halves (F1).
   */
  conkay: {
    label: 'Live · Real data',
    caption: 'Your studies are live: solves run on your inputs and saves persist. The reference materials and precomputed showcase designs are a real, static open-access dataset.',
  },
  /**
   * Cooking's member path (recipes, meal plan, pantry, shopping lists) is
   * the member's own live server state; the REAL_LIVE tier must not let
   * that claim swallow the reference layer, which is static open data.
   */
  cooking: {
    label: 'Live',
    caption: 'Live: your recipes, meal plan, pantry and shopping lists are your own data, saved as you work. The reference datasets (USDA FoodData Central, TheMealDB recipe feed) are real but static open-access data.',
  },
  /**
   * Real Estate declared REAL_FREE ("Real but static / open-access")
   * over a live, writable, persistent listing store — Review 5's
   * first pass reclassed it as a mis-scoped declaration (F1). The
   * listings are the member's own live records; the one external
   * feed is the US Census Bureau's ACS, named here and at the feed
   * surface itself.
   */
  realestate: {
    label: 'Live',
    caption: 'Live workspace: your listings, tours and notes are your real persistent records in Concord, and the tools work on them. The home-value feed is real too — US Census Bureau American Community Survey data, named at the feed.',
  },
  /**
   * Legal's matters, time, trust accounts and documents are the user's
   * own, saved server-side, and its case-law search queries the real
   * CourtListener API. The generic REAL_FREE line ("static / open-access
   * dataset") was false for this lens (gate record G1; the determination
   * probe persisted its matter across reload) — the caption states what
   * is live.
   */
  legal: {
    label: 'Live',
    caption: 'Live: your matters, time, trust accounts and documents are saved in your own workspace, and case law searches CourtListener.',
  },
  /**
   * Housing's substrate is the member's own persistent world state —
   * land claims and houses live in the platform database, owner-gated
   * in the lib (PROBE-BLOCKED at the then-missing claim surface in
   * Review 3's first pass; the claim path is wired in the full build).
   * The generic REAL_LIVE line ("polled live from an external source")
   * is false for this lens; no external source is polled (S-HO-3).
   */
  housing: {
    label: 'Live',
    caption: 'Your world records: land claims and houses are your real persistent state in Concord’s worlds, and the tools work on your own plots and buildings. No external feed is polled.',
  },
  /**
   * Daily's journal lives in two of the platform's own stores (the
   * Today panel's artifacts and the Studio's domain store) and the
   * lens's read-back — timeline, dashboard, streaks, the Daily Actions
   * and the journal export — computes over the union of both. The
   * generic REAL_LIVE line ("polled live from an external source") is
   * false for the journal; only the Inspiration/feed quotes are
   * external, and they are labelled at their panels.
   */
  daily: {
    label: 'Live',
    caption: 'Your journal lives here, in the platform store — Today and Studio read the same days from both of its stores, and the summaries, streaks and exports are computed from those records. Inspiration quotes and the quote feed are read live from ZenQuotes, labelled at their panels.',
  },
  /**
   * LFG rows are the players' own live requests in the platform's
   * lfg_requests store — the board itself is the source, not an external
   * poll. The caption names that and reads an empty board truthfully.
   */
  lfg: {
    label: 'Live',
    caption: 'Live group requests posted by players across Concord’s worlds, read from the board itself — an empty board means nobody is looking right now.',
  },
  /**
   * Personas are authored by users on the platform and traded in its own
   * marketplace — the store is the source, not an external poll. Chat
   * replies carry their own basis labels in the chat itself.
   */
  personas: {
    label: 'Live',
    caption: 'Personas authored by you and other authors, read live from the platform’s own store — an empty marketplace means nobody has published one yet.',
  },
  /**
   * Nonprofit's own records (campaigns, donors, volunteers, pages, events)
   * are live per-user workspace data; the 990 research data is ProPublica's
   * open-access IRS dataset — real, but static reference data. The generic
   * REAL_LIVE line would blur that split, so the caption names both halves.
   */
  nonprofit: {
    label: 'Workspace',
    caption: 'Your workspace data: campaigns, donors, volunteers and pages are your live records; 990 research data is ProPublica’s open-access IRS dataset.',
  },
  /**
   * Announcements are Concord's OWN operator record — published by admins
   * into the platform's announcements table and read live from it. The
   * generic REAL_LIVE line ('polled live from an external source') is
   * false here; the caption names the source and reads an empty feed
   * truthfully (nothing published yet, not a broken surface).
   */
  announcements: {
    label: 'Live',
    caption: 'Concord’s own operator announcements, read live from the platform’s record — an empty feed means nothing has been published yet.',
  },
  /**
   * Feed's timeline is the platform's own social store — posts by the
   * people on this instance — and its tools state (lists, polls, folders,
   * saved searches, threads, controls) persists per account on Concord's
   * backend. The generic REAL_LIVE line ("polled live from an external
   * source") is false for this lens; the one external surface is the HN
   * view, labelled there.
   */
  feed: {
    label: 'Live',
    caption: 'The timeline is this instance’s own social store: posts by the people here, and your lists, polls, folders and saved searches persist on Concord’s backend. Nothing here is polled from an external source; the HN view is the one external feed and says so.',
  },
};

export function useDepthBadge(lensId: string): DepthBadgeInfo | null {
  return useMemo(() => {
    if (!lensId) return null;
    const manifest = getLensManifest(lensId);
    if (!manifest?.dataTier) return null;
    const info = TIER_INFO[manifest.dataTier];
    if (!info) return null;
    const override = LENS_DEPTH_OVERRIDE[lensId];
    return override ? { ...info, ...override } : info;
  }, [lensId]);
}

export { TIER_INFO };
