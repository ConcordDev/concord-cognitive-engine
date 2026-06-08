# ConKay Safety Model — Capability Sandbox, Abuse Prevention & Lens Lifecycle
*Defensive design · 2026-06-08 · web-researched + cited · companion to `CONKAY_AS_BUILDER_ROADMAP.md`*

> **Why this exists:** ConKay can write + run code, author "lenses" others install, reach external
> services (MCP + OAuth connectors), and publish to a marketplace / global tier / social feed. That
> capability set is largely unprecedented for a *private, user-owned* assistant — so the safety model
> has to prevent abuse **without** nannying the sovereign local user.

## The organizing principle

> **Authority is bounded by what code can *reach*; duty is triggered by *whom an artifact reaches*.**

Enforce safety by **architecture** (capability confinement makes cross-user/host harm
*unrepresentable*, not merely forbidden), gate harm at the **distribution boundary** (sell / global /
social), and **never** police private use by inferring intent. This is the same consent-of-the-affected-
party line the CFAA, Anthropic, and GitHub all independently drew.

---

## Three boundaries

### 1. Integrity boundary — canon code is immutable
No user/agent lens can alter the **constitutional core**: the economy invariants (marketplace fees,
royalty caps, earned-only/48h withdrawals, `CREDIT_ROW_PREDICATE`), the substrate, `server.js`,
migrations, or another lens's state.
- **Enforced by:** lenses get a **confined `ctx`** — no raw `db` handle, no FS write to core, no ability
  to register/override economy macros. Minting (`mintCoins`) stays a privileged lib function, never on
  any user-callable allowlist. *(Already true; keep it.)*
- Maps to OWASP **LLM06 Excessive Agency**, **ASI05 Unexpected Code Execution**.

