# Developer-Platform Go-To-Market — how Concordia's systems get licensed/adopted (research)

> Context: the technical stack is **already built** (publishable SDK + 5 examples, scoped-API-key dev
> system, Ed25519-signed plugin gallery, OpenAPI, versioned DTU protocol v1.0.0, MCP server+client,
> 4 client SDKs). So this is **purely the adoption/business question**, not "can we build it."

## 0. The market is real and well-timed (with one headwind)

- **AI-NPC / NPC-generation market: ~$5.51 Bn**, and developer adoption of AI NPCs went **8% → 62% in two
  years.** Games with advanced AI systems report **43% higher retention and 2.3× longer playtime.**
- **MCP is now infrastructure:** ~**9,652 servers** in the official registry (~29K versions), **41% of
  software orgs** running MCP servers in production, cross-vendor support. Being **MCP-native is a
  distribution channel that didn't exist 18 months ago.**
- **The headwind (be honest):** per the GDC 2026 survey, **52% of devs now view generative AI negatively**
  (up from 30%). The backlash is against *shallow chatbot-NPC slop.* → Concordia's positioning must lead
  with **systemic emergence / a living world**, NOT "AI NPCs." Your systemic depth is literally the
  *antidote* to what devs are sick of.

## 1. The GTM motion: **product-led growth (PLG)**, not sales-led

Dev platforms win by letting developers **self-serve to value, then upgrade** — not by a sales call. The
playbook the research is unanimous on:
- **Free tier is non-negotiable** — devs must build against it for free and feel the value immediately.
  (Your `developer-sdk.js` scoped-API-key system already supports self-serve keys.)
- **Docs > marketing, early.** In the early days successful dev tools "focused on documentation and
  sharing what they were building, factually." You have the SDK + 5 examples; **polished docs are the
  highest-leverage GTM artifact**, more than any campaign.
- **Open-source the SDK** (not the engine — the *SDK/clients*). Community customization + integration +
  trust. The engine stays your IP (the monolith); the SDK is the open on-ramp.
- **Sell to the boss for the paid tier.** "You don't sell to developers, you sell to their boss" —
  devs adopt bottom-up (free), the studio/eng-lead pays for production.

## 2. Pricing — the menu, mapped to Concordia (and a differentiated one)

| Model | Who uses it | Fit for Concordia |
|---|---|---|
| **Usage-based** (per call / token / NPC-interaction) | **Inworld** ($20–100/mo, TTS per-M-chars) | natural fit — your inference cost is per-use; meter the emergent-NPC/world calls |
| **Concurrency** (concurrent NPCs/players) | **Convai** | fits a live-world substrate |
| **Seat-based** (per developer) | pre-production tools | for the SDK/dev-tooling tier |
| **Environment-size** | production platforms | enterprise/self-host tier |
| **Marketplace cut** (% of plugin/asset sales) | Unity Asset Store, app stores | **you have the signed-plugin gallery already** — take a cut of plugin sales |
| **⭐ Rev-share via the royalty cascade** | *nobody* | **your differentiator** — see below |

**The Concordia-native pricing innovation:** your **royalty cascade** *is* a rev-share engine. Apply it
to the **developer ecosystem**: a dev who builds a plugin/system/NPC-behavior earns **perpetual royalties
when other devs/players use it** — the same mechanic that pays content creators, pointed at *developers.*
No middleware does this. It turns your platform into a **creator-economy for code**, which is on-brand,
defensible, and a recruiting magnet ("build here, get paid forever when others use your system").

## 3. The MCP-native wedge (the cheapest acquisition channel you have)

You're an **MCP server**, and there's a **public registry of ~10K servers that AI agents and devs
discover through.** That's a near-free distribution channel:
- **List Concordia's systems on the MCP registry** — the emergent-NPC engine, the embodied-world layer,
  the DTU memory — each as a discoverable MCP server. Any AI agent (Claude, etc.) or developer browsing
  the registry can plug in via the standard protocol, *zero custom integration.*
