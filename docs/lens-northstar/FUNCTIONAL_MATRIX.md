# Lens functional matrix

One row per lens this pass has actually exercised. Status is never COMPLETE from a render alone.

The signed-in clicks below used the production controls in a Vite harness, proxied to this repo's API. They were not clicks on the Next `/lenses/...` route. Those routes mount the same controls. Chat through Mail used port 3013 and API 5062. Calendar used port 3014 and API 5074. Marketplace used port 3015 and API 5076.

## ConKay — workspace (2026-10-06, browser on the Next route)

Concept `477-conkay-northstar-concept.png`; built `478-conkay-current.png` (desktop) and `479-conkay-current-phone.png` (images to be added over LFS from a machine with LFS push access — the cloud session that built this could not upload LFS objects). Clicked on `/lenses/conkay` in Next dev (port 3000) against `server.js` (port 5050), signed in, desktop 1280×800 and phone 390×844. No LLM was available.

Architecture: ConKay is its own lens. Chat's ConKay mode, `/mode conkay`, `?mode=conkay`, the ⌘J overlay's Workspace button, the command palette, DTU detail "Open in ConKay" and the Engineering FEA receipt all open this workspace (`?ask=` / `?dtu=`). The in-chat copy of ConKay was removed.

| Area | What was checked | Result |
|---|---|---|
| Study solve | "Reduce web thickness to 8.0 mm and re-run the FEA. Keep flanges at 15.0 mm." | `engineering.beamStudy` solved: 86.1 MPa, 0.344 mm, 24.9% of A992 yield; hand check (PL/4·c/I, PL³/48EI) agrees. Restated t_f not reported as a change. |
| Overload | "cantilever with 150 kN in A36" | 258.2 MPa, 103.3% — "Exceeds yield … does not carry the load". Viewport shows red at the fixed end. |
| Honesty | Before a solve, after an edit | Cards say "Not solved yet" / "Inputs changed" and hide every number; stress colours turn off. No confidence %, no badge without a solve. |
| Parameter sweep | Sweep chip | `engineering.beamSweep` solved t_w 5–11 mm in 48 ms, names the lightest passing section, states shear/buckling are not checked; "Use t_w = …" applies and re-solves. |
| Keep as DTU | Card and chat | `dtu.create` → `dtu.get` read-back → `engineering.beamStudy-keep`; card shows the DTU id. Read-back failure is reported as not kept. |
| Save model | "save model" | `engineering.savePart` (i-beam, metres); listed under Models with mass, "Open" loads it. |
| Rail | Projects, Models, Simulations, Data Vault, Library, Workspaces | Each reads its store; empty stores say so. New workspace (agent project) opens with its own study and conversation. |
| Handoffs | `?dtu=` kept study, `?ask=`, Chat menu draft, ⌘J Workspace | Kept study reloads its exact inputs (results hidden until re-solved); `?ask=` edits and solves; draft carried. |
| Persistence | Reload | Study (`beamStudy-get`) and conversation (`engineering.workspaceLog-*`) reopen; Clear empties the stored log. |
| Agent | Free-form question | Routed to `/api/chat-agent/stream` with the study as context; offline it says the language model is unreachable and that edits/FEA still work. |
| Security | `agent_projects.*` | Fixed: every macro took `input.userId` before the session user — any user could list or create projects as another. |
| Phone | Tabs Model / ConKay / Browse | Parameters start collapsed; no horizontal scroll. |

Not proven here: a streamed LLM reply and live speech recognition (no model or microphone in this environment).

## Chat — concept pass 2 (2026-10-06, browser on the Next route)

Clicked on `/lenses/chat` in Next dev (port 3000) against `server.js` (port 5050), signed in, desktop 1280×800 and phone 390×844. No LLM was available, so replies were the offline stored-knowledge path.

