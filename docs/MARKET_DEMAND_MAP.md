# Concord — Market-Demand Map
*Web-researched companion to `SCIFI_FEASIBILITY_MAP.md` · 2026-06-08*

> **What this is.** The feasibility map (§1–§3 of `SCIFI_FEASIBILITY_MAP.md`) rates Concord's
> capabilities against the *code*. This companion rates the *market* against the *web*: for each
> demand vector Concord claims to serve, what is the real 2026 evidence of pull, who owns it today,
> and where is the white space. Built via a 5-angle deep-research fan-out (grounded AI · agentic AI ·
> local/private AI · subscription/lock-in · second-brain + landscape), with adversarial verification.
>
> **Honesty rule (same as the code half).** Every load-bearing claim carries a source URL. Estimates
> are marked **(est.)**. Where analyst firms disagree, the spread is shown, not a single cherry-picked
> number. A widely-circulated SEO cluster of round hallucination stats ("62%/71%/76%…") was found to
> have **no locatable primary source** and is deliberately excluded — see §6.

---

## TL;DR

- **The single demand vector with the strongest *revealed* pull is verifiable / grounded AI** —
  capital and product roadmaps, not just surveys, are converging on source-grounding (Perplexity at a
  ~$18–20B valuation on cited answers alone; Google + Microsoft shipping citations as default). This
  is Concord's deepest-built capability (`reason.verify` + compute-grounded routing). **Lead with it.**
- **Agentic AI has the loudest demand but the weakest delivery.** Appetite is real and accelerating
  (Gartner: agentic in 33% of enterprise apps by 2028, from <1% in 2024) **but production reliability
  is the binding constraint** — the best agents complete only ~30–35% of multi-step tasks (CMU/
  Salesforce benchmarks) and Gartner expects >40% of agentic projects cancelled by 2027. **This gap is
  Concord's opening: a *verified* agent is the answer to the agent-reliability backlash.**
- **Local/private AI is real but niche** — an enterprise + developer/enthusiast wedge (on-prem >50% of
  2025 enterprise LLM spend; Ollama ~174k stars), **not a mainstream consumer movement** (ChatGPT
  ~800–900M weekly users dwarfs the entire local ecosystem by 2–3 orders of magnitude). Position it as
  a wedge, never as "local is winning."
- **Anti-subscription / owned-AI is a "tax revolt," not an exodus** — broad stated grievance (41–47%
  subscription fatigue; 81% enterprise lock-in concern) but subscriptions are still *growing fast*.
  Strongest in enterprise/regulated buyers; consumer grievance is mostly about *price*, not the model.
- **Controllable memory / "second brain" is a real, monetizing market** (Notion ~$500M ARR with >50%
  AI-attributed; ChatGPT shipped controllable memory). Concord's DTU substrate maps here.
- **The white space is the *combination*, not any checkbox.** Every incumbent owns exactly one vector
  (Perplexity=grounded, ChatGPT=general, Copilot=enterprise, local-AI=privacy, Notion=PKM). No one
  ships grounded **AND** private **AND** agentic **AND** owned-memory **AND** creator-economy on one
  substrate. That intersection — Concord's actual shape — is unoccupied. The moat is depth ×
  combination, exactly as the feasibility map's honesty caveat #2 already warned.

---

## 1. Demand-vector scorecard

Verdict legend: **🟢 strong pull** (revealed by capital/usage) · **🟡 contested** (loud but soft
delivery or behavior) · **🔵 real-but-niche** · **⚪ grievance > behavior**

