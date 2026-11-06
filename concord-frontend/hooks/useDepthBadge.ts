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
  /**
   * Urban Planning's workspace records (parcels, scenarios, projects,
   * comments) are the account's own persisted data, and its County Data
   * tab pulls live US Census ACS + HUD figures for its six preset metro
   * counties — neither half is simulation (Review 5's Step-0a finding:
   * the lens shipped a Simulated banner over a live-data surface). The
   * generic REAL_LIVE caption names only the external half, so the
   * override names both.
   */
  'urban-planning': {
    label: 'Live',
    caption: 'Live: your own parcels, scenarios, projects and comments, saved as you work — plus live US Census ACS and HUD figures for the six preset metro counties in County Data.',
  },
  /**
   * Ghost Tracker's residues are the world's real drift events, read
   * live from the world's drift_alerts state — not an external feed, so
   * the generic REAL_LIVE caption ("polled live from an external
   * source") is false here. The caption answers the question this lens
   * most needs answered (Review 4's compilation): whether an empty
   * plane means a healthy world, an unconnected tracker, or a
   * simulation.
   */
  'ghost-tracker': {
    label: 'Live',
    caption: 'Live: residues are the world\'s real drift events, read from live world state as they occur — an empty plane means the world is quiet right now, not a simulation or a dead feed. Your hunts, dossiers and confront history are your own records.',
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
   * Construction's substrate is the user's own project record — jobs,
   * RFIs, submittals, logs and budgets persist server-side per account
   * (PROBE-LIVE in Review 5's full first pass) and the bench tools
   * compute over the user's own inputs. The generic REAL_LIVE line
   * ("polled live from an external source") is false for this lens;
   * its one external surface (federal datasets) links out and claims
   * no feed (F1/F4).
   */
  construction: {
    label: 'Live',
    caption: 'Your project records: jobs, RFIs, submittals, logs and budgets are your real workspace data, and the bench tools compute over your inputs. Federal datasets open on catalog.data.gov — no external feed is polled.',
  },
  /**
   * Aviation's records are the user's own, saved server-side, and its
   * weather/feed surfaces poll real external sources (NOAA METAR/TAF,
   * NOTAMs, the OpenSky network). The generic REAL_FREE line ("static /
   * open-access dataset") was false for this lens in both directions
   * (gate record G1/G2); the caption states what is live.
   */
  aviation: {
    label: 'Live',
    caption: 'Live: your aircraft, logbook and plans are saved in your own workspace, with live METAR/TAF, NOTAMs and OpenSky traffic.',
  },
  /**
   * Telecommunications records (sites, spectrum, outages, drive tests) are
   * the user's own live workspace data, and the planning figures are
   * computed over them — but nothing here is carrier telemetry, so the
   * generic REAL_LIVE line ("polled live from an external source") would
   * overclaim in the other direction (G1/F1).
   */
  telecommunications: {
    label: 'Workspace',
    caption: 'Your workspace planning data: sites, spectrum, outages and drive tests are your live records; coverage, capacity and SLA figures are computed over them — not live carrier-network data.',
  },
  /**
   * Electrical's substrate is the user's own trade record — panels,
   * estimates, invoices, checklists and diagrams persist server-side
   * per account (PROBE-LIVE in Review 5's full first pass) and the NEC
   * bench computes over the user's own inputs. The generic REAL_LIVE
   * line ("polled live from an external source") is false for this
   * lens; no external source is polled (F1).
   */
  electrical: {
    label: 'Live',
    caption: 'Your trade records: panels, estimates, invoices, checklists and diagrams are your real workspace data, and the NEC bench tools compute over your inputs. No external feed is polled.',
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
   * Sub-Worlds mixes three content kinds on one surface (the compilation's
   * census flag for this lens): spawned worlds are users' own records in
   * the platform store — not demo data, and not polled from anywhere —
   * while the Repos view is a live GitHub search, labelled in that view.
   * The generic REAL_LIVE caption ("polled live from an external source")
   * is true of the Repos view only, so the declaration carries the
   * distinction in its own text: ONE lens declaration, kinds named.
   */
  'sub-worlds': {
    label: 'Live',
    caption: 'Worlds here are real records in the platform store — yours and other creators’ public worlds, spawned, hosted and visited in Concord. The Repos view is a live GitHub search, labelled there; the worlds themselves are not polled from an external source.',
  },
  /**
   * Deities is the census's badge-only pole: the Explore panel carries a
   * "wikipedia REST · live" SOURCE badge for its feed, which is not a
   * lens declaration (the gate record's own census rule). The pantheon
   * itself is player-composed religion — other players' creations, kept
   * as live records in the platform store — so over this content the
   * declaration is a trust statement: not authored content, not
   * simulation, and not polled from Wikipedia either; only the Explore
   * panel reads from there. The generic REAL_LIVE caption would blur
   * exactly that distinction, so the caption carries it.
   */
  deities: {
    label: 'Live',
    caption: 'Deities here are composed by players and kept as live records in the platform store — the pantheon is other players’ creations, not authored or simulated content. The Explore panel reads live from Wikipedia, badged there.',
  },
  /**
   * Goddess is the family row whose declaration is written AGAINST a
   * determination (the compilation joins S1 to A1): the composer
   * (server/lib/goddess-broadcaster.js) is real composition — the
   * tone bands on the world's ecosystem score, the body varies with
   * refusal-field strength and drift kind, all three inputs read from
   * live world machinery and persisted with each dispatch. The flat
   * archive of record is that composer faithfully reporting a
   * dead-flat world, not a constant emitter — so the tier is
   * REAL_LIVE (the integration registry already reads it so), and
   * the caption states the consequence a reader needs: a quiet
   * world reads quiet. No cadence is asserted here; the "composed
   * hourly" reconciliation (A2) is the pass's live leg.
   */
  goddess: {
    label: 'Live',
    caption: 'Broadcasts are composed live from this world’s own signals — ecosystem score, refusal-field strength, and drift events — and each dispatch is recorded with the inputs it was composed from. A quiet world reads quiet: identical dispatches mean the signals have not moved, not that the feed is simulated.',
  },
  /**
   * World Creator's declaration follows its DETERMINATION (the
   * compilation's form — S1 priced on the determination's result):
   * the authoring execution is real (drafts persist in the platform
   * store with the full editor verb set; playtest mints a real world
   * via /api/worlds and routes the creator into it), so the old
   * Simulated banner was a taxonomy error. But the cross-lens seam
   * (A3) is NOT wired: a published draft is discoverable in this
   * lens's own Discover and does not yet surface in Sub-Worlds'
   * discovery — the two lenses keep separate stores. The caption
   * states both halves in the open rather than letting REAL_LIVE
   * imply the loop is closed; the seam bridge is priced separately
   * at the Lead.
   */
  'world-creator': {
    label: 'Live',
    caption: 'Drafts here are your real records — sculpted scenes, props, spawn points, zones, NPCs and factions persist, and playtest mints a real world you enter in the World lens. Published drafts are discoverable in this lens; they do not yet surface in Sub-Worlds’ discovery.',
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
   * Insurance's book — clients, policies, claims and certificates — is
   * the account's own data, persisted server-side, and its tools compute
   * over that book (Review 5's first pass: PROBE-LIVE over a live store;
   * the re-pass on PR #2210 failed F1 alone — a Simulated banner beside
   * the LIVE badge). The generic REAL_LIVE line ("polled live from an
   * external source") would claim a carrier feed this lens does not
   * poll — Quote Shopping refuses to invent quotes precisely because
   * there is none — so the caption names the actual substrate.
   */
  insurance: {
    label: 'Live',
    caption: 'Live: your clients, policies, claims and certificates are your own records, saved in your workspace as you work, and the tools compute over your book. Carrier reference data is static, and no live carrier quotes are polled.',
  },
  /**
   * Government declared REAL_FREE ("Real but static / open-access
   * dataset") over a live write layer — the probe CourtCase persisted
   * and moved the Caseload counts (Review 2's first pass, F1: the
   * declaration contradicted itself four ways). The lens's own records
   * are per-user workspace records on this server; its external reads
   * (Congress.gov bills and members, USAspending, data.gov, NWS) are
   * live public sources. Nothing in the lens files with any authority,
   * and the caption says so — the S2 half of the declaration.
   */
  government: {
    label: 'Live',
    caption: 'Live: your caseload, permits, records and FOIA drafts are your own workspace records on this server, and bills, members, spending, datasets and alerts are read live from Congress.gov, USAspending, data.gov and NWS. Nothing here is an official government service, and nothing you enter is filed with any authority.',
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