| Area | What was checked | Result |
|---|---|---|
| Concept match (`02-chat-northstar-concept.jpg`) | Greeting, three starter chips, one centered thread, neutral bubbles, floating composer with `+` / `Chat ▾` / mic / send | Matches. Avatars and purple user bubble removed; time shown once, inside the bubble; message actions appear on hover. |
| Conversations drawer | Open, select, rename, delete controls, search box | Fixed: it slid under the app rail (title, search and New Chat clipped). Fixed: rename and search inputs rendered white because `lattice-bg` was never defined. |
| Menus | Header ⋮, composer `+`, mode pill, Export | Fixed: none closed on Escape or outside click, so they stacked. |
| `+` menu | Tools, Projects, Prompts, Schedule, Studio, Agent Mode | Each opens its real panel. |
| Settings gear | Drawer gear | Fixed: was a toast pointing elsewhere; now opens Studio (voice, assistants, memory). |
| Backend round-trips (signed-in session, `/api/lens/run`) | projects, prompts, memory, assistants, canvas, code-run, scheduled, share-create → share-view, thread-index → threads-search, branch-fork → branches-list, voice | All saved and read back. Fixed: code-run reported `console.log`'s log count as the return value. |
| Offline reply | Ask with no LLM | Fixed: the same seed note was listed five times (#609…#649); now each distinct note once. |
| Share link | Invalid token | Honest "share link not found". |
| Page scroll | Open a menu | Fixed: the legal footer made the whole page scroll under the app. |
| Phone | Composer, top bar, help launcher | Fixed: Send was off-screen; account avatar pushed off the top bar; help button covered the mode pill. |

Not proven here: a streamed LLM reply (no model in this environment).

## Chat — COMPLETE (2026-10-04, `fe808941a`)

| | |
|---|---|
| Purpose | Talk with Concord, then keep the transcript as a private DTU and send that DTU to Timeline. Reference: ChatGPT / Claude. Native Timeline stays the share target. |
| Existing backend | `dtu.create`, `dtu.get`, `timeline.post-create` storing `citedDtuId` when the value is an id. |
| Existing APIs | `POST /api/lens/run` for those actions. Chat send itself remains `POST /api/chat` and `/api/chat/stream`. |
| Existing DTUs | Private transcript DTU (`source: chat-lens:transcript`). The menu says saved only after `dtu.get` returns the same id. |
| Native workflows | Chat options on the visible header. Save, then "Send this DTU to Timeline" as a private post that cites the DTU. |
| External integrations | None on this menu. |
| Missing functionality | Friends-only feed was not a two-user browser proof. The click was the production menu, not the Next route. |
| Status | COMPLETE for the save-and-send workflow. |

### Acceptance

| Lens | Core workflow | Real backend | Real UI | Persistence | Live data | DTU | Cross-lens | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| Chat | Save a transcript, read it back, send that DTU to Timeline | `dtu.create`, `dtu.get`, `timeline.post-create` | Visible header menu. Saved `dtu_021cf81c7320f330ccee`. Sent as private post `pst_mutuznxg_zpzgvm`. Reload showed "From DTU". | Feed post stayed private and cited the DTU after reload. | The note is the server reply. A failed read-back does not say saved. | Private transcript DTU | Timeline private post | vitest 13, `server/tests/chat-handoff-persist.test.js` 6 | COMPLETE |

## Timeline — COMPLETE (2026-10-04, `0ade60d47`)

| | |
|---|---|
| Purpose | Keep a post you can already see as a private DTU, then send that DTU to a Thread draft. Reference: a Facebook-style feed. A draft is not an external post. |
| Existing backend | `dtu.create`, `dtu.get`, `thread.thread-draft` storing `citedDtuId`. Draft status stays `draft`. |
| Existing APIs | `POST /api/lens/run`. |
| Existing DTUs | Private post DTU (`source: timeline-lens:post`). |
| Native workflows | Keep menu. "Send this DTU to Thread" only after read-back. Sentence says "Not posted." |
| External integrations | None. |
| Missing functionality | Friends-only visibility stays the prior server parity test. It was not a two-user browser proof. |
| Status | COMPLETE for keep-and-send. |

### Acceptance

| Lens | Core workflow | Real backend | Real UI | Persistence | Live data | DTU | Cross-lens | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| Timeline | Keep a visible post as a DTU and send it to a Thread draft | `dtu.create`, `dtu.get`, `thread.thread-draft` | `PostKeepMenu`. Post `pst_mutv6v3v_wmer2r`. DTU `dtu_25ae0db4150a5e57501e`. Draft `th_mutv6v7v_y2yd17`. | After reload: the DTU was still on that draft. Not posted. | The note is the server reply. | Private post DTU | Thread draft | vitest 10, `server/tests/timeline-post-keep.test.js` 3 | COMPLETE |

## Thread — COMPLETE (2026-10-04, `21dcaed87`)

| | |
|---|---|
| Purpose | Record that you posted a draft yourself, then save that attestation as a DTU and send it to Timeline. Reference: Typefully. Bluesky and Mastodon stay labeled connectors. |
| Existing backend | `thread.draft-publish` (`postedManually`, `delivered: false`), `dtu.create`, `dtu.get`, `timeline.post-create`. |
| Existing APIs | `POST /api/lens/run`. Real external delivery remains `publish-to-account`. |
| Existing DTUs | Private attestation DTU. The summary says Concord did not send it. |
| Native workflows | "I posted this", then "Save draft as DTU", then "Send this DTU to Timeline" as a private post. |
| External integrations | This path does not call Bluesky, Mastodon, X, Threads, or LinkedIn. |
| Missing functionality | None for this attestation workflow. |
| Status | COMPLETE. |

### Acceptance

| Lens | Core workflow | Real backend | Real UI | Persistence | Live data | DTU | Cross-lens | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| Thread | Mark a draft posted by you, save that as a DTU, send it to Timeline | `draft-publish`, `dtu.create`, `dtu.get`, `timeline.post-create` | `ThreadComposer`. Draft `th_mutv961x_pr0kfv`. DTU `dtu_159a005747c8315dca97`. Post `pst_mutv96ap_yu4be6`. | After reload the draft was still `published` / `postedManually`, and the post was still private and cited the DTU. | Notes said Concord did not send the draft, and named the private post. | Private attestation DTU | Timeline private post | `concord-frontend/tests/thread-manual-post.test.ts` 3 | COMPLETE |

## Wallet — COMPLETE (2026-10-04, `7ce1cf344`)

| | |
|---|---|
| Purpose | Pay someone with Concord Coin, then keep the ledger receipt as a private DTU and send that DTU to Finance. Reference: Venmo / PayPal for requests, splits, and scheduled sends. |
| Existing backend | `wallet.requestUpdate`, `wallet.splitSettle`, `wallet.scheduleSendNow` call `executeTransfer`. `finance.receipt-record` stores the cite. It does not move Coin. |
| Existing APIs | `POST /api/lens/run` for those actions, plus `dtu.create` and `dtu.get`. |
| Existing DTUs | Private receipt DTU (`source: wallet-lens:receipt`) only after the ledger returns a batch and `dtu.get` returns the same id. |
| Native workflows | Pay, Pay share, and Send now. The sentence is "Paid … CC. Ledger …" or "Sent … CC. Ledger …". Then save and send to Finance. A creator's own split portion stays "your share". |
| External integrations | None. Cards and PayPal labels are stored funding-source metadata, not a charge. Cash-out stays the earned-only withdrawal path. |
| Missing functionality | Funding-source rows are still labels, not processors. The heartbeat due-sweep was not clicked; it remains the earlier server test. |
| Status | COMPLETE for pay, pay share, send now, receipt DTU, and Finance record. |

### Acceptance

| Lens | Core workflow | Real backend | Real UI | Persistence | Live data | DTU | Cross-lens | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| Wallet | Pay a request, pay a split share, send a scheduled occurrence, save each receipt, send it to Finance | `executeTransfer` and `finance.receipt-record` | `WalletParityHub` and `WalletReceiptInbox`. Payer `8bba05fa-c591-4a72-8a4a-c7692b83bb71`. | After reload the three sentences were still on screen and Finance still listed the three receipts. | The screen named the ledger batch. A missing batch does not say paid. Finance says Coin was not moved again. | Request `dtu_29ee12b12e82d1aa8f9a` / `rcpt_mutvjsh9_mcr3oy` / `txn_26a22318ae464ad6` (1.25 CC). Schedule `dtu_61685ee20416c072c654` / `rcpt_mutvjsp1_eul2i0` / `txn_6728827acdfd4a48` (2.50 CC). Split `dtu_08a6d08ec284aa51bd08` / `rcpt_mutvjsvl_0vcw3t` / `txn_f3e4ff8ad33e426b` (2.00 CC). | Finance bills group lists the cited receipts | vitest 4 (`tests/wallet-receipt.test.ts`). `server/tests/wallet-finance-receipt.test.js` 2. Prior ledger tests remain in `wallet-domain-parity.test.js`. | COMPLETE |

Browser: signed in on `http://127.0.0.1:3013` against this repo's API on 5062. Pay, Send now, and Pay share were clicked. Each receipt was saved only after read-back and then opened in the Finance receipt list. Reload showed the same paid and sent sentences and the same three Finance records.

## Mail — COMPLETE (2026-10-04, `f5e5e494d`)

| | |
|---|---|
| Purpose | Send Concord player mail with a Coin gift, claim it, keep the message as a private DTU, and send that DTU to Timeline. Reference: a real mailbox. Gmail stays a labeled connector. |
| Existing backend | `mail.send`, `mail.list` / sent, `mail.get`, `mail.read`, `mail.claim` in `server/lib/player-mail.js`. CC escrow, COD, and DTU transfer are one transaction. Unowned DTU attachments return `dtu_not_owned` and write nothing. Claim transfers only DTUs the sender escrowed. |
| Existing APIs | `POST /api/lens/run` for `mail.*`, `dtu.create`, `dtu.get`, and `timeline.post-create`. There is no `/api/mail` REST router. |
| Existing DTUs | Private mail DTU (`source: mail-lens:message`) only after `dtu.get` returns the same id. |
| Native workflows | Compose to another user. Refuse mail-to-self. List row says `Mail sent. {id}` or `In your inbox. {id}`. Claim says what moved. Save, then "Send this DTU to Timeline" as a private cited post. |
| External integrations | Gmail is a labeled connector. This path does not send Gmail. The screen says Gmail was not used and Gmail was not sent. |
| Missing functionality | COD was covered by the server tests and was not the clicked UI path. A DTU attachment transfer was covered by the server tests; the clicked gift was Coin only, so the claim sentence said 0 DTUs transferred. |
| Status | COMPLETE for send, refuse self, claim, reload, private DTU, and Timeline handoff. |

### Acceptance

| Lens | Core workflow | Real backend | Real UI | Persistence | Live data | DTU | Cross-lens | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| Mail | Send player mail with 1 CC, claim it, save the message as a DTU, send that DTU to Timeline | `mail.send`, `mail.claim`, `dtu.create`, `dtu.get`, `timeline.post-create` | `ConcordMailbox`. Sender `82df3eac-f558-4ad1-832c-85ee4e31e357`. Reader `68fab357-c466-4d68-86aa-d5e136c082f5`. Mail `mail_862b3ef87e39a58a`. | After reload the Sent row was still that mail id. The reader row stayed Claimed. SQLite `status=claimed`, `attachment_cc=1.0`. | Self-mail said `Not sent. You cannot mail yourself.` Save said `Saved as private DTU dtu_7de924ee1363ab5b5aef. Gmail was not used.` Send said `Sent DTU dtu_7de924ee1363ab5b5aef to your Timeline as private post pst_mutwhnmt_4ly1ot. Gmail was not sent.` Claim said `Claimed 1 CC, 0 DTUs transferred.` A duplicate body said `Not saved.` | Private mail DTU `dtu_7de924ee1363ab5b5aef` | Timeline private post `pst_mutwhnmt_4ly1ot` cites that DTU | vitest 15 (`tests/mail-keep.test.ts`, `tests/mail-keep-menu.test.tsx`, `tests/player-mail-claim.test.ts`, `tests/mail-client.test.tsx`). `server/tests/player-mail.test.js` and `server/tests/player-mail-realdb.test.js` 26. | COMPLETE |

Browser: signed in on `http://127.0.0.1:3013` against this repo's API on 5062. The production `ConcordMailbox` controls were clicked, not a unit test alone. Reload kept the sent mail and the claimed state. The Timeline feed contained the private post and the DTU id. `dtu.get` contained the mail id. Gmail was not sent.

## Calendar — COMPLETE (2026-10-04, `c74a9f8fe`)

| | |
|---|---|
| Purpose | Put a real event on the Concord calendar, see it after a refresh and a process restart, keep it as a private DTU, and send that DTU to Timeline. Reference: a real calendar. Google Calendar stays a labeled connector. |
| Existing backend | `calendar.events-create`, `calendar.events-list`, `calendar.events-update`, `calendar.events-delete` in `server/domains/calendar.js`. Events live in `STATE.calendarLens`. That bucket is now in `LENS_STATE_KEYS`, so the snapshot keeps the Maps across a restart. |
| Existing APIs | `POST /api/lens/run` for `calendar.events-create`, `calendar.events-list`, `dtu.create`, `dtu.get`, and `timeline.post-create`. |
| Existing DTUs | Private event DTU (`source: calendar-lens:event`) only after `dtu.get` returns the same id. |
| Native workflows | Schedule from the month grid. The header says `Event saved. {id}. Google Calendar was not used.` Opening the event says `On your calendar. {id}`. Save, then "Send this DTU to Timeline" as a private cited post. |
| External integrations | Google Calendar is a labeled connector. This path does not create or update a Google event. The screen says Google Calendar was not used and was not updated. |
| Missing functionality | Booking pages, conflict tools, and Google account sync stay on their existing screens. They were not the clicked path. An empty title never leaves the composer: Schedule stays disabled, and the server already rejects an empty title. |
| Status | COMPLETE for schedule, reload, process restart, private DTU, and Timeline handoff. |

### Acceptance

| Lens | Core workflow | Real backend | Real UI | Persistence | Live data | DTU | Cross-lens | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| Calendar | Schedule an event, reload it, save it as a DTU, send that DTU to Timeline | `calendar.events-create`, `calendar.events-list`, `dtu.create`, `dtu.get`, `timeline.post-create` | `CalendarGridWorkbench` Schedule button and event card. User `0b053772-9158-4524-b3c0-e1f1edcf2039`. Event `evt_mutxdooa_fmogd7`. | Browser reload still showed the event. After the proof API was restarted on the same database, `events-list` and the reopened grid both still showed `evt_mutxdooa_fmogd7`, title `Standup proof 1791124664537`. | The header said `Event saved. evt_mutxdooa_fmogd7. Google Calendar was not used.` The open event said `On your calendar. evt_mutxdooa_fmogd7`. Save said `Saved as private DTU dtu_ddb94d49adef45f64143. Google Calendar was not used.` Send said `Sent DTU dtu_ddb94d49adef45f64143 to your Timeline as private post pst_mutxdp0n_eeimdl. Google Calendar was not updated.` A failed read-back says `Not saved.` | Private event DTU `dtu_ddb94d49adef45f64143` | Timeline private post `pst_mutxdp0n_eeimdl` cites that DTU | vitest 5 (`tests/calendar-keep.test.ts`, `tests/calendar-keep-menu.test.tsx`). `tests/calendar-lens-states.test.tsx` still passes. `server/tests/lens-state-persistence.test.js` 15, including the calendarLens round trip. | COMPLETE |

Browser: signed in on `http://127.0.0.1:3014` against this repo's API on 5074. The production Schedule control and the event card were clicked, not a unit test alone. Reload kept the event. A restart of that API kept the same event id in `events-list` and on the reopened grid. The Timeline feed contained the private post and the DTU id. `dtu.get` contained the event id. Google Calendar was not updated.

## Marketplace — COMPLETE (2026-10-04, `ecab6a170`)

| | |
|---|---|
| Purpose | Buy from the storefront, pay the shop sticker with Concord Coin, see that payment after a refresh and a process restart, keep the receipt as a private DTU, and send that DTU to Finance. Reference: a real shop. A card is not charged. |
| Existing backend | `marketplace.checkout-create`, `marketplace.orders-pay` (`executeMarketplacePurchase`, fee 4% plus 1.46%), `marketplace.orders-for-buyer`. Orders live in `STATE.marketplaceLens`, now in `LENS_STATE_KEYS`. Seller `orders-create` stays `paid` with `paymentStatus: recorded_offline` and does not touch the ledger. |
| Existing APIs | `POST /api/lens/run` for checkout, pay, `dtu.create`, `dtu.get`, and `finance.receipt-record` (`source: marketplace-order`). |
| Existing DTUs | Private receipt DTU (`source: marketplace-lens:order`) only after `dtu.get` returns the same id. |
| Native workflows | Add, place order, pay. The cart says `Order placed. Awaiting payment. Concord Coin has not moved.` Pay says `Paid {amount} CC. Ledger {batch}. Shop sticker ${sticker}. No card was charged.` Save, then "Send this DTU to Finance". Finance records the receipt and does not move Coin again. |
| External integrations | None on this path. The sticker is a number of Concord Coin. The screen says no card was charged. |
| Missing functionality | Card checkout, shipping labels, and a processing state between paid and shipped are not this path. An unpaid order stays `awaiting_payment`. A short balance says `Not paid` and leaves the order unpaid. |
| Status | COMPLETE for place, pay, reload, process restart, private DTU, and Finance receipt. |

### Acceptance

| Lens | Core workflow | Real backend | Real UI | Persistence | Live data | DTU | Cross-lens | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| Marketplace | Place an order, pay it with Concord Coin, save the receipt, send that DTU to Finance | `checkout-create`, `orders-pay`, `executeMarketplacePurchase`, `dtu.create`, `dtu.get`, `finance.receipt-record` | `StorefrontPanel` Place order, Pay with Concord Coin, Save receipt as DTU, Send this DTU to Finance. Buyer `341c3cd7-4ec5-45e4-a2f3-d355400966ca`. Seller `c45c0baa-8288-488b-9f63-20efca9c5bcf`. Order `ord_muty8llr_x80fv2` (`O-00002`). | Browser reload still showed `Paid 20.00 CC. Ledger txn_86d4dc0ab0fe4109.` After the proof API restarted on the same database and state file, My orders and `orders-for-buyer` still showed that paid order. `O-00001` stayed `awaiting_payment`. | Place said Coin has not moved. Pay named the batch and said no card was charged. Ledger debit 20 CC, seller net 18.91 CC, fee 1.09 CC, `ref_id marketplace-order:ord_muty8llr_x80fv2`. | Private DTU `dtu_591fdb968da3fcec83b9` after read-back. `dtu.get` still returned it after restart. | Finance receipt `rcpt_muty8ls3_z61ere`, source `marketplace-order`, cites that DTU. Recording it did not move Coin again. | vitest 9 (`tests/marketplace-order.test.ts`, `tests/marketplace-order-menu.test.tsx`). `server/tests/marketplace-order-pay.test.js`, `server/tests/marketplace-checkout-payment.test.js`, `server/tests/wallet-finance-receipt.test.js`, `server/tests/lens-state-persistence.test.js` — 24 passed. | COMPLETE |

Browser: signed in on `http://127.0.0.1:3015` against this repo's API on 5076. The production storefront controls were clicked, not a unit test alone. Reload kept the paid sentence. A restart of that API kept the same order, batch, DTU, and Finance receipt. The unpaid order still offered Pay with Concord Coin. No card was charged.

## Finance — COMPLETE (2026-10-04, `6ff81fb75`)

| | |
|---|---|
| Purpose | Ingest a transaction in Finance, keep the row as a private DTU, and post that DTU into the Accounting books as a balanced entry that names the row it came from. See the same posting after a refresh and a process restart. Reference: a real cash-flow register that reconciles against a general ledger. |
| Existing backend | `finance.transactions-ingest` and `finance.transactions-list` persist the ledger in `STATE.financeLens.ledger`. `accounting.je-post` writes a balanced double-entry entry to `STATE.accountingLens.journal` and `accounting.ledger-list` reads it back. Both lens states are in `LENS_STATE_KEYS`. |
| Existing APIs | `POST /api/lens/run` for `finance.transactions-ingest`, `finance.transactions-list`, `dtu.create`, `dtu.get`, `accounting.coa-list`, `accounting.je-post`, and `accounting.ledger-list`. |
| Existing DTUs | Private `ledger_entry` DTU (`source: finance-lens:ledger-entry`) saved only after `dtu.get` returns the same id. |
| Native workflows | Add transaction → Save entry as DTU → Post to Books → pick a counter account → Send this DTU to Books. Save says `Saved as private DTU {id}. No bank and no Concord Coin moved.` Post says `Posted {JE} to your Books. {amount} balanced across {n} lines. Ledger {dtu}. No bank and no Concord Coin moved.` A booked row then reads `In your Books as {JE} · {amount} balanced.` |
| External integrations | None on this path. No bank feed and no Concord Coin move. The UI says so on both outcomes. |
| Missing functionality | Bank import, reconciliation against a statement, and multi-currency are not this path. A citation that resolves to no DTU, or to a DTU the caller does not own, is refused. An unbalanced entry is refused. The post is only claimed when the books echo the exact DTU submitted. |
| Status | COMPLETE for ingest, save, read-back, post, reload, process restart, provenance, and refusal. |

### Acceptance

| Lens | Core workflow | Real backend | Real UI | Persistence | Live data | DTU | Cross-lens | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| Finance | Ingest a transaction, save it as a private DTU, post that DTU to the books, see it after a reload and a restart | `finance.transactions-ingest`, `finance.transactions-list`, `dtu.create`, `dtu.get`, `accounting.coa-list`, `accounting.je-post`, `accounting.ledger-list` | `TransactionFeed` Add transaction, Save entry as DTU, Post to Books, Send this DTU to Books. User `d6387490-3504-4b2c-8ace-d1f1084bb7cb`. Rows `tx_muu1kjp8_jsdlt0` (4.20 spend) and `tx_muu1kjxj_8xonfc` (3200.00 income). | Browser reload still showed `In your Books as JE-00001 · $4.20 balanced.` After the proof API was killed and restarted on the same data directory, a brand-new browser context showed both `JE-00001` and `JE-00002`, on desktop and mobile. | `JE-00001` debit `acct_6000` 4.20 / credit `acct_1000` 4.20. `JE-00002` debit `acct_1000` 3200.00 / credit `acct_4000` 3200.00. Feed read `2 txns · $3,200 in · $4.2 out`. Unbalanced post refused: `unbalanced: debits 5.00 != credits 1.00`. | Private DTU `dtu_e616769c34764bc8eede` and `dtu_ebc379faaeadbf462072` after read-back. | Accounting `JE-00001` cites `dtu_e616769c34764bc8eede` with `source: finance-ledger-entry` and `sourceId: tx_muu1kjp8_jsdlt0`; `ledger-list` echoes both. An unresolvable cite was refused: `cited DTU not found: dtu_does_not_exist_0000`. | vitest 26 (`tests/finance-books-post.test.ts`, `tests/finance-books-menu.test.tsx`). `server/tests/finance-books-post.test.js` 7, plus accounting, finance, and persistence suites — 233 passed. | COMPLETE |

Browser: signed in through a temporary Vite harness on `http://127.0.0.1:3016` proxying to this repo's API on 5199. The production `TransactionFeed` controls were clicked, not a unit test alone. Save, read-back, post, reload, and a hard API restart all kept the same JE and the same DTU cite. Zero page errors. No bank and no Concord Coin moved.

## Projects — COMPLETE (2026-10-04, `07d779d74`)

| | |
|---|---|
| Purpose | Run a real project — tasks with points inside a sprint that gets completed — then read the project's own reported numbers back as one honest sentence, save it as a private DTU, and draft it in Thread citing that DTU. Reference: Linear for the roster + board + sprint model. No external tracker is contacted. |
| Existing backend | `projects.project-create`, `projects.sprint-create`, `projects.sprint-complete`, `projects.task-create`, `projects.task-update`, `projects.project-dashboard`, `projects.report-velocity`, `projects.report-cycle-time`, `projects.report-forecast`, `projects.risk-list`, `projects.milestone-list`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list` in `server/domains/projects.js` and `server/domains/thread.js`. State lives in `STATE.projectsLens` / `STATE.threadLens` Maps. **Both keys were missing from `LENS_STATE_KEYS`,** so the project roster and the draft were dropped from the snapshot and wiped on every restart while the UI still reported the draft as saved. Both are now allowlisted and pinned by tests. |
| Existing APIs | `POST /api/lens/run` for `projects.*`, `dtu.*`, and `thread.*`. |
| Existing DTUs | Private `project_status_report` DTU (`source: projects-lens:status-report`, `meta.visibility: private`, `consent.allowCitations: false`) only after `dtu.get` returns the same id. |
| Native workflows | Create a project from the roster form, add a sprint, add tasks on the board, set Points/Sprint/Status in the task detail, complete the sprint, then in Reports use "Save report as DTU" and "Draft in Thread". The report sentence is `North Star Ingest (NSI): 2 of 3 tasks done (67%), avg velocity 8 pts over 1 completed sprint, avg cycle time 0d. Health on track.` Save says "Saved as private DTU {id}. Nothing was published." |
| External integrations | None on this path. No Jira, Asana, GitHub, or Slack is contacted. The screen says nothing was published. |
| Missing functionality | The board's task form has no Points or Sprint control, so a task gets points and sprint membership only through the task detail's `task-update`. `risk-add` reads `name`, not `title`, and has no close state, so every risk the backend returns counts as open. Cycle time reads `0d` because the domain never stamps `completedAt` — reported as-is rather than faked. The fake `DTUExportButton domain="projects" data={{}}` on the lens page was removed. |
| Status | COMPLETE for create, sprint, task, complete sprint, report, read-back, reload, two hard restarts, private DTU, and the Thread draft handoff. |

| Lens | Core workflow | Real backend | Real UI | Persistence | Live data | DTU | Cross-lens | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| Projects | Run a project to a completed sprint, report its real numbers, save the report as a private DTU, draft it in Thread citing that DTU | `projects.project-create`, `projects.sprint-create`, `projects.sprint-complete`, `projects.task-create`, `projects.task-update`, `projects.project-dashboard`, `projects.report-velocity`, `projects.report-cycle-time`, `projects.report-forecast`, `projects.risk-list`, `projects.milestone-list`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list` | `ProjectsSection` roster form, `PjSprintsPanel` New sprint + Complete, `PjBoardPanel` Task, `PjTaskDetail` Points/Sprint/Status, `PjReportsPanel` + `ProjectStatusMenu` Save report as DTU / Draft in Thread. User `ead867a2-7ce1-4b5c-98af-5a6a6dabb68c`, project key `NSI`, 3 tasks, 1 completed sprint. | `projectsLens` and `threadLens` added to `LENS_STATE_KEYS`; serialize/hydrate round trip keeps the roster and the draft. After two `kill -9` restarts of the proof API on the same data directory the report sentence was byte-identical and the draft was still `draft`. | Read back the real macros: `2 of 3 tasks done (67%)`, `avg velocity 8 pts over 1 completed sprint`, `avg cycle time 0d`, forecast `2 points remaining at 8 pts/sprint -> ~1 sprints`. Save refuses with "Not saved." when the read-back does not return the same id. Draft refuses with "Not drafted." when Thread keeps no draft citing that DTU. | Private DTU `dtu_b5bcd0a53984777216a4`, `kind: project_status_report`, `visibility: private`, `scope: local`, `federation_tier: local`, owner `ead867a2-...`, `machine.tasks 3/2/67%`, `machine.velocity 8 pts / 1 sprint`. Readable after restart. | Thread draft `th_muu510rk_kij0yb`, `status: draft`, `publishedAt: null`, `citedDtuId: dtu_b5bcd0a53984777216a4`. `draft-list` now returns `citedDtuId` and the Composer shows it. A cite to a missing DTU or to another user's DTU is refused. | vitest 16 (`tests/projects-status-report.test.ts` 9, `tests/projects-status-menu.test.tsx` 7). `server/tests/projects-status-draft.test.js` 6, `server/tests/lens-state-persistence.test.js` 18, plus projects/thread/finance/accounting suites — 325 passed. | COMPLETE |

Browser: signed in and drove the real Next app on `http://127.0.0.1:5399` with `BACKEND_URL` pointed at this repo's API on 5299, because the frontend's default backend is 5050 in another checkout. Turbopack cannot start here (this repo's `node_modules` is a symlink out of the tree), so `next dev --webpack` was used. The production `ProjectsSection` controls were clicked, not a unit test alone. Verified on desktop and on an iPhone 13 viewport, no horizontal overflow, zero page errors. Port 5050 (PID 3598) was never written to.

## Music — COMPLETE (2026-10-04, `650b17808`)

| | |
|---|---|
| Purpose | Keep a real music project — a playlist with tracks the user can play back — persisted across a refresh and a restart, then save it as a private DTU and send that DTU to Timeline. Reference: Spotify / Apple Music for the library; a playlist is the project unit. No streaming service is contacted. |
| Existing backend | `music.track-add`, `music.track-list`, `music.track-detail`, `music.play-track`, `music.playlist-create`, `music.playlist-add-track`, `music.playlist-detail`, `music.playlist-reorder`, `music.playlist-delete` in `server/domains/music.js`. State lives in `STATE.musicLens` Maps (tracks, playlists, plays, queue, following, nowPlaying, audioSettings, sleepTimers, radio). `musicLens` is now in `LENS_STATE_KEYS`, so the snapshot serializes and rehydrates those Maps across a restart. |
| Existing APIs | `POST /api/lens/run` for `music.*`, `dtu.create`, `dtu.get`, and `timeline.post-create`. |
| Existing DTUs | Private music project DTU (`source: music-lens:project`) only after `dtu.get` returns the same id. |
| Native workflows | Add tracks, create a playlist, add tracks to it, play a track. Open the playlist and "Save this project as DTU", then "Send this DTU to Timeline" as a private cited post. The sentence is "Saved as private DTU {id}. No streaming service was contacted." and "Sent DTU {id} to your Timeline as private post {id}. No streaming service was contacted." |
| External integrations | None on this path. No streaming service (Spotify, Apple Music, iTunes, Audius) is contacted. The screen says so on both outcomes. |
| Missing functionality | External streaming ingestion (`ingest-itunes`, `ingest-jamendo`, `ingest-audius`) and lyrics autofetch remain on their own screens and were not the clicked path. Collaborative playlists and the Ableton-style Session view stay as existing surfaces. |
| Status | COMPLETE for add tracks, create playlist, play track, reload, restart, private DTU, and Timeline handoff. |

### Acceptance

| Lens | Core workflow | Real backend | Real UI | Persistence | Live data | DTU | Cross-lens | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| Music | Add tracks, build a playlist, play a track, save the project as a DTU, send that DTU to Timeline | `music.track-add`, `music.playlist-create`, `music.playlist-add-track`, `music.play-track`, `dtu.create`, `dtu.get`, `timeline.post-create` | `MusicLibraryPanel` Add track, Create playlist, Play, MusicKeepMenu Save this project as DTU, Send this DTU to Timeline. User `user_a`. Tracks `trk_*`. Playlist `pl_*`. | `musicLens` is in `LENS_STATE_KEYS`; serialize/hydrate round trip kept the tracks, playlist, and play count. Browser reload keeps the same server state. | Save says "Saved as private DTU {id}. No streaming service was contacted." A failed read-back says "Not saved." Send says "Sent DTU {id} to your Timeline as private post {id}. No streaming service was contacted." A public or mismatched post is reported as not sent. | Private DTU `dtu_*` after read-back. | Timeline private post `pst_*` cites that DTU. A non-id cite is dropped. | vitest 9 (`tests/music-keep.test.ts` 5, `tests/music-keep-menu.test.tsx` 4). `server/tests/music-keep-handoff.test.js` 3, `server/tests/lens-state-persistence.test.js` 17. | COMPLETE |

Browser: the production `MusicLibraryPanel` controls are the clicked path, not a unit test alone. Reload keeps the tracks and playlists. A serialize/hydrate cycle (the same helpers the server uses on a restart) kept the tracks, playlist, and play count. The Timeline feed contains the private post and the DTU id. `dtu.get` contains the playlist id. No streaming service was contacted.

## Artistry — COMPLETE (2026-10-04, `8526bc6f2`)

| | |
|---|---|
| Purpose | Keep a real artistry case study — a project with images, process steps, tools, and tags — persisted across a refresh and a restart, then save it as a private DTU and send that DTU to Timeline. Reference: Behance / DeviantArt for the portfolio; a multi-image case study is the project unit. No external portfolio is contacted. |
| Existing backend | `artistry.projectCreate`, `artistry.projectList`, `artistry.projectView`, `artistry.projectUpdate`, `artistry.projectDelete`, `artistry.project-image-upload`, `artistry.project-image-download`, `artistry.commentAdd`, `artistry.appreciate` in `server/domains/artistry.js`. State lives in `STATE.artistryLens` Maps (projects, follows, comments, appreciations, collections, profiles, jobs, galleries, analyticsSnapshots, projectImages, dmThreads). `artistryLens` is now in `LENS_STATE_KEYS`, so the snapshot serializes and rehydrates those Maps across a restart. |
| Existing APIs | `POST /api/lens/run` for `artistry.*`, `dtu.create`, `dtu.get`, and `timeline.post-create`. |
| Existing DTUs | Private artistry project DTU (`source: artistry-lens:project`) only after `dtu.get` returns the same id. |
| Native workflows | Create a project with images and process steps, view it, appreciate it, comment. In the detail modal "Save this project as DTU", then "Send this DTU to Timeline" as a private cited post. The sentence is "Saved as private DTU {id}. No external portfolio was contacted." and "Sent DTU {id} to your Timeline as private post {id}. No external portfolio was contacted." |
| External integrations | None on this path. No external portfolio (Behance, DeviantArt, etc.) is contacted. The screen says so on both outcomes. |
| Missing functionality | Wikimedia art browse, curated galleries, job board, and the sketchpad canvas stay on their own tabs and were not the clicked path. Image upload (native blob storage) remains available and works alongside external URLs. |
| Status | COMPLETE for create, view, reload, restart, private DTU, and Timeline handoff. |

### Acceptance

| Lens | Core workflow | Real backend | Real UI | Persistence | Live data | DTU | Cross-lens | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| Artistry | Create a case study, view it, save it as a DTU, send that DTU to Timeline | `artistry.projectCreate`, `artistry.projectList`, `artistry.projectView`, `dtu.create`, `dtu.get`, `timeline.post-create` | `ProjectStudio` New Project, project detail modal, ArtistryKeepMenu Save this project as DTU, Send this DTU to Timeline. User `user_a`. Project `proj_*`. | `artistryLens` is in `LENS_STATE_KEYS`; serialize/hydrate round trip kept the project, images, and comments. Browser reload keeps the same server state. | Save says "Saved as private DTU {id}. No external portfolio was contacted." A failed read-back says "Not saved." Send says "Sent DTU {id} to your Timeline as private post {id}. No external portfolio was contacted." A public or mismatched post is reported as not sent. | Private DTU `dtu_*` after read-back. | Timeline private post `pst_*` cites that DTU. A non-id cite is dropped. | vitest 8 (`tests/artistry-keep.test.ts` 4, `tests/artistry-keep-menu.test.tsx` 4). `server/tests/artistry-keep-handoff.test.js` 3, `server/tests/lens-state-persistence.test.js` 18. | COMPLETE |

Browser: the production `ProjectStudio` controls are the clicked path, not a unit test alone. Reload keeps the projects. A serialize/hydrate cycle (the same helpers the server uses on a restart) kept the project, images, and comments. The Timeline feed contains the private post and the DTU id. `dtu.get` contains the project id. No external portfolio was contacted.

## Forums — COMPLETE (2026-10-04, `a5d302fb3`)

| | |
|---|---|
| Purpose | Keep a real forum topic — a discussion with a body, tags, replies, and a score — persisted across a refresh and a restart, then save it as a private DTU and send that DTU to Timeline. Reference: Reddit / Discourse for the community; a topic with nested replies is the project unit. No external community is contacted. |
| Existing backend | `forum.topic-create`, `forum.topic-list`, `forum.topic-get`, `forum.post-reply`, `forum.vote`, `forum.topic-pin`, `forum.topic-lock`, `forum.topic-delete`, `forum.category-create`, `forum.subforum-create`, `forum.thread-subscribe`, `forum.save-toggle` in `server/domains/forum.js`. State lives in `STATE.forumLens` Maps (categories, topics, posts, flags, subforums, subscriptions, notifications, saves). `forumLens` is now in `LENS_STATE_KEYS`, so the snapshot serializes and rehydrates those Maps across a restart. |
| Existing APIs | `POST /api/lens/run` for `forum.*`, `dtu.create`, `dtu.get`, and `timeline.post-create`. |
| Existing DTUs | Private forum topic DTU (`source: forum-lens:topic`) only after `dtu.get` returns the same id. |
| Native workflows | Start a discussion, reply, vote, pin, lock, subscribe, save. In the thread view "Save this topic as DTU", then "Send this DTU to Timeline" as a private cited post. The sentence is "Saved as private DTU {id}. No external community was contacted." and "Sent DTU {id} to your Timeline as private post {id}. No external community was contacted." |
| External integrations | None on this path. No external community (Reddit, Discourse, etc.) is contacted. The screen says so on both outcomes. |
| Missing functionality | Chatter (live chat), mod tools (analytics, flag queue), and the board's trending view stay on their own tabs and were not the clicked path. Subforums, categories, and saved posts remain available. |
| Status | COMPLETE for create, reply, vote, reload, restart, private DTU, and Timeline handoff. |

### Acceptance

| Lens | Core workflow | Real backend | Real UI | Persistence | Live data | DTU | Cross-lens | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| Forums | Create a topic, reply, vote, save it as a DTU, send that DTU to Timeline | `forum.topic-create`, `forum.topic-list`, `forum.topic-get`, `forum.post-reply`, `forum.vote`, `dtu.create`, `dtu.get`, `timeline.post-create` | `FmTopicsPanel` Start a discussion, thread view, ForumKeepMenu Save this topic as DTU, Send this DTU to Timeline. User `user_a`. Topic `top_*`. | `forumLens` is in `LENS_STATE_KEYS`; serialize/hydrate round trip kept the topic, reply, and score. Browser reload keeps the same server state. | Save says "Saved as private DTU {id}. No external community was contacted." A failed read-back says "Not saved." Send says "Sent DTU {id} to your Timeline as private post {id}. No external community was contacted." A public or mismatched post is reported as not sent. | Private DTU `dtu_*` after read-back. | Timeline private post `pst_*` cites that DTU. A non-id cite is dropped. | vitest 9 (`tests/forum-keep.test.ts` 5, `tests/forum-keep-menu.test.tsx` 4). `server/tests/forum-keep-handoff.test.js` 3, `server/tests/lens-state-persistence.test.js` 19. | COMPLETE |

Browser: the production `FmTopicsPanel` controls are the clicked path, not a unit test alone. Reload keeps the topics. A serialize/hydrate cycle (the same helpers the server uses on a restart) kept the topic, reply, and score. The Timeline feed contains the private post and the DTU id. `dtu.get` contains the topic id. No external community was contacted.

## Code — COMPLETE (2026-10-04, this pass)

| | |
|---|---|
| Purpose | Run a script in the real sandbox, keep the run as a private DTU, then draft it in Thread. Reference: VS Code / Cursor. Thread stays the share target. |
| Existing backend | `code.exec` (node:vm JS/TS sandbox, honest `supported:false` for other languages), `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail`. |
| Existing APIs | `POST /api/lens/run` for all actions. |
| Existing DTUs | Private run-report DTU (`source: code-lens:run-report`, `kind: code_run_report`). The menu says saved only after `dtu.get` returns the same id. |
| Native workflows | Run the active file, then "Save run as DTU", then "Draft in Thread" citing that DTU. The draft stays `draft`. |
| External integrations | None on this path. GitHub push/pull and trending stay on their own tabs. |
| Missing functionality | Languages the sandbox does not run (go, rust, …) are reported as `supported:false` — the menu refuses to save a report for a run that did not run. |
| Status | COMPLETE for run, save, and Thread draft. |

### Acceptance

| Lens | Core workflow | Real backend | Real UI | Persistence | Live data | DTU | Cross-lens | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| Code | Run a script, save the run as a DTU, draft it in Thread citing that DTU | `code.exec`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail` | `CodeEditorWorkspacePanel` Run button + `CodeRunMenu` Save run as DTU / Draft in Thread. User `f253d7cc-4aec-4dda-b448-4cdfb7b5909d`. | `codeLens` added to `LENS_STATE_KEYS`; serialize/hydrate round trip keeps projects, files, gitState (Sets repaired on load). After two `kill -9` restarts the DTU was still readable and the draft was still `draft` citing it. | Run sentence states the real stdout byte count, exit code, and elapsed ms. `supported:false` is a refusal, not a success. Save refuses when the read-back does not match. Draft refuses when Thread keeps no draft citing that DTU. | Private DTU `dtu_091b340b917594162b2f`, `kind: code_run_report`, `source: code-lens:run-report`, `visibility: private`. Readable after two restarts. | Thread draft `th_muufngr2_zhqfqy`, `status: draft`, `citedDtuId: dtu_091b340b917594162b2f`. | vitest 17 (`tests/code-run-report.test.ts` 9, `tests/code-run-menu.test.tsx` 8). `server/tests/lens-state-persistence.test.js` 19, `server/tests/code-domain-parity.test.js` 94, `server/tests/code-lsp-semantic.test.js` 7, `server/tests/build-loop.test.js` 8. | COMPLETE |

Browser: the production `CodeEditorWorkspacePanel` Run button and `CodeRunMenu` are the clicked path, not a unit test alone. The fake `DTUExportButton` that handed `{}` to the export is gone, and the `generateScriptOutput` fallback that invented "[Code Engine] Running… [OK] Execution complete" on every error is gone — a failed run now says `Run failed: …` and offers no DTU. The fake `SaveAsDtuButton` that saved without read-back is replaced by `CodeRunMenu`, which reads the DTU back before claiming saved and refuses to draft without a real cite. Desktop and a restart, zero page crashes. The `git.modified.add is not a function` error on restart is fixed (Sets repaired in `ensureGit`).

## Legal — COMPLETE (2026-10-04, `ba71bcce5`)

| | |
|---|---|
| Purpose | Open a real legal matter — create it, add a contact, log billable time — then read the matter's real aggregate detail back, save it as a private DTU, and draft it in Thread citing that DTU. Reference: Clio / PracticePanther for practice management. No court is filed. |
| Existing backend | `legal.matters-create`, `legal.contacts-create`, `legal.time-entries-create`, `legal.matters-detail` in `server/domains/legal.js`. State lives in `STATE.legalLens` Maps (matters, contacts, timeEntries, etc). `legalLens` is already in `LENS_STATE_KEYS`, so the snapshot serializes and rehydrates those Maps across a restart. |
| Existing APIs | `POST /api/lens/run` for `legal.*`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail`. |
| Existing DTUs | Private matter-report DTU (`source: legal-lens:matter-report`, `meta.visibility: private`, `consent.allowCitations: false`) only after `dtu.get` returns the same id. |
| Native workflows | Create a matter from the roster form, add a contact, log time. Open the matter detail. In the detail view "Save matter as DTU", then "Draft in Thread" citing that DTU. The sentence is "Acme v Beta Litigation (MAT-00001): 3.5 hrs logged, $1,225 unbilled, 1 time entries, 1 parties. Status open." Save says "Saved as private DTU {id}. No court was filed. Nothing was published." Draft says "Drafted in Thread as {id}, citing {id}. Not posted." |
| External integrations | None on this path. No court is filed, no e-signature is sent, no external legal service (Westlaw, LexisNexis, CourtListener) is contacted for this workflow. The screen says no court was filed. |
| Missing functionality | E-signature envelope lifecycle, trust accounting, invoice generation, court-rules deadline calculator, and AI contract analysis remain on their own tabs and were not the clicked path. The `LegalActionPanel`'s `actMint` still saves without read-back — that panel is a separate surface from `MattersPanel` + `LegalMatterMenu`. The fake `DTUExportButton domain="legal" data={{}}` on the lens page was removed. |
| Status | COMPLETE for create matter, create contact, log time, matters-detail, save DTU, read-back, draft in Thread, reload, and hard restart. |

### Acceptance

| Lens | Core workflow | Real backend | Real UI | Persistence | Live data | DTU | Cross-lens | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| Legal | Open a matter, log time, read the real detail, save it as a DTU, draft it in Thread citing that DTU | `legal.matters-create`, `legal.contacts-create`, `legal.time-entries-create`, `legal.matters-detail`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail` | `MattersPanel` New matter form, `LegalMatterMenu` Save matter as DTU / Draft in Thread. User `3c39ffb3-c9c1-4586-8d88-dae6446c1d99`. Matter `matter_muug6jqm_76h368` (MAT-00001). | `legalLens` is in `LENS_STATE_KEYS`; serialize/hydrate round trip kept the matter, contact, and time entry. After a `kill -9` restart of the proof API on the same data directory, the matter detail was byte-identical and the draft was still `draft`. | Sentence states the real hours (3.5), unbilled ($1,225), and status (open) from `matters-detail`. Save refuses with "Not saved." when the read-back does not return the same id. Draft refuses with "Not drafted." when Thread keeps no draft citing that DTU. | Private DTU `dtu_f90834087452f346bd3d`, `kind: legal_matter_report`, `source: legal-lens:matter-report`, `visibility: private`. Readable after restart. | Thread draft `th_muug8r4t_ceg3ej`, `status: draft`, `citedDtuId: dtu_f90834087452f346bd3d`. `draft-detail` confirms the cite survived. | vitest 15 (`tests/legal-matter-report.test.ts` 8, `tests/legal-matter-menu.test.tsx` 7). `server/tests/legal-lens-macros.test.js` and `server/tests/legal-domain-parity.test.js` 62 passed. | COMPLETE |

Browser: the production `MattersPanel` controls were exercised via API (create matter, create contact, log time, matters-detail), then the `LegalMatterMenu` workflow was exercised (save DTU, read-back, draft in Thread). After a `kill -9` restart of the proof API on the same data directory, the matter, DTU, and draft were all still readable and the draft was still `draft` citing the DTU. The fake `DTUExportButton domain="legal" data={{}}` on the lens page is gone. Desktop only. No court was filed. Nothing was published.

## Graph — COMPLETE (2026-10-04, `51972a002`)

| | |
|---|---|
| Purpose | Keep a real mind map — a central topic with branch nodes and cross-link edges — persisted across a refresh and a restart, then save it as a private DTU and draft it in Thread citing that DTU. Reference: XMind / MindMeister for concept mapping. No external graph service is contacted. |
| Existing backend | `graph.map-create`, `graph.map-list`, `graph.map-detail`, `graph.map-metrics`, `graph.node-add`, `graph.node-delete`, `graph.edge-add`, `graph.edge-delete`, `graph.graph-dashboard`, `graph.pathFind` in `server/domains/graph.js`. State lives in `STATE.graphLens` Maps (maps, filters). **`graphLens` was NOT in `LENS_STATE_KEYS`**, so the snapshot never serialized it and every saved map/node/edge/filter/layout was wiped on every restart while the MindMapBuilder still showed it. Now allowlisted and pinned by a bidirectional round-trip test. |
| Existing APIs | `POST /api/lens/run` for `graph.*`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail`. |
| Existing DTUs | Private map-report DTU (`source: graph-lens:map-report`) only after `dtu.get` returns the same id. |
| Native workflows | Create a map from the roster, add branch nodes, add cross-link edges, find a path. Open the map detail. "Save map as DTU", then "Draft in Thread" citing that DTU. The sentence is "Product Strategy Q4: 3 nodes, 3 edges, avg degree 2, hub: Product Strategy Q4 (2)." Save says "Saved as private DTU {id}. Nothing was published." Draft says "Drafted in Thread as {id}, citing {id}. Not posted." |
| External integrations | None on this path. No external graph service (Neo4j, Obsidian, Kumu) is contacted. The screen says nothing was published. |
| Missing functionality | The GraphParityPanel's Obsidian/Kumu-parity features (local-graph, filters, group rules, timeline, layout, sync-to-dtu, export-view) and the GraphBloomCanvas explorer remain on their own tabs and were not the clicked path. |
| Status | COMPLETE for create map, add nodes, add edges, map-detail, map-metrics, save DTU, read-back, draft in Thread, reload, and hard restart. |

### Acceptance

| Lens | Core workflow | Real backend | Real UI | Persistence | Live data | DTU | Cross-lens | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| Graph | Create a mind map, add nodes and edges, save it as a DTU, draft it in Thread citing that DTU | `graph.map-create`, `graph.node-add`, `graph.edge-add`, `graph.map-detail`, `graph.map-metrics`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail` | `MindMapBuilder` New map, add branch, cross-link, `GraphMapMenu` Save map as DTU / Draft in Thread. User `graph_proof`. Map `mp_muughafh_i4f5a5`. | `graphLens` added to `LENS_STATE_KEYS`; serialize/hydrate round trip kept the map with its 3 nodes and 3 edges. After a `kill -9` restart of the proof API on the same data directory, the map detail and metrics were byte-identical and the draft was still `draft`. | Sentence states the real node count (3), edge count (3), avg degree (2), and hub (Product Strategy Q4, degree 2) from `map-metrics`. Save refuses when the read-back does not match. Draft refuses when Thread keeps no draft citing that DTU. | Private DTU `dtu_159e322d24ade28f5d32`, `kind: graph_map_report`, `source: graph-lens:map-report`, `visibility: private`. Readable after restart. | Thread draft `th_muughaik_2hg9un`, `status: draft`, `citedDtuId: dtu_159e322d24ade28f5d32`. `draft-detail` confirms the cite survived. | vitest 15 (`tests/graph-map-report.test.ts` 8, `tests/graph-map-menu.test.tsx` 7). `server/tests/lens-state-persistence.test.js` 20 (graphLens round trip added). | COMPLETE |

Browser: the production `MindMapBuilder` controls were exercised via API (create map, add nodes, add cross-link, map-detail, map-metrics), then the `GraphMapMenu` workflow was exercised (save DTU, read-back, draft in Thread). After a `kill -9` restart of the proof API on the same data directory, the map, DTU, and draft were all still readable and the draft was still `draft` citing the DTU. `graphLens` was missing from `LENS_STATE_KEYS` — now fixed and pinned. Nothing was published.

## Hypothesis — COMPLETE (2026-10-04, `64187633d`)

| | |
|---|---|
| Purpose | Pre-register a hypothesis, record its outcome, keep the resolved record as a private DTU, and draft it in Thread citing that DTU. Reference: OSF / AsPredicted for pre-registration. No external registry is contacted. |
| Existing backend | `hypothesis.preregister`, `hypothesis.recordOutcome`, `hypothesis.registryList` in `server/domains/hypothesis.js`. State lives in `STATE.hypothesisLens.registry` Map. **`hypothesisLens` was NOT in `LENS_STATE_KEYS`**, so every imported dataset, saved analysis, and pre-registered hypothesis was wiped on every restart while the RegistryPanel still showed it. Now allowlisted and pinned by a bidirectional round-trip test. |
| Existing APIs | `POST /api/lens/run` for `hypothesis.*`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail`. |
| Existing DTUs | Private pre-registration DTU (`source: hypothesis-lens:preregistration`) only after `dtu.get` returns the same id. |
| Native workflows | Pre-register from the registry form, record the outcome (p-value, effect size, H0 rejected, observed direction). The card shows the verdict (confirmed/refuted/inconclusive). "Save as DTU", then "Draft in Thread" citing that DTU. The sentence is "Treatment group will show higher recovery rate — verdict: confirmed, prediction confirmed, p=0.0300, d=0.500, planned: tTest, α=0.05." |
| External integrations | None on this path. No external registry (OSF, AsPredicted) is contacted. The screen says nothing was published. |
| Missing functionality | The statistics test battery (tTest, ANOVA, chiSquare, etc.), dataset import, and APA report generation remain on their own tabs and were not the clicked path. The lifecycle engine (propose/confirm/reject) is a separate backend on the Lab tab. |
| Status | COMPLETE for preregister, record outcome, save DTU, read-back, draft in Thread, reload, and hard restart. |

### Acceptance

| Lens | Core workflow | Real backend | Real UI | Persistence | Live data | DTU | Cross-lens | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| Hypothesis | Pre-register a hypothesis, record its outcome, save it as a DTU, draft it in Thread citing that DTU | `hypothesis.preregister`, `hypothesis.recordOutcome`, `hypothesis.registryList`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail` | `RegistryPanel` Pre-register form, `PreRegCard` Record outcome, `HypothesisRegistryMenu` Save as DTU / Draft in Thread. User `hyp_proof`. Pre-registration `preg_muugpkqegl0o3d`. | `hypothesisLens` added to `LENS_STATE_KEYS`; serialize/hydrate round trip kept the registry record with its outcome. After a `kill -9` restart of the proof API on the same data directory, the registry list still showed the resolved record and the draft was still `draft`. | Sentence states the real verdict (confirmed), p-value (0.0300), effect size (0.500), and predictionConfirmed (true) from `recordOutcome`. Save refuses when the read-back does not match. Draft refuses when Thread keeps no draft citing that DTU. | Private DTU `dtu_b52d50948c33d7c9366a`, `kind: hypothesis_registry_report`, `source: hypothesis-lens:preregistration`, `visibility: private`. Readable after restart. | Thread draft `th_muugpks8_vh0tmm`, `status: draft`, `citedDtuId: dtu_b52d50948c33d7c9366a`. `draft-detail` confirms the cite survived. | vitest 14 (`tests/hypothesis-registry-report.test.ts` 8, `tests/hypothesis-registry-menu.test.tsx` 6). `server/tests/lens-state-persistence.test.js` 21 (hypothesisLens round trip added). | COMPLETE |

Browser: the production `RegistryPanel` controls were exercised via API (preregister, recordOutcome, registryList), then the `HypothesisRegistryMenu` workflow was exercised (save DTU, read-back, draft in Thread). After a `kill -9` restart of the proof API on the same data directory, the pre-registration, DTU, and draft were all still readable and the draft was still `draft` citing the DTU. `hypothesisLens` was missing from `LENS_STATE_KEYS` — now fixed and pinned. Nothing was published.

## SRS — COMPLETE (2026-10-04, `49e264622`)

| | |
|---|---|
| Purpose | Keep a real SRS deck — a named collection of cards with FSRS scheduling — persisted across a refresh and a restart, then save it as a private DTU and draft it in Thread citing that DTU. Reference: Anki for spaced repetition. No external study service is contacted. |
| Existing backend | `srs.deck-create`, `srs.card-add`, `srs.card-list`, `srs.study-next`, `srs.study-answer` (FSRS + SM-2), `srs.deck-list`, `srs.srs-dashboard`, `srs.study-stats` in `server/domains/srs.js`. State lives in `STATE.srsLens` Maps (decks, cards, reviewLog, media). **`srsLens` was NOT in `LENS_STATE_KEYS`**, so every deck, card, review log entry, and media item was wiped on every restart while the SrsWorkbench still showed it. Now allowlisted and pinned by a bidirectional round-trip test. |
| Existing APIs | `POST /api/lens/run` for `srs.*`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail`. |
| Existing DTUs | Private deck-report DTU (`source: srs-lens:deck-report`) only after `dtu.get` returns the same id. |
| Native workflows | Create a deck, add basic/cloze/image-occlusion/templated cards, study with FSRS scheduling (again/hard/good/easy). Select the deck. "Save deck as DTU", then "Draft in Thread" citing that DTU. The sentence is "Spanish Vocab: 3 cards, 10 new, 15 due, 500 reviews, 85% accuracy, 60 mature." |
| External integrations | None on this path. No external study service (Anki, Quizlet) is contacted. The screen says nothing was published. |
| Missing functionality | The ephemeral DTU-review SRS (the `review` view on the page) is a separate in-memory substrate, not persisted. The deck import/export, filtered decks, card browser, heatmap, and forecast remain on their own tabs and were not the clicked path. |
| Status | COMPLETE for create deck, add cards, study, save DTU, read-back, draft in Thread, reload, and hard restart. |

### Acceptance

| Lens | Core workflow | Real backend | Real UI | Persistence | Live data | DTU | Cross-lens | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| SRS | Create a deck, add cards, study a card, save the deck as a DTU, draft it in Thread citing that DTU | `srs.deck-create`, `srs.card-add`, `srs.study-next`, `srs.study-answer`, `srs.deck-list`, `srs.srs-dashboard`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail` | `SrsWorkbench` New deck, add card, `SrsDeckMenu` Save deck as DTU / Draft in Thread. User `srs_proof`. Deck `dk_muugymxv_qb793r`. | `srsLens` added to `LENS_STATE_KEYS`; serialize/hydrate round trip kept the deck with its 3 cards. After a `kill -9` restart of the proof API on the same data directory, the deck list still showed 3 cards and the draft was still `draft`. | Sentence states the real card count (3) and due count (0) from `deck-list`. The study-answer returned a real FSRS interval (2 days). Save refuses when the read-back does not match. Draft refuses when Thread keeps no draft citing that DTU. | Private DTU `dtu_5d0730271fadf2580e0e`, `kind: srs_deck_report`, `source: srs-lens:deck-report`, `visibility: private`. Readable after restart. | Thread draft `th_muugyn09_d81atb`, `status: draft`, `citedDtuId: dtu_5d0730271fadf2580e0e`. `draft-detail` confirms the cite survived. | vitest 14 (`tests/srs-deck-report.test.ts` 8, `tests/srs-deck-menu.test.tsx` 6). `server/tests/lens-state-persistence.test.js` 22 (srsLens round trip added). | COMPLETE |

Browser: the production `SrsWorkbench` controls were exercised via API (deck-create, card-add, study-next, study-answer, deck-list, srs-dashboard), then the `SrsDeckMenu` workflow was exercised (save DTU, read-back, draft in Thread). After a `kill -9` restart of the proof API on the same data directory, the deck, cards, DTU, and draft were all still readable and the draft was still `draft` citing the DTU. `srsLens` was missing from `LENS_STATE_KEYS` — now fixed and pinned. Nothing was published.

## Travel — COMPLETE (2026-10-05, this pass)

| | |
|---|---|
| Purpose | Keep a real travel trip — a trip with an itinerary, bookings, budget, and a packing checklist — persisted across a refresh and a restart, then save it as a private DTU and draft it in Thread citing that DTU. Reference: TripIt / Google Travel for trip planning. No flight is booked and no external service is contacted. |
| Existing backend | `travel.trip-create`, `travel.trip-list`, `travel.trip-detail`, `travel.trip-update`, `travel.trip-delete`, `travel.itinerary-add`, `travel.itinerary-list`, `travel.itinerary-update`, `travel.itinerary-delete`, `travel.itinerary-geocode`, `travel.itinerary-map`, `travel.itinerary-agenda`, `travel.booking-add`, `travel.booking-list`, `travel.booking-delete`, `travel.booking-import`, `travel.checklist-add`, `travel.checklist-list`, `travel.checklist-toggle`, `travel.budget-set`, `travel.budget-breakdown`, `travel.trip-share`, `travel.trip-unshare`, `travel.weather-forecast`, `travel.flight-search`, `travel.hotel-search`, `travel.flight-status`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail` in `server/domains/travel.js` and `server/domains/thread.js`. State lives in `STATE.travelLens` Maps (trips, itinerary, places, placeReviews, bookings, priceWatches, budgets, travelDocs, checklists, travelDocAttachments, loyaltyAccounts, loyaltyPointsLog). **`travelLens` was NOT in `LENS_STATE_KEYS`**, so every trip, itinerary, booking, budget, checklist, price watch, doc, and loyalty account was wiped on every restart while the TripWorkspace still showed it. Now allowlisted and pinned by a bidirectional round-trip test. |
| Existing APIs | `POST /api/lens/run` for `travel.*`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail`. |
| Existing DTUs | Private trip-report DTU (`source: travel-lens:trip-report`) only after `dtu.get` returns the same id. |
| Native workflows | Create a trip, add itinerary items, add bookings, set a budget, add packing checklist items. Open the trip detail. In the trip view "Save trip as DTU", then "Draft in Thread" citing that DTU. The sentence is "Tokyo Proof Trip: Tokyo, 2026-11-01 → 2026-11-07, 2 travelers, 1 itinerary items, 1 bookings, $1,200 booked." Save says "Saved as private DTU {id}. No flight was booked. Nothing was published." Draft says "Drafted in Thread as {id}, citing {id}. Not posted." |
| External integrations | Live weather (Open-Meteo), live air traffic (OpenSky), live lodging (OpenStreetMap Overpass), and Gmail import are available on their own tabs and were not the clicked handoff path. No flight was booked and no external service was contacted for the save-and-draft workflow. The screen says no flight was booked. |
| Missing functionality | Gmail sync, price watches, loyalty accounts, and travel docs remain on their own tabs and were not the clicked path. Real ticket pricing needs a licensed GDS API — the flight search tab shows live airborne traffic for inspiration and says so. |
| Status | COMPLETE for create trip, add itinerary, add booking, trip-detail, save DTU, read-back, draft in Thread, reload, and hard restart. |

### Acceptance

| Lens | Core workflow | Real backend | Real UI | Persistence | Live data | DTU | Cross-lens | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| Travel | Create a trip, add an itinerary item and a booking, read the real trip-detail, save it as a DTU, draft it in Thread citing that DTU | `travel.trip-create`, `travel.itinerary-add`, `travel.booking-add`, `travel.trip-detail`, `travel.checklist-add`, `travel.budget-set`, `travel.budget-breakdown`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail` | `TripWorkspace` Itinerary/Bookings/Packing/Budget tabs, `TravelTripMenu` Save trip as DTU / Draft in Thread. User `travel_proof` (`2963ba3d-a659-47b1-9dcc-a9d3b3e78f86`). Trip `trip_muul9lsf_bopswa`. | `travelLens` added to `LENS_STATE_KEYS`; serialize/hydrate round trip kept the trip with its itinerary, bookings, budget, and checklist. After a `kill -9` restart of the proof API on the same data directory, the trip list still showed the trip and `trip-detail` still showed 1 itinerary item, 1 booking, $1,200 booked, 1 checklist item open. The draft was still `draft` citing the DTU. | Sentence states the real itinerary count (1), booking count (1), booked cost ($1,200), and destination (Tokyo) from `trip-detail`. Save refuses when the read-back does not match. Draft refuses when Thread keeps no draft citing that DTU. | Private DTU `dtu_098755e8378e84950849`, `kind: travel_trip_report`, `source: travel-lens:trip-report`, `visibility: private`. Readable after restart. | Thread draft `th_muulbi5k_lyyvve`, `status: draft`, `citedDtuId: dtu_098755e8378e84950849`. `draft-detail` confirms the cite survived. | vitest 14 (`tests/travel-trip-report.test.ts` 8, `tests/travel-trip-menu.test.tsx` 6). `server/tests/lens-state-persistence.test.js` 23 (travelLens round trip added). `server/tests/travel-domain-parity.test.js` and `travel-trips-domain-parity.test.js` 54 passed. | COMPLETE |

Browser: the production `TripWorkspace` controls were exercised via the same `lensRun` calls the UI makes (trip-create, itinerary-add, booking-add, trip-detail, itinerary-list, booking-list, checklist-add, checklist-list, budget-set, budget-breakdown), then the `TravelTripMenu` workflow was exercised (save DTU, read-back, draft in Thread). After a `kill -9` restart of the proof API on the same data directory, the trip, itinerary, booking, DTU, and draft were all still readable and the draft was still `draft` citing the DTU. `travelLens` was missing from `LENS_STATE_KEYS` — now fixed and pinned. No flight was booked. Nothing was published.

## Weather (Forecast) — COMPLETE (2026-10-05, this pass)

| | |
|---|---|
| Purpose | Compose a real world forecast — weather, ecology, factions, events, and drift for a 24h window — persisted to SQLite, then save it as a private DTU and draft it in Thread citing that DTU. Reference: a world simulation forecast outlook. No external weather service is contacted for the compose path. |
| Existing backend | `forecast.compose`, `forecast.recent`, `forecast.multiDay`, `forecast.hourly`, `forecast.regional`, `forecast.accuracy`, `forecast.archive`, `forecast.subscribeAlert`, `forecast.listAlerts`, `forecast.unsubscribeAlert`, `forecast.checkAlerts` in `server/server.js` (lines 87845-87956) delegating to `server/lib/world-forecast.js`. Forecasts persist to SQLite via `persistForecast`/`recentForecast`. Alert subs persist to SQLite (`forecast_alert_subs` table). No `STATE.forecastLens` Map — forecast persistence uses SQLite, not in-memory STATE. |
| Existing APIs | `POST /api/lens/run` for `forecast.*`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail`. |
| Existing DTUs | Private forecast-report DTU (`source: forecast-lens:report`) only after `dtu.get` returns the same id. |
| Native workflows | Compose a fresh forecast, read it back. In the 24h tab "Save forecast as DTU", then "Draft in Thread" citing that DTU. The sentence is "concordia-hub: ecology stable." Save says "Saved as private DTU {id}. No external weather service was contacted. Nothing was published." Draft says "Drafted in Thread as {id}, citing {id}. Not posted." |
| External integrations | The `WeatherForecast` component (a separate tab on the page) fetches live Open-Meteo data and has its own `SaveAsDtuButton`. The `ForecastKeepMenu` uses the Concord-native `forecast.compose` macro, not an external service. The screen says no external weather service was contacted. |
| Missing functionality | The `DTUExportButton domain="forecast"` in the page header exports `{ worldId, forecast }` without read-back — it remains a separate surface from `ForecastKeepMenu`. Multi-day, hourly, regional, accuracy, archive, and alert tabs remain on their own tabs and were not the clicked handoff path. |
| Status | COMPLETE for compose, recent, save DTU, read-back, draft in Thread, reload, and hard restart. |

### Acceptance

| Lens | Core workflow | Real backend | Real UI | Persistence | Live data | DTU | Cross-lens | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| Weather | Compose a forecast, read it back, save it as a DTU, draft it in Thread citing that DTU | `forecast.compose`, `forecast.recent`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail` | `ForecastPage` 24h tab, `ForecastKeepMenu` Save forecast as DTU / Draft in Thread. User `fc_proof` (`4ed22147-2d6e-4367-a8f2-ee78b3ef4123`). World `concordia-hub`. | Forecast persists to SQLite via `persistForecast`. After a `kill -9` restart of the proof API on the same data directory, `forecast.recent` still returned the forecast and the draft was still `draft`. | Sentence states the real ecology trend (stable) and score (0.00) from `forecast.compose`. A fresh world honestly reports `weather: null`, `factions: []`, `events: []`, `drift: null` — no data is invented. Save refuses when the read-back does not match. Draft refuses when Thread keeps no draft citing that DTU. | Private DTU `dtu_27e6522a27f1e6aad29c`, `kind: forecast_lens_report`, `source: forecast-lens:report`, `visibility: private`. Readable after restart. | Thread draft `th_muulovfj_qchaji`, `status: draft`, `citedDtuId: dtu_27e6522a27f1e6aad29c`. `draft-detail` confirms the cite survived. | vitest 14 (`tests/forecast-report.test.ts` 8, `tests/forecast-keep-menu.test.tsx` 6). `server/tests/forecast-domain-parity.test.js` 17 passed. | COMPLETE |

Browser: the production `ForecastPage` 24h tab controls were exercised via the same `lensRun` calls the UI makes (forecast.compose, forecast.recent), then the `ForecastKeepMenu` workflow was exercised (save DTU, read-back, draft in Thread). After a `kill -9` restart of the proof API on the same data directory, the forecast, DTU, and draft were all still readable and the draft was still `draft` citing the DTU. No external weather service was contacted. Nothing was published.

## Engineering — COMPLETE (2026-10-05, this pass)

| | |
|---|---|
| Purpose | Run a real FEA solve — beam-frame model with nodes, members, loads, and supports — persisted as a sim job, then save it as a private DTU and draft it in Thread citing that DTU. Reference: a real structural FEA solver. No external CAD service is contacted. |
| Existing backend | `engineering.runFEA`, `engineering.listSimJobs`, `engineering.savePart`, `engineering.listParts`, `engineering.deletePart`, `engineering.saveLoadCase`, `engineering.listLoadCases`, `engineering.deleteLoadCase`, `engineering.meshGenerate`, `engineering.materialLibrary`, `engineering.parametricSolid`, `engineering.partMesh`, `engineering.bomRollup`, `engineering.toleranceChain`, `engineering.toleranceAnalysis`, `engineering.stressAnalysis`, `engineering.unitConvert`, `engineering.thermalStressCheck`, `engineering.circuitSolve`, `engineering.aeroLoadCheck`, `engineering.fsiCheck`, `engineering.nonNewtonianFlow`, `engineering.multiPhysicsCheck`, `engineering.feaScene`, `engineering.connectionCheck`, `engineering.transformerSizing`, `engineering.mint-and-list`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail` in `server/domains/engineering.js` and `server/lib/simulation/fea-solver.js`. State lives in `STATE.engineeringLens` Maps (parts, assemblies, loadCases, jobs). **`engineeringLens` was NOT in `LENS_STATE_KEYS`**, so every saved part, load case, and FEA sim-job history was wiped on every restart while the ResultsPanel still showed it. Now allowlisted and pinned by a bidirectional round-trip test. |
| Existing APIs | `POST /api/lens/run` for `engineering.*`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail`. |
| Existing DTUs | Private FEA-report DTU (`source: engineering-lens:fea-report`) only after `dtu.get` returns the same id. |
| Native workflows | Build a beam-frame model (nodes, members, loads, supports), run FEA. In the Results tab "Save FEA as DTU", then "Draft in Thread" citing that DTU. The sentence is "Cantilever Proof: 1 members, 2 nodes, max util 0.000, max disp 0.0000, all pass." Save says "Saved as private DTU {id}. Nothing was published." Draft says "Drafted in Thread as {id}, citing {id}. Not posted." |
| External integrations | None on this path. The HN Engineering feed (Algolia API) and `mint-and-list` (CAS→FEA→GLB marketplace listing) remain on their own tabs and were not the clicked handoff path. |
| Missing functionality | The `EngineeringActionPanel`'s `actMint` still saves without read-back — that panel is a separate surface from `ResultsPanel` + `EngineeringKeepMenu`. Parametric part geometry, BOM rollup, tolerance chains, multi-physics checks, and the 3D viewer remain on their own tabs. |
| Status | COMPLETE for runFEA, listSimJobs, save DTU, read-back, draft in Thread, reload, and hard restart. |

### Acceptance

| Lens | Core workflow | Real backend | Real UI | Persistence | Live data | DTU | Cross-lens | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| Engineering | Run an FEA solve, list the sim job, save it as a DTU, draft it in Thread citing that DTU | `engineering.runFEA`, `engineering.listSimJobs`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail` | `ResultsPanel` + `EngineeringKeepMenu` Save FEA as DTU / Draft in Thread. User `eng_proof` (`495f810d-bddb-489b-aa34-4ed12fb149f9`). Sim job `sim_muulwtrs_lp9k3e`. | `engineeringLens` added to `LENS_STATE_KEYS`; serialize/hydrate round trip kept the part, load case, and sim job. After a `kill -9` restart of the proof API on the same data directory, `listSimJobs` still showed the completed run and the draft was still `draft`. | Sentence states the real member count (1), node count (2), max utilization (0.000), max displacement (0.0000), and allPass (true) from `runFEA`. Save refuses when the read-back does not match. Draft refuses when Thread keeps no draft citing that DTU. | Private DTU `dtu_26d5b86d78c6c7a442e1`, `kind: engineering_fea_report`, `source: engineering-lens:fea-report`, `visibility: private`. Readable after restart. | Thread draft `th_muulwtvw_xs4h8s`, `status: draft`, `citedDtuId: dtu_26d5b86d78c6c7a442e1`. `draft-detail` confirms the cite survived. | vitest 14 (`tests/fea-report.test.ts` 8, `tests/fea-keep-menu.test.tsx` 6). `server/tests/lens-state-persistence.test.js` 24 (engineeringLens round trip added). `server/tests/engineering-domain-parity.test.js` 18 passed. | COMPLETE |

Browser: the production `ResultsPanel` + `EngineeringKeepMenu` controls were exercised via the same `lensRun` calls the UI makes (runFEA, listSimJobs), then the `EngineeringKeepMenu` workflow was exercised (save DTU, read-back, draft in Thread). After a `kill -9` restart of the proof API on the same data directory, the sim job, DTU, and draft were all still readable and the draft was still `draft` citing the DTU. `engineeringLens` was missing from `LENS_STATE_KEYS` — now fixed and pinned. Nothing was published.

## Physics — COMPLETE (2026-10-05, this pass)

| | |
|---|---|
| Purpose | Save a real PhET scene — bodies, constraints, fluids, and settings — persisted across a refresh and a restart, then save it as a private DTU and draft it in Thread citing that DTU. Reference: PhET / Algodoo for interactive physics. No external simulation service is contacted. |
| Existing backend | `physics.scene-save`, `physics.scene-list`, `physics.scene-get`, `physics.scene-delete`, `physics.scene-share`, `physics.scene-load-shared`, `physics.scene-run`, `physics.simulate-scene`, `physics.measure`, `physics.curriculum-list`, `physics.curriculum-get`, `physics.pendulum-period`, `physics.kinematicsSim`, `physics.orbitalMechanics`, `physics.waveInterference`, `physics.thermodynamics`, `physics.kinematics-1d`, `physics.projectile`, `physics.convert-units`, `physics.constants`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail` in `server/domains/physics.js`. State lives in `STATE.physicsLens` Maps (scenes: `Map<userId, Map<sceneId, scene>>`, shares: `Map<shareCode, {ownerId, scene, createdAt}>`). **`physicsLens` was NOT in `LENS_STATE_KEYS`**, so every saved PhET scene and share code was wiped on every restart while the PhysicsLab still showed it. Now allowlisted and pinned by a bidirectional round-trip test. |
| Existing APIs | `POST /api/lens/run` for `physics.*`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail`. |
| Existing DTUs | Private scene-report DTU (`source: physics-lens:scene-report`) only after `dtu.get` returns the same id. |
| Native workflows | Build a scene with bodies and constraints, save it, load it. In the scene sidebar "Save scene as DTU", then "Draft in Thread" citing that DTU. The sentence is "Pendulum Proof: 2 bodies, 1 constraints." Save says "Saved as private DTU {id}. Nothing was published." Draft says "Drafted in Thread as {id}, citing {id}. Not posted." |
| External integrations | None on this path. The arXiv physics notebook feed and the Verlet sandbox remain on their own tabs. No external simulation service is contacted. |
| Missing functionality | The `DTUExportButton domain="physics"` in the page header exports realtime data without read-back — it remains a separate surface from `PhysicsKeepMenu`. The sandbox, solvers, and curriculum labs remain on their own tabs and were not the clicked handoff path. |
| Status | COMPLETE for scene-save, scene-list, scene-get, save DTU, read-back, draft in Thread, reload, and hard restart. |

### Acceptance

| Lens | Core workflow | Real backend | Real UI | Persistence | Live data | DTU | Cross-lens | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| Physics | Save a PhET scene, list it, read it back, save it as a DTU, draft it in Thread citing that DTU | `physics.scene-save`, `physics.scene-list`, `physics.scene-get`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail` | `PhysicsLab` scene editor, `PhysicsKeepMenu` Save scene as DTU / Draft in Thread. User `phys_proof` (`f9df5845-9992-4f63-8406-851448887a89`). Scene `scene_muum4es4_owfc3f`. | `physicsLens` added to `LENS_STATE_KEYS`; serialize/hydrate round trip kept the scene with its bodies, constraints, and share code. After a `kill -9` restart of the proof API on the same data directory, `scene-list` and `scene-get` still showed the scene and the draft was still `draft`. | Sentence states the real body count (2) and constraint count (1) from `scene-list`. Save refuses when the read-back does not match. Draft refuses when Thread keeps no draft citing that DTU. | Private DTU `dtu_2e9c4cffe41e9b52ac1c`, `kind: physics_scene_report`, `source: physics-lens:scene-report`, `visibility: private`. Readable after restart. | Thread draft `th_muum4ewt_q154tr`, `status: draft`, `citedDtuId: dtu_2e9c4cffe41e9b52ac1c`. `draft-detail` confirms the cite survived. | vitest 14 (`tests/physics-scene-report.test.ts` 8, `tests/physics-keep-menu.test.tsx` 6). `server/tests/lens-state-persistence.test.js` 25 (physicsLens round trip added). `server/tests/physics-domain-parity.test.js` 30 passed. | COMPLETE |

Browser: the production `PhysicsLab` controls were exercised via the same `lensRun` calls the UI makes (scene-save, scene-list, scene-get), then the `PhysicsKeepMenu` workflow was exercised (save DTU, read-back, draft in Thread). After a `kill -9` restart of the proof API on the same data directory, the scene, DTU, and draft were all still readable and the draft was still `draft` citing the DTU. `physicsLens` was missing from `LENS_STATE_KEYS` — now fixed and pinned. Nothing was published.

## HVAC — COMPLETE (2026-10-05, this pass)

| | |
|---|---|
| Purpose | Run a real Manual J HVAC load calculation — square footage, climate, insulation, stories → heating BTU, cooling BTU, tonnage, equipment size, SEER — then save it as a private DTU and draft it in Thread citing that DTU. Reference: ServiceTitan / Wrightsoft / Wrightsoft Right-Suite for residential load calculation. No external load service is contacted. |
| Existing backend | `hvac.loadCalculation`, `hvac.energyAudit`, `hvac.maintenanceSchedule`, `hvac.zoneBalance`, `hvac.ductulator`, `hvac.hangerSpanCheck`, `hvac.tech-add`, `hvac.tech-list`, `hvac.appointment-create`, `hvac.appointment-assign`, `hvac.appointment-status`, `hvac.dispatch-board`, `hvac.booking-request`, `hvac.booking-list`, `hvac.booking-confirm`, `hvac.asset-add`, `hvac.asset-list`, `hvac.asset-log-service`, `hvac.estimate-request-signature`, `hvac.estimate-sign`, `hvac.payment-charge`, `hvac.payment-list`, `hvac.payment-refund`, `hvac.agreement-create`, `hvac.agreement-list`, `hvac.agreement-complete-visit`, `hvac.field-visit-start`, `hvac.field-visit-update`, `hvac.field-visit-complete`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail` in `server/domains/hvac.js`. State lives in `STATE.hvacLens` Maps (technicians, appointments, bookings, assets, payments, agreements, fieldVisits). **`hvacLens` was NOT in `LENS_STATE_KEYS`**, so every technician, appointment, booking, equipment asset, payment, agreement, and field visit was wiped on every restart while the FieldService panels still showed them. Now allowlisted and pinned by a bidirectional round-trip test. |
| Existing APIs | `POST /api/lens/run` for `hvac.*`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail`. |
| Existing DTUs | Private load-report DTU (`source: hvac-lens:load-report`) only after `dtu.get` returns the same id. |
| Native workflows | Enter square footage, stories, insulation, climate. Calculate the load. In the Manual J result "Save load as DTU", then "Draft in Thread" citing that DTU. The sentence is "1,800 sf hot-humid: 38,250 BTU heat, 45,000 BTU cool, 3.8 ton." Save says "Saved as private DTU {id}. Nothing was published." Draft says "Drafted in Thread as {id}, citing {id}. Not posted." |
| External integrations | None on this path. No external load service (Wrightsoft, Cool Calc, Energy Gauge) is contacted. The screen says nothing was published. |
| Missing functionality | The energy audit, maintenance calendar, and zone balance widgets still have no DTU handoff after their `SaveAsDtuButton` was removed (it saved without read-back). The dispatch board, bookings, equipment, e-sign, payments, agreements, and field-visit panels persist their state but were not the clicked handoff path. The ductulator and hanger-span check already produce real numbers. |
| Status | COMPLETE for loadCalculation, save DTU, read-back, draft in Thread, reload, and hard restart. |

### Acceptance

| Lens | Core workflow | Real backend | Real UI | Persistence | Live data | DTU | Cross-lens | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| HVAC | Run a Manual J load, save it as a DTU, draft it in Thread citing that DTU | `hvac.loadCalculation`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail` | `LoadCalculator` Calculate load button + `HvacKeepMenu` Save load as DTU / Draft in Thread. Inputs: 1800 sf, 2 stories, good insulation, hot-humid climate. Result: 45,000 BTU cool, 38,250 BTU heat, 3.8 ton, SEER 16+. | `hvacLens` added to `LENS_STATE_KEYS`; serialize/hydrate round trip kept a technician, appointment, booking, equipment asset, payment, agreement (with nested visit schedule), and field visit. After a `kill -9` restart of the proof API on the same data directory, the dispatch board and agreements still showed their rows. | Sentence states the real heating BTU (38,250), cooling BTU (45,000), tonnage (3.8 ton), and SEER (16+) from `loadCalculation`. Save refuses when the read-back does not match. Draft refuses when Thread keeps no draft citing that DTU. | Private DTU `dtu_*`, `kind: hvac_load_report`, `source: hvac-lens:load-report`, `visibility: private`. Readable after restart. | Thread draft `th_*`, `status: draft`, `citedDtuId: dtu_*`. `draft-detail` confirms the cite survived. | vitest 16 (`tests/hvac-load-report.test.ts` 8, `tests/hvac-keep-menu.test.tsx` 6, `tests/hvac-duct-designer.test.tsx` 2). `server/tests/lens-state-persistence.test.js` 26 (hvacLens round trip added). `server/tests/hvac-lens-macros.test.js` 16 passed. | COMPLETE |

Browser: the production `LoadCalculator` Calculate load button and `HvacKeepMenu` are the clicked path, not a unit test alone. The four fake `SaveAsDtuButton` instances that saved without read-back are gone (load, audit, maintenance, zone balance), and the fake `DTUExportButton domain="hvac" data={realtimeData || {}}` on the lens page is gone. A serialize/hydrate cycle (the same helpers the server uses on a restart) kept the technician, appointment, booking, equipment asset, payment, agreement, and field visit. No external load service was contacted. Nothing was published.

## Fitness — COMPLETE (2026-10-05, this pass)

| | |
|---|---|
| Purpose | Keep a real fitness activity as a private DTU, then draft that in Thread. Reference: Strava. The activity-detail macro returns the real type, distance, duration, pace, calories, heart rate, elevation, relative effort, and split analysis. Nothing is published by saving or drafting. |
| Existing backend | `fitness.activity-create`, `fitness.activity-list`, `fitness.activity-detail`, `fitness.activity-delete`, `fitness.activity-kudos`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail` in `server/domains/fitness.js`. State lives in `STATE.fitnessLens` Maps (activities, gear, segments, goals, plans). `fitnessLens` was already in `LENS_STATE_KEYS`. |
| Existing APIs | `POST /api/lens/run` for `fitness.*`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail`. |
| Existing DTUs | Private activity-report DTU (`source: fitness-lens:activity-report`) only after `dtu.get` returns the same id. |
| Native workflows | In the activities list, click "Keep" on a row. The panel fetches the real `activity-detail`, builds the report from real figures, "Save activity as DTU" (private, read-back confirmed), then "Draft in Thread" citing that DTU. The sentence is "Morning Run · 2026-10-05: 5.2 km, 31m, 6:00/km, 385 kcal, 152 bpm avg, RE 72." Save says "Saved as private DTU {id}. Nothing was published." Draft says "Drafted in Thread as {id}, citing {id}. Not posted." |
| External integrations | None on this path. No external fitness service (Strava API, Garmin, Apple Health) is contacted. The screen says nothing was published. |
| Missing functionality | The workout planner, training plan, goals, segments, gear, and wearable panels persist their state but were not the clicked handoff path. The Strava connector panels are labeled connectors; no external Strava API call was made. |
| Status | COMPLETE for activity-create, activity-detail, save DTU, read-back, draft in Thread, and draft-detail. |

### Acceptance

| Lens | Core workflow | Real backend | Real UI | Persistence | Live data | DTU | Cross-lens | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| Fitness | Keep a real activity as a DTU and draft it in Thread citing that DTU | `fitness.activity-create`, `fitness.activity-detail`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-detail` | `StravaActivitiesPanel` Keep button + `FitnessKeepMenu` Save activity as DTU / Draft in Thread. Activity: 5.0 km run, 1500s, 5:00/km, 320 kcal, 150 bpm avg. | `fitnessLens` already in `LENS_STATE_KEYS`; activities persist across restarts via the snapshot. | Sentence states the real distance (5.0 km), duration (1500s), pace (5:00/km), calories (320), avg HR (150), and relative effort from `activity-detail`. Save refuses when the read-back does not match. Draft refuses when Thread keeps no draft citing that DTU. | Private DTU, `kind: fitness_activity_report`, `source: fitness-lens:activity-report`, `visibility: private`. Readable via `dtu.get`. | Thread draft, `status: draft`, `citedDtuId` matches the DTU. `draft-detail` confirms the cite. | vitest 33 (`tests/fitness-activity-report.test.ts` 10, `tests/fitness-keep-menu.test.tsx` 6, `tests/fitness-lens-gap-closure.test.tsx` 8, `tests/fitness-lens-states.test.tsx` 9). `server/tests/fitness-activity-keep.test.js` 2 passed. | COMPLETE |

Browser: the production `StravaActivitiesPanel` controls were exercised via the same `lensRun` calls the UI makes (activity-create, activity-detail), then the `FitnessKeepMenu` workflow was exercised (save DTU, read-back, draft in Thread). The fake `DTUExportButton domain="fitness" data={{}}` on the lens page is gone. No external fitness service was contacted. Nothing was published.

## Food — COMPLETE (2026-10-05, this pass)

| | |
|---|---|
| Purpose | Keep a real recipe as a private DTU, then draft that in Thread. Reference: MyFitnessPal / Yelp. The recipe-list macro returns the real title, slot, servings, calories, protein, carbs, fat, tags, ingredients, ratings, and cook count. Nothing is published by saving or drafting. |
| Existing backend | `food.recipe-add`, `food.recipe-list`, `food.recipe-rate`, `food.recipe-cooked`, `food.recipe-cook-history`, `food.recipe-photo-add`, `food.recipe-photo-list`, `food.recipe-photo-delete`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail` in `server/domains/food.js`. State lives in `STATE.foodLens` Maps (recipes, recipeRatings, recipeCooks, recipePhotos). `foodLens` was already in `LENS_STATE_KEYS`. |
| Existing APIs | `POST /api/lens/run` for `food.*`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail`. |
| Existing DTUs | Private recipe-report DTU (`source: food-lens:recipe-report`) only after `dtu.get` returns the same id. |
| Native workflows | In the recipe library, expand a recipe, click "Keep". The panel builds the report from the real recipe-list figures, "Save recipe as DTU" (private, read-back confirmed), then "Draft in Thread" citing that DTU. The sentence is "Spaghetti Carbonara · Dinner: 4 servings, 580 kcal/serving, 22g protein, 65g carbs, 24g fat." Save says "Saved as private DTU {id}. Nothing was published." Draft says "Drafted in Thread as {id}, citing {id}. Not posted." |
| External integrations | None on this path. No external food service (OpenFoodFacts, Yelp API) is contacted. The screen says nothing was published. |
| Missing functionality | The meal planner, pantry, brewery, floor plan, prep list, and Yelp panels persist their state but were not the clicked handoff path. The OpenFoodFacts `SaveAsDtuButton` still saves without read-back — not the clicked path. |
| Status | COMPLETE for recipe-add, recipe-list, save DTU, read-back, draft in Thread, and draft-detail. |

### Acceptance

| Lens | Core workflow | Real backend | Real UI | Persistence | Live data | DTU | Cross-lens | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| Food | Keep a real recipe as a DTU and draft it in Thread citing that DTU | `food.recipe-add`, `food.recipe-list`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-detail` | `RecipeLibrary` Keep button + `FoodKeepMenu` Save recipe as DTU / Draft in Thread. Recipe: Proof Carbonara, Dinner, 4 servings, 580 kcal, 22g protein, 65g carbs, 24g fat, 2 ingredients. | `foodLens` already in `LENS_STATE_KEYS`; recipes persist across restarts via the snapshot. | Sentence states the real servings (4), calories (580), protein (22g), carbs (65g), fat (24g) from `recipe-list`. Save refuses when the read-back does not match. Draft refuses when Thread keeps no draft citing that DTU. | Private DTU, `kind: food_recipe_report`, `source: food-lens:recipe-report`, `visibility: private`. Readable via `dtu.get`. | Thread draft, `status: draft`, `citedDtuId` matches the DTU. `draft-detail` confirms the cite. | vitest 16 (`tests/food-recipe-report.test.ts` 10, `tests/food-keep-menu.test.tsx` 6). `server/tests/food-recipe-keep.test.js` 2 passed. | COMPLETE |

Browser: the production `RecipeLibrary` controls were exercised via the same `lensRun` calls the UI makes (recipe-add, recipe-list), then the `FoodKeepMenu` workflow was exercised (save DTU, read-back, draft in Thread). The fake `DTUExportButton domain="food" data={{}}` on the lens page is gone. No external food service was contacted. Nothing was published.

## Retail — COMPLETE (2026-10-05, this pass)

| | |
|---|---|
| Purpose | Keep a real product as a private DTU, then draft that in Thread. Reference: Shopify. The product-list macro returns the real sku, name, price, stock, category, supplier, lead time, daily sales rate, turnover rate, ABC class, and price history. Nothing is published by saving or drafting. |
| Existing backend | `retail.product-upsert`, `retail.product-list`, `retail.product-price-history`, `retail.product-delete`, `retail.product-variant-upsert`, `retail.product-variant-list`, `retail.product-variant-delete`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail` in `server/domains/retail.js`. State lives in `STATE.retailLens` Maps (products, variants). `retailLens` was already in `LENS_STATE_KEYS`. |
| Existing APIs | `POST /api/lens/run` for `retail.*`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail`. |
| Existing DTUs | Private product-report DTU (`source: retail-lens:product-report`) only after `dtu.get` returns the same id. |
| Native workflows | In the product catalog, expand a product, click the Keep shield. The panel builds the report from the real product-list figures, "Save product as DTU" (private, read-back confirmed), then "Draft in Thread" citing that DTU. The sentence is "Widget Pro · WIDGET-001: $29.99, 150 in stock, Electronics, ABC A, turnover 6.08×/yr, Acme Corp, 14d lead." Save says "Saved as private DTU {id}. Nothing was published." Draft says "Drafted in Thread as {id}, citing {id}. Not posted." |
| External integrations | None on this path. No external retail service (Shopify API, Stripe) is contacted. The screen says nothing was published. |
| Missing functionality | The POS terminal, fulfillment board, returns, refunds, shipping, customers, discounts, gift cards, campaigns, and storefront panels persist their state but were not the clicked handoff path. The LivePosTerminal `SaveAsDtuButton` still saves without read-back — not the clicked path. |
| Status | COMPLETE for product-upsert, product-list, save DTU, read-back, draft in Thread, and draft-detail. |

### Acceptance

| Lens | Core workflow | Real backend | Real UI | Persistence | Live data | DTU | Cross-lens | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| Retail | Keep a real product as a DTU and draft it in Thread citing that DTU | `retail.product-upsert`, `retail.product-list`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-detail` | `ProductCatalogPanel` Keep shield + `RetailKeepMenu` Save product as DTU / Draft in Thread. Product: Proof Widget, $29.99, 150 in stock, Electronics, Acme Corp, 14d lead. | `retailLens` already in `LENS_STATE_KEYS`; products persist across restarts via the snapshot. | Sentence states the real price ($29.99), stock (150), category, supplier, lead time, turnover rate, and ABC class from `product-list`. Save refuses when the read-back does not match. Draft refuses when Thread keeps no draft citing that DTU. | Private DTU, `kind: retail_product_report`, `source: retail-lens:product-report`, `visibility: private`. Readable via `dtu.get`. | Thread draft, `status: draft`, `citedDtuId` matches the DTU. `draft-detail` confirms the cite. | vitest 16 (`tests/retail-product-report.test.ts` 10, `tests/retail-keep-menu.test.tsx` 6). `server/tests/retail-product-keep.test.js` 2 passed. | COMPLETE |

Browser: the production `ProductCatalogPanel` controls were exercised via the same `lensRun` calls the UI makes (product-upsert, product-list), then the `RetailKeepMenu` workflow was exercised (save DTU, read-back, draft in Thread). The fake `DTUExportButton domain="retail" data={{}}` on the lens page is gone. No external retail service was contacted. Nothing was published.

## Healthcare — COMPLETE (2026-10-05, this pass)

| | |
|---|---|
| Purpose | Keep a real patient summary as a private DTU, then draft that in Thread. Reference: MyChart / Epic. The patients-detail macro returns the real MRN, name, DOB, sex, insurance, and full chart (problems, allergies, vitals, labs, immunizations, encounters). Nothing is published by saving or drafting. |
| Existing backend | `healthcare.patients-create`, `healthcare.patients-list`, `healthcare.patients-detail`, `healthcare.patients-update`, `healthcare.problems-add`, `healthcare.allergies-add`, `healthcare.vitals-record`, `healthcare.labs-record`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail` in `server/domains/healthcare.js`. State lives in `STATE.healthLens` Maps (patients, problems, allergies, vitals, labs, immunizations, encounters, medications, records, appointments). `healthLens` was already in `LENS_STATE_KEYS`. |
| Existing APIs | `POST /api/lens/run` for `healthcare.*`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail`. |
| Existing DTUs | Private patient-summary DTU (`source: healthcare-lens:patient-summary`) only after `dtu.get` returns the same id. |
| Native workflows | In the patient chart, the `HealthcareKeepMenu` appears under the patient banner. "Save summary as DTU" (private, read-back confirmed), then "Draft in Thread" citing that DTU. The sentence is "Doe, Jane · MRN-000001: DOB 1980-05-15, F, Blue Cross, 2 problems, 1 allergy, 3 vitals, 2 labs, 1 immun, 2 encounters." Save says "Saved as private DTU {id}. Nothing was published." Draft says "Drafted in Thread as {id}, citing {id}. Not posted." |
| External integrations | None on this path. No external health service (Epic, Cerner, FHIR) is contacted. The screen says nothing was published. |
| Missing functionality | The provider directory, appointments, medications, refills, protocols, CDS, insurance, Rx price compare, and results release panels persist their state but were not the clicked handoff path. The ProviderDirectory `SaveAsDtuButton` still saves without read-back — not the clicked path. |
| Status | COMPLETE for patients-create, patients-detail, save DTU, read-back, draft in Thread, and draft-detail. |

### Acceptance

| Lens | Core workflow | Real backend | Real UI | Persistence | Live data | DTU | Cross-lens | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| Healthcare | Keep a real patient summary as a DTU and draft it in Thread citing that DTU | `healthcare.patients-create`, `healthcare.patients-detail`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-detail` | `PatientChartPanel` patient banner + `HealthcareKeepMenu` Save summary as DTU / Draft in Thread. Patient: Proof Patient, MRN-000001, DOB 1980-05-15, F, Blue Cross. | `healthLens` already in `LENS_STATE_KEYS`; patients persist across restarts via the snapshot. | Sentence states the real MRN, DOB, sex, insurance, and chart counts (problems, allergies, vitals, labs, immunizations, encounters) from `patients-detail`. Save refuses when the read-back does not match. Draft refuses when Thread keeps no draft citing that DTU. | Private DTU, `kind: healthcare_patient_summary`, `source: healthcare-lens:patient-summary`, `visibility: private`. Readable via `dtu.get`. | Thread draft, `status: draft`, `citedDtuId` matches the DTU. `draft-detail` confirms the cite. | vitest 16 (`tests/healthcare-patient-report.test.ts` 10, `tests/healthcare-keep-menu.test.tsx` 6). `server/tests/healthcare-patient-keep.test.js` 2 passed. | COMPLETE |

Browser: the production `PatientChartPanel` controls were exercised via the same `lensRun` calls the UI makes (patients-create, patients-detail), then the `HealthcareKeepMenu` workflow was exercised (save DTU, read-back, draft in Thread). The fake `DTUExportButton domain="healthcare" data={{}}` on the lens page is gone. No external health service was contacted. Nothing was published.

## Accounting — COMPLETE (2026-10-05, this pass)

| | |
|---|---|
| Purpose | Keep a real posted journal entry as a private DTU, then draft that in Thread. Reference: QuickBooks. The je-post macro returns the real entry number, date, memo, lines (account/debit/credit), and balanced totals. Nothing is published by saving or drafting. |
| Existing backend | `accounting.je-post`, `accounting.ledger-list`, `accounting.coa-list`, `accounting.trialBalance`, `accounting.profitLoss`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail` in `server/domains/accounting.js`. State lives in `STATE.accountingLens` Maps (coa, journal, seq, audit). `accountingLens` was already in `LENS_STATE_KEYS`. |
| Existing APIs | `POST /api/lens/run` for `accounting.*`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail`. |
| Existing DTUs | Private journal-entry-report DTU (`source: accounting-lens:journal-entry-report`) only after `dtu.get` returns the same id. |
| Native workflows | In the Accounting Workbench's Post Entry tab, post a balanced journal entry. After a successful post, the `AccountingKeepMenu` appears. "Save entry as DTU" (private, read-back confirmed), then "Draft in Thread" citing that DTU. The sentence is "JE-00001 · 2026-10-05: 2 lines, 500.00 balanced." Save says "Saved as private DTU {id}. Nothing was published." Draft says "Drafted in Thread as {id}, citing {id}. Not posted." |
| External integrations | None on this path. No external accounting service (Stripe, QBO) is contacted. The screen says nothing was published. |
| Missing functionality | The COA, ledger, balance sheet, aging, invoices, customers, vendors, bills, expenses, budgets, payroll, sales tax, 1099, bank feeds, and statements persist their state but were not the clicked handoff path. The StripeInvoicePanel `SaveAsDtuButton` still saves without read-back — not the clicked path. |
| Status | COMPLETE for je-post, ledger-list, save DTU, read-back, draft in Thread, and draft-detail. |

### Acceptance

| Lens | Core workflow | Real backend | Real UI | Persistence | Live data | DTU | Cross-lens | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| Accounting | Keep a real posted journal entry as a DTU and draft it in Thread citing that DTU | `accounting.je-post`, `accounting.ledger-list`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-detail` | `AccountingWorkbench` JournalEntryTab Post entry + `AccountingKeepMenu` Save entry as DTU / Draft in Thread. Entry: JE-00001, 2026-10-05, 2 lines, $500.00 balanced (Dr Cash, Cr Revenue). | `accountingLens` already in `LENS_STATE_KEYS`; journal entries persist across restarts via the snapshot. | Sentence states the real entry number, date, line count, and balanced totals from `je-post`. Save refuses when the read-back does not match. Draft refuses when Thread keeps no draft citing that DTU. Unbalanced entries are rejected by the server. | Private DTU, `kind: accounting_journal_entry_report`, `source: accounting-lens:journal-entry-report`, `visibility: private`. Readable via `dtu.get`. | Thread draft, `status: draft`, `citedDtuId` matches the DTU. `draft-detail` confirms the cite. | vitest 16 (`tests/accounting-entry-report.test.ts` 10, `tests/accounting-keep-menu.test.tsx` 6). `server/tests/accounting-entry-keep.test.js` 2 passed. | COMPLETE |

Browser: the production `JournalEntryTab` controls were exercised via the same `lensRun` calls the UI makes (je-post, ledger-list), then the `AccountingKeepMenu` workflow was exercised (save DTU, read-back, draft in Thread). The fake `DTUExportButton domain="accounting" data={{}}` on the lens page is gone. No external accounting service was contacted. Nothing was published.

## Analytics — COMPLETE (2026-10-05, this pass)

| | |
|---|---|
| Purpose | Keep a real event-analytics dashboard (real event-log aggregate from `analytics-dashboard`) as a private DTU, then draft that in Thread. Reference: Mixpanel / Amplitude. The dashboard macro returns real total events, unique users, events today, distinct event types, and saved funnels. Nothing is published by saving or drafting. |
| Existing backend | `analytics.event-track`, `analytics.event-list`, `analytics.event-stats`, `analytics.analytics-dashboard`, `analytics.funnel-build`, `analytics.funnel-save`, `analytics.funnel-list`, `analytics.segment`, `analytics.retention-report`, `analytics.dashboard-save`, `analytics.dashboard-list`, `analytics.dashboard-get`, `analytics.alert-save`, `analytics.alert-list`, `analytics.cohort-build`, `analytics.cohort-save`, `analytics.cohort-list`, `analytics.path-analysis`, `analytics.breakdown`, `analytics.event-stream`, `analytics.range-compare`, `analytics.world-summary`, `analytics.global-summary`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail` in `server/domains/analytics.js`. State lives in `STATE.analyticsLens` Maps (events, funnels, dashboards, alerts, cohorts). |
| Existing APIs | `POST /api/lens/run` for `analytics.*`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail`. |
| Existing DTUs | Private dashboard-report DTU (`source: analytics-lens:dashboard-report`) only after `dtu.get` returns the same id. |
| Native workflows | In the Analytics lens, the Events tab tracks real events via the `event-track` macro and shows the real `analytics-dashboard` counts. The `AnalyticsKeepMenu` appears once at least one event is tracked. "Save dashboard as DTU" (private, read-back confirmed), then "Draft in Thread" citing that DTU. The sentence is "12 events tracked · 3 unique users · 4 today · 2 event types · 1 saved funnels." Save says "Saved as private DTU {id}. Nothing was published." Draft says "Drafted in Thread as {id}, citing {id}. Not posted." |
| External integrations | None on this path. No external analytics service (Mixpanel, Amplitude, Google Analytics) is contacted. The screen says nothing was published. |
| Missing functionality | Funnels, saved dashboards, alerts, cohorts, path analysis, breakdown, event stream, range compare, and the world/global structural analytics persist their state but were not the clicked handoff path. The four legacy artifact-shape macros (`funnelAnalysis`, `cohortAnalysis`, `detectAnomalies`, `trendForecast`) operate on `artifact.data` and were not the clicked path. |
| Status | COMPLETE for event-track, analytics-dashboard, save DTU, read-back, draft in Thread, and draft-detail. |

### Acceptance

| Lens | Core workflow | Real backend | Real UI | Persistence | Live data | DTU | Cross-lens | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| Analytics | Keep a real event-analytics dashboard as a DTU and draft it in Thread citing that DTU | `analytics.event-track`, `analytics.analytics-dashboard`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-detail` | `EventAnalytics` Track an event + `AnalyticsKeepMenu` Save dashboard as DTU / Draft in Thread. Dashboard: 2 events tracked, 1 unique user, 2 today, 2 event types, 0 saved funnels. | `analyticsLens` added to `LENS_STATE_KEYS` (was missing); events/funnels/dashboards/alerts/cohorts now persist across restarts via the snapshot. Pinned by a bidirectional round-trip test. | Sentence states the real total events, unique users, events today, event types, and saved funnels from `analytics-dashboard`. Save refuses when the read-back does not match. Draft refuses when Thread keeps no draft citing that DTU. Empty event names are rejected by the server. | Private DTU, `kind: analytics_dashboard_report`, `source: analytics-lens:dashboard-report`, `visibility: private`. Readable via `dtu.get`. | Thread draft, `status: draft`, `citedDtuId` matches the DTU. `draft-detail` confirms the cite. | vitest 7 (`tests/analytics-keep-menu.test.tsx`). `server/tests/analytics-keep.test.js` 2 passed. `server/tests/lens-state-persistence.test.js` 29 passed (incl. new analyticsLens round-trip). | COMPLETE |

Browser: Playwright (Chrome) registered a real user, opened `/lenses/analytics`, clicked the Events tab, tracked two real events (`signup`, `purchase`) via the macro-backed form, and screenshotted the page — the "Event Analytics" panel and the "Events" label were visible in the DOM. Screenshot: `~/.zuko/lens-northstar/proof/analytics.png`. Fixed: `analyticsLens` was missing from `LENS_STATE_KEYS`, so every tracked event, saved funnel, dashboard, alert, and behavioral cohort was wiped on every restart while the EventAnalytics panel still showed the dashboard counts. Now allowlisted and pinned by a bidirectional round-trip test. Removed: the fake `DTUExportButton domain="analytics" data={{}}` on the lens page (exported `{}`). Nothing was published.

## Trades — COMPLETE (2026-10-05, this pass)

| | |
|---|---|
| Purpose | Keep a real trades work order (from `job-create`) as a private DTU, then draft that in Thread. Reference: ServiceTitan / Housecall Pro. The job-create macro returns the real job number, customer, description, priority, status, and estimated hours. Nothing is published by saving or drafting. |
| Existing backend | `trades.customer-upsert`, `trades.customer-list`, `trades.job-create`, `trades.job-list`, `trades.job-update-status`, `trades.job-assign`, `trades.contract-create`, `trades.contract-list`, `trades.technicians-add`, `trades.dispatch-board`, `trades.route-optimize`, `trades.quotes-create`, `trades.bookings-create`, `trades.timesheets-clock-in`, `trades.payments-create-link`, `trades.recurring-plans-create`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail` in `server/domains/trades.js`. State lives in `STATE.tradesLens` Maps (customers, jobs, contracts, technicians, etc.). `tradesLens` was already in `LENS_STATE_KEYS`. |
| Existing APIs | `POST /api/lens/run` for `trades.*`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-list`, `thread.draft-detail`. |
| Existing DTUs | Private job-report DTU (`source: trades-lens:job-report`) only after `dtu.get` returns the same id. |
| Native workflows | In the Trades lens Workbench nav item, the JobsTab creates real jobs via the `job-create` macro and lists them. Each job card shows the real number, customer, priority, status, and a `TradesKeepMenu`. "Save job as DTU" (private, read-back confirmed), then "Draft in Thread" citing that DTU. The sentence is "JOB-00001 · Proof Customer: high unassigned, est 4h." Save says "Saved as private DTU {id}. Nothing was published." Draft says "Drafted in Thread as {id}, citing {id}. Not posted." |
| External integrations | None on this path. No external field-service / dispatch service is contacted. The screen says nothing was published. |
| Missing functionality | Customers, contracts, technicians, dispatch board, route optimize, quotes, bookings, timesheets, invoices, payments, recurring plans, pricebook, reminders, reviews, reports, and the reddit feed persist their state but were not the clicked handoff path. The `SaveAsDtuButton` in TradesFeed saves reddit feed data without read-back — not the clicked path. The legacy artifact-shape macros (`calculateEstimate`, `calculatePL`, `checkPermits`, `generateInvoice`, `generatePO`, `scheduleInspection`, `materialsCost`) operate on `artifact.data` and were not the clicked path. |
| Status | COMPLETE for customer-upsert, job-create, job-list, save DTU, read-back, draft in Thread, and draft-detail. |

### Acceptance

| Lens | Core workflow | Real backend | Real UI | Persistence | Live data | DTU | Cross-lens | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| Trades | Keep a real trades work order as a DTU and draft it in Thread citing that DTU | `trades.customer-upsert`, `trades.job-create`, `trades.job-list`, `dtu.create`, `dtu.get`, `thread.thread-draft`, `thread.draft-detail` | `TradesWorkbench` JobsTab New job form (select customer, description, priority, est hrs, Dispatch) + `TradesKeepMenu` Save job as DTU / Draft in Thread. Job: JOB-00001, Proof Customer, high, unassigned, 4 est hrs. | `tradesLens` already in `LENS_STATE_KEYS`; customers/jobs/contracts/etc. persist across restarts via the snapshot. | Sentence states the real job number, customer, priority, status, and estimated hours from `job-create`. Save refuses when the read-back does not match. Draft refuses when Thread keeps no draft citing that DTU. Jobs without a customer are rejected by the server. | Private DTU, `kind: trades_job_report`, `source: trades-lens:job-report`, `visibility: private`. Readable via `dtu.get`. | Thread draft, `status: draft`, `citedDtuId` matches the DTU. `draft-detail` confirms the cite. | vitest 7 (`tests/trades-keep-menu.test.tsx`). `server/tests/trades-keep.test.js` 2 passed. | COMPLETE |

Browser: Playwright (Chrome) registered a real user, opened `/lenses/trades`, clicked the Workbench nav item, created a real customer via the macro-backed API (`customer-upsert`), created a real job via the macro-backed form (selected the customer, filled the description, clicked Dispatch), and screenshotted the page — the job card (JOB-00001) and the "Keep this job" menu were visible in the DOM. Screenshot: `~/.zuko/lens-northstar/proof/trades.png`. Removed: the fake `DTUExportButton domain="trades" data={{}}` on the lens page (exported `{}`). Nothing was published.
