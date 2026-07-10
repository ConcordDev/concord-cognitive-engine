# Marketing Lens — Capability Map (Frontend Rebuild Program, Wave 2 batch 7, Docs/B2B SaaS archetype)

Reproduce the macro count:
`grep -c 'registerLensAction("marketing"' server/domains/marketing.js` → **64**

## Reference apps + parity target

- **HubSpot Marketing Hub** — the canonical growth-marketing suite:
  campaign management with budget/spend/ROI tracking, a lead/contact CRM
  with pipeline stages and multi-touch attribution, marketing-automation
  workflows, landing pages with form capture, email marketing with real
  send + open/click tracking, and a unified marketing dashboard.
- **Mailchimp** — the email-and-audience-segmentation-focused competitor:
  audience segments, A/B-tested campaigns, and a content/social calendar.
- **Parity target, in the owner's framing:** the only difference between
  this lens and HubSpot/Mailchimp should be the scale of the audience and
  the absence of a real outbound email/SMS carrier account — every
  *workflow* (campaign ROI + budget pacing, lead scoring + CRM, content
  calendar + A/B testing, attribution, segmentation, email, automation
  workflows, landing pages, social scheduling, SEO audits) should be a
  real, designed feature over this lens's own STATE-backed substrate.

## Audit finding: the entire marketing OS was already real — it was buried behind a duplicate fake-CRUD scaffold covering the SAME features its own real panels already shipped

Before this pass, `concord-frontend/app/lenses/marketing/page.tsx` (578
lines) ran two systems in parallel, and — unlike a typical scaffold defect
— the fake half was a literal **duplicate** of real, already-built
components sitting unused one directory over:

1. **The real marketing OS** — nine purpose-built, macro-wired components
   already existed: `MarketingDashboardSection` (a "Marketing Hub" with
   its own 4-tab subnav — Campaigns/Leads/Content & Tests/Channels — that
   **already wires** `MarketingCampaignsPanel` (`campaign-create/list/
   delete/kpis`, `metric-log`, `budget-pacing`), `MarketingLeadsPanel`
   (`lead-add/list/update-stage/score/delete`, `attribution-report`),
   `MarketingContentPanel` (`content-add/list/update-status/delete`,
   `abtest-create/record/list/delete`), and `MarketingChannelsPanel`
   (`channel-performance`, `segment-create/list`)); `MarketingEmailPanel`
   (`email-create/update/list/delete/send` — a real send path, not a
   stub); `MarketingWorkflowsPanel` (`workflow-create/update/list/delete/
   enroll/runs`); `MarketingPagesPanel` (`page-create/update/list/delete/
   submit/submissions`); `MarketingSocialPanel` (`social-schedule/list/
   publish/delete`); `MarketingScoringPanel` (`scoring-model-save/list/
   delete/apply`); `MarketingSEOPanel` (`seo-audit`, `seo-audit-list/
   delete`); `MarketingContactsPanel` (`contact-upsert/list/delete/
   sync`); `MarketingCalendarPanel` (`campaign-calendar`);
   `MarketingActionPanel` (the four pure-compute macros —
   `campaignROI`, `abTestAnalysis`, `funnelOptimize`, `audienceSegment` —
   plus mint/DM/publish/agent); and `MarketingFeed` (a live Reddit
   marketing-discussion pull, r/marketing et al.). Cross-referencing every
   `registerLensAction("marketing", …)` name against its `lensRun` call
   site confirmed **all 64 macros** were already reached by one of these
   real panels.
2. **A fully disconnected generic-CRUD scaffold** duplicating exactly the
   surface area the real Marketing Hub already covered — four of the
   twelve `MODE_TABS` (Campaigns / Content / Analytics / Audiences) were
   backed by `useLensData('marketing', <ArtifactType>, { seed: [] })`, a
   fake "campaign" data model (`name/type/status/budget/spent/
   impressions/clicks/conversions/channel/targetAudience/...`) with its
   own create/edit modal, its own fabricated "Dashboard" stat cards
   (total budget/spent/impressions/conversions summed from the fake
   store), and its own fabricated "Channel Distribution" bar chart —
   none of it touching a single real macro. The remaining eight
   `MODE_TABS` did point at the real panels (`PANEL_TABS`), but were
   jumbled into the same flat nav as the four fake ones, and the page
   still imported the generic `ManifestActionBar` + `UniversalActions` +
   `LensFeaturePanel` scaffold on top of everything. The honest grader
   confirmed the shape: `bespokeRatio: 0.831` (83% of the lens's code was
   already real, designed, macro-wired panel work) yet
   `tier: "functional"` / `isGenericScaffold: true`.

