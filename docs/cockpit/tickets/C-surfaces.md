# Tickets CKPT-16 to CKPT-20: surfaces

Read `../PLAN.md` "Implementer instructions" first. Anchors are quoted text at `origin/main` @ `dae9e10a6`; find them by search.
Server library files go in `server/lib/cockpit/`, server tests in `server/tests/cockpit/`. Frontend files go in `concord-frontend/components/cockpit/` and `concord-frontend/lib/cockpit/`; frontend tests sit next to the file as `*.test.ts(x)` and run under the existing vitest job in CI.
Server test files start with the two imports shown in `A-foundations.md`. `memDb`, `fakeExec` and the mock model come from `server/tests/cockpit/_helpers.js` (CKPT-08) and `mock-model.js` (CKPT-04).

Frontend rule for every ticket here: every visible element is drawn from a server event or a server response. No `setInterval`, no timer-driven progress, no placeholder steps. A run that cannot be loaded shows an error line, not an empty card.

---

## CKPT-16: Chat routing in: answer, one call, or run

**Goal.** One function decides, for every chat turn, whether to answer, make one tool call, start a run, or continue a waiting run.
**Why.** Architecture section 14. Today the decision is a regex over the last assistant reply, so "yes run it" works only when the previous reply happens to match (Oct 19 #2), and a multi-step ask is squeezed into one agent turn.
**Probe failure it addresses.** `server.js` calls `_ar.chatAgentRoute(prompt, { prevRoute: _prevAgentRoute, prevReply: _prevReply })` and nothing in that path knows a run exists.
**Depends on.** CKPT-10, CKPT-13, CKPT-15. **Flag.** `CONCORD_COCKPIT_ROUTE`, default off. It does nothing unless `CONCORD_COCKPIT_RUNS` is also on.
**Reuse.** `chatAgentRoute`, `isBareAffirmation`, `stripAffirmation` (`lib/chat/agent-route.js`), `isLongTaskAsk` (`lib/long-task.js`), `planRun` (CKPT-10), `findWaitingRun`, `createRun`, `insertSteps`, `listRunsForUser`, `listSteps`, `countActiveRuns` (CKPT-08), `applyDecision` (CKPT-13), `driveRun` (CKPT-09), `maxActiveRuns` (CKPT-14), `scrubUserFacingToolNames`. **Do not** add yes/no regexes, and do not change `chatAgentRoute`.

### Files

- Create `server/lib/cockpit/router.js`
- Create `server/lib/cockpit/chat-entry.js`
- Modify `server/server.js` (one call site)
- Create `server/tests/cockpit/router.test.js`, `server/tests/cockpit/chat-entry.test.js`

### Interfaces

```js
// router.js
export const REJECT_WORDS = Object.freeze(["no", "nope", "cancel", "stop", "don't", "dont", "no thanks"]);
export const STATUS_ASKS = Object.freeze(["what happened", "what went wrong", "why did it fail", "why did it stop", "status"]);
/**
 * @param {string} message
 * @param {{ db: object, userId: string, chatSessionId: string|null, lensContext?: string|null,
 *           prevRoute?: string|null, prevReply?: string, profile: string, lensActions?: Map,
 *           deps?: { planRun?: Function } }} ctx
 * @returns {Promise<
 *   | { kind: "answer", statusText?: string }
 *   | { kind: "single"|"run", plan: { source: string, steps: PlanStep[] } }
 *   | { kind: "resume", runId: string, stepId: string, decision: "approve"|"reject"|"answer", answer?: string }>}
 */
export async function decide(message, ctx) {}
/** Plain-language account of the newest run in a thread: what finished, what failed or was skipped and why. */
export function runStatusText(run, steps) {}
```

`decide` rules, in this order. `norm` is the message lower-cased, trimmed, with trailing `.`, `!` and `?` removed.

| # | Condition | Result |
|---|---|---|
| 1 | `!cockpitFlag("ROUTE")` or `!cockpitFlag("RUNS")` or `!tablesReady(db)` or no `userId` | `{ kind:"answer" }` |
| 2 | `findWaitingRun(db, userId, chatSessionId)` returns a run, and `isBareAffirmation(message)` | `resume`, `decision:"approve"`, `stepId` = the run's step with status `awaiting_confirm` |
| 3 | a waiting run, and `REJECT_WORDS.includes(norm)` | `resume`, `decision:"reject"` |
| 4 | a waiting run whose waiting step's stored card kind is `question` or `help` | `resume`, `decision:"answer"`, `answer: message` |
| 5 | a waiting run, anything else | fall through to rule 6. The run stays waiting; it is not cancelled |
| 6 | `STATUS_ASKS.includes(norm)` and `listRunsForUser(db, userId, { limit: 5 })` has a run with this `chatSessionId` | `{ kind:"answer", statusText: runStatusText(run, steps) }` |
| 7 | `isLongTaskAsk(message)` is false and `chatAgentRoute(message, { prevRoute, prevReply })` is falsy | `{ kind:"answer" }` |
| 8 | `planRun(...)` returns `ok:false` | `{ kind:"answer" }` (the old agent route then handles the turn as it does today) |
| 9 | plan has exactly 1 step and `isLongTaskAsk(message)` is false | `{ kind:"single", plan }` |
| 10 | otherwise | `{ kind:"run", plan }` |

Rule 4 needs the card kind. `applyDecision` in CKPT-13 names the kinds `confirm`, `question`, `help`, `maybe_done`; read the kind from wherever CKPT-13 stored the card on the step. If CKPT-13 as built did not store it, stop and ask on the bridge; do not guess from the step's tool.

`runStatusText`: one line per failed or skipped step, `"<label>: <scrubbed error>"`, preceded by `"<done> of <total> steps finished."`. When nothing failed: `"All <total> steps finished."`. Labels and errors go through `scrubUserFacingToolNames`. At most 12 lines, then `"and <n> more."`.

```js
// chat-entry.js
/**
 * Called from the chat route. Returns null when the turn is not the cockpit's.
 * @param {{ db: object, userId: string, chatSessionId: string|null, message: string, lensContext?: string|null,
 *           surface?: Surface, prevRoute?: string|null, prevReply?: string,
 *           runMacro: Function, lensActions: Map, chatProgress?: (event: object) => void,
 *           deadlineMs: number, deps?: object }} a
 * @returns {Promise<null | { handled: true, reply: string, meta: { cockpit: { runId: string|null, kind: string, status: string|null } } }>}
 */
export async function handleChatTurn(a) {}
```

`handleChatTurn`:

1. `const d = await decide(...)`. `answer` without `statusText` returns `null`. `answer` with `statusText` returns `{ handled:true, reply: statusText, meta:{ cockpit:{ runId:null, kind:"status", status:null } } }`.
2. `resume`: load the run and step, call `applyDecision(db, { run, step, userId, decision, ... })`. For `answer`, pass the text the way CKPT-15's `decision` route does. On `ok:false` return a reply `"That step is no longer waiting."`. Otherwise continue at step 5 with that run.
3. `single` or `run`: if `countActiveRuns(db, userId) >= maxActiveRuns()` return `{ handled:true, reply:"You already have " + n + " tasks running. Wait for one to finish or cancel one.", meta:{ cockpit:{ runId:null, kind:"refused", status:null } } }`.
4. `createRun(db, { userId, surface: a.surface || "chat", goal: message.slice(0, 2000), chatSessionId, lensContext, modelProfile })`, then `insertSteps(db, run.id, 1, plan.steps)`.
5. Build `deps` exactly as the pump's `makeDeps` does in CKPT-09, and set `emit` to a function that calls both `publishRun(e.runId, e)` (CKPT-15) and `a.chatProgress?.(e)`. Then `await driveRun({ db, runId, owner: "chat:" + process.pid, deps, deadlineMs: a.deadlineMs })`.
6. Build the reply from the run's state after `driveRun` returns:

| Run status | Reply |
|---|---|
| `done` | the last done step's `resultSummary.text`; if the run had more than one step, prefix `"Finished <total> steps. "` |
| `awaiting_confirm` | `"I need your OK before I continue: <card label>."` |
| `failed` | `runStatusText(run, steps)` |
| `running`, `verifying`, `planned`, `paused` | `"Working on it: <done> of <total> steps finished. I'll keep going and post the result here."` |

   A `done` run with an empty summary replies `"Finished, but the last step returned no text."`; never invent a summary.
7. Return `{ handled:true, reply, meta:{ cockpit:{ runId, kind: d.kind, status } } }`.

`deadlineMs` for the foreground is `Date.now() + 25000`, the same value CKPT-15's `POST /api/cockpit/runs` uses. The pump finishes the rest.

### Steps

1. Create `router.js` and `chat-entry.js` as specified.
2. In `server/server.js`, find `const _agentRouteKind = _ar.chatAgentRoute(prompt, { prevRoute: _prevAgentRoute, prevReply: _prevReply });`. Directly **before** that line add:
   ```js
   let _cockpitTurn = null;
   try {
     const { cockpitFlag } = await import("./lib/cockpit/flags.js");
     if (cockpitFlag("ROUTE") && ctx?.actor?.userId) {
       const { handleChatTurn } = await import("./lib/cockpit/chat-entry.js");
       _cockpitTurn = await handleChatTurn({
         db: ctx?.db || globalThis._concordSTATE?.db || null, userId: ctx.actor.userId,
         chatSessionId: sess?.id || null, message: prompt, lensContext: input.lens || null,
         surface: "chat", prevRoute: _prevAgentRoute, prevReply: _prevReply,
         runMacro, lensActions: globalThis.__concordLensActions,
         chatProgress: (e) => { try { ctx.chatProgress?.(e); } catch { /* progress never blocks */ } },
         deadlineMs: Date.now() + 25000,
       });
     }
   } catch (e) { console.warn("[cockpit] chat entry failed, using the old route:", e?.message || e); }
   ```
   Use the identifiers that scope really has for the session id and the progress writer: read 40 lines either side of the anchor first. If the scope has no session object or no progress writer, pass `null` and `undefined`; do not invent one.
3. Directly after that block, when `_cockpitTurn?.handled` is true, return the turn through the **same** code the existing agent route uses to save and return its reply (the block that starts at `if (_agentRouteKind && _agentCtx.db && _agentCtx.actor?.userId) {`). Read that block, find where it writes the assistant message with `meta: { agentRoute: … }`, and write the cockpit reply the same way with `meta: { agentRoute: "cockpit", cockpit: _cockpitTurn.meta.cockpit }`. Do not write a second save path. If the save code is not reachable without copying more than 15 lines, stop and ask on the bridge.
4. When `_cockpitTurn` is `null`, execution continues to the existing line unchanged.

### Tests (CI only)

`router.test.js`, with `memDb()`, flags set through the `env` argument or `process.env` restored in `after`, and `deps.planRun` injected:

| Case | Expected `kind` |
|---|---|
| flag `ROUTE` off | `answer`, and `planRun` was not called |
| thread has a run in `awaiting_confirm`, message `"yes"` | `resume`, `approve` |
| same, message `"cancel"` | `resume`, `reject` |
| same, card kind `question`, message `"use 12 feet"` | `resume`, `answer`, `answer === "use 12 feet"` |
| same, card kind `confirm`, message `"what is a beam?"` | not `resume`; the run is still `awaiting_confirm` afterwards |
| no waiting run, message `"yes"` | `answer` (today's behaviour is untouched) |
| message `"what happened"`, thread has a failed run | `answer` with `statusText` containing the failed step's label and not containing `web_search` |
| plain greeting | `answer` |
| planner returns 1 step | `single` |
| planner returns 5 steps | `run` |
| planner returns `{ ok:false }` | `answer` |

Negative control: a waiting run in thread `A` must not make `"yes"` in thread `B` a `resume`.

`chat-entry.test.js`, with a mock model and `fakeExec`: a 3-step plan reaches `done` and the reply starts `"Finished 3 steps."`; a plan with a `create_dtu` step returns the `"I need your OK"` reply and a following `handleChatTurn` with `"yes"` finishes the run; `chatProgress` received at least one `cockpit:step` event; with 2 active runs the third is refused and no run row is created; `deadlineMs` in the past returns the `"Working on it"` reply and the run is not `failed`.

**2B check.** With both flags on at the desk, ask chat "size a beam for a 12 foot garage span and save the design", then answer "yes" to the confirm. Expect one run, one confirm, a saved design. Recorded in CKPT-22, not here.
**Rollback.** `CONCORD_COCKPIT_ROUTE=0`. The added block is then a no-op.
**Risks.** A turn that used to be answered inline now starts a run: rule 7 keeps every turn the old router would not have sent to the agent on the old path. A waiting run swallowing unrelated messages: rule 5 and its test. The cockpit entry throwing: the `try/catch` falls back to the old route.
**Done when.** CI green, and with the flag off the chat suite's results are unchanged from the previous ticket's run.

---

## CKPT-17: Frontend: run card, confirm card, live transcript

**Goal.** Show a run in the chat transcript as it happens: a progress card, a confirm card the person can approve, edit or reject, and the finished reply appended to the open thread without a reload.
**Why.** Brief item 11. FIX-chat-001: the server completes a reply and the open transcript does not show it. Today the only tool display is `ToolCallCard`, which prints tool ids and raw results.
**Probe failure it addresses.** `ChatWorkspacePanel.tsx` reads the `/api/chat/stream` body and renders only what arrives in that one response; anything finished after the response closed is invisible until the thread is reopened.
**Depends on.** CKPT-15, CKPT-16. **Flag.** None of its own. The cards render only when a message carries `meta.cockpit.runId` or a `cockpit:*` event arrives, which happens only when `CONCORD_COCKPIT_ROUTE` is on.
**Reuse.** `MessageRenderer` for reply text, `streamResult` and `chatFailure` (`components/chat/chatStreamResult.ts`), the `api` client and `getApiBase` (`lib/api/client.ts`), the existing SSE line parser used inside `sendMessage` in `ChatWorkspacePanel.tsx`, the notice-message pattern (`id: \`notice-${Date.now()}\``, `setLocalMessages((prev) => [...prev, noticeMsg])`). **Do not** change `ToolCallCard.tsx` or `ToolTraceBlock.tsx`; the old agent path still uses them.

### Files

- Create `concord-frontend/lib/cockpit/run-client.ts`
- Create `concord-frontend/lib/cockpit/useCockpitRun.ts`
- Create `concord-frontend/components/cockpit/RunCard.tsx`
- Create `concord-frontend/components/cockpit/ConfirmCard.tsx`
- Create `concord-frontend/components/cockpit/ReceiptLink.tsx`
- Modify `concord-frontend/components/chat/ChatWorkspacePanel.tsx` (three edits, below)
- Create `concord-frontend/lib/cockpit/run-client.test.ts`, `concord-frontend/components/cockpit/RunCard.test.tsx`, `concord-frontend/components/cockpit/ConfirmCard.test.tsx`

`concord-frontend/app/lenses/chat/page.tsx` is not edited: it mounts `ChatWorkspacePanel`.

### Interfaces

```ts
// run-client.ts
export type RunStatus = 'planned'|'running'|'awaiting_confirm'|'verifying'|'paused'|'done'|'failed'|'cancelled';
export interface PublicRun { id: string; goal: string; status: RunStatus; statusReason: string|null; chatSessionId: string|null;
  usage: { toolCalls: number; modelCalls: number; humanInterventions: number } }
export interface PublicStep { id: string; seq: number; label: string; goal: string; status: string; required: boolean;
  attempts: number; hasReceipt: boolean; summary: string|null; error: string|null }
export interface ConfirmCardData { runId: string; stepId: string; kind: 'confirm'|'question'|'help'|'maybe_done';
  label: string; goal: string; risk: string; changes: string[]; args: { name: string; value: string }[] }
export type CockpitEvent =
  | { type: 'cockpit:run'; runId: string; status: RunStatus; statusReason?: string|null; done: number; total: number }
  | { type: 'cockpit:step'; runId: string; seq: number; total: number; status: string; label: string; receiptId: string|null }
  | ({ type: 'cockpit:confirm' } & ConfirmCardData);
export const TERMINAL: readonly RunStatus[];   // done, failed, cancelled

export function isCockpitEvent(x: unknown): x is CockpitEvent;
export async function fetchRun(runId: string): Promise<{ ok: true; run: PublicRun; steps: PublicStep[] } | { ok: false; error: string }>;
export async function sendDecision(runId: string, body: { stepId: string; decision: 'approve'|'reject'|'answer'|'mark_done'|'run_again';
  editedArgs?: Record<string, unknown>; dontAskAgain?: boolean; answer?: string }): Promise<{ ok: boolean; error?: string }>;
export async function runAction(runId: string, action: 'pause'|'resume'|'cancel'): Promise<{ ok: boolean; error?: string }>;
/** Opens GET /api/cockpit/runs/:id/events. Returns a close function. Calls onError once if the stream ends before a terminal status. */
export function openRunEvents(runId: string, onEvent: (e: CockpitEvent) => void, onError: (reason: string) => void): () => void;
/** Pure: fold one event into the state the card draws. */
export function reduceRun(state: RunView, e: CockpitEvent): RunView;
export interface RunView { run: PublicRun|null; steps: PublicStep[]; confirm: ConfirmCardData|null; error: string|null }
```

`openRunEvents` uses `fetch` with `credentials: 'include'` and a `ReadableStream` reader, not `EventSource`, so it shares the cookie and base-URL handling `ChatWorkspacePanel` already uses. It ends its read loop when a `cockpit:run` event carries a terminal status.

`reduceRun`: `cockpit:run` replaces `status`, `statusReason`; `cockpit:step` upserts the step with that `seq`; `cockpit:confirm` sets `confirm`; any `cockpit:step` or `cockpit:run` whose status is not `awaiting_confirm` clears `confirm` for that step. Unknown events return the state unchanged.

```ts
// useCockpitRun.ts
/** Loads the run once, then follows its events. On terminal status calls onFinished exactly once. */
export function useCockpitRun(runId: string | null, opts?: { onFinished?: (run: PublicRun, steps: PublicStep[]) => void }): RunView & {
  approve: (edited?: Record<string, unknown>, dontAskAgain?: boolean) => Promise<void>;
  reject: () => Promise<void>; answer: (text: string) => Promise<void>;
  pause: () => Promise<void>; resume: () => Promise<void>; cancel: () => Promise<void>; busy: boolean };
```

The hook calls `fetchRun` on mount and after every decision, opens the event stream while the run is not terminal, and closes it on unmount. If the stream errors, it calls `fetchRun` once more and sets `error` to `"Lost the live connection. Showing the last saved state."`; it does not poll.

Optimistic behaviour (fluidity rule): `approve`, `reject` and `cancel` set `busy` and update the drawn state at once (confirm card collapses to "Approved" or "Rejected"). If `sendDecision` returns `ok:false`, the hook restores the previous state and sets `error` to the server's message. Never leave an optimistic state that the server did not confirm.

```tsx
// RunCard.tsx
export function RunCard(props: { runId: string; onFinished?: (run: PublicRun, steps: PublicStep[]) => void }): JSX.Element;
// ConfirmCard.tsx
export function ConfirmCard(props: { card: ConfirmCardData; busy: boolean;
  onApprove: (edited?: Record<string, unknown>, dontAskAgain?: boolean) => void; onReject: () => void; onAnswer: (text: string) => void }): JSX.Element;
// ReceiptLink.tsx
export function ReceiptLink(props: { runId: string; stepId: string }): JSX.Element;
```

`RunCard` layout, top to bottom:

1. Header: the run goal (one line, truncated), a status word (`Working`, `Needs your OK`, `Paused`, `Finished`, `Stopped`, `Cancelled`), and `<done> of <total>`. The bar width is `done / total` from server counts only.
2. Step list: one row per step with a status mark, the `label`, and, for `failed` or `skipped`, the `error` text. A `done` step with `hasReceipt` shows `ReceiptLink`. Rows are collapsed to the current step plus the last two when there are more than 6; a "Show all <n> steps" button expands.
3. `ConfirmCard` when `confirm` is set.
4. Actions: `Pause` while running, `Resume` while paused, `Cancel` while not terminal. Each is a real `<button>` with a visible label.
5. `error` line when set, with `role="alert"`.

`ConfirmCard`: shows `label`, `goal`, each `changes` sentence, and one row per `args` entry. For kind `confirm`: an "Approve" button, a "Don't run this" button, an "Edit" toggle that turns each arg value into a text input (the edited values are sent as `editedArgs` keyed by the original arg name), and, only when `risk === "write"`, a checkbox "Don't ask again for this task". For kind `question` or `help`: a text input and "Send". For kind `maybe_done`: "It already happened" and "Run it again". All controls are disabled while `busy`. Enter approves or sends; Escape closes edit mode. The card shows no tool id and no JSON.

`ReceiptLink`: a button "Receipt". On click it fetches `GET /api/cockpit/runs/:id/steps/:stepId/receipt` and shows `issuedAt`, whether a signature is present, and the two hashes in a small popover. A 404 shows "No receipt for this step."

Loading, empty and error states are required on `RunCard`: a skeleton row while `run` is null and `error` is null; `"This task has no steps."` when the step list is empty; the error line otherwise.

### Steps

1. Create the five new files and three test files.
2. In `ChatWorkspacePanel.tsx`, extend the local `Message` type (find `/** Brain was unreachable. Render as a notice, not an assistant answer. */`, which sits inside it) with `cockpitRunId?: string;`.
3. Edit A, events during the stream. Find the SSE handler inside `sendMessage` that sets `topDone = data as Record<string, unknown>;`. In the same handler, before the `done` branch, add: when `isCockpitEvent(data)` is true and no message in `localMessages` has `cockpitRunId === data.runId`, append `{ id: \`run-${data.runId}\`, role: 'assistant', content: '', timestamp: new Date().toISOString(), cockpitRunId: data.runId }` with `setLocalMessages`. Do not copy event data into React state here; `RunCard` owns it.
4. Edit B, the final payload. Where the handler reads `finalOut`, also read `finalOut.meta?.cockpit?.runId` (the field CKPT-16 writes) and set `cockpitRunId` on the assistant message built from that reply, unless a `run-<id>` message was already appended in edit A, in which case update that message's `content` with the reply text instead of adding a second message.
5. Edit C, rendering and FIX-chat-001. Find `<ToolCallCard key={i} call={call} />`. In the same message body, when `message.cockpitRunId` is set, render `<RunCard runId={message.cockpitRunId} onFinished={handleRunFinished} />` above the text. Add:
   ```tsx
   const handleRunFinished = useCallback((run: PublicRun, steps: PublicStep[]) => {
     const last = [...steps].reverse().find((s) => s.status === 'done' && s.summary);
     const text = run.status === 'done'
       ? (last?.summary ?? 'Finished, but the last step returned no text.')
       : steps.filter((s) => s.error).map((s) => `${s.label}: ${s.error}`).join('\n') || 'The task stopped.';
     setLocalMessages((prev) => prev.some((m) => m.id === `run-done-${run.id}`) ? prev
       : [...prev, { id: `run-done-${run.id}`, role: 'assistant', content: text, timestamp: new Date().toISOString() }]);
   }, []);
   ```
   The `prev.some` guard makes the append happen once. This is the FIX-chat-001 change: the reply reaches the open transcript from the run's own event stream, whether or not the original chat response is still open.
6. Thread reload. Where the panel loads a session's messages from the server, map a stored message's `meta.cockpit.runId` onto `cockpitRunId`, so reopening a thread shows the card from `fetchRun`. Find the mapping by searching for where server messages are turned into `Message` objects after `fetch('/api/chat/sessions?limit=100'`; if stored messages do not carry `meta` to the client, stop and report on the bridge. The server change that would be needed belongs to CKPT-16's save step, not to a guess here.
7. FIX-chat-001 also applies to the old path. In the same `sendMessage`, find the idle-stall branch (`idleStalled = true;`). After it aborts, the code already has a recovery read (search `recovered: true`). Confirm that the recovered reply is appended with `setLocalMessages`; if it is only written to session storage, add the append. Describe what you found in the commit message.

### Tests (CI only)

`run-client.test.ts` (vitest, no DOM): `reduceRun` folds a `cockpit:run`, three `cockpit:step` and one `cockpit:confirm` into the expected view; a `cockpit:step` with status `done` for the confirmed step clears `confirm`; an unknown event returns the same object; `isCockpitEvent` rejects `{ type: 'token' }` and `null`. `openRunEvents` with a stubbed `fetch` that streams two events then a terminal `cockpit:run` calls `onEvent` three times and `onError` zero times; a stream that ends early calls `onError` once.

`RunCard.test.tsx` (testing-library, `fetch` stubbed): renders the skeleton, then `2 of 5`; a failed step shows its error text; no rendered text contains `web_search` or `lens:` when the stub labels are plain; `Cancel` calls `POST …/cancel`; a `sendDecision` that returns `{ ok:false, error:"not_waiting" }` restores the confirm card and shows the alert. Negative control: with a `fetchRun` that returns `ok:false`, the card shows the error line and no step rows.

`ConfirmCard.test.tsx`: the "Don't ask again" checkbox is absent for `risk:"high"`; editing a value and approving calls `onApprove` with `{ <name>: <new value> }`; all buttons are disabled when `busy`; kind `question` renders an input and calls `onAnswer`.

Also add to CI's existing grep-style check, as a test in `RunCard.test.tsx`: read the three component source files with `fs.readFileSync` and assert none contains `setInterval(`.

**2B check.** Part of CKPT-22's desk run: the card advances step by step, the confirm card appears twice, and the final reply appears in the open thread without a reload.
**Rollback.** `CONCORD_COCKPIT_ROUTE=0`: no message carries a run id, so no card renders. The three edits in `ChatWorkspacePanel.tsx` are inert.
**Risks.** `ChatWorkspacePanel.tsx` is large and edited by other seats: keep the three edits small, rebase before pushing, and do not reformat the file. Double replies: the `run-done-<id>` guard and edit B's "update, don't add" rule. A held-open event stream per card: one stream per non-terminal run, closed on unmount and at terminal status.
**Done when.** CI green (vitest and `type-check`), and FIX-chat-001 is marked fixed in `audit/fix-list/FIX_PROGRESS.md` with the commit hash.

---

## CKPT-18: Lens Ask on the core

**Goal.** An Ask from a lens knows which lens it came from, sees that lens's description and live state, stays in that lens's thread, and always ends with an answer or a plain error.
**Why.** Fifteen FIX ids in `PLAN.md` section 4. `LensToolbar.tsx` links to `/lenses/chat?context=<domain>`, `ChatWorkspacePanel.tsx` turns that into `lens: domainContext` on the request, and the server uses it as a name only: no description and no lens data reach the model.
**Probe failure it addresses.** Ask answers about the wrong thing (FIX-analytics-005 and six more); the whole question read as a place name (FIX-forecast-001); four lenses that hang or crash on the first Ask.
**Depends on.** CKPT-16, CKPT-17. **Flag.** `CONCORD_COCKPIT_ASK_CONTEXT`, default off.
**Reuse.** `getManifest(lensId)` (`lib/lens-manifest.js`), `listLensActionsMcp` and `runLensActionMcp` through the executor (never a direct handler call), `buildContextPacket` (CKPT-07), `requestStepCall` (CKPT-04), `extractWeatherLocation` (`lib/chat/weather-location.js`), Muse's thread rule from commit 545ed1873. **Do not** change Muse's `RCA-ask-silent` code, and do not query `dtus` directly.

### Files

- Create `server/lib/cockpit/lens-context.js`
- Create `server/lib/cockpit/slot-extract.js`
- Modify `server/lib/cockpit/context-packet.js` (lens evidence first)
- Modify `server/lib/cockpit/chat-entry.js` (pass `lensContext`, set surface `ask`)
- Modify `server/server.js` (one call site: the weather route)
- Modify `concord-frontend/components/chat/ChatWorkspacePanel.tsx` (Ask error card)
- Create `server/tests/cockpit/lens-context.test.js`, `server/tests/cockpit/slot-extract.test.js`, `server/tests/cockpit/ask-thread.test.js`
- Create `docs/cockpit/ASK_DIAGNOSIS.md` (results of the diagnosis procedure below)

### Interfaces

```js
// lens-context.js
export const CONTEXT_ACTION_NAMES = Object.freeze(["context", "overview", "summary", "dashboard", "status", "list"]);
/**
 * @param {{ lensId: string, exec: Function, lensActions: Map, deps?: { getManifest?: Function } }} a
 * @returns {Promise<{ ok: boolean, evidence: Evidence[], reason?: string }>}   at most 2 items
 */
export async function lensContextEvidence(a) {}
/** The read action this lens offers for its own state, or null. */
export function pickContextAction(lensId, lensActions) {}
```

`lensContextEvidence`:

1. `getManifest(lensId)`. No manifest: `{ ok:false, evidence:[], reason:"unknown_lens" }`.
2. First item: `{ id: "lens:" + lensId, title: <manifest display name>, snippet: <manifest description cut to 240 chars>, source: "lens" }`. Read the manifest's real field names from `registerManifest` in `lens-manifest.js`; if it has no description field, use its category and tags joined with ", ".
3. `pickContextAction`: the first name in `CONTEXT_ACTION_NAMES` for which `lensActions` has `<lensId>.<name>` **and** `resolveLensRisk(lensId, name)` (CKPT-02) is `read`. None: return with the one item.
4. Run it with `exec({ tool: "run_lens_action", params: { domain: lensId, action: name, params: {} } })` under a 5 s limit. On `ok:true`: second item `{ id: "lens:" + lensId + ":state", title: "Current " + <display name>, snippet: summarizeResult(result, …).text cut to 240, source: "lens" }` (`summarizeResult` from CKPT-07). On failure: no second item, and `reason` set to the failure class. A failed context read never fails the Ask.

`context-packet.js`: when `run.lensContext` is set and `cockpitFlag("ASK_CONTEXT")`, put the lens evidence first and count it inside the limit of 8. Add the constraint line `"The person is asking from the <display name> page. Answer about that unless they name something else."`.

```js
// slot-extract.js
/**
 * Fill named slots from a sentence with one constrained call. No free text.
 * @param {{ text: string, slots: { name: string, description: string, required: boolean }[], profile: string, deps?: object }} a
 * @returns {Promise<{ ok: boolean, values: Record<string,string|null>, reason?: string }>}
 */
export async function extractSlots(a) {}
```

`extractSlots` builds a schema `{ type:"object", additionalProperties:false, required:[…required names], properties:{ <name>: { type:["string","null"] } } }` and calls `requestStepCall` with it. A required slot that comes back empty, or longer than 80 characters, or equal to the whole input text, makes `ok:false, reason:"slot_missing"`.

FIX-forecast-001: in `server/server.js` find the call to `extractWeatherLocation(`. When `cockpitFlag("ASK_CONTEXT")` and the value it returns is longer than 40 characters or contains more than 4 words, call `extractSlots({ text: prompt, slots: [{ name:"place", description:"city or region the person wants weather for", required:true }] })`. Use its `place` when `ok`; when not, ask the person `"Which place do you want the forecast for?"` and do not call the weather tool. If the anchor is in a library file and not in `server.js`, make the same edit there and name the file in the commit.

Thread identity (FIX-quests-005, FIX-world-005): `chat-entry.js` passes `lensContext` to `createRun` and sets `surface: "ask"` when `lensContext` is set. It does not choose the thread. Muse's fix does: read the function their commit added (search the fix branch for `RCA-ask-silent`), call it or rely on the session it already selected, and assert in `ask-thread.test.js` that two Asks from different lenses produce runs with different `chatSessionId`, and two Asks from the same lens share one.

Required end state for every Ask (covers FIX-goddess-001, FIX-lfg-001, FIX-tick-005, FIX-inheritance-011, which have no root cause yet):

- The server answers within the chat turn deadline with a reply, a run id, or `{ ok:false, reason }`. CKPT-16's foreground `deadlineMs` already bounds a cockpit turn at 25 s.
- The client shows an error card, not a blank transcript or a crashed tab, when the request fails. In `ChatWorkspacePanel.tsx`, the `catch` around the `/api/chat/stream` fetch must end in a `setLocalMessages` append with the text from `chatFailure(...)` or `"That didn't go through. Try again."`. Read the existing `catch`; add the append only if it is missing.

Diagnosis procedure for those four. Do each step for each lens (`goddess`, `lfg`, `tick`, `inheritance`), in CI or by reading code; nothing is run on the Mac:

1. Open `concord-frontend/app/lenses/<lens>/page.tsx` and list what its Ask control does: a link to `/lenses/chat?context=`, a `LensAgentPanel`, or its own fetch.
2. Follow that call to its server handler and note every `await` with no timeout.
3. For `lfg` (tab crash): search the page's component tree for an unbounded list render or a recursive effect that runs when `?context=` is set. Write down the component and line.
4. For `tick` and `inheritance` (first Ask aborts, retry works): look for state that is created on first use (a thread, a session, a lens registration) inside the request, and check whether the first request waits for it.
5. Add one route test per lens under `server/tests/cockpit/ask-<lens>.test.js` that posts an Ask with a mock model and asserts a reply or an `{ ok:false, reason }` inside 10 s.
6. Write the findings in `docs/cockpit/ASK_DIAGNOSIS.md`: one section per lens with "cause found" and the fix made, or "cause not found" and exactly what was checked. Do not mark a FIX id fixed without a cause and a test. A lens with no cause found is handed back on the bridge with that section.

### Steps

1. Create `lens-context.js` and `slot-extract.js` with tests.
2. Edit `context-packet.js` and `chat-entry.js` as described.
3. Make the weather edit.
4. Make the client error-card check and edit.
5. Run the diagnosis procedure and write `ASK_DIAGNOSIS.md`.

### Tests (CI only)

`lens-context.test.js`: a lens with a manifest and a read `overview` action yields 2 evidence items, the second containing a value from the fake action result; a lens whose only matching action has risk `write` yields 1 item and `exec` was not called; an unknown lens gives `ok:false`; a context action that throws still returns the first item. Negative control: with the flag off, `buildContextPacket` output contains no `source:"lens"` item.

`slot-extract.test.js`, mock model: `"what's the weather like in Lisbon this weekend, should I pack a coat"` gives `place: "Lisbon"`; a mock that returns the full sentence as `place` gives `ok:false, reason:"slot_missing"`; a mock that returns `null` gives `ok:false`.

`ask-thread.test.js`: as described under thread identity.

**2B check.** At the desk, with the flag on, Ask from Analytics "what is my worst funnel step" and from Forecast "should I bring a coat to Lisbon on Saturday". Expect the first to name the person's own funnel data and the second to use Lisbon. Recorded in CKPT-22.
**Rollback.** `CONCORD_COCKPIT_ASK_CONTEXT=0`. The error-card append stays; it is a plain bug fix.
**Risks.** A lens "context" action that is slow or large: the 5 s limit and the 240-character snippet. A read action that is not really read-only: only actions whose resolved risk is `read` are called. Claiming the four unknown lenses fixed without a cause: the procedure forbids it.
**Done when.** CI green; the nine context and thread FIX ids and FIX-forecast-001 are marked fixed with commit hashes; each of the four undiagnosed ids has a section in `ASK_DIAGNOSIS.md` and is either fixed with a test or handed back on the bridge.

---

## CKPT-19: Lens agent panels and the Agents lens on the core

**Goal.** One reply contract for every lens "agent" button, an Agents lens whose Run Loop follows the goal and respects an agent's tool list, and a Thread Summarize that shows its result.
**Why.** FIX-meditation-002, FIX-wellness-004 and FIX-reasoning-002 (agent parts), FIX-agents-010, FIX-chat-014. Audit finding 9: `chat_agent.do` returns its text in `answer`; 88 frontend files contain the string `'Agent returned empty.'` and each reads its own mix of `reply`, `summary`, `output`.
**Probe failure it addresses.** A successful agent run shows "Agent returned empty." `agents.executeRun` picks `tools[i % tools.length]` for each step with `stepInput = goal`, so the goal never shapes the steps, and an agent created with no tools gets `["dtu_read","summarize","classify"]`.
**Depends on.** CKPT-16. **Flag.** The reply contract and the Summarize fix are unflagged bug fixes. The Agents lens change is behind `CONCORD_COCKPIT_RUNS`: off means today's loop.
**Reuse.** `planRun`, `createRun`, `insertSteps`, `driveRun`, `runProgress`, `publicStep` shape from CKPT-15, `lensRun` and `api` (`concord-frontend/lib/api/client.ts`). **Do not** rewrite the 88 panels' layouts or change `runAgentLoop`'s return shape.

### Files

- Create `concord-frontend/lib/agent-reply.ts`, `concord-frontend/lib/agent-reply.test.ts`
- Modify the panels that contain `'Agent returned empty.'` (list them with `git grep -l "Agent returned empty" -- concord-frontend`; 88 at `dae9e10a6`)
- Modify `server/domains/chat-agent.js` (add `reply` to the result)
- Modify `server/domains/agents.js` (`executeRun`)
- Modify `concord-frontend/components/agents/AgentRuntime.tsx` (show cockpit steps)
- Modify `concord-frontend/components/chat/ChatWorkspacePanel.tsx` and `concord-frontend/components/chat/ChatToolsDrawer.tsx` (Thread Summarize)
- Create `server/tests/cockpit/agent-reply-contract.test.js`, `server/tests/cockpit/agents-execute-run.test.js`

### Interfaces

```ts
// agent-reply.ts
export type AgentReply = { ok: true; text: string } | { ok: false; reason: string };
/** One reader for every agent-style response. `data` is the axios `r.data` from POST /api/lens/run. */
export function readAgentReply(data: unknown): AgentReply;
```

`readAgentReply`, with `result = data?.result`:

1. The first non-empty value among `result.answer`, `result.reply`, `result.summary`, `result.output`, `data.reply`. A string is used as is; anything else is `JSON.stringify(value, null, 2)`. Return `{ ok:true, text }`.
2. Otherwise, if `result?.ok === false` or `data?.ok === false`: `{ ok:false, reason: result?.reason || result?.error || data?.error || "The agent could not finish." }`.
3. Otherwise `{ ok:false, reason: "The agent finished without writing anything." }`.

The reason is shown as it is. The literal `'Agent returned empty.'` is removed from every panel.

Server side: in `server/domains/chat-agent.js`, find `register("chat_agent", "do", async (ctx, input = {}) => {`. Where it returns the loop's result, add `reply: result.answer ?? null` next to `answer`. Nothing else in the result changes.

`agents.executeRun` (find `registerLensAction("agents", "executeRun"`). Keep the budget code, the run record and the return shape. Change only how steps are produced, when `cockpitFlag("RUNS")` and `tablesReady(db)`:

1. Tools: `params.tools` cleaned as today. An **empty array given on purpose** (`Array.isArray(params.tools) && params.tools.length === 0`) or an agent record whose tool list is empty means a tool-less agent: `candidateIds = []`. Only a missing `params.tools` falls back to the default three.
2. `planRun({ db, userId, goal, profile, lensActions, deps })` restricted to those tools. Check how CKPT-10's `planRun` takes an allow-list (`normalizePlan` has `candidateIds`); if `planRun` has no such argument, add an optional `allowTools: string[] | null` to it in this ticket and cover it in the test. A tool-less agent gets a one-step plan with `tool: null` and an empty menu, which the engine answers with `done` and a written summary, never a tool call.
3. `createRun({ surface: "agents_lens", … budget: { maxSteps } })`, `insertSteps`, `await driveRun({ …, deadlineMs: Date.now() + 25000 })`.
4. Map cockpit steps into the existing `steps` array shape (`index`, `tool` as the step label, `toolKind`, `input` as the step goal, `output` or `error`, `latencyMs`, `tokens`, `status`, `ts`) and add `cockpitRunId` to the returned run. A run still going at the deadline returns `status: "running"` with the steps done so far.
5. With the flag off, the existing loop runs unchanged.

`AgentRuntime.tsx`: in the run list (find `{r.agentName}: {r.goal}`), when a run has `cockpitRunId` render `<RunCard runId={r.cockpitRunId} />` from CKPT-17 in the expanded row, in place of the static step list. No other change to the component.

FIX-chat-014, Thread Summarize. The cause is recorded as a guess in `AUDIT.md`. Do this:

1. In `ChatWorkspacePanel.tsx` find `if (action === 'threadSummarize') setThreadSummarizeResult(result);` and read back to what `result` is and which macro it came from.
2. In `ChatToolsDrawer.tsx` find `{threadSummarizeResult && (` and read which fields it renders.
3. Call the macro through the test harness in CI (`lensRun` from `server/tests/depth/_harness.js`) with a three-message thread and record the real result shape in the test.
4. Make the drawer render the fields the macro really returns. If the macro returns `ok:false`, render its reason. If it returns an empty summary for a non-empty thread, that is a server bug: fix the macro and say so in the commit.
5. Do not route Summarize through a cockpit run unless step 3 shows the macro needs more than one call; `ARCHITECTURE.md` section 15 allows a one-step run, but a direct macro call that renders is the smaller fix.

Handed back, not fixed here (post on the bridge with the FIX id when you reach this ticket): FIX-wellness-004 publish part ("No DTU id returned"); FIX-reasoning-002 publish rejection, the HTTP 400 and the map crash.

### Steps

1. Create `agent-reply.ts` and its test.
2. In each of the 88 panels, replace the local reply-reading lines and both `'Agent returned empty.'` branches with:
   ```ts
   const reply = readAgentReply(r.data);
   if (reply.ok) { setAgentReply(reply.text); ok('<keep the panel\'s existing success word>'); }
   else err(reply.reason);
   ```
   Keep each panel's own state setter and success message. Panels differ in small ways; if a panel does not fit this shape, leave it and list it in the commit message. Commit in batches of about 20 files so a bad batch is easy to revert.
3. Make the `chat-agent.js` edit.
4. Make the `agents.js` and `AgentRuntime.tsx` edits.
5. Do the Thread Summarize procedure.
6. Post the handed-back items on the bridge.

### Tests (CI only)

`agent-reply.test.ts`: `{ result:{ ok:true, answer:"hi" } }` gives `text "hi"`; `{ result:{ summary:{ a:1 } } }` gives the JSON text; `{ result:{ ok:false, reason:"no_brain" } }` gives `reason "no_brain"`; `{ result:{ ok:true } }` gives the "without writing anything" reason; `null` gives `ok:false`. Negative control: `{ result:{ answer:"" , reply:"x" } }` gives `"x"`, not empty.

`agent-reply-contract.test.js`: a source check. Read every file under `concord-frontend/components` and `concord-frontend/app` and assert none contains `Agent returned empty`. Assert `server/domains/chat-agent.js` contains `reply:`.

`agents-execute-run.test.js`, mock model and `fakeExec`, flag on: a goal "summarize my notes on beams" with tools `["dtu_read","summarize"]` produces steps whose inputs differ from each other and whose first tool is the read; an agent with `tools: []` produces a run with zero tool calls in `usage.toolCalls` and a written output; `maxSteps: 2` yields at most 2 steps; flag off produces today's shape (`steps[0].tool === "dtu_read"`). Negative control: with tools `["dtu_read"]`, no step uses `summarize`.

A Thread Summarize test in `server/tests/cockpit/thread-summarize.test.js`: the macro returns a non-empty summary for a three-message thread, and the test pins the field name the drawer reads.

**2B check.** None beyond CKPT-22.
**Rollback.** Agents lens: `CONCORD_COCKPIT_RUNS=0`. The reply reader and Summarize fix are reverted by reverting their commits; they change no data.
**Risks.** An 88-file edit colliding with other seats: batch commits, rebase before each push, stage named files only. A panel that relied on a non-string reply: `readAgentReply` keeps the `JSON.stringify` behaviour. The agent's tool allow-list being widened by the planner: the negative-control test.
**Done when.** CI green; FIX-meditation-002, FIX-agents-010, FIX-chat-014 and the agent parts of FIX-wellness-004 and FIX-reasoning-002 are marked fixed with commit hashes; the handed-back parts are on the bridge.

---

## CKPT-20: ConKay, long tasks and outside MCP agents on the core

**Goal.** The three remaining ways a multi-step job starts all create a cockpit run: `start_long_task`, ConKay's agent stream, and an outside agent over MCP.
**Why.** Architecture section 1: six surfaces, one core. After CKPT-16 to 19, these three still run their own loops with no receipts, no confirm card and no resume.
**Probe failure it addresses.** `case "start_long_task":` in `chat-agent.js` calls `lt.startLongTask(...)`, a separate marathon job; `/api/chat-agent/stream` sends `tool_call` events with tool ids to ConKay and `LensAgentPanel`; an MCP client can call single tools only.
**Depends on.** CKPT-16. **Flag.** `CONCORD_COCKPIT_LONG_TASK`, default off, and it needs `CONCORD_COCKPIT_RUNS`.
**Reuse.** `startLongTask`, `longTaskStartedReply`, `deliverLongTaskResult`, `takePendingLongTaskNotices`, `activeLongTaskCount` (`lib/long-task.js`), `handleChatTurn` (CKPT-16), `authorizeBridgeCall` (`lib/mcp-hermes-identity.js`), `mcpShouldAdvertiseTool` (`lib/mcp-server.js`), `streamConKayAgent` and `parseSseBuffer` (`concord-frontend/lib/conkay/agent-stream.ts`), `RunCard` (CKPT-17). **Do not** replace `lib/conkay/chat/orchestrator.js`, `lib/agent-marathon.js` or `lib/mission-runtime.js`, and do not build a second notice channel.

### Files

- Create `server/lib/cockpit/long-task-bridge.js`
- Create `server/lib/cockpit/mcp-tools.js`
- Modify `server/lib/chat-agent.js` (`case "start_long_task":`)
- Modify `server/lib/chat-agent-stream.js` (cockpit turn before the old loop)
- Modify `server/lib/cockpit/agent-tool-specs.js` (add `conkay_design` if absent)
- Modify `server/lib/mcp-server.js` (register three tools)
- Modify `concord-frontend/lib/conkay/agent-stream.ts`, `concord-frontend/components/conkay/conkayRunStore.ts`, `concord-frontend/components/lens/LensAgentPanel.tsx` (handle cockpit events)
- Create `server/tests/cockpit/long-task-bridge.test.js`, `server/tests/cockpit/mcp-tools.test.js`, `server/tests/cockpit/agent-stream-cockpit.test.js`

### Interfaces

```js
// long-task-bridge.js
/**
 * @param {{ db: object, userId: string, goal: string, mode?: string|null, chatSessionId?: string|null,
 *           surface?: Surface, lensActions?: Map, deps?: object }} a
 * @returns {Promise<{ ok: boolean, runId?: string, total?: number, message?: string, reason?: string }>}
 */
export async function startCockpitLongTask(a) {}
/** Called by the engine when a long_task run reaches a terminal status. Never throws. */
export async function deliverRunResult(db, run, steps) {}
```

`startCockpitLongTask`: refuse with `reason:"too_many_runs"` at the concurrency cap; `planRun`; `createRun({ surface: a.surface || "long_task", … })`; `insertSteps`; **do not** drive the run, the pump does; return `{ ok:true, runId, total, message: "Started. " + total + " steps. I'll post the result here when it's done." }`. A planner failure returns `{ ok:false, reason }` and the caller falls back to the old `startLongTask`.

`deliverRunResult`: writes the finished text (the same text CKPT-16's reply table produces for `done` or `failed`) into the chat thread through the existing long-task notice path. Read `deliverLongTaskResult` and `takePendingLongTaskNotices` first: they key on a marathon session id. If they can take a cockpit run without changing their signatures (for example by a notice row they already read), use them. If they cannot, add one small exported function in `lib/long-task.js` that enqueues a notice `{ userId, surface, sessionId, text }` into the same store `takePendingLongTaskNotices` reads, and call that. Do not create a table. Call `deliverRunResult` from the engine's terminal-status branch for runs whose surface is `long_task`, inside `try/catch`.

`chat-agent.js`: in `case "start_long_task": {`, after the `if (!ctx.db || !userId)` line, add:

```js
const { cockpitFlag } = await import("./cockpit/flags.js");
if (cockpitFlag("LONG_TASK") && cockpitFlag("RUNS") && !ctx.cockpitRunId) {
  const { startCockpitLongTask } = await import("./cockpit/long-task-bridge.js");
  const goalText = String(call.params?.goal || "").trim() || String(ctx.userPrompt || "").trim();
  const cr = await startCockpitLongTask({ db: ctx.db, userId, goal: goalText, mode: call.params?.mode || null,
    chatSessionId: ctx.actor?.sessionId || null, lensActions: ctx.lensActions });
  if (cr.ok) return { tool: call.tool, ok: true, jobId: cr.runId, mode: call.params?.mode || "general", message: cr.message, cockpitRunId: cr.runId };
  if (cr.reason === "too_many_runs") return { tool: call.tool, ok: false, error: "You already have tasks running. Wait for one to finish or cancel one.", reason: cr.reason };
}
```

Any other failure falls through to the existing code. `ctx.cockpitRunId` is set by `makeExec` (CKPT-09) so a run cannot start a run; if `makeExec` does not set it, add `cockpitRunId: run.id` to the ctx it builds, in this ticket. In the cockpit tool catalogue (`agent-tool-specs.js`), `start_long_task` must not appear in any step menu; assert that in the test.

ConKay and the agent stream. In `server/lib/chat-agent-stream.js`, find where the handler starts the loop (the call to `runAgentLoop`). Before it, when `cockpitFlag("ROUTE")`:

1. Call `handleChatTurn({ …, surface: req.body?.slot === "conkay" ? "conkay" : "agent", chatProgress: (e) => send(e.type, e) })`, where `send` is the handler's existing SSE writer. Check how this handler really tells ConKay from other callers (read how `slot` is used); if it cannot tell, use `"agent"` for all and say so in the commit.
2. When it returns `handled`, send the reply through the handler's existing `token` and `done` events (one `token` event with the whole reply, then `done` with `cockpitRunId` added) and return.
3. When it returns `null`, the old loop runs unchanged.

ConKay's own design iteration stays where it is. Add a tool spec `conkay_design` (risk `compute`, title "Work out the design") whose executor case calls the existing orchestrator entry point; find the function ConKay's chat route calls in `lib/conkay/chat/orchestrator.js` and call the same one. If `executeToolCall` already has a ConKay design tool, register that id and add no new case.

Frontend: in `agent-stream.ts`, `streamConKayAgent` dispatches on the SSE event name. Add a branch: an event whose name starts with `cockpit:` is passed to a new optional callback `onCockpit?: (e: CockpitEvent) => void`. In `conkayRunStore.ts`, store `cockpitRunId` from the first such event or from `done`. In `LensAgentPanel.tsx`, in the loop that handles `event === 'tool_call'`, add `else if (event.startsWith('cockpit:')) liveAnswer.cockpitRunId = data.runId;` and render `<RunCard runId={…} />` above the answer when it is set. Where ConKay's workspace renders a turn, render `RunCard` the same way; name the component you edited in the commit.

```js
// mcp-tools.js
export const COCKPIT_MCP_TOOLS = Object.freeze([
  { name: "start_run",  risk: "write", requiresScopes: ["mcp:lens:compute"],
    inputSchema: { type:"object", additionalProperties:false, required:["goal"], properties:{ goal:{ type:"string", maxLength:2000 } } } },
  { name: "get_run",    risk: "read",  requiresScopes: ["mcp:lens:read"],
    inputSchema: { type:"object", additionalProperties:false, required:["run_id"], properties:{ run_id:{ type:"string" } } } },
  { name: "cancel_run", risk: "write", requiresScopes: ["mcp:lens:compute"],
    inputSchema: { type:"object", additionalProperties:false, required:["run_id"], properties:{ run_id:{ type:"string" } } } },
]);
/** @returns {Promise<object>} the tool result; always { ok, ... } */
export async function callCockpitMcpTool(name, args, { db, actor, lensActions, deps }) {}
```

`callCockpitMcpTool`: `!cockpitFlag("LONG_TASK")` returns `{ ok:false, reason:"disabled" }`. Every call first goes through `authorizeBridgeCall` with the tool's risk and scopes, exactly as the bridge's own tools do; read one existing call to copy its arguments. `start_run` calls `startCockpitLongTask({ surface:"mcp", userId: actor.userId, … })` and returns `{ ok, run_id, total }`. `get_run` returns CKPT-15's `publicRun`, `publicSteps` and `progress` for the actor's own run, or `{ ok:false, reason:"not_found" }`. `cancel_run` sets `cancelled`.

An outside agent cannot approve. A run with surface `mcp` that reaches `awaiting_confirm` stays there; `get_run` reports it with `needs_person: true` and the confirm label; only the signed-in person, through `POST /api/cockpit/runs/:id/decision`, can approve. There is no MCP tool for a decision. This is the rule in `ARCHITECTURE.md` section 11 applied to the MCP surface.

Register the three tools in `mcp-server.js` the way its existing tools are registered and advertised (read `createMCPServer` and `mcpShouldAdvertiseTool`), and advertise them only when the flag is on.

### Steps

1. Create `long-task-bridge.js` and `mcp-tools.js` with tests.
2. Make the `chat-agent.js` edit.
3. Wire `deliverRunResult` into the engine's terminal branch.
4. Make the `chat-agent-stream.js` edit and add the `conkay_design` spec.
5. Register the MCP tools.
6. Make the three frontend edits.

### Tests (CI only)

`long-task-bridge.test.js`, mock model: flag on, `start_long_task` through `executeToolCall` creates a `cockpit_runs` row with surface `long_task` and no marathon session; flag off creates a marathon job as today; at the cap the result is `ok:false` with the plain message; a planner failure falls back to the old path; after `pumpOnce` drives the run to `done`, `takePendingLongTaskNotices(db, userId)` returns one notice containing the last step's summary; `start_long_task` called with `ctx.cockpitRunId` set does not create a run. Negative control: the delivered notice text does not contain a tool id.

`mcp-tools.test.js`: an actor without `mcp:lens:compute` gets `scope_denied` from `start_run`; with the scope, `start_run` returns a `run_id` and `get_run` returns its steps; another actor's `get_run` is `not_found`; a run with a `create_dtu` step reaches `awaiting_confirm`, `get_run` shows `needs_person: true`, and no call in `COCKPIT_MCP_TOOLS` can move it on; flag off returns `disabled` and the tools are not advertised.

`agent-stream-cockpit.test.js`: with `ROUTE` on and a mock model, a POST to the stream handler for a 3-step ask emits at least one `cockpit:step` event, one `token` and one `done` carrying `cockpitRunId`, and no `tool_call` event; with `ROUTE` off the event sequence is today's.

Frontend, in `concord-frontend/lib/conkay/agent-stream.test.ts` (extend the existing test file if there is one): `streamConKayAgent` with a stubbed stream containing `event: cockpit:step` calls `onCockpit` once and does not treat it as a token.

**2B check.** At the desk with the flags on: ask ConKay "design a shelf bracket for a 40 lb load, then save it". Expect a run card, one confirm, and the saved design. Ask chat "research budget 3D printers and write me a report"; expect the "Started" reply, then the report posted in the thread. Recorded in CKPT-22.
**Rollback.** `CONCORD_COCKPIT_LONG_TASK=0` returns `start_long_task` and MCP to today's behaviour. `CONCORD_COCKPIT_ROUTE=0` returns the agent stream to the old loop.
**Risks.** A run starting runs: `ctx.cockpitRunId` guard and its test. An outside agent approving a write: no decision tool exists, tested. Two delivery paths posting the same result: only `long_task` runs call `deliverRunResult`; chat-surface runs report through `RunCard`. Marathon jobs already in flight when the flag flips: they finish on the old path, since the flag is read only when a job starts.
**Done when.** CI green, and with all flags off the event sequence of `/api/chat-agent/stream` and the behaviour of `start_long_task` are unchanged.
