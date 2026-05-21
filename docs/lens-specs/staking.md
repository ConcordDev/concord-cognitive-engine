# staking — Feature Gap vs Coinbase / Lido staking

Category leader (2026): Coinbase Earn / Lido (crypto staking products). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `staking` domain macros (`stake`, `redeem`, `list_for_user`) over a staking table; yield funded by treasury share of marketplace fees. Currency: CC.

## Has (verified in code)
- Time-locked staking — lock CC for 1-60 months, variable APR (100 + months×20 bps, capped 1200).
- Per-user stake list with principal, term, lock/unlock dates, yield rate, accrued yield, status.
- Redeem at maturity (returns principal + accrued yield); unlock gating on `unlocks_at`.
- Projected-APR calculator in the new-stake form.
- StakingMarkets discovery panel.

## Missing — buildable feature backlog
- [ ] `[M]` Auto-compound / re-stake option at maturity.
- [ ] `[S]` Early-unstake with penalty — leaders all offer liquidity-with-fee instead of hard lock.
- [ ] `[M]` Rewards history / earnings ledger over time, not just a single accrued number.
- [ ] `[S]` Estimated-rewards calculator before staking (annual/monthly breakdown).
- [ ] `[M]` Multiple staking products / pools at different risk-reward tiers.
- [ ] `[S]` APR history chart so users can judge the variable rate.
- [ ] `[M]` Liquid-staking receipt token usable elsewhere while locked.
- [ ] `[S]` Maturity notifications / reminders.

## Parity
~45% of Coinbase staking. The core lock-earn-redeem loop is real and honestly variable-rate, but it lacks auto-compound, early-exit, an earnings history, and multiple pools that define mature staking products.
