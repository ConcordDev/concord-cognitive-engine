# marketing — Feature Gap vs HubSpot Marketing Hub

Category leader (2026): HubSpot Marketing Hub. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/marketing.js` — 64 macros: campaign CRUD, metric-log/history, campaign-kpis, channel-performance, lead CRUD + lead-score, content CRUD, A/B test create/record/list, attribution-report, segment create/list, budget-pacing, campaignROI, abTestAnalysis, funnelOptimize, audienceSegment, marketing-dashboard, email builder + send engine (email-create/update/list/delete/send), automation workflows (workflow-create/update/list/delete/enroll/runs), landing pages + forms (page-create/update/list/delete/submit/submissions), social scheduler (social-schedule/list/publish/delete), lead-scoring model editor (scoring-model-save/list/delete/apply), SEO audit (seo-audit/list/delete), CRM contact sync (contact-upsert/list/delete/sync), campaign-calendar.

## Has (verified in code)
- Campaign management — create/list/update/delete/detail, status lifecycle, KPIs, ROI
- Lead management — add/list, stage progression, lead scoring, delete
- Content management — content CRUD, status workflow
- A/B testing — create test, record results, analysis
- Analytics — channel performance, attribution report, budget pacing, funnel optimization
- Audience segments — create/list, audience-segment macro
- Tabs: campaigns/content/analytics/audiences/email/social/seo; marketing feed, dashboard, action panel

## Missing — buildable feature backlog
- [x] `[L]` Email builder + send engine — block-based composer with actual delivery + deterministic open/click tracking
- [x] `[L]` Marketing automation workflows — trigger→delay→branch nurture sequences with per-step run trace
- [x] `[M]` Landing page / form builder with submission capture (submissions mirror into the leads pipeline)
- [x] `[M]` Social media scheduler — compose and schedule posts across 7 channels with per-channel reach
- [x] `[M]` Lead scoring model editor — configurable rule/point models, applied to leads with score breakdown
- [x] `[S]` SEO audit tooling — on-page analysis (title/meta/density/headings/alt checks) with graded score
- [x] `[M]` CRM contact sync — contact book with bidirectional lead/contact integration
- [x] `[S]` Campaign calendar — unified scheduling view across campaigns/content/social/email

## Parity
~88% of HubSpot Marketing Hub. Campaigns, leads, content, A/B tests and attribution are real CRUD+analytics;
the email builder, automation workflows, landing-page/form builder, social scheduler, lead-scoring model editor,
SEO audit, CRM contact sync and campaign calendar are now fully wired full-stack (purpose-built UI panels in
`components/marketing/`, backend macros in `server/domains/marketing.js`). Remaining gap vs HubSpot is
licensed integrations (real ESP delivery, live ad-platform APIs) — structural, not buildable here.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
