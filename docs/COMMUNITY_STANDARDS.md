# Concord — Community Standards

**Effective Date: [DATE]**
**Last Updated: [DATE]**

This document tells you what's allowed on Concord, what isn't, how to report
content that breaks the rules, and what happens after you report.

The rules here apply to:
- DTUs (any kind, public scope)
- Social posts, comments, direct messages
- Agent specs, recipes, blueprints, NPC personas, voice recordings
- Anything you publish into a public or federated context

Personal DTUs (`scope='personal'`) and private chats with the platform's
brains are NOT subject to community review — they're yours alone and they
never leak (the `personal_dtus_never_leak` invariant is enforced in the
substrate code, not just policy).

---

## What's Allowed

Concord exists so people can build, share, and earn from real knowledge.
You're welcome to publish:

- Anything you created or have the right to share
- Research, opinion, code, music, art, writing, recipes, blueprints, agents
- Critical, controversial, or unpopular takes — argument is part of the work
- Derivative work that properly cites its sources (the royalty cascade
  pays the originals automatically)
- Adult content where legally allowed, marked as such, behind a mature filter
- Commercial content — selling your DTUs is the point of the platform

The standard is honesty: do what you say you're doing, cite what you cite,
sell what you actually made.

---

## What's Not Allowed — Instant Removal + Account Action

These categories are blocked at the substrate layer (`server/lib/content-guard.js`).
Attempting to publish them triggers immediate removal, full audit log entry,
and account suspension or ban depending on severity.

1. **Child sexual abuse material (CSAM) or child exploitation content.**
   Zero tolerance. Detection triggers instant ban, content destruction,
   and a report to the National Center for Missing & Exploited Children
   (NCMEC) per 18 U.S.C. § 2258A.

2. **Credible, specific threats of violence** against identified people
   or groups.

3. **Terrorism content** — recruitment material, instructional content
   for attacks, or propaganda for designated terrorist organizations.

4. **Non-consensual intimate imagery** — sexual or nude images of an
   identifiable person published without their consent, including
   AI-generated deepfakes.

5. **Direct solicitation of illegal drug sales** — buying, selling, or
   facilitating Schedule I/II distribution.

These five categories do not get a review queue. They are removed on detection
and the account responsible is banned. We don't negotiate on them.

---

## What's Not Allowed — Reviewed and Removed

These categories produce a removal action after human review through
`server/lib/content-moderation.js`. Use the report system to flag them.

- **Spam** — automated posting, scraped content, repetitive low-value posts
- **Harassment** — targeted abuse of an individual, including doxxing
- **Hate speech** — content attacking a protected class as a class
- **Graphic violence** as glorification (news / documentation is allowed)
- **Sexual content** outside the mature-content filter, or involving anyone
  whose age can't be verified as 18+
- **Misinformation** that causes real-world harm (election fraud, health
  misinformation that endangers, financial scams)
- **Copyright infringement** — content you don't have the right to share.
  DMCA takedown process below.
- **Impersonation** — pretending to be another real person or organization
- **Self-harm content** — promotion or instruction, NOT recovery discussion
  or harm-reduction work
- **Money laundering, fraud, or other financial crime** — including using
  the CC economy to layer illicit proceeds

---

## Federation and What Travels

Concord can federate DTUs to peer instances (Mastodon-compatible). When you
publish a public DTU on `concord-os.org`, it may:

1. Appear on federated peer instances that have followed you or your topic
2. Be cited by users on those peer instances, triggering royalty cascade
   payouts back to you across instances
3. Continue to exist on peer instances even if you delete it from
   `concord-os.org` — federation has no central undo

If you don't want that, mark your DTU as personal (`scope='personal'`) or
keep it on your own self-hosted instance.

---

## How to Report

**Through the app:**
- Every DTU, post, comment, and user profile has a report button
- Pick the category that fits, add a short reason
- Reports go to `POST /api/moderation/report` and land in the moderation
  queue immediately

