# nonprofit — Feature Completeness Spec

Rival app(s): Givebutter, Bloomerang, Donorbox, ProPublica Nonprofit Explorer (2026)
Sources:
- https://projects.propublica.org/nonprofits/api/ (IRS Form 990 data — live)
- fundraising campaign + donor record-keeping

## Features

### Fundraising management
- [x] Run campaigns — goal, deadline, status (macro: nonprofit.campaign-create)
- [x] List campaigns with raised / progress / donor count (macro: nonprofit.campaign-list)
- [x] Update a campaign goal / status (macro: nonprofit.campaign-update)
- [x] Delete a campaign (macro: nonprofit.campaign-delete)
- [x] Log donations — one-off or recurring, named or anonymous (macro: nonprofit.donation-log)
- [x] Giving dashboard — campaigns, active, total raised, recurring donors (macro: nonprofit.nonprofit-dashboard)

### Live data
- [x] ProPublica Nonprofit Explorer search — IRS-registered orgs ingested as DTUs (macro: nonprofit.propublica-*)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Payment processing | a PSP (Stripe/PayPal) | donations are recorded, not charged; Concord Coin economy carries real value transfer |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/nonprofit.js` clean.
  Campaign substrate (6 macros) appended to the ProPublica lookup domain.
- 2026-05-20: Tests — `tests/nonprofit-campaign-domain-parity.test.js` 5/5
  green (campaign CRUD + per-user scope / donation log + progress math /
  dashboard recurring-donor aggregation / positive-amount guard).
- 2026-05-20: Frontend — new `CampaignManager` (campaign list with progress
  bars + donation logging + dashboard) mounted in the nonprofit lens page.
  `npx tsc --noEmit` exit 0.