### 2. Sovereignty boundary — local is free
What runs **only on your machine, against only your data, in the confined sandbox** = maximally free.
Dual-use, security research, anything that doesn't reach a non-consenting party — allowed. No nannying.
- **Enforced by:** object-capability + **per-user data isolation** → a lens holds *no reference* by which
  to address another user's data or another machine. The blast radius is provably confined, so freedom
  is the safe default. ([object-capability / POLA](https://github.com/dckc/awesome-ocap),
  [GDPR Art. 25 data-minimization](https://www.privacy-regulation.eu/en/article-25-data-protection-by-design-and-by-default-GDPR.htm),
  [local-first sovereignty](https://www.inkandswitch.com/essay/local-first/))

### 3. Distribution boundary — sell / global / social = gated
The promotion ladder **private → sold → global** puts the gate at promotion; the social feed is a
publish event too. This is where legal duty + abuse screening fire.

**🔴 Hard pre-block (criminal; §230 won't save you; never reachable via mere takedown):**
| Category | Why |
|---|---|
| **CSAM** | 18 U.S.C. §2258A — block **+ mandatory NCMEC CyberTipline report** + 1-yr preservation |
| **NCII / deepfake porn** | TAKE IT DOWN Act 2025 — publishing is a federal crime **+** 48-hr removal mechanism (due May 2026) |
| **Terrorism / FTO material support** | 18 U.S.C. §2339B — providing *services* to a designated FTO is criminal |
| **Incitement / true threats** | outside 1st-Amendment + §230 protection |
| **Malware / exploit / phishing / carding tooling** *distributed for unauthorized access or fraud* | CFAA §1030, §1029, §1960; the **purpose+target** is the line, not the capability |
| **Stalkerware / covert surveillance** | FTC ban (SpyFone); ECPA/Wiretap exposure |
| **Any artifact that mints/moves money outside platform rails** | §1960 unlicensed money transmission + BSA/AML — *validates the existing can't-mint-CC + earned-only-withdrawal invariants* |

**🟡 Notice-and-takedown (managed liability — keep the safe harbor by acting):**
- **Copyright / IP** — DMCA §512: register a designated agent, expeditious removal, counter-notice
  window, **repeat-infringer termination**.
- **EU illegal content generally** — DSA notice-and-action + statement-of-reasons.

**Dual-use carve-out (so sovereignty holds at the boundary too):** gate on **purpose + target +
distribution**, not capability. Security/research tooling stays free; only *unauthorized targeting* and
*weaponized distribution into active attacks* are gated (the GitHub/Anthropic model). Require an
**authorization attestation** for security-tool listings.

**Provenance:** attach **C2PA Content Credentials** to AI-generated media shared to social/global.

**Moderation pipeline:** automated pre-screen at publish → **human review for the global/high-reach
tier** → report/takedown after. Cost is paid at scale, not at private creation.
([DSA](https://digital-strategy.ec.europa.eu/en/policies/digital-services-act),
[DMCA §512](https://www.copyright.gov/512/),
[§230 limits](https://www.congress.gov/crs-product/R46751),
[TAKE IT DOWN](https://www.congress.gov/bill/119th-congress/senate-bill/146/text),
[C2PA](https://contentauthenticity.org/how-it-works))

---

## ConKay itself is the attack surface — agentic-AI hardening

Because ConKay both *runs code* and *acts on your behalf with tools*, assume **prompt injection will
succeed** and make a hijacked agent **unable to do damage**. The #1 control is least-privilege +
capability authorization **at the runtime, not in the model** + **provenance separation**.

| Threat (OWASP LLM 2025 / Agentic ASI 2026) | Control |
|---|---|
| **LLM01 / ASI01** prompt injection, goal hijack | **Provenance separation** — untrusted content (fetched web, installed-lens output, docs) can never become a privileged instruction. Dual-LLM / CaMeL pattern: the tool-wielding planner never ingests raw untrusted tokens. |
| **LLM06** excessive agency | minimize tools; scope tightly; **human-in-the-loop for high-impact/irreversible actions** |
| **ASI03** identity & privilege abuse | per-connector **short-lived, least-scope** OAuth tokens; no credential inheritance (the tokens we built get minimal scope) |
| **ASI09** human-agent trust exploitation | at approval, show the **real action + parameters + data provenance** — never ConKay's narrative |
| **ASI05 / LLM10** unexpected code exec, unbounded consumption | **ephemeral microVM/gVisor sandbox + default-deny egress + CPU/mem/time quotas** (node:vm/isolated-vm are *not* sufficient alone — vm2's CVE wave proves it) |
| **ASI04 / LLM03** supply-chain (lenses, MCP servers) | **sign + review + capability-declared** lenses; vet MCP servers; dependency scan. *(The Nx/VS Code extension thefts — 3,800 repos — are the live precedent.)* |
| **ASI08** cascading failures | blast-radius limits, circuit breakers, **kill-switch** (Concord already has kill-switches + the refusal-field ethos) |

([OWASP LLM Top-10 2025](https://genai.owasp.org/llm-top-10/),
[OWASP Agentic Top-10 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/),
[CaMeL / Dual-LLM](https://simonwillison.net/2025/Apr/11/camel/),
[vm2 CVE wave](https://www.kodemsecurity.com/resources/vm2-sandbox-escape-vulnerabilities-the-2026-cve-wave-turning-ai-agents-into-host-rce-vectors),
[sandboxing AI agents](https://northflank.com/blog/how-to-sandbox-ai-agents),
[NIST AI RMF GenAI Profile](https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf),
[MITRE ATLAS](https://atlas.mitre.org/))

---

## What's already there vs. what to build
- ✅ **Already:** privileged (non-user-callable) minting, the `personal→public→published→global` scope
  ladder, `personal_dtus_never_leak`, three-gate ACL, SSRF guard, exec gated-off in prod,
  command-injection + authz-coverage detectors, kill-switches, the constitutional economy invariants.
- 🔧 **To build:** (1) the **confined-ctx capability sandbox** (allowlisted macros + pre-scoped user id +
  no raw db); (2) a **capability manifest + install-time consent** per lens; (3) **provenance separation**
  for ConKay's planner (untrusted-data-can't-instruct); (4) **ephemeral microVM/gVisor isolation +
  default-deny egress + quotas** for code exec; (5) the **publish-boundary screening pipeline**
  (hard-block list + DMCA agent/repeat-infringer + DSA notice-action + human review for global) + C2PA
  on shared AI media; (6) **least-scope, short-lived connector tokens**.

## The one-line policy a user sees
> **"Run anything on your own hardware, against your own data — that's yours. The moment you point it at
> someone else, or ship it to others, you're at the consent boundary, and that's the only thing we
> gate."**

---

*Caveats: this is research, not legal advice — have counsel review the gating policy, especially
money-transmitter/state-licensing and the exact statutory wording (confirm against the linked
.gov/primary sources). Several research fetches were 403-blocked and quoted from search extracts of the
canonical pages; verify verbatim policy quotes before using them in a compliance doc.*
