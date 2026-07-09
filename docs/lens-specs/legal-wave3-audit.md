# legal — Wave 3 unsurfaced-macro audit

Frontend Rebuild Program, Wave 3. `legal` scored `polished` under
`grade-ux-polish.mjs --honest`, but `node scripts/lens-unsurfaced.mjs --lens legal`
flagged 6/62 macros with zero frontend references:

```
ai-*       (2): ai-court-doc-to-calendar, ai-matter-update
payment-*  (2): payment-portal-summary, payment-record
contacts-* (1): contacts-update
matters-*  (1): matters-update
```

Method: read every macro's implementation in `server/domains/legal.js`, then
read every `concord-frontend/components/legal/*.tsx` file in full (the
Clio-Manage-shape left-rail shell `ClioShell.tsx` composed by `ClioSection.tsx`,
which `app/lenses/legal/page.tsx` mounts) to check whether the capability was
already reachable a different way.

## Findings — all six were real gaps

### `matters-update` — REAL GAP (fixed)
`server/domains/legal.js:417` lets a caller patch a matter's name/client/
jurisdiction/court/case number/rates/status/billing type/parties. `MattersPanel.tsx`
(pre-fix) only had `matters-create` and `matters-close` — once a matter was
opened, none of its fields (a wrong case number, a rate change, reopening a
closed matter) could ever be corrected without deleting the matter (which isn't
even possible — there's no `matters-delete` macro at all).

**Fix:** added an Edit mode to the matter-detail pane (Pencil button → the same
field set as "New matter" plus a status selector) that calls `matters-update`.

### `contacts-update` — REAL GAP (fixed)
`server/domains/legal.js:515` — same shape of gap for contacts: `ContactsPanel.tsx`
only had create/delete, so a mistyped email or a client's kind/organization
change had no path to fix short of delete-and-recreate (which also silently
drops the contact from any matter's `partyIds` and from the conflict-check
corpus).

**Fix:** added an inline row-edit mode (Pencil → editable row → Save/Cancel)
calling `contacts-update`.

### `ai-matter-update` — REAL GAP (fixed)
`server/domains/legal.js:1178` — labeled in-code as "Clio 'Manage AI' parity":
builds a deterministic activity digest (time entries/documents/events/invoices/
trust transactions since a cutoff) and, if a brain is online, asks it to draft a
short client-update blurb from that digest (falls back to the deterministic
summary otherwise — honest, no silent LLM-required cliff). Nothing in
`MattersPanel.tsx` ever called it — the matter detail pane had totals and lists
but no "tell the client what's been happening" feature at all, despite the
domain file explicitly building it as a headline parity feature.

**Fix:** added a "Draft client update" card to the matter-detail pane (Draft/
Regenerate button → `ai-matter-update` → renders the summary + which source
produced it, so it never pretends an LLM wrote it when it didn't).

### `ai-court-doc-to-calendar` — REAL GAP (fixed)
`server/domains/legal.js:1216` — a real deterministic regex pass (no LLM) over
pasted court-document text: pulls "within N days [of X]" and "by [date]"
clauses, plus hearing/trial/conference-adjacent dates, and turns them into
calendar-event suggestions with FRCP-aware trigger-date math. `CalendarPanel.tsx`
already had a hand-picked-rule deadline calculator but no "read a document and
find the deadlines in it" feature — the two are complementary, not the same
thing, and the second didn't exist in the UI at all.

**Fix:** added a "Parse court document for deadlines" card to `CalendarPanel.tsx`
— paste text (+ optional trigger date + matter) → Extract deadlines →
`ai-court-doc-to-calendar` → a list of suggested deadline/hearing events, each
with its source context and an "Add to calendar" button that calls the existing
`calendar-create` macro per suggestion.

### `payment-record` / `payment-portal-summary` — REAL GAP (fixed)
`server/domains/legal.js:1480,1566` — a real payments subsystem distinct from
the existing "Bills" tab: `payment-record` supports partial payments, four
payment methods, a genuine 2.9% card-processing fee deduction (mirrors the
platform's own token-purchase fee rate), and auto-flips an invoice to `paid`
only once cumulative payments cover the full total; `payment-portal-summary` is
the client-facing "what do you currently owe" view across open invoices.
`InvoicesPanel.tsx`'s existing "Mark paid" button is a blunt full-amount
boolean toggle with no method, no fee, no partial-payment history — a real,
different capability was sitting behind a control that couldn't reach it.

**Fix:** added a new `PaymentsPanel.tsx` (record a payment against an invoice or
as a general matter credit/retainer, method selector with the fee note, payment
ledger, and the portal "what's owed" summary) and wired it into the Clio-shape
left rail as a new "Payments" nav item (`ClioShell.tsx` / `ClioSection.tsx`)
under the Financial group, next to Bills and Trust.

## Files touched
- `concord-frontend/components/legal/MattersPanel.tsx` — edit form + AI client-update card.
- `concord-frontend/components/legal/ContactsPanel.tsx` — inline edit row.
- `concord-frontend/components/legal/CalendarPanel.tsx` — court-document deadline parser.
- `concord-frontend/components/legal/PaymentsPanel.tsx` — new component.
- `concord-frontend/components/legal/ClioShell.tsx`, `ClioSection.tsx` — new nav entry.

No generic button walls: every new control is a designed field on the specific
panel where the underlying record already lives, and the AI-drafted content is
labeled with its real source (brain vs. deterministic) rather than presented as
uniformly "AI".