| Concord demand vector | Market evidence (cited, summarized) | Who owns it today | Concord's position | Verdict |
|---|---|---|---|---|
| **Verifiable / grounded AI** (cites, refuses when unsure) | Perplexity ~$18–20B val on cited answers [B8]; Google AI Overviews citations at ~2B users + "Grounding with Google Search" [B10]; MS Copilot footnote citations + Bing AI-citation data [B11]; RAG market ~$1.9B→$10.2B by 2030 **(est.)** [B12]; trust *fell* as use rose — only 46% trust AI while 66% use it [A1]; 66% of US adults + 70% of experts most-worried about inaccurate info [A3]. | **Perplexity** (grounded search); Google/MS adding it as a feature. | `reason.verify` deterministic citation floor + council judge + Grounded/"verify" badge, **plus compute-grounded routing** (math → real CAS). Verification is *first-class*, not a footnote. | **🟢** |
| **Proactive / agentic** (does real multi-step tasks) | Gartner: agentic in 33% of enterprise apps by 2028, from <1% [C1]; 40% of enterprise apps with task-specific agents by 2026 [C3]; AI-agent market ~$7.84B→$52.6B by 2030 **(est., wide spread)** [C4]; OpenAI ChatGPT-agent, Claude computer-use shipped [C5][C6]. **But:** best agents finish only ~30% of multi-step office tasks (CMU) [C12], ~35% multi-step (Salesforce) [C13]; >40% of agentic projects cancelled by 2027 (Gartner) [C10]; MIT: 95% of GenAI pilots flat on P&L [C14]. | ChatGPT/Operator, Copilot (420M MAU, 120k agents) [C7] — but no one has *reliable* multi-step. | ~9,600 macros / 478 domains + `initiative-cycle` / `personal-beat-scheduler` heartbeats. **The verification layer is the differentiator the agent wave is missing.** | **🟡** (appetite real, delivery is the whole game) |
| **Local / private / no-harvest** | On-prem >50% of 2025 enterprise LLM spend **(est.)** [D3]; Ollama ~174k GitHub stars, +261% in 2024 [D1][D2]; Cisco: 90% think local storage safer [D6]; Apple Intelligence on-device + Private Cloud Compute [D7]. **But:** ChatGPT ~800–900M WAU dwarfs local by 2–3 orders of magnitude [D9]; Ollama itself ~$500K funding / ~$3.2M rev / ~21 people [D10]; hardware + quality-gap barriers [D11][D12]; privacy paradox — 64% worry yet ~half still input personal data [D13]. | **Ollama / LM Studio / Jan** (enthusiast); enterprise on-prem; Apple (on-device). | Local 5-brain Ollama stack + consent gates + `personal_dtus_never_leak`. | **🔵** (enterprise + enthusiast wedge; **not** mainstream) |
| **Owned / no-subscription / anti-lock-in** | 41–47% report subscription fatigue (Deloitte) [E1]; 81% of enterprise leaders concerned about AI vendor dependency [E4]; >50% of orgs already use open-source AI, >75% will increase (McKinsey/Mozilla) [E5]; open-weights ~30% of OpenRouter tokens by late-2025 **(est.)** [E7]. **But:** OpenAI ~35–50M paying subs, ChatGPT ~$8B in 2025 — subs *growing* [E11]; consumers keep ~5.6 subs and complain about *price*, not the model [E13]; open-source friction (56% cite security/compliance) [E14]. | Open-weight ecosystem + self-host (enterprise); incumbents still win consumer wallets. | Free + local + take-rate (no subscription) + creator economy / perpetual royalties. | **⚪→🔵** (grievance > behavior for consumers; real for enterprise/regulated) |
| **Controllable memory / second brain** | Notion ~$500M ARR, ~$11–12B val, >50% of ARR AI-attributed [B2][B3]; Obsidian ~1.5M MAU, local-first **(est.)** [B4]; ChatGPT shipped controllable memory in 2025 [B6]; note-taking market ~$11–15B in 2024–25 **(est., firms disagree 5×)** [B5]. | **Notion / Obsidian** (PKM); ChatGPT memory. | DTU substrate (674 tables, ~1.5M-DTU cap, auto-consolidation) + scope/consent privacy gates + cross-lens recall. | **🟢** (real + monetizing) |

---

## 2. Competitive landscape — who owns which vector

