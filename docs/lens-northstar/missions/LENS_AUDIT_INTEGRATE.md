Runner split (2026-10-04 1:55 PM): This checkout owns Projects, then Code. Do not edit Music, Artistry, or Forums. Those belong to the Ollama glm-5.2:cloud runner in `/Users/dutch/concord vs code/concord-web-ollama` on branch `lens-audit-ollama`.

Runner note (2026-10-04 11:32 AM): Grok Build balance is exhausted. This run is OpenCode with model opencode/big-pickle. Finance is the open Tier 1 lens. Chat, Timeline, Thread, Mail, Wallet, Calendar, and Marketplace are already committed. Do not redo them unless a column is still missing. Do not push.

# LENS AUDIT + INTEGRATE MISSION

Repo: `/Users/dutch/concord vs code/concord-web`
Branch: `lens-chrome-consolidation` — stay on it. Do not checkout another branch.
Do not push. Do not deploy.
Do not commit untracked `AGENTS.md`, `CLAUDE.md`, `node_modules`, or `docs/lens-northstar`.

## HARD RULE (2026-10-04, Ramaj)

PARTIAL is not done. Do not commit a lens and move on while any acceptance column is still missing. Stay on that lens until its status is COMPLETE.

COMPLETE means all of these are true, verified, and written in the matrix:
- the core workflow hits the real backend and persists
- the real UI control was exercised, not only a unit test
- a refresh and reopen show the same state
- a DTU can be created from the result and sent to a lens that can consume it
- the screen says what actually happened (posted, paid, saved, or refused)
- tests cover the workflow

Wallet, Chat, Timeline, and Thread are PARTIAL. Finish those to COMPLETE before Mail or any later lens. Do not start a new lens while an earlier Tier 1 lens is still PARTIAL.

UNSUPPORTED is allowed only when the real system cannot do the action. Say that on screen. Do not mark it COMPLETE and do not fake the success.

## Operating constraints

- One lens per commit. Do not move on because the page renders. A lens is COMPLETE only when its acceptance criteria pass.
- Keep the existing Claude-clean visual design. Function and interaction, not a new cockpit.
- Concord-native social, mail, and calendar stay authoritative. External services are connectors, clearly labeled. Never say posted or paid unless the real system accepted it.
- Search the repo before building new infrastructure. Use existing DTU, API, and domain code.
- Maintain ~/.zuko/lens-northstar/AUDIT_STATUS.md and a matrix file ~/.zuko/lens-northstar/FUNCTIONAL_MATRIX.md after each lens.
- Start at Tier 1 in the given order (Chat, Timeline, Thread, Mail, Calendar, Marketplace, Wallet, Finance, Projects, Code, Music, Artistry, Forums), then Tier 2, then the rest. If Wallet work is already mid-edit and uncommitted, finish that commit first, then follow Tier 1 order for anything not yet done.
- Stop if disk free is under 5 GB. Do not kill other processes.
- Do not revert Claude's Oct 3-4 commits. Build on them.

Uncommitted Mail files are on disk from a run that was stopped. Do not commit those Mail files until Mail itself is the lens you are taking to COMPLETE. Leave them in the working tree.
Relaunch note (2026-10-04 11:29 AM): Wallet, Chat, Timeline, Thread, Mail, Calendar, and Marketplace are COMPLETE per ~/.zuko/lens-northstar/AUDIT_STATUS.md. Return to Finance and take it to COMPLETE before Projects or any later lens. Do not commit untracked AGENTS.md, CLAUDE.md, node_modules, or docs/lens-northstar. Do not kill Claude, Claude Remote Control, Concord, Unity, or a Next server. Stop if disk free is under 5 GB.

## Mission

CONCORD — LENS FUNCTIONALIZATION, REALITY & CROSS-LENS WORKFLOW PASS

You are not redesigning mockups. You are not adding placeholder buttons. You are not making fake workflows that merely look successful. You are turning every Concord lens into genuinely usable software. Surface existing backend capability through excellent interactive lens experiences.

If the software can do something, the lens should expose it. If an external service provides real data, show the real data. If an operation changes state, persist it. If something cannot be performed, do not pretend it happened. If two lenses are related, they exchange DTUs and workflows.

