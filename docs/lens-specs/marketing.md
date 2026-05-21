# marketing — Feature Gap vs HubSpot Marketing Hub

Category leader (2026): HubSpot Marketing Hub. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/marketing.js` — 31 macros: campaign CRUD, metric-log/history, campaign-kpis, channel-performance, lead CRUD + lead-score, content CRUD, A/B test create/record/list, attribution-report, segment create/list, budget-pacing, campaignROI, abTestAnalysis, funnelOptimize, audienceSegment, marketing-dashboard.

## Has (verified in code)
- Campaign management — create/list/update/delete/detail, status lifecycle, KPIs, ROI
- Lead management — add/list, stage progression, lead scoring, delete
- Content management — content CRUD, status workflow
- A/B testing — create test, record results, analysis
- Analytics — channel performance, attribution report, budget pacing, funnel optimization
- Audience segments — create/list, audience-segment macro
- Tabs: campaigns/content/analytics/audiences/email/social/seo; marketing feed, dashboard, action panel

## Missing — buildable feature backlog
- [ ] `[L]` Email builder + send engine — drag-drop email composer with actual delivery
- [ ] `[L]` Marketing automation workflows — trigger→delay→branch nurture sequences
- [ ] `[M]` Landing page / form builder with submission capture
- [ ] `[M]` Social media scheduler — compose and schedule posts across channels
- [ ] `[M]` Lead scoring model editor — configurable rules/points, not a fixed score
- [ ] `[S]` SEO audit tooling — on-page analysis, keyword tracking (tab exists, thin)
- [ ] `[M]` CRM contact sync — bidirectional lead/contact integration
- [ ] `[S]` Campaign calendar — unified scheduling view across channels

## Parity
~50% of HubSpot Marketing Hub. Campaigns, leads, content, A/B tests, and attribution are real CRUD+analytics, but missing the email builder, automation workflows, and landing-page builder that are HubSpot's core execution surfaces.
