# Ask diagnosis: goddess, lfg, tick, inheritance (CKPT-18)

Nothing here was run on the Mac. Findings are from reading code on branch `fix/audit-sweep-20261110`.

## What all four share

Steps 1 and 2 of the procedure give the same answer for all four lenses. Each page
(`concord-frontend/app/lenses/<lens>/page.tsx`) is a plain `LensShell` page with no Ask control or chat
fetch of its own. The Ask control is the shared `LensToolbar.tsx` link to `/lenses/chat?context=<lens>`.
The chat page reads `?context=` once on mount (`ChatWorkspacePanel.tsx`, the effect that calls
`setDomainContext` and `resolveAskThread`), then `sendMutation` runs. In `sendMutation`:

- `buildLensFactsBlock(domainContext)` is awaited before the request. Only `analytics` and `conkay` have a
  provider, so for these four lenses it returns `''` at once. Not the cause.
- `chatAbortControllerRef.current?.abort()` runs at the start of every send, and again on unmount.
- The stream request has an idle-stall watchdog and falls back to a buffered `POST /api/chat`.

The client already ends failures in a visible message: `sendMutation.onError` appends a system message
and `onSuccess` appends the `chatFailure(...)` text. So the "error card, not a blank transcript" rule holds
on the client and no edit was needed.

## goddess (FIX-goddess-001: Ask never answers, "Working on it" then nothing)

Cause not found. Checked: the page has no Ask code of its own; the facts block is not involved; the
client error path shows a message on failure. With `CONCORD_COCKPIT_ROUTE` on, CKPT-16's foreground
`deadlineMs` bounds the turn at 25 s and the run card keeps updating, so a silent hang cannot come from
the cockpit path. What is not covered: the old (flag off) chat-agent path, whose awaits I did not trace to
a timeout. Handed back on the bridge. Test: `ask-goddess.test.js` (cockpit path, mock model).

## lfg (FIX-lfg-001: tab crashes, "Aw, Snap" error code 9)

Cause not found. Error code 9 is an out-of-memory renderer crash. Checked: the lfg page itself (it renders
only on `/lenses/lfg`, not on `/lenses/chat`); the chat page's `?context=` effect runs once and does not
loop. The report says the crash also happened on alliance and crisis-ops chat, which points at the chat
page rather than at lfg. I did not find an unbounded list render or a recursive effect by reading, and I
will not name one without a heap profile. Handed back on the bridge; it needs a browser heap capture of
`/lenses/chat?context=lfg`. Test: `ask-lfg.test.js`.

## tick (FIX-tick-005: first Ask aborts with "signal is aborted without reason", retry works)

Cause not found. The message comes from an `AbortController` that was aborted. In `sendMutation` the
previous controller is aborted before a new one is made, and the unmount effect aborts the current one.
A first-send abort is consistent with the chat page unmounting once after the `?context=` effect (for
example a route replace), but I did not find the unmount. Handed back on the bridge. Test: `ask-tick.test.js`.

## inheritance (FIX-inheritance-011: first Ask crashes the tab, retry works)

Cause not found. Same shared path and same state-created-on-first-use question as tick: the thread is
created on the first send when `resolveAskThread` returns null. Nothing in the request waits on that
creation by reading. Handed back on the bridge with the tick note. Test: `ask-inheritance.test.js`.

## Status

None of the four ids is marked fixed. Each has a test that pins the cockpit path and a section above.