NON-NEGOTIABLE: every meaningful control leads to a real backend operation, persisted state transition, real calculation, real external API operation, real DTU create/transform/export, or a clearly explained unsupported state. Never: fake success, fake loading, fake records, fake API results, fake payments, fake social, local-only buttons, mark-complete that skips the workflow, hardcoded example data as live data, dead controls, placeholder textboxes where a real interface can exist.

Work lens by lens. Build a functionalization matrix: Lens, Purpose, Existing backend, Existing APIs, Existing DTUs, Native workflows, External integrations, Missing functionality, Status. Do not move on because the page renders.

For each lens define: core user job (not a widget list), 3–7 primary workflows, secondary workflows the backend already supports, persisted objects, real APIs, DTUs it can consume/create/transform/export/share, and cross-lens consumers.

Make every lens interactive with the surface the domain needs (timeline, cards, table, graph, map, calendar, editor, player, inspector, simulation, drag/drop, filters, search, inline edit, charts). Not a giant textbox. Finance gets accounts, balances, transactions, cash-flow, budgets, debt projections, sliders, charts, exportable DTUs. Engineering gets parameter controls, simulation, charts, saved scenarios, export. Travel gets itinerary, stops, dates, maps, flight/hotel data where available, editing, reordering, timeline, alerts, export. Music gets projects, tracks, lyrics, playback, timestamp sync, metadata, editing, export, sharing, DTU creation.

Real API data must be a native-feeling UI with a source indicator, never a JSON dump.

Content: persisted Concord data, connected accounts, real APIs, or clearly labeled deterministic seed data. Empty states teach the job (create, import DTU, connect, explore example).

DTUs are first-class. Export as DTU, Save as DTU, Send to, Open in, Share, Publish, Transform, Add to project, Attach, Compare, Remix, Continue in. Use existing DTU infrastructure. Send to shows only destinations that can consume that DTU. Transformations preserve provenance (created from, transformed by, published to).

Cross-lens examples to implement where the types really match, not arbitrary hardcoding: Music to Thread/Timeline/Marketplace/Podcast; Artistry artwork to Music; Marketplace sale to Finance; Travel to Calendar and back; Code patch to Projects and Graph; Graph to Hypothesis; Legal contracts to Marketplace and Projects; Pets reminders to Calendar; social share of DTUs into Timeline, Thread, Forums. Build capability discovery so Concord can say which lenses consume a DTU.

Native Concord calendar, player mailbox, and social stay authoritative. Google, Gmail, Bluesky, Mastodon are labeled integrations. If the external API cannot do the action, label copy/export as copy, never as posted.

Real state machines. Marketplace: created, awaiting_payment, paid, processing, shipped, delivered. Returns: pending, approved, received, closed. Legal: draft, sent, viewed, signed, completed. Payments: scheduled, processing, settled. No UI shortcuts that skip states.

Live feedback where the backend supports it: polling, subscriptions, optimistic updates with reconciliation, refresh, progress. Do not require a full reload.

Search the repo before new infrastructure.

Test each lens like a user: open, create, edit, save, refresh, reopen, interact, transform/export, send to another lens, verify persistence.

Acceptance matrix columns: Lens, Core workflow, Real backend, Real UI, Persistence, Live data, DTU, Cross-lens, Tests. Status COMPLETE, PARTIAL, BLOCKED, or UNSUPPORTED. Never COMPLETE just because the UI renders.

Order: Tier 1 Chat, Timeline, Thread, Mail, Calendar, Marketplace, Wallet, Finance, Projects, Code, Music, Artistry, Forums. Tier 2 Legal, Graph, Hypothesis, SRS, Travel, Weather, Engineering, Physics, HVAC, Pets, Fitness, Food, Retail, Healthcare, Accounting. Tier 3 every remaining lens. Do not skip them.

Quality bar is the real product category (ChatGPT/Claude, VS Code/Cursor, Spotify, Monarch, QuickBooks, Linear, Strava, Shopify, Miro, MyChart, TripIt, MyFitnessPal/Yelp, Anki) in usefulness, not a copied interface.

Each lens must answer: what am I looking at, what can I do, what changed, what next, where can this go, what else in Concord can use it. After the lens works, implement the coolest useful workflow, the DTU connection, the live data that would help, and the interaction that makes it a serious product. Repeat until the family is done. The end state is one OS of connected capabilities, not hundreds of isolated pages.
