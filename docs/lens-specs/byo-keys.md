# byo-keys — Feature Gap vs OpenRouter / LiteLLM key management

Category leader (2026): OpenRouter / LiteLLM (BYO-key + model routing). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/byo-keys.js` — macros `list`, `set`, `remove`, `set_active`, `test`, `available_providers`; keys AES-GCM encrypted at rest with per-user wrapping key (migration 170 `byo_brain_overrides`).

## Has (verified in code)
- Per-brain-slot key overrides (OpenAI / Anthropic / xAI / Google)
- Set / update / remove an override; toggle active without deleting
- Masked key preview (plaintext never returned after save)
- 1-token test ping to verify a key works
- Provider catalog with default models + key formats; OpenRouterCatalog panel
- Last-used timestamp per override

## Missing — buildable feature backlog
- [x] `[M]` Per-key usage + spend tracking (tokens, cost estimate)
- [x] `[S]` Per-key rate limit / monthly budget cap with enforcement
- [x] `[M]` Model picker per slot from the provider's live model list
- [x] `[S]` Fallback chain — if key A fails, route to key B
- [x] `[S]` Key health/last-error surfaced in the list
- [x] `[M]` Org-shared keys with member-level access control

## Parity
~95% of an OpenRouter-style key console. Secure storage, per-slot routing, test ping, provider catalog, per-key usage + spend tracking, monthly budget caps with enforcement, per-slot model selection, fallback-chain routing, key health surfacing, and org-shared keys with access control all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