| Player | 2026 scale (cited) | Owns the vector of… |
|---|---|---|
| **ChatGPT / OpenAI** | ~800M weekly users (Oct 2025) [B7]; >$20B ARR run-rate [B8'] | General-purpose consumer default |
| **Google Gemini** | ~750M MAU + AI Overviews reach ~2B/mo [B9][B10] | Ecosystem distribution (Android/Search/Workspace) |
| **Anthropic Claude** | ~$9B+ ARR, $380B val, Claude Code ~$1B [B11'][B12'] | Coding + enterprise + safety |
| **Microsoft Copilot** | ~420M MAU, 120k custom agents [C7] | Enterprise / Office bundling |
| **Perplexity** | ~45M MAU, ~$18–20B val [B8][B9'] | **Grounded / cited search** |
| **Local-AI (Ollama/LM Studio/Jan)** | Ollama ~174k stars; vendor revenue tiny [D1][D10] | Privacy / self-host (enthusiast + enterprise) |
| **Notion / Obsidian** | Notion ~$500M ARR; Obsidian ~1.5M MAU [B2][B4] | Second brain / PKM |

**The white space.** Each incumbent is deep in *one* column and shallow-to-absent in the others.
Perplexity is grounded but cloud, not private, not your-memory, not agentic-over-your-life.
Notion is your-memory but not grounded-with-refusal and not local. Ollama is private but bring-your-own
everything-else. **No incumbent ships the intersection.** Concord's defensible position is precisely
that intersection — *and only if the depth is real in each*, which the feasibility map verified the
code mostly is. The risk is the mirror image: a do-everything product that is shallow everywhere loses
to a focused incumbent on that incumbent's one axis. Hence: **lead with one vector (grounded +
private R&D compute-agent), let the combination be the retention story, not the acquisition pitch.**

---

## 3. Market sizing (all figures are estimates; firms disagree widely)

Cite these as **order-of-magnitude signal**, never as precise TAM. Inter-firm disagreement is large
(up to ~10× on the broad GenAI number), so each row shows the source and, where found, the spread.

| Segment | 2025 size **(est.)** | Forecast **(est.)** | Source |
|---|---|---|---|
| Generative AI (broad) | ~$22B–$38B (firms disagree ~70%) | ~$109B–$1,206B by 2030–35 (~10× spread) | Grand View / Precedence [B16] |
| AI assistant (narrow) | ~$3.35B | ~$21.1B by 2030 (~44.5% CAGR) | MarketsandMarkets [B17] |
| Enterprise LLM | ~$8.8B | ~$71.1B by 2034 (~26% CAGR) | GMInsights [D3] |
| RAG / grounded answering | ~$1.9B | ~$10.2B by 2030 (~40% CAGR) | Mordor [B12] |
| AI agents | ~$7.84B | ~$52.6B by 2030 (~46% CAGR) | MarketsandMarkets [C4] |
| Note-taking / PKM | ~$11–15B (base differs 5×) | ~$26–49B by 2030–35 | MRF / TBRC / Credence [B5] |

**The honest read:** these markets are large and growing fast in every framing, so "is the market big
enough" is not the question. The question is **share inside a crowded field** — which is a
positioning/distribution problem, not a TAM problem.

---

## 4. Wedge segments (tie-in to the feasibility map's R&D thesis)

| Wedge | Leads with | Demand evidence | Competition | Fit |
|---|---|---|---|---|
| **R&D / engineering compute-agent** | verifiable + private + the *real* CAS + beam-frame FEA (feasibility map §1 row 6) | enterprise on-prem >50% of LLM spend [D3]; sovereignty board-level [D5]; verification demand [A3] | thin — no incumbent pairs a private agent with real engineering compute | **best** — strongest demand (enterprise private + verifiable) meets Concord's confirmed strength |
| **Private "second brain"** | owned-memory + local + verifiable recall | Notion >50% AI-ARR proves AI-over-your-notes demand [B3]; Obsidian local-first pull [B4] | Notion (cloud), Obsidian (local, no AI depth) | strong — but crowded; differentiate on grounded recall + privacy |
| **Verifiable-research user** | grounded / cited / refuses | Perplexity's $18–20B reveals the pull [B8] | **Perplexity owns it and is well-funded** | viable but hardest — attacking the incumbent on its home axis |

**Recommendation:** lead acquisition with the **R&D compute-agent** wedge (best demand-to-strength fit,
thinnest competition), use the **verifiable + private** combination as the retention/moat story, and
treat the verifiable-research and second-brain framings as adjacent expansion, not the beachhead.

---

## 5. Strategic implications for Concord

1. **Verification is the wedge AND the answer to the agent backlash.** The same research that shows
   huge agentic *appetite* (Gartner) shows the *delivery* is broken (CMU ~30%, MIT 95% pilots flat).
   A grounded-by-construction agent that says "verify me" is not a nice-to-have — it directly addresses
   the #1 reason agentic projects are being cancelled. Pitch `reason.verify` as agent *trust
   infrastructure*, not just a citation badge.
2. **Private/owned is a wedge, never a mainstream claim.** The data is unambiguous: cloud AI has ~1B
   users; local has enthusiast+enterprise share. Selling "private" to consumers fights the privacy
   paradox (they say they care, then paste secrets into ChatGPT [D13]). Sell it to **enterprise/
   regulated/R&D** where the demand is revealed (on-prem spend, sovereignty) and monetizable.
3. **Don't out-checkbox incumbents; out-combine them.** Every survey says people want grounded AND
   private AND agentic AND owned. No incumbent delivers the set. The combination is the only
   defensible claim — provided each component is genuinely deep (the feasibility map says the code is).
4. **"Show the receipts" is the channel.** In a market where trust *fell* as adoption rose [A1] and
   95% of pilots disappoint [C14], a build-in-public "here is the code, here is the source, verify it
   yourself" narrative is itself the differentiator — for both the product and the market claims.

---

## 6. Honest counter-evidence & caveats (protect credibility)

- **Stated demand ≠ revealed willingness-to-pay.** 66% of users don't verify AI output even when they
  say they distrust it [A2]; convenience beats verification at the point of use. The verifiable-AI pull
  is strongest on the *vendor/capital* side; consumer pay-for-verification is softer than surveys imply.
- **Agentic delivery is genuinely broken right now.** If Concord ships agents on small local models,
  the ~30% multi-task ceiling applies *harder*. Lead with verification + bounded/assisted agency, not
  full autonomy claims.
- **Local AI is niche; do not overclaim.** Any "local is winning" framing is contradicted by
  ChatGPT's ~800–900M users [D9] and the tiny scale of local-AI vendors [D10].
- **Anti-subscription is mostly a price grievance for consumers** [E13], and lock-in concern is so
  universal (81–94%) it risks being cheap talk while incumbent budgets triple [E15]. Real behavior
  change is concentrated in enterprise/open-source adoption.
- **Market-size figures are soft.** Up to ~10× inter-firm disagreement on GenAI [B16]; PKM has no
  consistent TAM. Use as directional signal only.
- **Excluded as unverified:** a recurring SEO cluster — "62% cite hallucinations as #1 barrier,"
  "71% of C-suite won't scale without hallucination-proofing," "76% run human-in-the-loop,"
  "47% made a major decision on hallucinated content" — appears across content farms with **no
  locatable primary report**. Do **not** cite these. The credible anchors are KPMG, Pew, McKinsey,
  Stanford HAI, Gartner, CMU, MIT, and the financial press (below).

---

## Cross-references
- Code-feasibility half (capabilities vs. source): `docs/SCIFI_FEASIBILITY_MAP.md`.
- Master continuation plan + tracks (incl. the connector-honesty Track C): `docs/CONKAY_HONEST_HOLOGRAM_PLAN.md`.

---

## Sources

**A — Verifiable / grounded AI (trust & accuracy demand)**
- [A1] KPMG / Univ. of Melbourne, *Trust, Attitudes and Use of AI: A Global Study 2025* (48k people, 47 countries) — https://kpmg.com/xx/en/our-insights/ai-and-technology/trust-attitudes-and-use-of-ai.html
- [A2] KPMG 2025 (66% rely without evaluating; 56% work mistakes) — https://www.unleash.ai/artificial-intelligence/66-of-individuals-may-be-using-ai-but-79-are-wary-of-possible-risks-finds-kpmg/
- [A3] Pew Research Center, *How the US Public and AI Experts View AI*, Apr 3 2025 — https://www.pewresearch.org/internet/2025/04/03/views-of-risks-opportunities-and-regulation-of-ai/
- [A4] Pew Research Center, Sept 2025 (50% more concerned than excited) — https://www.pewresearch.org/science/2025/09/17/how-americans-view-ai-and-its-impact-on-people-and-society/
- [A5] McKinsey, *The State of AI 2025*, Nov 2025 — https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai
- [A6] Stanford HAI, *2025 AI Index — Responsible AI* (233 incidents in 2024, +56%) — https://hai.stanford.edu/ai-index/2025-ai-index-report/responsible-ai
- [A7] CMU (Cash et al.), *AI overconfidence / miscalibration*, July 2025 — https://www.cmu.edu/dietrich/news/news-stories/2025/july/trent-cash-ai-overconfidence.html

**B — Grounded supply side, second brain & landscape**
- [B2][B3] CNBC, *Notion crosses $500M ARR, launches AI agent*, Sep 18 2025 — https://www.cnbc.com/2025/09/18/notion-launches-ai-agent-as-it-crosses-500-million-in-annual-revenue.html
- [B4] Fueler, *Obsidian statistics 2026* (est.) — https://fueler.io/blog/obsidian-usage-revenue-valuation-growth-statistics
- [B5] Market Research Future / TBRC / Credence (note-taking market, conflicting) — https://www.marketresearchfuture.com/reports/note-taking-app-market-27737
- [B6] OpenAI, *Memory and new controls for ChatGPT*, 2025 — https://openai.com/index/memory-and-new-controls-for-chatgpt/
- [B7] TechCrunch, *ChatGPT hits 800M weekly active users*, Oct 6 2025 — https://techcrunch.com/2025/10/06/sam-altman-says-chatgpt-has-hit-800m-weekly-active-users/
- [B8] Bloomberg, *Perplexity valued at $18B*, Jul 17 2025 — https://www.bloomberg.com/news/articles/2025-07-17/ai-startup-perplexity-valued-at-18-billion-with-new-funding ; [B9'] TechCrunch, *$200M at $20B*, Sep 10 2025 — https://techcrunch.com/2025/09/10/perplexity-reportedly-raised-200m-at-20b-valuation/
- [B8'] Sherwood, *OpenAI ARR >$20B in 2025* — https://sherwood.news/business/openais-arr-reached-over-usd20-billion-in-2025-cfo-says/
- [B9] TechCrunch, *Gemini app surpasses 750M MAU*, Feb 4 2026 — https://techcrunch.com/2026/02/04/googles-gemini-app-has-surpassed-750m-monthly-active-users/
- [B10] Google, *Grounding with Google Search* — https://ai.google.dev/gemini-api/docs/interactions/google-search
- [B11] Microsoft, *Best of AI search in Copilot*, Nov 7 2025 — https://www.microsoft.com/en-us/microsoft-copilot/blog/2025/11/07/bringing-the-best-of-ai-search-to-copilot/
- [B11'][B12'] SaaStr, *Anthropic ARR* — https://www.saastr.com/anthropic-just-hit-14-billion-in-arr-up-from-1-billion-just-14-months-ago/ ; Anthropic, *$30B Series G at $380B* — https://www.anthropic.com/news/anthropic-raises-30-billion-series-g-funding-380-billion-post-money-valuation
- [B12] Mordor Intelligence, *RAG market* (est.) — https://www.mordorintelligence.com/industry-reports/retrieval-augmented-generation-market
- [B16] Grand View / Precedence (generative-AI market, conflicting) — https://www.grandviewresearch.com/industry-analysis/generative-ai-market-report ; https://www.precedenceresearch.com/generative-ai-market
- [B17] MarketsandMarkets, *AI assistant market* (est.) — https://www.marketsandmarkets.com/Market-Reports/ai-assistant-market-40111511.html

**C — Agentic AI demand & reliability backlash**
- [C1][C2][C10][C11] Gartner, *>40% of agentic AI projects cancelled by 2027* (+ 33% by 2028; agent-washing) — https://www.gartner.com/en/newsroom/press-releases/2025-06-25-gartner-predicts-over-40-percent-of-agentic-ai-projects-will-be-canceled-by-end-of-2027
- [C3] Gartner, *40% of enterprise apps with task-specific agents by 2026* — https://www.gartner.com/en/newsroom/press-releases/2025-08-26-gartner-predicts-40-percent-of-enterprise-apps-will-feature-task-specific-ai-agents-by-2026-up-from-less-than-5-percent-in-2025
- [C4] MarketsandMarkets, *AI agents market $52.6B by 2030* (est.) — https://www.marketsandmarkets.com/PressReleases/ai-agents.asp
- [C5] OpenAI, *Introducing ChatGPT agent* — https://openai.com/index/introducing-chatgpt-agent/
- [C6] Anthropic, *Computer use* — https://www.anthropic.com/news/3-5-models-and-computer-use
- [C7] Stackmatix (Microsoft Copilot adoption) — https://www.stackmatix.com/blog/copilot-market-adoption-trends
- [C12] The Register, *CMU TheAgentCompany — agents wrong ~70% of the time* — https://www.theregister.com/2025/06/29/ai_agents_fail_a_lot/
- [C13] Mezha (CMU/Salesforce multi-step benchmark figures) — https://mezha.media/en/news/ai-agents-fails-most-tasks-303017/
- [C14] Fortune, *MIT — 95% of GenAI pilots failing* — https://fortune.com/2025/08/18/mit-report-95-percent-generative-ai-pilots-at-companies-failing-cfo/

**D — Local / private AI**
- [D1] Ollama GitHub — https://github.com/ollama/ollama ; [D2] TechCrunch, *hottest OSS startups 2024* — https://techcrunch.com/2025/03/22/the-20-hottest-open-source-startups-of-2024/
- [D3] GMInsights, *Enterprise LLM market* (est.; on-prem >50% of 2025 spend) — https://www.gminsights.com/industry-analysis/enterprise-llm-market
- [D5] Deloitte, *State of AI in the Enterprise 2026* (sovereignty board-level) — https://www.deloitte.com/us/en/insights/topics/technology-management/ai-infrastructure-survey.html
- [D6][D13] Cisco, *2025 Data Privacy Benchmark Study* (90% local-safer; privacy paradox) — https://www.cisco.com/c/dam/en_us/about/doing_business/trust-center/docs/cisco-privacy-benchmark-study-2025.pdf
- [D7] Apple, *Private Cloud Compute* — https://security.apple.com/blog/private-cloud-compute/
- [D9] TechCrunch (ChatGPT 800M WAU — the niche reality check) — https://techcrunch.com/2025/10/06/sam-altman-says-chatgpt-has-hit-800m-weekly-active-users/
- [D10] Crunchbase / getLatka (Ollama funding ~$500K) — https://getlatka.com/companies/ollama.com/funding
- [D11][D12] Local-LLM hardware / quality guides 2026 — https://studiomeyer.io/en/blog/local-llms-2026
- [D14] Pew, *Americans' views of AI control* (want regulation, not self-hosting) — https://www.pewresearch.org/science/2025/09/17/ai-in-americans-lives-awareness-experiences-and-attitudes/

**E — Subscription / lock-in / owned AI**
- [E1] Deloitte, *2025 Digital Media Trends* (41–47% subscription fatigue) — https://www.deloitte.com/us/en/insights/industry/technology/digital-media-trends-consumption-habits-survey/2025.html
- [E4][E10] Zapier, *AI vendor lock-in survey* (81% concerned) — https://zapier.com/blog/ai-vendor-lock-in-survey/
- [E5][E6][E14] McKinsey w/ Mozilla, *Open source in the age of AI* (>50% use, 56% security barrier) — https://www.mckinsey.com/capabilities/quantumblack/our-insights/open-source-technology-in-the-age-of-ai
- [E7][E15] Kai Waehner, *Enterprise Agentic AI Landscape 2026* (open-weight token share; lock-in vs. spend) — https://www.kai-waehner.de/blog/2026/04/06/enterprise-agentic-ai-landscape-2026-trust-flexibility-and-vendor-lock-in/
- [E11] The Tech Portal, *OpenAI targets 122M subscribers* (subs growing) — https://thetechportal.com/2026/04/29/openai-targets-122mn-chatgpt-subscribers-by-2026-with-new-8-plan-push/
- [E13] Marketing LTB, *Subscription statistics 2026* — https://marketingltb.com/blog/statistics/subscription-statistics/

*Researched 2026-06-08 via a 5-angle deep-research fan-out with adversarial verification. Confidence
and inter-source conflicts are noted inline. Estimates marked **(est.)**. Figures reflect the cited
reports' methodologies, which differ; treat market-size numbers as directional.*