**Email:**
- `abuse@concord-os.org` for moderation reports
- `dmca@concord-os.org` for copyright takedowns (must include DMCA notice
  elements — your identity, the work claimed, the infringing URL, a
  good-faith statement, a perjury statement)
- `legal@concord-os.org` for law enforcement / preservation requests
- `security@concord-os.org` for security vulnerabilities (responsible
  disclosure preferred)

**What to include:**
- URL or DTU ID of the content
- Which category from the lists above
- Why you think it violates (one sentence is enough)

---

## What Happens After You Report

1. **Within 24 hours**: report is reviewed by a human moderator (currently the
   platform operator). We acknowledge by email.
2. **Within 72 hours**: a decision is recorded — `approve`, `remove`, `restrict`,
   `warn`, or `suspend`. Reporter is notified of the outcome.
3. **Always**: an audit log entry is created. Content is never silently
   removed — every action has a paper trail viewable via `GET /api/moderation/audit/:contentId`.

For the five instant-removal categories, the timeline is "immediate" —
no review queue, action on detection.

---

## Appeals

If your content was removed or your account suspended and you think the
decision was wrong:

1. Email `abuse@concord-os.org` with the subject line `Appeal: <content-id>`
2. Include why you think the decision was wrong
3. Appeals are reviewed within 7 days by a second moderator (when the team
   grows past one person) or by the platform operator within the same SLA
4. If the appeal succeeds, the content is restored and the moderation log
   shows both the original action and the reversal

CSAM, terrorism, and NCII bans are not appealable.

---

## Account Actions

The moderation engine supports seven actions, in roughly escalating order:

- **Warn**: notice to the user, content stays
- **Restrict**: content stays but loses visibility (no recommendation, no
  federation, no search)
- **Remove**: content is hard-deleted from the substrate and federation
  outbox; ancestor lineage is preserved for royalty cascade purposes but
  the body is gone
- **Suspend**: account is disabled for a fixed period (7 days default)
- **Ban**: account is permanently disabled, sessions revoked, email blocked
  from re-registration, federated peers notified
- **Restore**: reverse a removal (appeal outcome)
- **Flag**: send to review queue without immediate action

Repeated violations escalate. A first spam offense is a warn; the third
is a suspend; sustained pattern is a ban.

---

## Notes on the Economy

The CC economy makes some abuses worth calling out specifically:

- **Citation cycles** are blocked at the substrate level — a recursive
  CTE check in `royalty-cascade.js` prevents A→B→A loops before they form.
  Don't try.
- **Sybil farming** — creating multiple accounts to cite your own work
  and inflate cascade payouts — is bannable. The audit detects it via
  IP + device + behavioral patterns.
- **Royalty cap**: no transaction pays more than 30% of sale price to
  ancestors, capped at depth 50 with a 0.05% floor. The math is
  attack-resistant; don't waste cycles trying to game it.
- **Withdrawal hold**: 48 hours from earn-time to withdraw-eligibility.
  This is the anti-refund-exploit gate (sell → withdraw → buyer disputes
  → funds clawed back). It's enforced in code.

---

## Contact

| Topic | Email | SLA |
|---|---|---|
| Moderation reports | abuse@concord-os.org | 24h ack, 72h decision |
| DMCA takedowns | dmca@concord-os.org | 24h ack, statutory window |
| Law enforcement | legal@concord-os.org | 24h ack |
| Security disclosure | security@concord-os.org | 24h ack |
| General support | support@concord-os.org | best effort |

This is a one-person operation right now. The SLAs are real but they
depend on me actually being awake. If something is genuinely urgent
(active CSAM, ongoing harassment, credible threat), use the report
button AND email — duplication is fine.

---

## Changes to These Standards

We'll post material changes here with a 14-day notice. Minor clarifications
(typos, formatting) may go in immediately. Effective Date / Last Updated
at the top reflects the most recent change.
