# Concord economy: marketplace payments and creator royalties

*For funds that look at payments, creator economies or crypto. Everyone else can skip this: the economy is a later expansion, and Concord's first market is engineers who need AI answers they can check (see the [README](../README.md)).*

*Last checked against the code: 2026-10-07, `main` @ `973e214`.*

## In one line

Concord has a built-in marketplace where people sell their work, and creators whose work is cited get paid royalties automatically. Payments run in a platform credit called **Concord Coin (CC)**, bought and cashed out in US dollars through Stripe.

## What it is, and what it isn't

- **CC is a platform currency, not a cryptocurrency.** 1 CC always equals $1.00 of purchasing power on the platform. It isn't on a blockchain, and there are no smart contracts, wallets or chain integrations in the codebase. The Terms of Service say: "It is not a cryptocurrency, security, or investment vehicle" ([`TERMS_OF_SERVICE.md`](TERMS_OF_SERVICE.md) §5.1).
- **Dollars in, dollars out, both through Stripe.** Stripe Checkout mints CC on a completed payment. Withdrawals burn CC and pay out through Stripe Connect.
- **There's no speculation mechanism.** The price is fixed at $1, there's no trading and no issuance schedule.

## Fees and royalties (as implemented)

| Item | Value | Where in code |
|---|---|---|
| Platform fee on CC transactions (purchase, transfer, withdrawal) | 1.46% | `server/economy/fees.js`, `server/economy/micro-cc.js` |
| Extra marketplace fee on sales | 4% (5.46% total on a marketplace sale) | same |
| Royalty to cited creators | Generational decay: each generation gets half the previous rate, with a 0.05% floor (`royalty(n) = max(initialRate / 2^n, 0.0005)`) | `server/economy/royalty-cascade.js` |
| Royalty cap per sale | 30% of the sale price | `server/economy/royalty-cascade.js`, `server/economy/creative-marketplace.js` |
| Seller's minimum take | 64.54% of the sale price after fees and royalties | Terms §6.2 |
| Withdrawal rules | 10 CC minimum, 48-hour hold on newly earned CC, processed by Stripe | `server/economy/withdrawals.js`, Terms §5.4 |

Citation drives the royalties. When someone sells a work that cites other creators, a share of the sale flows back up the citation chain. Attribution is permanent, so the original creator keeps earning from later derivative sales.

## How much is built

- `server/economy/` holds 43 modules: the coin ledger (`coin-service.js`), fee split, Stripe checkout and webhooks (`stripe.js`), withdrawals, the royalty cascade and the creative marketplace.
- Tests cover Stripe checkout idempotency, webhook atomicity, the withdrawal earned-funds policy, the coin audit trail and royalty-cascade parity against a real database (`server/tests/economy/`, `server/tests/royalty-cascade*.test.js`).
- Abuse control: funds held by in-world NPCs and system accounts can't be cashed out to dollars; only coin a real user earned can (`server/economy/emergent-accounts.js`).

## Status

- **Payments aren't switched on in production yet.** Stripe runs only when keys are configured, and there's no transaction volume.
- **Open items before real-money launch:** forming the operating entity (the Terms and Privacy Policy still carry an "[Your LLC Name]" placeholder), and a legal review of the stored-value and cash-out design.
- **Order of priority:** the engineering product and its pricing (free for individuals, per-seat for enterprises and teams, usage-based MCP calls) come first. Marketplace payments with creator royalties follow once there are users creating work worth selling.

## Contact

Dutch (Ramaj Duncan), founder · [Dutchtropez@gmail.com](mailto:Dutchtropez@gmail.com) · [X](https://x.com/revie9858) · [LinkedIn](https://www.linkedin.com/in/dizzy-review-48979b176)