- The pitch becomes **"the living, emergent world-substrate that AI agents plug into via MCP"** — not a
  closed chatbot SDK (Inworld/Convai are closed). **Open + MCP-native + systemic = a position nobody
  else holds**, and it rides the 10K-server MCP wave instead of fighting the closed-middleware crowd.

## 4. The developer-ecosystem cold-start (the honest hard part)

A dev platform has its **own two-sided cold-start** — no devs without apps, no apps without devs (Andrew
Chen, one layer up from the player cold-start). The same answers apply:
1. **Be your own first developer.** **Concordia (the game) IS the flagship app proving the SDK** —
   dogfooding is your credibility. You can't sell an unproven platform; the game *is* the proof.
2. **Atomic dev-network.** Seed a tight early cohort — the MCP-curious, AI-agent builders, modders — in
   ONE niche (probably the emergent-NPC/world-via-MCP angle), not a broad launch.
3. **Come for the tool, stay for the platform** — free SDK + MCP access is the *tool*; the
   plugin-marketplace + royalty-rev-share is the *network* that locks them in.

## 5. The honest caveats (what's still true)

- **Credibility requires the flagship at scale.** Devs adopt *proven, alive* platforms. **Concordia
  succeeding is the prerequisite** — don't sell the platform before the game proves it.
- **It's a different business + a focus tax.** SDK + 4 clients + plugin protocol + MCP server = a real
  versioning/support/dev-relations commitment. Pursuing it *now* competes with the game's cold-start
  (the dominant risk). Build *toward* it; don't pivot *to* it yet.
- **The genAI backlash** — positioning matters; lead with "systemic world," never "AI NPC slop."
- **Clean deps are a prerequisite** (the license pass) — can't ship an SDK that drags in non-commercial
  deps; the swaps you locked enable this.

## 6. The sequencing recommendation

1. **Now (near-free, do it):** polish the SDK docs, **list the MCP servers on the official registry**
   (organic developer trickle at ~zero cost), open-source the client SDKs. The gates (L0–L5) double as
   the *"this platform is reliable"* credibility.
2. **Phase 1 (post-game-traction):** dogfood publicly (Concordia as the flagship), free tier + self-serve
   keys, seed the atomic dev-cohort via the MCP/emergent-NPC angle.
3. **Phase 2 (post-scale):** monetize — usage pricing + the plugin-marketplace cut + the
   **royalty-cascade rev-share for developers** (the differentiator).
4. **Throughout:** every clean module boundary + gate is future licensability; let it accrete, don't
   let it fragment the game's cold-start.

## 7. Verdict

The technical platform is **done and unusually complete** — so this is a *business* problem with a
favorable market (AI-NPC at $5.51Bn, MCP at 10K servers) and a real headwind (dev genAI backlash, which
your *systemic* depth answers). The motion is **PLG: free SDK + great docs + MCP-registry distribution +
self-serve keys**, monetized later via **usage + a marketplace cut + the royalty-cascade rev-share that
no competitor can copy.** The cheapest move available *right now* is **listing on the MCP registry** —
near-zero cost, rides the biggest current wave, and positions you as the open, systemic, MCP-native
world-substrate while everyone else ships closed chatbot SDKs. But the *order* holds: **prove it in
Concordia first; the game is the credibility that sells the platform.**

**Sources:** [dev-tool GTM strategy](https://business.daily.dev/resources/dev-tool-companies-go-to-market-strategy-launch-scale/) ·
[GTM for developer tools](https://mattermost.com/blog/go-to-market-strategy-for-developer-tools/) ·
[selling to developers](https://www.markepear.dev/blog/selling-to-developers) ·
[Convai pricing](https://convai.com/pricing) · [Inworld](https://inworld.ai/) ·
[NPC-gen AI market $5.51Bn](https://www.researchandmarkets.com/reports/6226388/non-player-character-npc-generation-ai-market) ·
[GDC 2026: 52% view genAI negatively](https://blog.imseankim.com/gdc-2026-ai-game-development-npcs-procedural-content-voice-acting/) ·
[MCP adoption stats 2026](https://www.digitalapplied.com/blog/mcp-adoption-statistics-2026-model-context-protocol) ·
[official MCP registry](https://registry.modelcontextprotocol.io/)
