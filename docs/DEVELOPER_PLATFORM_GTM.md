# Developer-Platform Go-To-Market

> **What this is.** How Concordia's systems get licensed/adopted by *other
> developers* — the business/adoption question, not "can we build it." The
> technical platform is **already built** (see the claim-audit in §8): a
> publishable SDK + 5 examples, a scoped-API-key dev system, an Ed25519-signed
> plugin gallery, an OpenAPI 3.1 spec, a versioned DTU protocol, an MCP
> server+client, and client SDKs. So this doc is the *motion*, not the build.
>
> **Status: this is a post-flagship-scale track.** Build *toward* it, don't
> pivot *to* it — it competes with the game's own cold-start, which is the
> dominant risk. The order holds: **prove it in Concordia first; the game is the
> credibility that sells the platform.** (Companion map: `docs/OFFICIAL_PLAN.md`
> §6; cold-start mechanics: `docs/COLD_START_STRATEGY.md`.)

---

## 0. The market is real and well-timed (with one headwind)

- **AI-NPC / NPC-generation market** is on a steep ramp: **$1.41 Bn (2024) →
  $5.51 Bn (2029 forecast), 31.2% CAGR** (Research & Markets). Developer
  adoption of AI NPCs reportedly went **8% → 62% in two years**, with games that
  use advanced AI systems citing **~43% higher retention and ~2.3× longer
  playtime** *(these three engagement figures are weakly sourced — see §8)*.
- **MCP is now infrastructure.** The official registry holds **~9,652 servers
  (~28,959 versions)** as of 2026-05-24; **41% of software orgs** run MCP servers
  in limited/broad production (Stacklok 2026); SDK downloads hit **~97M/month** by
  March 2026. Being **MCP-native is a distribution channel that didn't exist 18
  months ago.**
- **The headwind (be honest).** Per the **GDC 2026 State of the Game Industry**
  survey, **52% of devs now view generative AI as bad for the industry** (up from
  30% the prior year, 18% before that); only ~7% see a positive impact, and only
  ~36% personally use the tools. The backlash is against **shallow chatbot-NPC
  slop.** → Concordia's positioning must lead with **systemic emergence / a
  living world**, NOT "AI NPCs." The systemic depth is literally the *antidote*
  to what devs are sick of.

---

## 1. The motion: product-led growth (PLG), not sales-led

Dev platforms win by letting developers **self-serve to value, then upgrade** —
not by a sales call.

- **Free tier is non-negotiable.** Devs must build against it for free and feel
  the value immediately. The `developer-sdk` scoped-API-key system already
  supports self-serve keys.
- **Docs > marketing, early.** Successful dev tools "focused on documentation and
  sharing what they were building, factually." With the SDK + 5 examples already
  shipped, **polished docs are the highest-leverage GTM artifact** — more than any
  campaign.
- **Open-source the SDK** (the *SDK/clients*, **not** the engine). Community
  customization + integration + trust. The engine stays IP (the monolith); the
  SDK is the open on-ramp.
- **Sell to the boss for the paid tier.** "You don't sell to developers, you sell
  to their boss" — devs adopt bottom-up (free); the studio/eng-lead pays for
  production.

---

## 2. Pricing — the menu, mapped to Concordia

| Model | Who uses it | Fit for Concordia |
|---|---|---|
| **Usage-based** (per call / token / NPC-interaction) | Inworld | natural fit — inference cost is per-use; meter the emergent-NPC/world calls |
| **Concurrency** (concurrent NPCs/players) | Convai | fits a live-world substrate |
| **Seat-based** (per developer) | pre-production tools | the SDK/dev-tooling tier |
| **Environment-size** | production platforms | enterprise/self-host tier |
| **Marketplace cut** (% of plugin/asset sales) | Unity Asset Store, app stores | the signed-plugin gallery already exists — take a cut of plugin sales |
| **⭐ Rev-share via the royalty cascade** | *nobody* | **the differentiator — see below** |