This is a sharper instance of the wave's recurring defect: not just
disconnected depth, but disconnected depth that was **already re-built in
full, one directory over**, and never wired into the page that mattered.

## What this rebuild changed

- Deleted the entire fake-CRUD system from `page.tsx`: `MODE_TABS`,
  `ArtifactType`/`MarketingArtifact`, `STATUS_CONFIG`, `CHANNELS`/
  `PLATFORMS`/`CONTENT_TYPES`, `useLensData`/`useRunArtifact`,
  `renderDashboard`/`renderEditor`/`renderLibrary`, the fabricated stat
  cards, and the fabricated channel-distribution bar.
- Removed the generic scaffold: `ManifestActionBar`, `UniversalActions`,
  `LensFeaturePanel` (and its show/hide toggle), `DraftedTextarea`.
- Rebuilt the page around the real Marketing Hub (`MarketingDashboardSection`,
  unchanged) plus a new, clearly-named **"Execution Studio"** tab strip
  that surfaces exactly the eight real backend-wired execution panels
  (Email / Workflows / Landing Pages / Social / Lead Scoring / SEO / CRM /
  Calendar) that used to be jumbled into the old flat `MODE_TABS` nav
  alongside the fake tabs — now with their own dedicated section, header,
  and numeric keyboard shortcuts (`1`–`8`).
- Kept `MarketingActionPanel` ("Quick Analysis") and `MarketingFeed` (live
  marketing chatter) as their own sections, plus a real header
  (title/subtitle/live indicator/DTU export) and `RealtimeDataPanel`.
  Kept `RecentMineCard`/`AutoActionStrip`/`CrossLensRecentsPanel` at the
  bottom (real cross-lens recent-activity feeds — `AutoActionStrip` alone
  doesn't trip `isGenericScaffold`, which requires the full trio + the
  generic body, both now absent).
- Rewrote `tests/marketing-lens-states.test.tsx`, which asserted against
  the OLD fake-CRUD page shape (loading spinner / "No … items yet" empty
  CTA / populated artifact row driven by a mocked `useLensData`) and was
  failing outright against the new page (confirmed by running it, not
  assumed). The new suite exercises the real page: every real section
  mounts, the Execution Studio defaults to Email, and each of the other
  seven tabs correctly swaps in its own panel and unmounts the previous
  one (10/10 passing).
- No backend changes — `server/domains/marketing.js` was untouched;
  every macro was already real.

## Reference-parity checklist

