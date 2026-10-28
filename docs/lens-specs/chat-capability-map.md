# Chat Lens — Capability Map (three-column, LENS REWORK format)

> Reworked 2026-10-28 (PR #1704 rework). Base table: Product's live
> review of the Chat lens (`concord-product/lens-reviews/chat.md` §5d,
> verified live 2026-10-28 as the concordosdev account), updated for
> what this rework shipped. New/changed rows are marked
> "(this rework)" and are behaviour-tested in this PR; per the Concord
> Standard they count as closed only on Product's §9 re-review, not on
> this document's say-so.
>
> Backend inventory (unchanged by the rework): 45 `chat` domain
> macros, all surfaced; `project-get` is the one macro with no
> dedicated UI call, redundant by design (`projects-list` returns full
> records). Chat surface: `components/chat/ChatWorkspacePanel.tsx`.

| ChatGPT feature | 1. Have, and works live | 2. Have in backend, not surfaced or broken | 3. Missing |
|---|---|---|---|
| General chat with streaming reply + stop control | **Yes** — live-verified by Product; stop is wired (AbortController) and pinned by panel behaviour tests | | |
| Conversation history: list, search, rename, delete | **Yes** — panel now starts OPEN on desktop for first-run users and remembers the user's choice (this rework, S3); message counts are DERIVED from the stored rows server-side and from the real thread client-side — the "3 messages for 2" defect is fixed at both ends (this rework, S4) | | |
| Message actions: copy, edit (own), regenerate, feedback thumbs | **Yes** — live-verified by Product | | |
| Read answer aloud | **Yes** — present on assistant messages (presence verified; audio playback not exercised) | | |
| Suggestion prompts on the home view | **Yes** — 4 job starters, jargon-free: Explain a concept simply / Help me outline a plan / Make something I can keep / Compute something exactly (the last routes to ConKay) (this rework, S3) | | |
| Visible model / brain choice before send | **Yes** — a Brain chip on the composer names the answering slot (Conscious brain / Backup model) and the live pool state from GET /api/brain/status BEFORE sending, and re-reads when a send starts (this rework, S1). Mode menu opens readably with per-mode descriptions and full menu semantics in BOTH the toolbar and the composer (this rework, S6); ConKay carries its true subtitle — "Deterministic solvers — answers that show their work" — and a calculator glyph instead of a microphone | | |
| Citations / sources on answers | **Yes, surfaced honestly** — every assistant reply carries a receipts strip: "Computed — checked by Concord's solvers" when the server marked it computed, "Sourced — N sources below" when it carries sources/DTU refs (the sources render under it), or "No external sources — model answer" when it has none (this rework, S2). Citation depth itself stays the narrow verified-compute scope | | |
| Verification of an answer (checked, not just cited) | Computed-marked answers state their checked status on the receipts strip (this rework, S2) | | One-click re-verify of an arbitrary reply — no chat backend exists for it; not built, not faked |
| Truthful generation progress | **Yes** — stage line in the thread: "Thinking" until content streams, then "Writing", with a real elapsed clock (this rework, S8) | | |
| Answer → persistent work object (Canvas) | **Yes** — "Keep as DTU" is a labelled, primary-styled action on every reply (was the icon-like "Forge DTU"), with an ownership line under unforged replies ("Yours to keep — save this answer as a DTU…"); "Draft in Thread" now explains itself when clicked before forging instead of sitting silently disabled (this rework, S5). Prod caveat stands: DTU provenance is not yet switched on in prod (proof index) | | |
| Branch a conversation from a message | **Yes** — local branch + server-synced branch, renamed in plain language ("Branch this conversation" / "Save branch") (this rework, S5) | | |
| Memory across chats / custom assistants | | **Unsurfaced/unverified** — advertised inside Chat settings; not reachable/testable in Product's pass; outside this rework's scope | |
| BYOK / bring your own model | | **Backend + one panel entry, not surfaced as a flow** — brain slots + BYO keys exist in-product; no composer-level flow beyond the mode menu and the Brain chip's slot disclosure | |
| Queue / capacity state when brains are busy | | **Partially surfaced** — the Brain chip shows pool state (all/partial/offline); a true queue depth is NOT tracked server-side, so no queue position is shown or invented | |
| Projects / Library inside Chat | | | **Missing in Chat** — organisation is conversations + branches; Projects is its own lens |
| First-run overlay sequencing | **Yes** — the install banner on Chat now waits until after the first completed reply (localStorage `concord_first_reply_done`, via the lib/first-run coordinator); the cookie notice already persisted its answer (verified, unchanged) (this rework, S9) | | |
| Sub-tab overload (9 tabs) | **Yes** — the core-lens tab strip caps at 4 + a More menu for Chat and every core lens; the active tab is always visible and the last-visited overflow tab is promoted and remembered per user (this rework, S7) | | |

**Counts: 18 rows mapped — 13 have-and-works (7 of them moved or fixed
by this rework), 3 have-in-backend-unsurfaced, 2 missing.**

Deliberately NOT built in this rework (stated, not faked): a canned
"demo conversation" for first run (fabricated history violates the
no-fake-data bar — the Compute chip produces a real checked answer
live instead); a one-click re-verify action (no backend); queue
positions (not tracked server-side).