**The Concordia-native pricing innovation.** The **royalty cascade** *is* a
rev-share engine. Point it at the **developer ecosystem**: a dev who builds a
plugin/system/NPC-behavior earns **perpetual royalties when other devs/players
use it** — the same mechanic that pays content creators, aimed at *developers*.
No middleware does this. It turns the platform into a **creator-economy for
code**: on-brand, defensible, and a recruiting magnet ("build here, get paid
forever when others use your system").

> Competitor reference points (2026): **Inworld** meters TTS per-million-chars
> (~$15/1M Mini, ~$25/1M Max/TTS-2 standard; Founder legacy ~$5/$10);
> **Convai** sells concurrency tiers (Indie ~$22–29/mo, Pro ~$69–99/mo at
> concurrency 1/3, Scale ~$299, Business ~$499). Both are **closed**; the open +
> MCP-native + rev-share position is open.

---

## 3. The MCP-native wedge (the cheapest acquisition channel available)

Concordia is **already an MCP server**, and there's a **public registry of ~10K
servers that AI agents and devs discover through.** That's a near-free
distribution channel:

- **List Concordia's systems on the MCP registry** — the emergent-NPC engine,
  the embodied-world layer, the DTU memory — each as a discoverable MCP server.
  Any AI agent (Claude, etc.) or developer browsing the registry can plug in via
  the standard protocol, *zero custom integration.*
- The pitch becomes **"the living, emergent world-substrate that AI agents plug
  into via MCP"** — not a closed chatbot SDK. **Open + MCP-native + systemic = a
  position nobody else holds**, riding the MCP wave instead of fighting the
  closed-middleware crowd.

---

## 4. The developer-ecosystem cold-start (the honest hard part)

A dev platform has its **own** two-sided cold-start — no devs without apps, no
apps without devs (Andrew Chen, one layer up from the player cold-start; see
`docs/COLD_START_STRATEGY.md`). The same answers apply:

1. **Be your own first developer.** **Concordia (the game) IS the flagship app
   proving the SDK** — dogfooding is the credibility. You can't sell an unproven
   platform; the game *is* the proof.
2. **Atomic dev-network.** Seed a tight early cohort — the MCP-curious, AI-agent
   builders, modders — in ONE niche (the emergent-NPC/world-via-MCP angle), not a
   broad launch.
3. **Come for the tool, stay for the platform** — free SDK + MCP access is the
   *tool*; the plugin-marketplace + royalty-rev-share is the *network* that locks
   them in.

---

## 5. The honest caveats

- **Credibility requires the flagship at scale.** Devs adopt *proven, alive*
  platforms. **Concordia succeeding is the prerequisite** — don't sell the
  platform before the game proves it.
- **It's a different business + a focus tax.** SDK + client SDKs + plugin
  protocol + MCP server = a real versioning/support/dev-relations commitment.
  Pursuing it *now* competes with the game's cold-start (the dominant risk).
- **The genAI backlash** — positioning matters; lead with "systemic world,"
  never "AI NPC slop."
- **Clean deps are a prerequisite.** Can't ship an SDK that drags in
  non-commercial deps; the Track-G license swaps (`docs/LICENSING.md`) enable
  this.

---

## 6. The sequencing recommendation

1. **Now (near-free, do it):** polish the SDK docs, **list the MCP servers on the
   official registry** (organic developer trickle at ~zero cost), open-source the
   client SDKs. The L0–L5 gates (`docs/FUNCTION_ASSURANCE.md`) double as the
   *"this platform is reliable"* credibility.
2. **Phase 1 (post-game-traction):** dogfood publicly (Concordia as the
   flagship), free tier + self-serve keys, seed the atomic dev-cohort via the
   MCP/emergent-NPC angle.
3. **Phase 2 (post-scale):** monetize — usage pricing + the plugin-marketplace
   cut + the **royalty-cascade rev-share for developers** (the differentiator).
4. **Throughout:** every clean module boundary + gate is future licensability;
   let it accrete, don't let it fragment the game's cold-start.

---

## 7. Verdict

The technical platform is **done and unusually complete** (§8) — so this is a
*business* problem with a favorable market (AI-NPC ramping to $5.51 Bn by 2029,
MCP at ~10K servers) and a real headwind (the dev genAI backlash, which the
*systemic* depth answers). The motion is **PLG: free SDK + great docs +
MCP-registry distribution + self-serve keys**, monetized later via **usage + a
marketplace cut + the royalty-cascade rev-share no competitor can copy.** The
cheapest move available *right now* is **listing on the MCP registry** —
near-zero cost, rides the biggest current wave, positions Concordia as the open,
systemic, MCP-native world-substrate while everyone else ships closed chatbot
SDKs. But the *order* holds: **prove it in Concordia first.**

---

## 8. Claim verification (codebase audit + web, 2026-06-01)

> Repo culture: *trust the code over any doc, including this one.* Every claim in
> §0–§7 was checked. Two technical claims are overstated and several market
> figures need a nuance label — recorded here rather than buried.

### 8a. Technical-platform claims — codebase audit (read-only)

| Claim | Verdict | Evidence (file:line) |
|---|---|---|
| Publishable SDK | ✅ **TRUE** (production) | `sdk/package.json` — `@concord/sdk` v0.1.0, `prepublishOnly` build hook, dual ESM/CJS + types; `sdk/index.ts` (~685 LOC, 11 sub-clients: lens/dtus/chat/keys/link/marketplace/mesh/presence/combat/federation/intelligence) |
| 5 examples | ✅ **TRUE** | `sdk/examples/{dtu-citation,lens-macro,link-send,mesh-peer,presence-stream}.ts` + `sdk/examples/README.md` (exactly 5, runnable) |
| Scoped-API-key dev system | ✅ **TRUE** (production) | `server/lib/api-keys.js:268` `checkScope()` (wildcard + per-domain), `server/middleware/api-key-auth.js:95` returns 403 `scope_denied`; `csk_`-prefixed keys, per-key rate limits |
| Ed25519-signed plugin gallery | ✅ **TRUE** (production) | `server/lib/plugin-signing.js` — `crypto.generateKeyPairSync("ed25519")`, `verifyPluginSignature` via `crypto.verify(null,…)`; trusted-key registry + migration `085_plugin_gallery.js` (`plugin_trusted_keys`) |
| OpenAPI | ✅ **TRUE** (production) | `server/openapi.yaml` (3620 LOC, `openapi: 3.1.0`), served at `/api/openapi.json` + Swagger UI `/api/docs`; contract-tested `server/tests/openapi-contract.test.js` (18/18) |
| **DTU protocol "v1.0.0"** | ⚠️ **OVERSTATED** | `server/lib/dtu-protocol.js:28` declares `DTU_VERSION = "1.0"` — **not "1.0.0"** (semver-lite). The protocol itself (8-field envelope, SHA-256 canonical content hash, `validate`, 6 create methods) **is** production + contract-tested (`dtu-protocol-canonical.test.js`). |
| MCP server + client | ✅ **TRUE** (production) | Server: `server/lib/mcp-server-host.js:119` `mountMcpServer` — `POST/GET/DELETE /mcp` (Streamable HTTP), 6 tools (dtu.search, expert_mode.answer, web_search, lens.list, event_timeline.recent, cross_world_effectiveness.explain), wired at boot `server.js:~29105`. Client: `server/lib/mcp-client.js` via `server/routes/mcp.js:24` (connects to external MCP servers; admin-gated namespaces/verbs). |
| **"4 client SDKs"** | ⚠️ **OVERSTATED → 2** | Only **two** exist: **TypeScript** `@concord/sdk` (production, npm-publishable) + **React Native** `concord-mobile/src/api/macro-client.ts` (~80-LOC thin wrapper over `POST /api/lens/run`, in-repo only). **No Python / Go / other-language SDK** in the tree. |

**Net:** the "stack is already built" premise is **mostly true** — 6 of 8 claims
are production-wired exactly as stated; the DTU protocol is versioned but at
`"1.0"` not `"1.0.0"`; "4 client SDKs" is really **2** (one production, one
thin). Neither overstatement undermines the GTM thesis, but the doc should not
repeat them.

### 8b. Market claims — web verification

| Claim (§0/§2) | Verdict | Note |
|---|---|---|
| NPC-gen AI market **$5.51 Bn** | ✅ with caveat | It's the **2029 forecast** ($1.41 Bn in 2024, 31.2% CAGR) — not a current figure. Labelled as such above. |
| MCP **~9,652 servers / ~28,959 versions**; **41%** orgs in prod; **~97M** monthly SDK downloads | ✅ solid | Registry API 2026-05-24; 41% = Stacklok 2026 software report; downloads ~970× since Nov-2024 launch. |
| GDC 2026 **52% view genAI negatively** (up from 30%) | ✅ **exact** | 30% prior year, 18% before; ~7% positive; corporate adoption 52% but only ~36% personally use. Strongest support for the "lead with systemic, not AI-NPC" positioning. |
| AI-NPC adoption **8%→62%**, **43% retention**, **2.3× playtime** | ⚠️ **weakly sourced** | Traces to a single secondary blog (solidaitech, "AI Games 2026"); no primary study located. Treat as directional, not citable. |
| **Inworld** per-M-char pricing | ✅ with update | 2026 standard ≈ **$15/1M (Mini), $25/1M (Max/TTS-2)**; Founder legacy ~$5/$10; on-demand $25/$50. (The earlier "$20–100/mo" framing is roughly the subscription tier, not the per-char meter.) |
| **Convai** concurrency pricing | ✅ verified | Indie ~$22–29/mo, Pro ~$69–99/mo (concurrency 1 / 3), Scale ~$299, Business ~$499; Free concurrency 1. |

### Sources

- [NPC-gen AI market $5.51 Bn (Research & Markets)](https://www.researchandmarkets.com/reports/6226388/non-player-character-npc-generation-ai-market) ·
  [Yahoo Finance summary](https://finance.yahoo.com/news/non-player-character-npc-generation-144600991.html)
- [MCP adoption statistics 2026 (digitalapplied)](https://www.digitalapplied.com/blog/mcp-adoption-statistics-2026-model-context-protocol) ·
  [MCP Manager](https://mcpmanager.ai/blog/mcp-adoption-statistics/) ·
  [official MCP registry](https://registry.modelcontextprotocol.io/)
- [GDC 2026 State of the Game Industry (gdconf)](https://gdconf.com/article/gdc-2026-state-of-the-game-industry-reveals-impact-of-layoffs-generative-ai-and-more/) ·
  [Game Developer: half think genAI is bad](https://www.gamedeveloper.com/business/one-third-of-game-workers-use-generative-ai-but-half-think-it-s-bad-for-the-industry) ·
  [GDC 2026 AI/NPCs (Sean Kim)](https://blog.imseankim.com/gdc-2026-ai-game-development-npcs-procedural-content-voice-acting/)
- [AI-NPC engagement figures — solidaitech (weak source)](https://www.solidaitech.com/2026/05/ai-games-2026-complete-guide.html)
- [Inworld pricing](https://inworld.ai/pricing) · [Convai pricing](https://convai.com/pricing) · [Convai FAQ (concurrency)](https://convai.com/faqs)
- GTM framing: [dev-tool GTM (daily.dev)](https://business.daily.dev/resources/dev-tool-companies-go-to-market-strategy-launch-scale/) ·
  [GTM for developer tools (Mattermost)](https://mattermost.com/blog/go-to-market-strategy-for-developer-tools/) ·
  [selling to developers (markepear)](https://www.markepear.dev/blog/selling-to-developers)