| # | Capability (HubSpot/Mailchimp) | Disposition |
|---|---|---|
| 1 | Campaign creation with budget + channel | **ALREADY REAL** — `MarketingCampaignsPanel` via `campaign-create/list/delete` |
| 2 | Daily metric logging → computed KPIs (CTR/CPC/CPA/ROAS) | **ALREADY REAL** — `metric-log` + `campaign-kpis` |
| 3 | Budget pacing (spent vs. expected-by-now) | **ALREADY REAL** — `budget-pacing` |
| 4 | Campaign ROI calculator | **ALREADY REAL** — `campaignROI` in `MarketingActionPanel` |
| 5 | Lead capture + pipeline stage tracking | **ALREADY REAL** — `MarketingLeadsPanel` via `lead-add/list/update-stage/delete` |
| 6 | Lead scoring | **ALREADY REAL** — `lead-score` + a full scoring-model builder (`scoring-model-save/list/delete/apply`) in `MarketingScoringPanel` |
| 7 | Multi-touch attribution reporting | **ALREADY REAL** — `attribution-report` in `MarketingLeadsPanel` |
| 8 | Content calendar (scheduled posts/assets) | **ALREADY REAL** — `MarketingContentPanel` via `content-add/list/update-status/delete` |
| 9 | A/B test creation + significance/lift | **ALREADY REAL** — `abtest-create/record/list/delete` + `abTestAnalysis` |
| 10 | Funnel-stage drop-off analysis | **ALREADY REAL** — `funnelOptimize` in `MarketingActionPanel` |
| 11 | Audience segmentation | **ALREADY REAL** — `audienceSegment` (compute) + `segment-create/list` (persisted segments) in `MarketingChannelsPanel` |
| 12 | Channel performance comparison | **ALREADY REAL** — `channel-performance` |
| 13 | Email campaign builder + real send | **ALREADY REAL** — `MarketingEmailPanel` via `email-create/update/list/delete/send` |
| 14 | Marketing-automation workflows (enrollment + run history) | **ALREADY REAL** — `MarketingWorkflowsPanel` via `workflow-create/update/list/delete/enroll/runs` |
| 15 | Landing pages with form capture + submissions | **ALREADY REAL** — `MarketingPagesPanel` via `page-create/update/list/delete/submit/submissions` |
| 16 | Social post scheduling + publishing | **ALREADY REAL** — `MarketingSocialPanel` via `social-schedule/list/publish/delete` |
| 17 | SEO audits (on-page + keyword) | **ALREADY REAL** — `MarketingSEOPanel` via `seo-audit`, `seo-audit-list/delete` |
| 18 | Unified contacts/CRM with external sync | **ALREADY REAL** — `MarketingContactsPanel` via `contact-upsert/list/delete/sync` |
| 19 | Campaign calendar (cross-campaign scheduling view) | **ALREADY REAL** — `MarketingCalendarPanel` via `campaign-calendar` |
| 20 | Unified marketing dashboard (spend/revenue/ROAS/leads rollup) | **ALREADY REAL** — `MarketingDashboardSection` via `marketing-dashboard` |
| 21 | Real-world marketing trend/discussion feed | **ALREADY REAL** — `MarketingFeed` (live Reddit pull, saveable to DTU) — most HubSpot-class tools don't ship this at all |
| 22 | Real outbound email carrier account (SPF/DKIM domain, deliverability reputation) | **GENUINELY MISSING — honest relabel.** `email-send` executes a real send path in this codebase's mail substrate, but there is no dedicated marketing-sending domain/warranty separate from the platform's general outbound mail; deliverability-grade sending infrastructure (dedicated IP warmup, bounce/complaint handling at scale) is a hosting-provider concern out of scope for this lens. No UI claims a dedicated sending domain exists. |
| 23 | External ad-platform integration (Google/Meta Ads spend sync) | **GENUINELY MISSING — flagged as a scoped future build.** `campaign-create`/`metric-log` accept manually-entered spend/impressions/clicks; there is no connector pulling live ad-platform spend automatically. Would follow the `connectorFetch`-chokepoint pattern (`docs/CONNECTORS_GO_LIVE.md`) as a Google-Ads-API addition. Deferred, not faked — every KPI shown derives from metrics a user actually logged. |

**Coverage: 21 of 23 checklist items ALREADY REAL, 0 BACKEND-CAPABLE-BUT-UNSURFACED (everything real was already surfaced, just duplicated/buried behind fake tabs of the same name), 2 GENUINELY MISSING with explicit honest dispositions.**

## Verification

- `npx eslint app/lenses/marketing/page.tsx components/marketing/*.tsx tests/marketing-lens-states.test.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide (3 pre-existing errors in `components/queue/*.tsx` belong to a concurrent sibling batch, untouched by this pass).
- `npx vitest run tests/marketing-lens-states.test.tsx` — rewritten, 10/10 passing (was failing against the new page shape before the rewrite).
- `node scripts/verify-lens-backends.mjs` — `marketing` still `WIRED`.
- `node scripts/grade-ux-polish.mjs --honest` — `marketing`: was `tier: "functional"` / `isGenericScaffold: true`; now `tier: "polished"` / `isGenericScaffold: false` (`bespokeRatio` up to `0.945`, `pageLoc` down from 579 to 165).
