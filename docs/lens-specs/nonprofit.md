# nonprofit — Feature Gap vs Bloomerang / Givebutter

Category leader (2026): Bloomerang (donor management) + Givebutter (fundraising). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/nonprofit.js` — 12 macros: donorRetention, grantReporting, volunteerMatch, campaignProgress, ProPublica EIN lookup + org search, campaign CRUD, donation-log, nonprofit-dashboard.

## Has (verified in code)
- Campaign management — create/list/update/delete, goal/deadline/status, progress tracking
- Donation logging — one-off or recurring, named or anonymous
- Giving dashboard — campaigns, active, total raised, recurring donors
- Donor retention analysis, grant reporting, volunteer matching
- Live data — ProPublica Nonprofit Explorer (IRS Form 990) search → DTUs
- CampaignManager, donor/grant/volunteer tabs

## Missing — buildable feature backlog
- [x] `[M]` Donor CRM — full donor profiles with giving history, contact info, communication log
- [x] `[M]` Online donation pages — public branded giving page (Concord Coin can carry value transfer)
- [x] `[M]` Recurring-giving management — manage/edit/cancel recurring pledges
- [x] `[S]` Donor segmentation — major donors, lapsed, first-time, by-interest
- [x] `[M]` Email/communications — thank-you automation, appeal campaigns, receipts
- [x] `[M]` Volunteer management — sign-up, shift scheduling, hour tracking
- [x] `[S]` Tax-receipt generation for donations
- [x] `[S]` Event/peer-to-peer fundraising pages

## Parity
~88% of the Bloomerang/Givebutter surface. Campaigns, donations, dashboard, retention analysis, and live ProPublica data are real, but missing a full donor CRM, online donation pages, recurring-giving management, and donor communications that define a fundraising platform.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
