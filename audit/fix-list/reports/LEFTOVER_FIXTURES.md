- 2026-11-09 6:50 AM LEFTOVER FIXTURE: photos empty album 'QA Lens Tester 2 photos 2026-11-09 album' (no album delete UI; FIX-photos). Clean up once delete ships.

- 2026-11-09 7:15 AM ET (LT3, classroom): assignment 'QA LT3 classroom 2026-11-09 assignment' (due 11/16) remains visible only under To-do > Upcoming with no actions; cohort #13 archived; assignment/material vanished from Classwork/Materials after reload (FIX-classroom bug). No UI delete. Needs backend cleanup by builders (no DB changes by audit).

- 2026-11-09 7:59 AM ET (LT2, legal): no delete UI (FIX-legal-001). Remaining: matter MAT-00010 'QA Lens Tester 2 legal 2026-11-09 matter edited', calendar deadline '…deadline' 2042-03-15, template '…template', docket case '…case' QA-2042-001, possibly hidden 999999999999-hour time entry (FIX-legal-002).

- 2026-11-09 7:57 AM ET (Lens Tester 3, repos): public Social Feed post, caption 'QA LT3 repos 2026-11-09 share test', posted by the QA account via Repos header Share > Lens > Social Feed. Not visible in /lenses/social or /profile, so it can't be deleted via the UI. Needs backend cleanup.

- 2026-11-09 2026-11-09 8:05 AM ET (LT1, ml): minted private ML DTU from Analysis bench (~7:55–8:00 AM ET) — no delete/unpublish control; check My vault at /lenses/dtus. Also local browser download `ml-export-2026-11-09.json` on the box (not site data). All other QA fixtures (ds, exp, exp2, dep, sp-priv, sp-pub, sp-pub2, AutoML records) deleted. 3 non-QA harness datasets left untouched.

- 2026-11-09 8:08 AM ET (LT3, foundry): PUBLISHED world 'QA LT3 foundry 2026-11-09 retest' (https://concord-os.org/lenses/world?worldId=world-8a8ab303-2dad-4861-8f24-35453b23d3fd) in the Builder Marketplace, plus building 'QA LT3 temporary building' (wb_mw99q8up_fa6o97, dtu_mw99q8ul_xeijr2). There's no Unpublish UI and Delete is disabled while published (FIX-foundry-007). Needs backend unpublish/delete.

- 2026-11-09 8:14 AM ET (LT3, agents retest): run history 'QA LT3 agents 2026-11-09 agent: Reply with OK' in Recent runs plus runtime counters (no run delete); Quality Critic template install count +1 and an import history entry (no undo); a budget of 1000 tokens/$3 set on the deleted QA agent ('reset' doesn't clear it). Agent, trigger, thread and taskdef were deleted.

- 2026-11-09 8:16 AM ET (LT4, entity): no delete path for: Registry entity 'qa-lt4-entity-2026-11-09 Wikidata search — "Ada Lovelace" (16 matches)' (owner auto_extract; delete says unauthorized; DTU dtu_lens_entity_dtu_f4952358ef225cf64126 not in Global Library) (FIX-entity-009); snapshot 'qa-lt4-entity-2026-11-09 snapshot'; simulation runs 'Evolve qa-lt4-entity-2026-11-09 spawn and its neighbours' and 'What if qa-lt4-entity-2026-11-09 spawn's salience were different?' (FIX-entity-010); orphan relation from deleted qa-lt4 spawn on Harness spot HSD987 (FIX-entity-008). Research agent 'qa-lt4-entity-2026-11-09 agent test' no longer listed. Local box downloads entity-export-2026-11-09*.json/.csv (not site data). Needs backend cleanup.

- 2026-11-09 8:25 AM ET (LT2, world-creator): live PUBLIC world 'qa-lt2-world-creator-2026-11-09-c' id world-3a42d05d-cf0c-4f4e-87b4-68945ff2e7b6 from ▶ Playtest; no Settings/Delete on its Sub-worlds card, draft already deleted (FIX-world-creator-013). Needs backend cleanup.

- 2026-11-09 2026-11-09 8:32 AM ET (LT1, chat retest): DTU `dtu_88ca0f3b13c2a4a8300c` (saved chat transcript) — no delete observed; auto `AI: …` shadow `#chat-output` DTUs in My Vault; share link `shr_mw9ac50l_somme9la1eo9w1` was **revoked**; local download `chat-export-2026-11-09.json`. QA threads (`qa-lt1-chat-2026-11-09…` and `-m`) were deleted.

- 2026-11-09 8:36 AM ET (LT2, move-builder): minted moves 'qa-lt2-move-builder-2026-11-09-a' and 'qa-lt2-move-builder-2026-11-09-b-xxx…' (130 chars) in Your moves; no delete UI, ids not shown (FIX-move-builder-008). Needs backend cleanup.

- 2026-11-09 8:36 AM ET (LT4, ar recheck): image target 'qa-lt4-ar-2026-11-09' (no delete UI, FIX-ar-015); Sketchfab Save-as-DTU dtu_8a2150e1d97637a6889e ('chair', 20 results; not in Global Library, no delete, FIX-ar-016). Published scene and feed post were deleted. Needs backend cleanup.

## classroom policy retest (Lens Tester 3, 2026-11-09 8:36 AM ET)
- Archived cohort #14 'QA LT3 classroom 2026-11-09 retest cohort' (0 students)
- Quiz 'QA LT3 classroom 2026-11-09 quiz' (1 attempt), no delete
- Announcement 'QA LT3 classroom 2026-11-09 announcement', no delete
- Submission sub_17942310 (graded 4/5; parent assignment deleted), no delete; stream events remain
- UNINTENDED: harness cohort #11 'tz102619142lrx name harness value' archived by tester mis-click. Needs restore by an owner/zuko 3.

- 2026-11-09 8:42 AM ET (LT1, fitness policy recheck): segment `qa-lt1-fitness-2026-11-09-seg` (+ leaderboard effort 5:00 under zukotest10101358); club `…-club` (0 members after leave); challenge `…-chal`; beacon `bcn_nh7dgx29xg` (ended); workout `wo_1794231618902_d9tyx5`; DTU `dtu_2154ba7a221e5a900f70`; 4 WGER feed DTUs. No delete UI for segment/club/challenge/workout (FIX-fitness-014).

- 2026-11-09 8:55 AM ET (LT4, trades retest): unchanged leftovers 'QA LT4 trades 2026-11-08 Customer', JOB-00001, 'QA LT4 trades 2026-11-08 Fixture Quote' ($313.93), which is now marked SENT (Send has no recipient prompt; customer had no email, so likely no delivery). Blank 'New Job' artifact was deleted.

- 2026-11-09 8:58 AM ET (LT4, insurance recheck): e-sign envelope 'QA LT4 insurance 2026-11-09 recheck e-sign' (COMPLETED; signer = QA own email; no void/delete). Earlier insurance leftovers unchanged.
- UPDATE 9:05 AM (LT3): classroom harness cohort #11 has no UI un-archive path (Cohorts/Workspace/Library checked; page '...' menu not checked). NEEDS BACKEND UN-ARCHIVE.
## council retest (LT3, 9:05 AM): no leftovers (nothing created; feed share post deleted). Audit CSVs in ~/Downloads.

- 2026-11-09 9:15 AM ET (LT4, agriculture recheck): Workbench field 'QA LT4 agriculture 2026-11-09 recheck field' (Ames IA) with an undeletable scout observation 'QA LT4 agriculture 2026-11-09 recheck scout observation', 2 undeletable soil grids, and an NDVI layer. The field is kept as their parent. Crops, cost entry and feed post were deleted.

## accounting policy recheck (LT3, 9:15 AM ET)
- INV-00012 "QA LT3 accounting 2026-11-09 invoice" $1.00 PAID (no void/delete)
- ~/Downloads/accounting-export-2026-11-09.json/.csv

- 2026-11-09 2026-11-09 9:26 AM ET (LT1, government policy recheck): DENIED permit ('no reason provided'); inspection; fine; FOIA draft; voter registration; 311 SR-000002 — all lack delete/cancel (FIX-government-018). Publish post from run 1 was deleted (confirm worked). Notice subscription did not persist. Screenshots for fac5dffa missing at closeout.

## bounties (Lens Tester 2, 2026-11-09)
- qa-lt2-bounties-2026-11-09-a: open bounty, 5 CC (milestone m1). No delete/cancel in UI.
- qa-lt2-bounties-2026-11-09-b: open bounty, 5 CC, deadline 2020-01-01, ~700-char description. No delete/cancel in UI.

## srs — Lens Tester 5 — 2026-11-09 9:33 AM ET
- Deck `qa-lt5-srs-2026-11-09` (dk_mw9chlf1_xfvd32): deletion in progress (see update below if any).
- Spaced-review state on shared-account DTUs "Exercise: Leg Extension" (rated, re-added) and "qa-lt4-ar-2026-11-09 chair" (rated): no UI path to remove a not-due item (FIX-srs-004). Harmless review metadata.
- Local files: /home/box/Downloads/qa-lt5-srs-2026-11-09.srs.json, /workspace/qa-lt5-srs-2026-11-09.srs.json (export bundle; copy kept as evidence/srs/export-bundle.srs.json).
- Possibly 2 rejected publish attempts (Council rejected; nothing created).
- Update 9:32 AM ET: deck `qa-lt5-srs-2026-11-09` deleted (Decks shows "No decks yet"). /workspace copy of the bundle removed; /home/box/Downloads/qa-lt5-srs-2026-11-09.srs.json remains (local file only). Remaining leftover: review metadata on 2 shared-account DTUs (no UI remove path, FIX-srs-004).

## crisis-ops — Lens Tester 4 — 2026-11-09 09:41 ET
- Asset 'QA LT4 crisis-ops 2026-11-09' qty 12 (no delete)
- Incident report 'QA LT4 crisis-ops 2026-11-09…' priority 70 (no delete)
- Status-log entries on resolved QA crisis

- 2026-11-09 9:43 AM ET (LT6, tools): e-sign envelopes ENV-00012 'qa-lt6-tools-2026-11-09-a w c s d' (VOIDED) and 'qa-lt6-tools-2026-11-09-b' (COMPLETED, no void/delete; FIX-tools-003); possibly a cited DTU from Web research 'Alan Turing' (not surfaced, FIX-tools-008); local download ~/Downloads/compiled.js. Feed post was deleted.

## deities (Lens Tester 2, 2026-11-09)
- qa-lt2-deities-2026-11-09-a: deity, domain "Patron of QA tests", rev 2, 1 pilgrimage + 4 communes by QA account. No delete control in UI.
- qa-lt2-deities-2026-11-09-b <b>&"%🔥ü</b>: deity, domain "<script>x</script> 😀" (escaped), rev 1. No delete control in UI.

## Translation (Lens Tester 3, 2026-11-09)
- None visible. Saved translation and glossary entries were deleted. Keep as DTU showed no result; if a DTU titled like "QA LT3 save test" exists, it is a leftover.

## death-insurance — Lens Tester 5 — 2026-11-09 9:52 AM ET
- Pacts `pct_mw9d33tc_g7xwe7` (beneficiary qa-lt5-nonexistent-user) and `pct_mw9dkpup_tcijm2` (beneficiary qa-lt5-death-insurance-2026-11-09-bene): both REVOKED; UI has no delete path (FIX-death-insurance-007). In-app ⚡ premiums spent: 50 + 22.

## goddess — Lens Tester 4 — 2026-11-09 09:53 ET
- DTU dtu_4ac6d2a3d48efedff223 'QA LT4 goddess 2026-11-09' (Private; no delete UI)
- qa-lt2-deities-2026-11-09-c: deity, default domain 'Patron of the unspoken', rev 1 (created by blank-domain validation). No delete control.

- 2026-11-09 2026-11-09 9:56 AM ET (LT1, paper policy recheck): Library collection `qa-lt1-paper-20261109 col` — no delete UI (FIX-paper-006/ still). Local downloads in `/home/box/Downloads`: `paper-export-2026-11-09.json`, `paper-1794234455515.dtu`, `qa-lt1-paper-20261109-ms.txt`, `qa-lt1-paper-20261109-pub.txt`. All papers, manuscripts/versions, and the feed post were deleted. Prior leftover `QA zuko3 paper 2026-11-08` collection may still remain.

## law — Lens Tester 5 — 2026-11-09 10:10 AM ET
- Case file `qa-lt5-law-2026-11-09 case` (judge "Judge QA", deadline 2020-01-15, status review): no delete control in UI (FIX-law-004).
- Signature link https://concord-os.org/sign/H42aBvo6… for the deleted contract `qa-lt5-law-2026-11-09` (contract deleted).
- Contracts, alerts, obligations: all removed. Local /home/box/Downloads/law-*.dtu files.

### death-insurance, account-2 beneficiary flow (Lens Tester 5, 2026-11-09 10:16 AM ET)
- pct_mw9ee1qm_8tvjy5, pct_mw9eg38i_qx1ukg and pct_mw9eg8we_yv5pxt are all REVOKED. There is no delete path (FIX-death-insurance-007). The beneficiary is QA account 2.

## Kingdoms (Lens Tester 3, 2026-11-09)
- "QA LT3 kingdoms 2026-11-09 Kingdom of QA", with decree firearms_prohibited and an open war campaign. It cannot be deleted (no UI).
- "QA LT3 kingdoms 2026-11-09 Mobile". It cannot be deleted (no UI).

## Tournaments (Lens Tester 3, 2026-11-09)
- "QA LT3 tournaments 2026-11-09 Neg": Completed, 2/2, champion QA Player A. It cannot be deleted.
- "QA LT3 tournaments 2026-11-09 Mobile": Cancelled. It cannot be deleted.

### sponsorship (Lens Tester 5, 2026-11-09 10:28 AM ET)
- An Arden Bronze 5 CC pledge-history entry is left on the QA account. The sponsorship itself is cancelled, and the history can't be labelled or deleted. No posts were created, because publishing is admin-only.

## saved (Lens Tester 2, 2026-11-09)
- No live leftovers. Local export files ~/Downloads/saved-2026-11-09.json and .csv.

- 2026-11-09 10:35 AM ET (LT6, inheritance): will versions 'qa-lt6-inheritance-2026-11-09-b' (v2) and '-b-edit' (v3 active), no delete (FIX-inheritance-008); 10 CC Heir-Slot Market listing for the seeded NPC, no delist (FIX-inheritance-003); a Share & Publish Feed post reported 'Published!' but not locatable (FIX-inheritance-007); QA-tagged chat Q&A from 'Ask about Inheritance'. Beneficiaries/asset/executor removed.

## Vote (Lens Tester 3, 2026-11-09)
- "QA LT3 vote 2026-11-09 Feature test": Closed, 1 ballot. It cannot be deleted.
- "QA LT3 vote 2026-11-09 Change test": Closed, 1 ballot. It cannot be deleted.
- "QA LT3 vote 2026-11-09 Mobile": Open, 0 ballots. It cannot be deleted.

## mail two-account retest (Lens Tester 2, 2026-11-09)
- Primary (zukotest10101358) Sent: qa-lt2-mail-2026-11-09-cod (mail_a69220ce0a610453), -gift2 (mail_5c98dfc3ce733539); removal refused 'already claimed'.
- Primary Inbox: 'Re: qa-lt2-mail-2026-11-09-b' (mail_fd4902a8f2efd838); no remove action.
- Account 2 (zukotest210101829) Inbox: -b, -gift2 (1 CC claimed), -cod (paid 1 CC); no delete action.
- mail_ccb90025b0b55bba: 1 CC gift misrouted to unidentified 'A Concord member' (removed from primary Sent; recipient copy and CC fate unknown). Needs server-side check.

- 2026-11-09 10:44 AM ET (LT1, markets): market `qa-lt1-markets-20261109 a` with YES 10 + NO 1 positions — not cancellable (FIX-markets-003); local download `/home/box/Downloads/markets-1794238485307.dtu`.

- 2026-11-09 10:52 AM ET (LT6, achievements): two duplicate QA chat Q&A pairs from Lens tools > Ask. Feed share post was deleted. Lens is read-only, so nothing else was created.

## mail_ccb90025b0b55bba (read-only DB check, 2026-11-09 10:50 AM ET)

DB: `/Users/dutch/concord vs code/concord-cognitive-engine/server/data/concord.db` (live node PID 4784 `server/server.js`).

### Recipient
- Stored `to_user_id` is the **username string** `zukotest210101829`, not a UUID.
- That username belongs to test account 2: id `6af5da0d-e392-4ec7-a13d-b6e2c66c5d6d`, username `zukotest210101829`, email `z***@example.com`, `is_test_account=1`, `is_agent=0`.
- **Not a real/external user.** Same QA account 2 the tester meant to reach — but inbox is keyed by UUID, so B never saw it.
- UI showed "A Concord member" because `lookupUserIdentity` looks up by id; a username-as-id miss leaves null names → `mailPartyLabel` fallback in `concord-frontend/components/mail/playerMail.ts:48-51`.

### Gift / 1 CC state
- Row: status `unread`, `attachment_cc=1.0`, `claimed_at` NULL, `sender_deleted_at` set 2026-11-09 10:44:22 AM ET (soft-delete from Sent only).
- Sent 2026-11-09 10:37:46 AM ET from primary QA `zukotest10101358` (`496291b0-9c92-478c-b02a-ebf3d29bbbc4`).
- Escrow debit: `reward_ledger` `led_25215ec3bb49` kind `mail_debit` −1.0 ref `mail_escrow` at send time. Sender balance now 99.0 CC.
- Account 2 has no credit for this mail id (only gift2 claim + COD debit today). Gift **unclaimed**.
- `deleteSentMail` does **not** refund escrow. 1 CC is **stranded in escrow** (debited from A, not credited to anyone) until `sweepExpiredMail` at `expires_at` **2026-12-09 10:37:46 AM ET**, which would refund A.

### Other QA mail today to non-test users
- None. Today's zukotest↔zukotest mails: `-b`, reply, `-gift` (this one), `-gift2`, `-cod`. Only this gift has username-as-id; all others used real UUIDs between the two test accounts. Sole historical username-as-id orphan from these accounts is this row.

### FIX-mail-011 root cause (why unresolved typed name still sends)
- Frontend `ComposeMailPanel.tsx:45-46` sends `toUserId: composeTo.trim()` — typed text, not necessarily a picked UUID. `RecipientSearchInput` only writes a UUID on dropdown select; free-typed usernames pass through.
- Server `mail.send` (`server/domains/mail.js:113-120`) forwards to `sendMail` with no resolve step. `server/lib/player-mail.js:40-42,104-110` only requires a non-empty string ≠ sender; it never calls `resolveUserByHandle` / never checks `users.id` exists. So a username (or garbage) is INSERTed as `to_user_id` and CC is escrowed.

### Recommended cleanup (NOT performed)
1. Code fix: resolve recipient via `resolveUserByHandle` in `sendMail` (or require UUID + `SELECT id FROM users`); reject with `unknown_recipient` if unresolved; refuse send until compose has a selected user id.
2. Data: either (a) UPDATE this row's `to_user_id` to `6af5da0d-e392-4ec7-a13d-b6e2c66c5d6d` so B can claim, or (b) credit A +1 CC (`mail_expiry_refund`/`mail_cancel_refund`) and mark status `expired` (or delete). Prefer (b) if B already got gift2. Do not leave escrow stranded until Dec 9.

## courtship partner 6af5da0d-e392-… (read-only, same DB, 2026-11-09 10:51 AM ET)

### Who is it
- Full id `6af5da0d-e392-4ec7-a13d-b6e2c66c5d6d` = **QA account 2** `zukotest210101829`, email `z***@example.com`, `is_test_account=1`, `is_agent=0`. Not an NPC/seed, not a real user.
- Row: primary QA (`496291b0-…`) → partner_kind `player`, partner_id that UUID, affinity 0.93, status **`estranged`** (started 2026-10-11 6:59 PM ET). No open proposals. UI `/api/courtship/mine` returns all statuses, so this estranged row can still appear under "Active courtships".

### Can courtship start with a specific user?
- Yes on the API/macros: `POST /api/courtship/interact` with `{ partnerKind: "player", partnerId: "<user-uuid>", sentiment }` (`server/server.js` ~65240; guard allows partnerKind `player`|`npc`). Lens macros `courtship.interact` / `courtship.propose` take the same (`server/domains/courtship.js`).
- `courtInteraction` in `server/lib/romance-engine.js:110-125` INSERTs a new `player_courtship` row for that partnerId when none exists (status `acquainted`).
- Lens empty-state UI only tells players to start from an NPC world context menu (`CourtshipsPanel.tsx:20-22`); there is no in-lens recipient picker for a specific player, but the endpoint/macro already supports `partnerKind:"player"` + a user id.

- 2026-11-09 10:59 AM ET (LT6, fishing): two catch-log entries (River Trout and Voltfin Piranha, 28% quality) that can't be labeled or deleted (FIX-fishing-004); possibly a QA Ask message in the shared /lenses/chat?context=fishing thread; local download ~/Downloads/fishing-export-2026-11-09.json. The Feed post was deleted.

- 2026-11-09 11:03 ET, Lens Tester 2, courtship: the A (zukotest10101358) to B (zukotest210101829) courtship affinity was raised 93% to 100% by 4 Interact clicks. It can't be undone and there is no marriage.

## Careers (Lens Tester 3, 2026-11-09)
- No items were created. The QA account played a chef shift: tier 1, 63/100 XP, 15 sparks.
- Download on the box: careers-export-2026-11-09.csv

- 2026-11-09 11:04 AM ET (LT1, creatures): none on lens (Feed post deleted). Possible lingering Ask conversation at `/lenses/chat?context=creatures` (question answered via creatures.species; not verified deleted).

## Meditation (Lens Tester 3, 2026-11-09)
- Session 7 (3m focus, 4 stars) and the journal "QA LT3 meditation 2026-11-09 Journal calm focus". The journal cannot be deleted.
- QA reminders were deleted.
- Download on the box: meditation-export-2026-11-09.json

- 2026-11-09 11:21 AM ET (LT1, quests): none on lens (Feed post deleted; no quests). Ask conversation may persist at `/lenses/chat?context=quests` (off-topic species reply; context bleed from creatures).

- 2026-11-09 11:28 AM ET (LT6, auction): none (Feed post qa-lt6-auction-2026-11-09-share deleted; no listing created). Ask attempt may persist at /lenses/chat?context=auction.

- 2026-11-09 11:36 ET, Lens Tester 2, housing (primary account): House qa-lt2-housing-2026-11-09-a (private, 5 placed items); house '-lt2-housing-2026-11-09-d <b>bold</b>' (private, misnamed by dropped keystrokes). Neither can be deleted. Listings -b and -c were deleted.
- 2026-11-09 11:35 AM ET (LT6, market): none.

- 2026-11-09 11:47 AM ET (LT1, finance): no site fixtures remain (QA snapshot + cash-flow tx + Feed post deleted; 3 pre-existing snapshots untouched). Local leftovers: `/home/box/Downloads/finance-export-2026-11-09.json` (~1.7 MB) and `/home/box/Downloads/finance-export-2026-11-09.csv` (1000 rows, unscoped — FIX-finance-004). Do not open/quote row titles (possible other-user data).
- 2026-11-09 12:00 PM ET (LT6, questmarket): quest `qa-lt6-questmarket-2026-11-09-main` left open with 1 QC escrowed (no cancel/delete UI). Feed post deleted. Ask attempt may persist in chat.

## Wellness (Lens Tester 3, 2026-11-09)
- Mood entry 'QA LT3 wellness 2026-11-09 mood' (no delete UI)
- CBT record TR-0001 (no delete UI)
- Self-composed field SF-0001 (revoked, still listed)
- Private minted DTU dtu_cc7e… (title lacks QA prefix)
- Metric entries incl. sleep 7.5/30, water -5, steps 0/1234, future-dated sleep 2026-11-10 import (no delete UI; list may hide them)

- 2026-11-09 12:04 PM ET (LT1, staking): 2 EARLY EXITED positions; 1 REDEEMED stFLEX receipt (backs stk_ed667a5a…); 2 CC early-exit penalties spent (in-app CC); possible empty Ask chat at `/lenses/chat?context=staking`. Feed post deleted.
- 2026-11-09 12:09 PM ET (LT6, civic-bonds, world subw_mw98uno8_vkkjs4): bonds qa-lt6-civic-bonds-2026-11-09-a (voting 0/2), -b (funding 0/1000, pledge refunded), -neg (proposed 0/5), -zero (proposed 0/1) — no cancel/delete UI. Feed post `qa-lt6-civic-bonds-2026-11-09-post` — no Delete in its menu. Ask attempt may persist in chat.
- 2026-11-09 12:20 PM ET (LT6, forge): project `qa-lt6-forge-2026-11-09-a` (saas, 1 version) — no delete UI. Feed post deleted. Ask attempt may persist in chat.

## Database (Lens Tester 3, 2026-11-09)
- None; all QA LT3 database items deleted and verified after reload.

## Literary (Lens Tester 3, 2026-11-09)
- Public feed post 'QA LT3 literary 2026-11-09 Share'
- Public feed post 'QA LT3 literary 2026-11-09 Mobile' (possibly duplicated)
- Chat message 'QA LT3 literary 2026-11-09 AI: in one sentence, what is the Literary lens?'
- 2026-11-09 12:35 PM ET (LT6, lab): notebook entry `qa-lt6-lab-2026-11-09-notebook` (1 revision) — no delete UI. Feed post deleted. Local file evidence/lab/lab-export-2026-11-09.json (and ~/Downloads copy).

- 2026-11-09 12:45 ET, Lens Tester 2, game (primary account): Playtest sessions qa-lt2-game-2026-11-09-a (Lv2, 40 XP, 3 turns) and -d (Lv1); no delete control. Habit c and stray 'qa-l' deleted; b deleted.
- 2026-11-09 12:43 PM ET (LT6, social): comment `qa-lt6-social-2026-11-09-comment` (no delete UI; parent post deleted, possibly orphaned). Ask msg `qa-lt6-social-2026-11-09-ask` may sit in chat. Download ~/Downloads/social-my-records.json. Posts deleted, reaction removed.

- 2026-11-09 12:50 PM ET (LT1, ethics): Multi-Framework results ('Recommended: A', 'Recommended: Release', qa-lt1-ethics-20261109 b items); Decision Matrix junk ('Winner: d'); Stakeholder Map Users/Public; Bias Checklist record (2/10); Ethics Review entry; possible case 'test dilemma'; possible Ask chat at `/lenses/chat?context=ethics`; clipboard had lens link (Copy Link).

## spectate — Lens Tester 4 — 2026-11-09 13:08 ET (released, partial walk)
- No fixtures created (notes show no saved spectate items; see evidence/spectate/desktop-notes.md). Partial evidence kept: d-01..08, m-01..03 (two mobile tab crashes code 9, 18.8 s message-handler stall).

- 2026-11-09 13:09 ET, Lens Tester 2, society (primary account): Agents qa-lt2-society-2026-11-09-a (paused), -b (emoji/tags name), -c (600-char name); private DTU dtu_dcf7… (Mint); saved chart soc_wv7iaisz3. None can be deleted.
- 2026-11-09 1:13 PM ET (LT6, fractal): presets and Feed post deleted. Possible new Chat conversation with `qa-lt6-fractal-2026-11-09-ask` (tab crashed before cleanup).
- 2026-11-09 1:25 PM ET (LT6, social retest): zukotest #2 (6af5da0d-…) FOLLOWS primary QA account (no unfollow UI). DM thread between them: 'qa-lt6-social-2026-11-09-dm hello from LT6', reply 'qa-lt6-social-2026-11-09-dm-reply', 2 'Message taken back' tombstones.
- 2026-11-09 1:31 PM ET (LT6, timeline): posts a/b/c deleted; possible Chat conversation left from Ask (context=timeline).
- 2026-11-09T13:33-05:00 Lens Tester 2 / forecast: DTU dtu_2d92ba75832d447d8b80 (private, 'Save forecast as DTU'); no delete control in lens.
- 2026-11-09T13:33-05:00 Lens Tester 2 / forecast: DTU dtu_21616acfc71ba44f50c0 (private, Open-Meteo San Francisco 7-day); no delete control in lens.
- 2026-11-09 1:33 PM ET (LT2, forecast + cognitive-replay): possible Chat conversations left from Ask (context=forecast, context=cognitive-replay).

## Reasoning (Lens Tester 3, 2026-11-09)
- Chains 'QA LT3 reasoning 2026-11-09 chain smoke test' and '... Mobile'
- HLR traces '... 300-char text validation' and '... HLR smoke test: Does the conclusion follow?'
- Private derivation DTU dtu_a84a… (no delete UI)

## Anon (Lens Tester 5, 2026-11-09)
- DM conversation anon-dc30d61c (QA acct 1) <-> anon-4700fae0 (QA acct 2): 'qa-lt5-anon-2026-11-09 hello'/'reply' (no delete UI)
- QA acct 1 pseudonym rotated anon-7f8b1fbc -> anon-dc30d61c
- DP budget left reset; no DTU saved
- 2026-11-09 1:47 PM ET (LT6, event-timeline): share post deleted; Ask Q&A appended to pre-existing chat 'What species live in this world?'; downloads /home/box/Downloads/event-timeline-2026-11-09T18-33-3{5.csv,6.json}.
- 2026-11-09 1:53 PM ET (LT6, meta): service + feed post deleted; possible Chat conversation 'qa-lt6-meta-2026-11-09-ask'.

- 2026-11-09 1:56 PM ET (LT1, voice): PUBLIC speech report `/dtu/dtu_56c7c93951c07d2320b8` (not recalled); private DTU `dtu_a5ba…`; Meetings session `qa-lt1-voice-20261109 b` + orphan `Live session 11/9/2026 1:29:04 PM`; transcripts `qa-lt1-voice-20261109 c` and 120-x title row; ~10 stray Booth takes (deletes don't persist — FIX-voice-002); Analyze fields left with `abc`; possible Ask chat `/lenses/chat?context=voice`; downloads `~/Downloads/voice-export-2026-11-09.json`, `.csv`, `voice-1794248463608.dtu`; accidental click/ctrl+a/`-5` into Markets tab (no visible effect).

## Invariant (Lens Tester 3, 2026-11-09)
- Public feed post about 'QA LT3 invariant 2026-11-09 Monitor'
- Violation History rows (2, one resolved) under removed QA monitor name; chat message from Ask about Invariant
- 2026-11-09 2:09 PM ET (LT6, observe): telemetry metric qa-lt6-observe-2026-11-09-metric remains (no delete UI); dashboard, monitor, feed post deleted.
- 2026-11-09 2:10 PM ET (LT6, billing): PAUSED before any results; no fixtures expected.

## Self (Lens Tester 5, 2026-11-09, paused at 2:10 PM ET)
- None confirmed. The run was stopped within about a minute of starting. Any qa Water reading or Water goal on the QA account comes from this run.

## productivity (LT1, paused 2026-11-09 2:09 PM ET)
- Task 'qa-lt1-productivity-20261109 a' (P1, due 2026-11-10) created in Tasks, then marked complete (in Completed section). No delete performed.
- Possibly a ~300-char title / invalid-date probe left typed in Quick add/Tasks inputs (not submitted per notes).
- 2026-11-09 2:10 PM ET (LT2, eco, paused): a/b/c deleted; possible d/e/f from an interrupted pass (unverified); possible Ask chat (context=eco); local downloads eco-1794249643286.dtu + JSON/CSV exports on the box.

## Global (Lens Tester 3, 2026-11-09, paused)
- Public feed post 'QA LT3 global 2026-11-09 Share' (no delete UI)
- Chat message 'QA LT3 global 2026-11-09 AI: in one sentence, what is the World Bank GDP indicator?'
- Saved view deleted (none left)

## Self (ZT5, 2026-11-09)
- Water readings on the main QA account dated 2026-11-09 can't be deleted from the UI: a pre-existing 999999997 ml reading (from the earlier interrupted run), plus ZT5's four test readings (empty, -5, 99999999 and 7). Today's Water total shows 1099999998 ml and the ledger shows 10 readings. A Water goal of 8 was created and removed. More may be added by pass 2 (import).
- One imported Steps reading of 1 dated 2026-11-09 (source Other) can't be deleted from the UI. The ledger total is now 11. The layout is left as 'custom layout' with the default tiles, because there's no reset in the UI.

## Billing (ZT2, 2026-11-09)
No delete UI for any Subscription Billing record, so these remain on the main QA account: plans qa-zt2-billing-2026-11-09-huge (USD 1e20) and qa-zt2-billing-2026-11-09-nt; subscriptions for customers qa-zt2-billing-2026-11-09-a and -b (both canceled; -a has one 5-unit metered event); coupon QA-ZT2-BILLING-2026-11-09-C (100%, 1 redemption); dunning case USD 7.77 card_declined (recovered); one unlabeled Tax Summary DTU.

## Spectate (ZT2, 2026-11-09)
Possible chat conversation on the main QA account containing 'qa-zt2-spectate-2026-11-09: what can I do here?' (question never displayed; not verified or deleted).
- 2026-11-09 2:52 PM ET (ZT1, global): LT3 public feed post 'QA LT3 global 2026-11-09 Share' DELETED by ZT1. ZT1 saved view deleted. Remaining: LT3 Ask chat message in Chat (context=global); Saved Views card still reads 1 with no visible view (FIX-global-008).
- 2026-11-09 3:05 PM ET (ZT1, byo-keys): Org key group 'qa-zt1-byo-keys-2026-11-09' (anthropic, owner only) remains — no delete UI. Fake keys, caps, limits, fallback chain all deleted; mode restored to Private.
- 2026-11-09 3:10 PM ET (ZT4, eco): LT2 saved locations 'qa-lt2-eco-2026-11-09-d…' (600-char label) and 'qa-lt2-eco-2026-11-09-e 😀 <b>bold</b>' remain on the main QA account (Air > Local environmental alerts). Not deleted by ZT4 (other tester's fixtures). ZT4 fixtures a/b deleted.

## Code Quality (ZT5, 2026-11-09)
- Scan history entries `qa-zt5-code-quality-2026-11-09` and `qa-zt5-code-quality-2026-11-09-b` (no delete UI). Pre-existing harness Issues (3 CRITICAL harness value, 2 HIGH no-eval zukotest) left untouched.
- 2026-11-09 3:19 PM ET (ZT1, cognition): Private DTU dtu_7db8134f452be6deaed0 'qa-zt1-cognition-2026-11-09' remains (no delete UI on /dtu page). Question log items deleted.
- dx-platform (ZT1, 2026-11-09): Workbench codebase and team 'qa-zt1-dx-platform-2026-11-09' remain — no delete UI (FIX-dx-platform-001).
- 2026-11-09 3:33 PM ET (ZT4, custom): possible Chat message 'qa-zt4-custom-2026-11-09-c — What is this Custom lens for?' from Ask about Custom on the main QA account; not found, not deleted. Canvases a/b deleted.
- 2026-11-09 3:42 PM ET (ZT4, export): own export-history entries remain on the main QA account (no per-entry delete; Clear history not used because it holds a pre-existing schedule's entry). Schedules/destination deleted.

## Crypto (ZT2, 2026-11-09)
Wallet qa-zt2-crypto-2026-11-09-w and contact -c deleted. Left: Ask chat thread 'qa-zt2-crypto-2026-11-09: what can I do here?' on the main QA account; downloaded exports in /home/box/Downloads/crypto-export-2026-11-09*.

## productivity (Zuko Lens Tester 3, 2026-11-09 3:50 PM ET)
- Quick capture 'qa-zt3-productivity-2026-11-09 g capture gnk' (id lart_a09dd3f0…): not listed in the lens and has no delete UI; shows only in the export.
- Subtask 'qa-zt3-productivity-2026-11-09 e subtask' and comment '... f comment': no separate delete; parent task a was deleted, so these may be orphaned.
- LT1 task 'qa-lt1-productivity-20261109 a' (completed) was left in place.
- Box downloads: productivity-export-2026-11-09*.csv/json.

## Debug (ZT5, 2026-11-09)
- One trace `lens.debug bootstrap` captured about 3:44 PM ET (258 ms, 3 spans) — no delete UI (FIX-debug-013).
- One Sample Runtime set (`heap_used_mb`, `page_load_ms`, `macro_latency_ms`; 1 sample each, 3:44:16 PM ET; heap 19.19) — no clear/delete UI (FIX-debug-014).

## Fork (ZT5, 2026-11-09)
- 13 event DTUs ingested from `octocat/Hello-World` via Pull feed about 3:57 PM ET — not deletable from the Fork lens UI (FIX-fork-011).

## Legacy (ZT5, 2026-11-09)
- Possible orphan Debt Trend snapshot for deleted codebase `qa5` (debt index 0, ~4:01 PM ET). Debt Trend UI only appears when a codebase is selected, so the snapshot cannot be verified or deleted from the UI after codebase delete (FIX-legacy-008).

## import (ZT4, 2026-11-09)
- 7 Import History records from qa-zt4-import uploads (4 completed, 3 failed) on the main QA account. The UI has no delete control (FIX-import-004). Vault items are deleted.

## mesh (ZT4, 2026-11-09)
- 2 Messages-tab log entries on the main QA account: "qa-zt4-mesh-2026-11-09-c <b>bold</b> 😀" and a 600x"x" string. The lens has no delete control, so they need backend cleanup.
- mesh: confirmed after the final walk. The 2 messages remain (no delete). The -d, -e and -f fixtures were never created or have been deleted.

## Integrations (ZT2, 2026-11-09)
- Workflow qa-zt2-integrations-2026-11-09-ed deleted (verified after reload). No webhook persisted. The Ask prompt (~4:00 PM ET) may have appended to the existing qa-zt2-crypto chat thread.

## Queue (ZT5, 2026-11-09)
- One completed-count increment on the shared `autocrawl` queue about 4:40 PM ET from test job `qa5` (Low, `{}`). The job itself was removed; the 24 h completed counter side effect remains (FIX-queue-001 related).

### ZT3 update 2026-11-09 4:47 PM ET
- productivity: quick captures 'c' and 'g capture gnk' DELETED via /lenses/dtus My Vault row menu (evidence/productivity/shots/C02-captures-deleted.png). Productivity's own panel has no delete for captures (FIX-productivity-006 stands).
- lattice: DTU c and chat b deleted; none left.
- psyops: Ask created an unlabeled chat 'What is the psyops lens for?' (3 messages, main QA account), left in place.

## Repair-telemetry (ZT2, 2026-11-09)
- None. Ask thread created and deleted (verified by search).

## Sentinel (ZT5, 2026-11-09)
- Undeletable threat report: severity-1 `exploit` description `qa5`, submitted about **5:15 PM ET**. Toast said it was added to the collective threat lattice. No UI to view, edit, or retract. Did not appear in Triage. Shield Security score dropped 35→17 (FIX-sentinel-001 / 002). Pre-existing Triage case "zt threat" (other tester) left untouched.

## Sandbox (ZT2, 2026-11-09)
- None. All qa-zt2-sandbox loadouts/dummy presets and the Ask thread were deleted (lists show empty).

## System (ZT2, 2026-11-09)
- None. Temporary default CPU % dashboard panel removed (reload shows 0 panels). Ask about System produced no visible thread.
- Sandbox run 2 (5:47 PM ET): qa-zt2-sandbox-2026-11-09-r2 presets and a default 'Fist loadout' created then deleted; none left.

## Worldmodel (ZT5, 2026-11-09)
- Snapshots for entities **qa5** and **qa5b** (no delete UI) — FIX-worldmodel-001. Remain after cleanup.
- Simulation runs for **qa5** (incl. total **217.1**) — no delete UI for saved runs — FIX-worldmodel-001. Remain.
- Entity fixtures **qa5** and **qa5b**: DELETED (each via confirm dialog). After reload ~6:07 PM ET header **1 entity / 0 relations**. Only pre-existing `tzl026220427mi name harness value` (value 0) remains; untouched. World state back to pre-test.
- 2026-11-09 ~5:50 PM ET (ZT5 pass2): one-click Restore on qa5 snapshot (no confirm) had temporarily resurrected deleted qa5/qa5b + relation (1E/0R → 3E/1R); cleanup re-deleted both. Library scenario deleted. Snapshots/sim runs still undeletable (FIX-worldmodel-001 / 002 HIGH).

## sync (ZT4, 2026-11-09)
- Devices qa-zt4-sync-2026-11-09-a/-b revoked. The Sync activity history still lists their register, quota, prepare and revoke events, and there is no delete control.

## App-maker (ZT2, 2026-11-09)
- App qa-zt2-app-maker-2026-11-09-counter deleted (verified). Ask messages (System ~5:40 PM and App Maker ~6:05 PM) sit in a QA chat thread titled 'What is the purpose of the System lens…'; left in place.

## Creative-writing (ZT5, 2026-11-09)
- Page **qa5** (body `qa5 test`) — no edit/rename/delete UI (FIX-creative-writing-001 HIGH). Remains after walk ~6:20 PM ET. Pre-existing harness pages (`tz1026191421rx…`) left untouched.

## Podcast (ZT5, 2026-11-09)
- None. Episode qa5/qa5b created, renamed, deleted with confirm; empty after reload.

## Game-design (ZT2, 2026-11-09)
- Game project `qa-zt2-game-design-2026-11-09-jump-mechanic` (platformer/PC, ~6:20 PM ET) remains: no delete control in the UI (FIX-game-design-001). Mechanic and scratch beat deleted. The Ask question produced no visible thread.
- 2026-11-09T18:51:43-05:00 ZT1 vault: TheVault submission 'qa-zt1-vault-2026-11-09' (status Withdrawn) — no delete UI (FIX-vault-001).

## Astronomy (ZT5 pass 1, 2026-11-09)
- None from pass 1 (target qa5 deleted). See pass 2 leftover session below.

## Atlas (ZT2, 2026-11-09)
- None. Saved place qa-zt2-atlas-2026-11-09-main(-ed) and the Ask thread were deleted.

## Podcast QA rework (ZT5, 2026-11-09 ~7:17 PM ET)
- None. No qa5 episode, NASA unsubscribed (count 0), playback speed 1x, NASA auto-download off.

## Creative-writing Narrative trail rework (ZT5, 2026-11-09 ~7:24 PM ET)
- None new. Start over → No walk open. Prior qa5 page leftover still undeletable (FIX-creative-writing-001).

## Geology (ZT2, 2026-11-09)
- None. Observation qa-zt2-geology-2026-11-09-outcrop and the Ask thread were deleted.

## Astronomy (ZT5 pass 2, 2026-11-09 ~7:39 PM ET)
- **Session `2026-11-09 · qa5`** — created in Observing Log > Sessions; **no edit/delete UI** (FIX-astronomy-008). Cannot remove. Form field was Location (not target).
- Gear qa5 deleted (no confirm — evidence on FIX-astronomy-002).
- Pass 1 target qa5 was deleted earlier.

## Robotics (ZT5 pass 1, 2026-11-09 ~8:00 PM ET)
- None from pass 1 at that time. See pass 2 possible leftover below.

## Ocean (ZT2, 2026-11-09)
- None. Spot qa-zt2-ocean-2026-11-09-spot and the Ask thread were deleted.

## Robotics (ZT5 pass 2, 2026-11-09 ~8:21 PM ET; leftover recheck 8:33 PM ET)
- **RESOLVED.** Robot `qa5` cleanup **VERIFIED PASS** after reload: Fleet shows *No robots registered yet. Register your first robot above to start managing a fleet.* Evidence: `evidence/robotics/zt5-pass2/fleet-empty-after-reload-1.webp` (ce23a760), `fleet-empty-after-reload-2.webp` (2fe5aafe). Mission already clean.

## Debate (ZT5 pass 1, 2026-11-09 ~8:33 PM ET)
- None. No debate created this pass.

## Debate (ZT5 pass 2, 2026-11-09 ~8:41 PM ET, released at handoff)
- None. Cleanup **VERIFIED**: 0 debates, 0 arguments, *No debates yet.* after Remove + reload (`evidence/debate/zt5-pass2/cleanup-empty-after-reload.webp` / 5998d833).

## Debate (ZT5 pass 3, 2026-11-09 9:29 PM ET, closed 2026-11-09 9:34 PM ET)
- None. Cleanup **VERIFIED**: *No debates yet.* after Remove + reload (`evidence/debate/zt5-pass3/cleanup-empty-after-reload.png` / 4370fe18). Fixture `qa-zt5-debate-2026-11-09` removed.

## Debate (ZT5 AI recheck ~9:41 PM ET, closed 2026-11-09 10:10 PM ET)
- None. Fixture `qa-zt5-debate-ai-2026-11-09` removed. Cleanup **VERIFIED**: *No debates yet.* after reload (`evidence/debate/zt5-pass3/ai-cleanup-empty-after-reload.webp` / 7d271790).

## Analytics (ZT2, 2026-11-09, released at handoff)
- Events tracker event `qa-zt2-analytics-2026-11-09-event` / user `qa-zt2-analytics-2026-11-09-user` (~8:20 PM ET). It remains because there is no delete control.
- Ask thread "From this Analytics lens, summarize the current total DTUs, posts, and engagement rate…" (~8:30 PM ET). It may remain; it was not deleted before the stop.
- The QA dashboard was deleted.

## ZT3 handoff check (2026-11-09 8:42 PM ET)
No ZT3 fixtures remain from narrative-walk, answers, frontier, history, space or projects; all were deleted and checked after a reload. The earlier psyops Ask chat entry above still stands. Pre-existing items I saw but don't own (left untouched): answers Q&A "tz1017155101gt title harness value"; history "zukotest r89 history persistence probe 1"; space launch watch/satellite "tz1026220427mi name harness value"; projects VZ1026 and TZ1026.
- mentorship (ZT1, 2026-11-09 8:42 PM ET): Workspace goal 'qa-zt1-mentorship-2026-11-09' (active, 0%). The Goals view has no delete action and it isn't a DTU in My Vault, so it couldn't be deleted. Evidence: evidence/mentorship/zt1-step11-cleanup-reload-20261109.png

## Analytics (ZT2, 2026-11-09, completed 9:03 PM ET)
- Update: the Ask thread was deleted in run 3. Still LEFT: tracked event qa-zt2-analytics-2026-11-09-event (no delete control, FIX-analytics-004).
- mentorship update (ZT1 9:11 PM ET): goal 'qa-zt1-mentorship-2026-11-09' set to paused; still no delete UI (FIX-mentorship-001).

## ZT3 world (2026-11-09 9:56 PM ET)
- Chat conversation titled "what is this lens for?" in /lenses/chat (main QA account), created about 9:15 PM by the world-ledger Ask check. Not deleted, because I ran out of usage. There may be two of them; delete any "what is this lens for?" chat from about 9:15 PM.
- UPDATE 9:58 PM: resolved. A search for "what is this lens for?" (also after reload) shows no matching conversations; the send never persisted. No ZT3 world fixtures remain.

- 2026-11-09 ~10:05 PM ET (ZT1 supplychain): double-click on scenario trash (no confirm/undo) deleted the QA scenario AND one pre-existing scenario in the main QA account; one "NONE / resilient" remains. Pre-existing scenario was not a logged tester fixture. Not restored (no restore clicks allowed). FIX-supplychain-001 HIGH. Evidence: evidence/supplychain/zt1-step11b-scenario-delete-20261109.webp

## Telecommunications (ZT5, walk ~9:43–10:05 PM ET, closed 2026-11-09 10:10 PM ET)
- None. Cleanup **VERIFIED** after hard reload: Site map (0), no `qa-zt5` text (`evidence/telecommunications/zt5/cleanup-site-map-0.png` / e51234a1).

## Concord-link-frontier (ZT2, 2026-11-09, completed 10:15 PM ET)
- Link `qa-zt2-concord-link-frontier-2026-11-09-run2` (bearing `qa-bearing-initial`) remains: no delete/rename control exists in the UI (FIX-concord-link-frontier-003). Evidence: `evidence/concord-link-frontier/cleanup-bearing-editor-no-delete.webp`, `cleanup-overflow-no-delete.webp`.
- `Mark the link` and Bridge/global write actions were not activated (shared-state risk).
- Ask reply was a Chat conversation, not a listed Thread, so no thread was deleted.

## Parenting (ZT2, 2026-11-09, paperwork 10:55 PM ET)
- Child `qa-zt2-parenting-2026-11-09-validation` remains — **cleanup retry pending**. It has two persisted `999999999999 kg` growth measurements. One exact click on the child chip's Remove control in Baby Care timed out; after reload the chip and records were still present. No second Remove click was made (destructive-click rule). Evidence: `evidence/parenting/growth-huge-values.png`, `m390-growth.png`, `run1-report.md`.
- Core child `qa-zt2-parenting-2026-11-09-core-child` was deleted and absence confirmed after reload (`cleanup-core-child-deleted.png`).
- Ask about Parenting was appended to a pre-existing unrelated Link Frontier Chat thread (four messages); that thread was not deleted (FIX-parenting-005).
- UPDATE 11:12 PM ET (ZT2): Child `qa-zt2-parenting-2026-11-09-validation` is **cleaned**. One Remove click (no confirm) on the exact child chip deleted it; absence confirmed after a 30s wait + reload (`evidence/parenting/cleanup-retry-before.webp`, `cleanup-retry-after-reload.webp`). The first Remove had timed out and did nothing visible; this second attempt, after reload, deleted it. Core child was already deleted. Ask-thread leftover (FIX-parenting-005) still stands.

- ZT1 2026-11-09T23:09:15-05:00: world-observatory lens artifact `lart_fed50287975d84969e5c` titled qa-zt1-world-observatory-2026-11-09 (private Quick capture). Its DTU was deleted, but the artifact remains and still exports; there's no UI to delete it (FIX-world-observatory-009).

- ZT1 2026-11-09T23:12:14-05:00: sports 'Pull feed' ingested the DTU 'San Jose Sharks vs New York Islanders (result pending)' (thesportsdb-fixtures) into the main QA account's My Vault. Left in place because it isn't a titled QA fixture (FIX-sports-007).

## Telecommunications (ZT5 rework 2026-11-09 11:00–11:19 PM ET, logged 2026-11-09 11:31 PM ET)
- None new. Cleanup **VERIFIED** again (`evidence/telecommunications/zt5-rework/site-gone-after-reload.png` / b88362cd). Claim remains IN_PROGRESS only because load timing is UNVERIFIED.

## Cooking (ZT5, 2026-11-09 11:00–11:19 PM ET, logged 2026-11-09 11:31 PM ET)
- ZT5: none. Fixture `qa-zt5-cooking-2026-11-09` deleted with inline confirm; gone after reload (Recipes 2).
- Pre-existing (another harness, **not ZT5**, left untouched): two recipes titled `tz1026191421rx title harness value`. Not already listed under Cooking. They also show broken image placeholders (FIX-cooking-005).

## Black-market (ZT2, 2026-11-10 12:05 AM ET; watchlist path verified 12:38 AM ET)
- Watchlist fixtures `qa-zt2-black-market-2026-11-10-watch` and `qa-zt2-black-market-2026-11-10-invalid` were created and both deleted (one click each, no confirm; gone after 30s + reload). No watch leftovers. List/buy/bid/post/publish were not submitted (shared-state risk).
- Ask about Black Market was appended to a pre-existing unrelated Link Frontier Chat thread; that thread was not deleted (FIX-black-market-006, same routing as FIX-parenting-005).

- 2026-11-10 12:21 AM ET, ZT4, wallet: Quick capture note 'qa-zt4-wallet-2026-11-09-note' (body 12345) on the main QA account. There's no delete control; it's visible only as an Activity Timeline entry. See FIX-wallet-009.

## Disputes (ZT5, pass 1 + gap checks, closed 2026-11-10 12:28 AM ET)
- **ODR case `qa-zt5-disputes-2026-11-09`** (#10, Open, Not As Described, opened 11/9/2026 11:49:27 PM ET). **No delete/withdraw/close/archive control** (FIX-disputes-003 HIGH). Remains in ODR totals after reload (4 total, 1 active). Cannot remove. Pre-existing `qc1231-*` cases left untouched.
- 2026-11-10 12:35 AM ET, ZT4, hr: former employees 'qa-zt4-hr-2026-11-09-a' (with open onboarding task 'qa-zt4-hr-2026-11-09-a onboarding task') and 'qa-zt4-hr-2026-11-09-c <b>bold</b>' on the main QA account. They're offboarded, but there's no permanent delete (Rehire only). See FIX-hr-003.

## Marketing (ZT2, 2026-11-10 12:38 AM ET)
- Campaign `qa-zt2-marketing-2026-11-10-case1` was deleted (one click, no confirm; gone after 30s + reload; campaigns returned to 0). No marketing-record leftovers.
- Ask about Marketing was appended to a pre-existing unrelated Link Frontier Chat thread; that thread was not deleted (FIX-marketing-003, same routing as FIX-parenting-005 and FIX-black-market-006).

## Mental health (ZT1, 2026-11-10 1:15 AM ET)
- Main QA account: a mood check-in (3/5, note 'qa-zt1-mental-health-2026-11-10') and a gratitude journal entry 'qa-zt1-mental-health-2026-11-10' dated 2026-11-10 remain; the UI has no edit or delete for either (FIX-mental-health-001). Factor fixture deleted and verified.

## Veterinary (ZT4, 2026-11-10 1:40 AM ET)
- Billing: unpaid invoice `qa-zt4-veterinary-2026-11-10` ($25.00, line `qa-zt4-veterinary-2026-11-10-inv`), no delete/void control; 'Record payment' not touched (FIX-veterinary-007).
- Pharmacy: prescription `qa-zt4-veterinary-2026-11-10-rx`, active, no delete/discontinue (FIX-veterinary-008). Both orphaned after the patient was deleted.

## Marketing (ZT2, 2026-11-10, Hub + Studio rework 1:39 AM ET)
- All named rework fixtures were deleted once and hard-reload-confirmed absent: `qa-zt2-marketing-2026-11-10-lead`, `-abtest`, `-email`, `-workflow`, `-landing`, `-score`, `-roas`, and the SEO audit result `https://example.com`. Run 1 campaign `qa-zt2-marketing-2026-11-10-case1` was already deleted at 12:38 AM ET.
- LEFT: Quick Analysis result card (`250% ROI` / `ROI 250% · exceptional`, spend $1,000 / revenue $3,500 for deleted campaign `qa-zt2-marketing-2026-11-10-roas`) remained visible after campaign deletion and reload. It is an analysis output, not a campaign record (FIX-marketing-015). Evidence: `evidence/marketing/rework-7-quick-analysis.png`, `evidence/marketing/run1-report.md` Rework Fixture status.
- Prior leftover still stands: Ask Q&A on a pre-existing Link Frontier thread (FIX-marketing-003).

## Automotive (ZT2, 2026-11-10 2:08 AM ET)
- Named fixtures were deleted and list-empty after reload: `qa-zt2-automotive-2026-11-10-vehicle` (and its fuel/service/reminder/expense/trip/document/renewal children, removed with the vehicle confirm) and `qa-zt2-automotive-2026-11-10-car2` (children deleted one-by-one with no confirm, then the vehicle via the generic “Delete this vehicle and all its records?” confirm in Cleanup 2).
- LEFT (not a visible named fixture): Garage summary stayed stale after both deletes — Vehicles 1 after car2 (`evidence/automotive/cleanup2-after.png`); after the first vehicle also 1 vehicle / $197 spend / 2 logged entries (`cleanup-after-reload.png`, `resume-A-garage-empty-after-reload.png`). Possible orphaned records or a stale aggregate (FIX-automotive-001). No vehicle row remains in the Garage list.
- Ask about Automotive was opened as a new Chat conversation (the existing Marketing thread was not touched). That new thread was not reported deleted.

## Forestry (ZT4, 2026-11-10 2:33 AM ET)
- Pests & Replanting > Pest & Disease Tracking: report `qa-zt4-forestry-2026-11-10-pest` (low, 1 ac, open), no delete control (only Schedule).

## HVAC (ZT2, 2026-11-10 2:48 AM ET)
- Jobs: `qa-zt2-hvac-2026-11-10-run1-job` remains. Exact-row Confirm delete was used twice (30s wait + reload after each); the record and 1 Job / 1 Open summary persisted. Cannot delete via UI (FIX-hvac-001). Evidence: `evidence/hvac/case1-job-confirm.png`, `case1-job-after-delete.png`, `fu-jobs-reload.png`.
- CRM: `qa-zt2-hvac-2026-11-10-client` remains (Description `Follow-up CRUD QA edit.`). The in-row Confirm delete? prompt disappeared before it could be clicked; after 30s + hard reload the client and 1 Client / 1 Open summary were still present. Cannot delete via UI (FIX-hvac-002). Evidence: `evidence/hvac/fu-crm-delete-state.png`, `fu-crm-after-delete-check.png`.
- Loads: saved estimate `load_mwada82x_z0zqqm` (`1,000 sf temperate · 25,000 BTU cool`) remains listed with no visible edit/delete control. Cannot delete via UI (FIX-hvac-003). Evidence: `evidence/hvac/fu-loads-fixture-status.png`. Save load as DTU was not clicked.
- Ask: the HVAC question was appended to a pre-existing Automotive Chat thread (title begins “What is the primary job this Automotive lens supports…”) and returned `handler_error`. That thread was not deleted (FIX-hvac-004). Evidence: `evidence/hvac/case9-ask-hvac.png`.

## Construction (ZT1, 2026-11-10 2:58 AM ET), uncleaned, BLOCKED
- These are probably on the main QA account: 9 records named `qa-zt1-construction-2026-11-10`: Job ($1,100), Estimate ($330), MaterialTakeoff, Inspection, SafetyReport, CrewAssignment, Document, Punch item #3, Daily log 2026-11-10. Cleanup isn't possible because the main Chrome profile has shown a different, empty account since about 2:39 AM ET (Zuko is investigating). Delete them by name once the main account is back.

## Electrical (ZT4, 2026-11-10 3:00 AM ET)
- Panel `qa-zt4-electrical-2026-11-10-tool` (200A) seen in Electrical > Panel at about 2:45 AM. It was created before the shared-session flip and may sit on another account. Per Zuko, not hunted.

- 2026-11-10 3:12 AM ET (ZT2): hvac leftovers (qa-zt2-hvac-2026-11-10-run1-job, qa-zt2-hvac-2026-11-10-client, load_mwada82x_z0zqqm) may be on zuko_qa_admin or zukotest10101358 due to a session flip; whichever account holds them.

## Landscaping (ZT5, 2026-11-10 3:20 AM ET)
- Job `qa-zt5-landscaping-2026-11-10` (scheduled, QA Crew, client QA Test Client, 1 Test Lane, 2026-11-10 8:00, 2h) remains on **@zukotest10101358**. There is **no delete, remove, cancel, or archive control** on the job row (FIX-landscaping-002 HIGH, RCA-missing-delete-confirm). The owning Chrome session expired about 2:58 AM ET and cannot be signed back in safely (Zuko is investigating). A later walk at 3:07–3:14 AM ET on **zuko_qa_t1** showed “No jobs match this filter” and cannot reach this job. Pre-existing harness jobs `tzI026220427mi*` were left untouched. Needs backend cleanup on @zukotest10101358 once that account is reachable again.

## Pharmacy leftovers from the 2:45 AM ET return (ZT5, logged 2026-11-10 3:20 AM ET)
- These were not logged at the original pharmacy close (2:30 AM ET, cleanup then verified for `qa-zt5-pharmacy-2026-11-09`). They were created in the later return rework on **@zukotest10101358** and are now unreachable because that session expired about 2:58 AM ET and cannot be signed back in safely:
  - Cancelled appointment `qa-zt5-pharmacy-2026-11-10`.
  - Medication `qa-zt5-pharmacy-2026-11-10-med`.
  - The refill request on that medication — the UI has **no delete control** for the refill request.
- Needs backend cleanup on @zukotest10101358 once that account is reachable again. Do not hunt these fixtures on zuko_qa_t1.
- (3:42 AM ET) Forestry, account zuko_qa_t1: replanting project `qa-zt4-forestry-2026-11-10-replant` (2 ac, 870 seedlings, ordered). There's no delete control (FIX-forestry-004). The -pest report isn't visible on zuko_qa_t1, so it's on the pre-flip account.

## Masonry (ZT2, 2026-11-10 3:42 AM ET)
- LEFT on account **zuko_qa_t1**: proposal draft `qa-zt2-masonry-2026-11-10-proposals` (`PROP-1001`, fake client `QA Client zt2`, total $1.15, DRAFT). Created and hard-reload-persisted during the follow-up CRUD sweep. The row has no Edit or Delete control (FIX-masonry-001, high). Evidence: `evidence/masonry/fu-proposals-created.png`, `fu-proposals-persisted.png`.
- Takeoff `qa-zt2-masonry-2026-11-10-deleteprobe` was deleted with a confirm that named the fixture; after 30s + hard reload, Saved takeoffs (0) / “No takeoffs yet.” (`01-probe-deleted.png`). Not a leftover record (stale preview only; FIX-masonry-004).
- The 300-character takeoff submit created no record. No other `qa-zt2-masonry-*` fixtures were created. Schedule, Change Orders, Price Book, Invoices, Clients, Inspections, Certifications, and Photos were not exercised after the proposal proved undeletable.
- Ask thread titled “What can I estimate and track in the Masonry lens, and what” (truncated; 3 messages, 03:35–03:36 AM ET) was not reported deleted (FIX-masonry-008).
- (4:32 AM ET rework): PROP-1001 still stands on zuko_qa_t1. Additional leftovers and cleaned fixtures are under "Masonry rework on zuko_qa_t1" below.

## Pharmacy rework leftovers on zuko_qa_t1 (ZT5, 2026-11-10 3:44 AM ET)
- Walk 3:14–3:32 AM ET on **zuko_qa_t1** after the main @zukotest10101358 session expired about 2:58 AM ET and could not be signed back in safely. These are separate from the earlier main-account leftovers (`qa-zt5-pharmacy-2026-11-10` cancelled appointment, `qa-zt5-pharmacy-2026-11-10-med`, and its undeletable refill request), which still stand and were not retested.
- Archived medication `qa-zt5-pharmacy-2026-11-10-t1med` (1 mg). Archive was one-click with no confirm (FIX-pharmacy-002). My Meds is empty after reload, but child records remain.
- Its logged dose: 08:00 on `qa-zt5-pharmacy-2026-11-10-t1med` was Taken (1/2 DOSES TODAY, 2% ADHERENCE 30D) with **no undo or delete** (FIX-pharmacy-011). After archive the My Meds dose list is empty, but the taken-dose history may still exist.
- Its refill request, still **Requested** / Processing after the medication was archived, **no delete/remove/cancel** (FIX-pharmacy-009, 013 HIGH). OPEN REQUESTS stayed 1 while MEDS returned to 0.
- Price Compare entry **qa-zt5 Test Pharmacy, $9.99** (on the t1med compare chip), persisted after reload, **no remove control** (FIX-pharmacy-010).
- Health journal note `qa-zt5-pharmacy-2026-11-10 note` dated 2026-11-10, persisted after reload, **no delete control** (FIX-pharmacy-012).
- Appointment `qa-zt5-pharmacy-2026-11-10-t1` is **not** logged as still present: the form was filled and Schedule was clicked, but the date had been corrupted to 11/11/52026 (FIX-pharmacy-008) and no still shows it in Upcoming or Past. Do not hunt it on the main account.
- Needs UI or backend cleanup on **zuko_qa_t1**.

## HVAC rework on zuko_qa_t1 (ZT2, 2026-11-10 3:54 AM ET)
- Rechecked on **zuko_qa_t1** (`/api/auth/me` before every create/delete). Old run-1 leftovers are **ABSENT** on this account: Jobs search for `qa-zt2-hvac-2026-11-10-run1-job` returned no items; CRM search for `qa-zt2-hvac-2026-11-10-client` returned no items; Loads did not list `load_mwada82x_z0zqqm`. Those three, logged at 2:48 AM ET and flagged at 3:12 AM ET, therefore sit on the other account (suspected `zuko_qa_admin` session flip, or the old `zukotest10101358` account). This recheck confirms they are not on zuko_qa_t1. Evidence: `evidence/hvac/rw-job-old-leftover-check.png`, `rw-client-old-leftover-check.png`. The Ask turn on the pre-existing Automotive Chat thread (FIX-hvac-004) was not re-checked on t1.
- LEFT on **zuko_qa_t1**: job `qa-zt2-hvac-2026-11-10-rw-job` (Description `QA rework edit`; summary 1 Job / 1 Open). Edit persisted after hard reload. One Delete click showed `Confirm delete?`, which reverted before confirm could be clicked. After 30s + reload the job remained. Delete was not clicked again (FIX-hvac-001 CONFIRMED; FIX-hvac-013). Evidence: `evidence/hvac/rw-job-edit-reloaded.png`, `rw-job-delete-after-reload.png`.
- CRM `qa-zt2-hvac-2026-11-10-rw-client` was created, edited, persisted, and deleted with a prompt confirm; after 30s + reload CRM showed 0 records (FIX-hvac-002 RETRACTED/REVERIFIED_OK). Evidence: `evidence/hvac/rw-client-delete-after-reload.png`.
- LEFT on **zuko_qa_t1**: saved load estimate `load_mwag3cgh_4aj4jq` (1,800 sf test; 38,250 BTU/hr heating; 45,000 BTU/hr cooling; 3.8 ton). Clicking Calculate load auto-saved it with no explicit save or confirm (FIX-hvac-014). No edit/delete control (same class as FIX-hvac-003). Save load as DTU was inspect-only and not clicked (may publish into the shared library). Evidence: `evidence/hvac/rw-load-dtu-inspect.png`.

## Automotive Garage recheck on zuko_qa_t1 (ZT2, 2026-11-10 3:54 AM ET)
- Look-only on **zuko_qa_t1**: Garage shows “No vehicles yet” and no stale “Vehicles 1” summary count (the small `1` by Garage is its tab index). FIX-automotive-001 is NOT_REPRODUCED on this account; the original stale aggregate logged at 2:08 AM ET (Vehicles 1 after deletes; also $197 / 2 entries after the first vehicle) was likely from the session flip and may still exist on the other account (`zuko_qa_admin` or `zukotest10101358`). No vehicle was added. Evidence: `evidence/hvac/rw-automotive-summary.png`.
- Pharmacy appointment (11/11/2026, entered by ZT5 on zuko_qa_t1 ~3:20 AM ET) never showed in Upcoming/Past; may exist server-side as a leftover (FIX-pharmacy-008). Logged by coordinator 4:02 AM ET.

## Landscaping redo leftover on zuko_qa_t1 (ZT5, 2026-11-10 4:06 AM ET)
- Walk 3:32–3:53 AM ET on **zuko_qa_t1** after the main @zukotest10101358 session expired about 2:58 AM ET and could not be signed back in safely. The earlier leftover job `qa-zt5-landscaping-2026-11-10` on @zukotest10101358 (FIX-landscaping-002) still stands and remains unreachable from t1.
- LEFT on **zuko_qa_t1**: Proposal client suggestion `qa-zt5-landscaping-2026-11-10-client` with subtitle “No contact info yet”. It persisted after the 3:51:41 AM ET hard reload. The suggestion row has **no edit or delete control** (FIX-landscaping-010). Evidence: `evidence/landscaping/zt5-redo/127-05025-add-client-suggestion.webp`, `139-05204-client-leftover-no-contact-info-yet.webp`.
- Not leftover: garden bed `qa-zt5-landscaping-2026-11-10-bed` and planting `qa-zt5-landscaping-2026-11-10-plant` were deleted once; immediately after, BEDS and PLANTINGS were 0 (“No garden beds yet”). Health diary `qa-zt5-landscaping-2026-11-10-diary` and certification `qa-zt5-landscaping-2026-11-10-cert` were also deleted in-session. Built proposal `qa-zt5-landscaping-2026-11-10-proposal` did not persist after reload (FIX-landscaping-009) and is not a leftover record. No invoice was created. Pre-existing harness jobs `tzI026220427mi*` were not touched.
- Needs UI or backend cleanup of the t1 client suggestion on **zuko_qa_t1**.
- Update 4:15 AM ET (ZT1): the redo on zuko_qa_t1 was fully cleaned (9 '-t1' fixtures deleted, reload-verified). Main-account 'qa-zt1-construction-2026-11-10' x9 is still for a main-account tester.

## Masonry rework on zuko_qa_t1 (ZT2, 2026-11-10 4:32 AM ET)
- Rechecked and walked on **zuko_qa_t1** (`/api/auth/me` before every create/delete) for the 4:02 AM ET return. The earlier leftover proposal draft still stands and was not deleted (no Delete control).
- LEFT on **zuko_qa_t1**: proposal draft `qa-zt2-masonry-2026-11-10-proposals` (`PROP-1001`, fake client `QA Client zt2`, total $1.15, DRAFT). No Edit or Delete control (FIX-masonry-001, high). Evidence: `evidence/masonry/fu-proposals-created.png`, `fu-proposals-persisted.png`.
- LEFT on **zuko_qa_t1**: change order `qa-zt2-masonry-2026-11-10-change-orders` (`CO-001 · $0.00`, PENDING, scope “QA-only scope; no external commitment”). It persists after reload (late load ~1.9 s). The row offers only `Approve & sign` and `Reject`; no Edit or Delete (FIX-masonry-015, high, RCA-missing-delete-confirm). Left untouched because `Approve & sign` is a signing action. Evidence: `evidence/masonry/rw-change-orders-reloaded-late.png`, `rw-change-orders-reloaded.png`.
- LEFT on **zuko_qa_t1**: inspection `qa-zt2-masonry-2026-11-10-inspections` (`INSP-001`, Footing / Foundation, 2026-11-10, Pending). No Edit or Delete; the only row action was `Record result`, which was not activated (FIX-masonry-017, high, RCA-missing-delete-confirm). After the parent schedule job was deleted and verified absent, the inspection remained with the label “job no longer on schedule” and no cascade or cleanup (FIX-masonry-016). Evidence: `evidence/masonry/rw-inspections-create-reload.png`, `rw-inspections-orphan-after-schedule-delete.png`.
- Not leftover (deleted and verified absent after 30s + reload, named confirm, no second delete click): Price Book `qa-zt2-masonry-2026-11-10-price-book`; Invoice `qa-zt2-masonry-2026-11-10-invoices` (`INV-2001 · qa-test-only`; no invoice was sent or paid); Client `qa-zt2-masonry-2026-11-10-clients`; Certification `qa-zt2-masonry-2026-11-10-certifications`; Photo `qa-zt2-masonry-2026-11-10-photos`; Schedule job `qa-zt2-masonry-2026-11-10-schedule` (Job calendar (0) / “No jobs scheduled.” / Active Jobs 0; `rw-schedule-deleted-reload.png`). Takeoff `qa-zt2-masonry-2026-11-10-deleteprobe` was already deleted in the first walk.
- The Ask thread titled “What can I estimate and track in the Masonry lens, and what” (truncated; 3 messages, 03:35–03:36 AM ET) was still not reported deleted (FIX-masonry-008).
- Needs UI or backend cleanup of PROP-1001, CO-001, and INSP-001 on **zuko_qa_t1**.

## Plumbing leftover on zuko_qa_t1 (ZT5, 2026-11-10 4:38 AM ET)
- Pass 1 walk 4:09–4:33 AM ET (frames 4:09:29–4:31:41 AM ET) on **zuko_qa_t1**. The plumbing claim stays IN_PROGRESS; pass 2 is walking. This is not a close.
- LEFT on **zuko_qa_t1**: Dispatch Board job `qa-zt5-plumbing-2026-11-10-job-a` (normal, no address, 2026-11-10 8:00 (0.5h)). Created 4:16:52 AM ET; persisted after later intervals and a network reload; status was edited to `en_route` at 4:18:37 AM ET and still showed `en_route` at 4:28:49. Counts: JOBS TODAY 1, OPEN JOBS 1, UNASSIGNED 1. Row controls are Assign, a status dropdown, and Complete only — **no delete, trash, or remove** (FIX-plumbing-001, RCA-missing-delete-confirm). Evidence: `evidence/plumbing/zt5/052-job-a-created-0.5h-no-delete.webp`, `054-job-a-persisted-scheduled.webp`, `061-job-a-status-en-route.webp`, `123-job-a-en-route-persisted-no-delete.webp`.
- No technician, price-book item, invoice, service plan, part, or inspection was created in this pass.
- Needs UI or backend cleanup of the job on **zuko_qa_t1**. Pass 2 should not click Complete (that would mutate status) and should not invent a delete if none appears.

## HVAC rework 2 on zuko_qa_t1 (ZT2, 2026-11-10 4:47 AM ET)
- Walked on **zuko_qa_t1** (`/api/auth/me` before every create/delete) for the 4:02 AM ET return (Estimates, Inspections, Certs, and own Materials New). Evidence in `evidence/hvac/rw2-*.png` and `evidence/hvac/run1-report.md` (`## Rework 2 on zuko_qa_t1`).
- LEFT on **zuko_qa_t1**: estimate `qa-zt2-hvac-2026-11-10-estimates` (Description `QA rework estimate edited`). Create, read, edit, and reload persistence passed. One Delete click showed `Confirm delete?`, which disappeared before confirmation; after 30s + reload the exact estimate remained. Delete was not clicked again (FIX-hvac-015, medium; same inline confirm-revert pattern as FIX-hvac-013, likely a shared component). Evidence: `evidence/hvac/rw2-estimates-create.png`, `rw2-estimates-read.png`, `rw2-estimates-reload-edit.png`, `rw2-estimates-delete-after-reload.png`.
- Not leftover (deleted and verified absent after 30s + reload; confirm completed; no second delete click): Inspection `qa-zt2-hvac-2026-11-10-inspections` (0 Inspection records / No Inspection items yet; `rw2-inspections-delete-after-reload.png`); Certification `qa-zt2-hvac-2026-11-10-certs` (EPA 608 Universal; 0 Certification records / No Certification items yet; `rw2-certs-delete-after-reload.png`); own Material `qa-zt2-hvac-2026-11-10-materials` (Ductwork, quantity 1 each, created via Materials → own stock → New, not the published catalog; 0 Material records / No Material items yet; `rw2-materials-delete-after-reload.png`).
- Prior t1 leftovers still stand and were not re-deleted: job `qa-zt2-hvac-2026-11-10-rw-job` (FIX-hvac-001 CONFIRMED, FIX-hvac-013) and auto-saved load `load_mwag3cgh_4aj4jq` (FIX-hvac-014, FIX-hvac-003). Old run-1 leftovers remain on the other account, not t1.
- Needs UI or backend cleanup of `qa-zt2-hvac-2026-11-10-estimates`, `qa-zt2-hvac-2026-11-10-rw-job`, and `load_mwag3cgh_4aj4jq` on **zuko_qa_t1**.

## Plumbing leftovers on zuko_qa_t1 — pass 2 close (ZT5, 2026-11-10 5:00 AM ET)
- Pass 2 walk claimed 4:35–4:55 AM ET on **zuko_qa_t1**; the 41 provided frames are dated 4:42:43–4:53:48 AM ET (`sand-subagent-ecd0a83c-b4fe-4a61-3152-a2d2c86a8cc9`). Lens closed FAIL. This updates the 4:38 AM ET pass-1 leftover note (do not treat that note's "pass 2 should not click Complete" line as still open).
- STILL LEFT on **zuko_qa_t1**: Dispatch Board job `qa-zt5-plumbing-2026-11-10-job-a` (normal, no address, 2026-11-10 8:00 (0.5h), `en_route`). Still Unassigned (1) at 4:53:29 AM ET. Row controls remain Assign, status dropdown, and Complete only — **no delete** (FIX-plumbing-001). Evidence: `evidence/plumbing/zt5-pass2/039-dispatch-job-a-en-route-no-technicians-ar25-low-stock-1.webp` (also pass-1 stills under `evidence/plumbing/zt5/`).
- LEFT on **zuko_qa_t1**: a Parts Inventory item, indicated by **LOW STOCK 1** from the first pass-2 frame (4:42:43 AM ET, Quote tab) through the last Field Service stills (4:50:44–4:53:29). Pass 1 at 4:19 AM ET showed LOW STOCK 0 / “No parts stocked.” The walker named the fixture `qa-zt5-plumbing-2026-11-10-parts` (qty 1, $1, reorder 5) and reported no edit or delete control. **The Parts Inventory row itself was not photographed in the 41 pass-2 frames**, so the name, quantities, and missing controls are walker-reported, not image-verified. Evidence for the leftover metric: `evidence/plumbing/zt5-pass2/001-quote-invoice-create-enabled-ar0-low-stock-1.webp`, `030-official-390x844-field-service-subtabs-fab-ar25.webp`, `039-dispatch-job-a-en-route-no-technicians-ar25-low-stock-1.webp`.
- Unexplained residual: OUTSTANDING AR was $0 at 4:42:43 (“No invoices yet”) and **$25** from 4:50:44 through 4:53:29. The Quote / Price Book / invoice lists were not re-opened after 4:42, so the source record was not photographed. Do not invent an invoice leftover; flag the stale or uncaptured $25 AR for cleanup review.
- End state “No technicians yet” (4:51:32 and 4:53:29). Technician create/delete stills are not in the captured set.
- Needs UI or backend cleanup of job-a, the parts-inventory leftover (LOW STOCK 1), and a review of the unexplained $25 AR on **zuko_qa_t1**.

## Mining leftovers on zuko_qa_t1 (ZT2, 2026-11-10 5:21 AM ET)
- Walked on **zuko_qa_t1** (`/api/auth/me` before every create/delete). Paused 4:02–4:46 AM ET for the masonry/hvac return; resumed 4:47 AM ET. Lens closed FAIL. Evidence in `evidence/mining/` and `evidence/mining/run1-report.md` (including `## Paused` and `## Resumed 4:47 AM`).
- Not leftover (deleted and reload-verified absent on **zuko_qa_t1**): site `qa-zt2-mining-2026-11-10-sites`; geology hole `qa-zt2-mining-2026-11-10-geology`; hole `qa-zt2-mining-2026-11-10-assays` including its 0–5 m assay interval (fresh_ore, 0.8%, 95% recovery); fleet unit `qa-zt2-mining-2026-11-10-equipment`. After reload, Sites, Geology, and Fleet showed their empty states. Evidence: `evidence/mining/12-cleanup.png`.
- LEFT on **zuko_qa_t1**: the case 9 Ask/QA Chat conversation at `/lenses/chat`. Question: “In the Mining lens's Mine Plan view, what are the default pit depth and bench height?” Answer: 120 m and 15 m (also noted 8 benches and 45° slope), matching the page defaults. The question and answer remained visible after reload, but the UI did not expose a thread ID/title or show a corresponding new row in the conversation list, so it could not be selected for deletion (FIX-mining-006, RCA-ask-silent). This is not a Mining panel fixture. Evidence: `evidence/mining/9-ask-answer.png`.
- Needs UI or backend cleanup of the Ask/QA Chat conversation on **zuko_qa_t1**, or a way to select and delete it once a list entry is visible.

## Plumbing leftovers on zuko_qa_t1 — verify + pass 3 re-close (ZT5, 2026-11-10 5:45 AM ET)
- Zuko returned the lens at 5:17 AM ET because Technician CRUD, Price Book CRUD, and price validation were UNVERIFIED (stills missing from pass 2). Look-only verify 5:01–5:05 AM ET (walker `sand-subagent-592dfa87-ce48-3e40-5c38-05ec67b1d723`) plus pass 3 5:06–5:32 AM ET (walker `sand-subagent-61e9bb60-8e0a-ad72-8654-a5ccae4d740f`) on **zuko_qa_t1**. Lens re-closed FAIL. This updates the 5:00 AM ET pass-2 leftover note (the unexplained $25 AR is now identified as INV-0001; the parts row is now image-verified). Evidence: `evidence/plumbing/zt5-pass3/`.
- STILL LEFT on **zuko_qa_t1**: Dispatch Board job `qa-zt5-plumbing-2026-11-10-job-a` (normal, no address, 2026-11-10 8:00 (0.5h), `en_route`, Unassigned). The inspection job dropdown still labels it “qa-zt5-plumbing-2026-11-10-job-a · no client.” Row controls remain Assign, status dropdown, and Complete only — **no delete** (FIX-plumbing-001). Evidence: `v-001-dispatch-job-a-en-route-no-technicians-ar25-low-stock-1.webp`, `p3-028-inspection-job-dropdown-job-a-no-client.webp`, `p3-197-no-technicians-final.webp`.
- LEFT on **zuko_qa_t1**: Parts Inventory row `qa-zt5-plumbing-2026-11-10-parts` (SKU same as name, On Hand 1, Reorder At 5, Unit Cost $1.00, Value $1.00, banner “Low stock: qa-zt5-plumbing-2026-11-10-parts”). **image-verified** in the 5:03 AM ET verify, including hover on the SKU — **no edit or delete control**. LOW STOCK 1 persists through pass 3. Evidence: `v-016-parts-row-qty1-1dollar.webp`, `v-017-parts-hover-no-edit-delete.webp`.
- LEFT on **zuko_qa_t1**: client `qa-zt5-plumbing-2026-11-10-client`, created ~5:07 AM ET via the Quote Client typeahead. There is no client delete in Plumbing, and Accounting → Customers is empty (“No customers yet.”) so it does not appear there either (FIX-plumbing-013). Evidence: `p3-013-client-created-selected-checkmark.webp`, `p3-064-accounting-customers-empty.webp`.
- LEFT on **zuko_qa_t1**: service plan `qa-zt5-plumbing-2026-11-10-plan` (client `qa-zt5-plumbing-2026-11-10-client`, annual · $0 · next 2027-11-10 · 0 visits done). ACTIVE PLANS 1. The only row control is **Log Visit** — no edit or delete (FIX-plumbing-011). Log Visit was not clicked. Evidence: `p3-022-service-plan-created-log-visit-only.webp`.
- LEFT on **zuko_qa_t1**: inspection `INSP-001` (Rough-In, pending on `qa-zt5-plumbing-2026-11-10-job-a`, inspector qa-zt5, jurisdiction qa-zt5, date 2026-11-11). The only card action is **Record Result** — no delete (FIX-plumbing-012). Record Result was not clicked. Evidence: `p3-055-insp-001-pending-record-result-only.webp`.
- LEFT on **zuko_qa_t1**: invoice `INV-0001` · No client, Issued, 1 line, total **$25**, Paid $0 · Balance $25. This is the AR source first seen as OUTSTANDING AR $25 in pass 2; it was created with no client (FIX-plumbing-009). Only **Record Payment** — no edit, delete, or void (FIX-plumbing-010). Evidence: `v-018-inv-0001-no-client-25-record-payment-only.webp`, `p3-082-inv-0001-and-inv-0002-record-payment-only.webp`.
- LEFT on **zuko_qa_t1**: invoice `INV-0002` · qa-zt5-plumbing-2026-11-10-client, Issued, 1 line (`qa-zt5-plumbing-2026-11-10-line`), total **$10**, Paid $0 · Balance $10. Created with the direct Create Invoice button (no separate quote or convert step). Only **Record Payment** (FIX-plumbing-010). Together with INV-0001, OUTSTANDING AR is $35. Evidence: `p3-082-inv-0001-and-inv-0002-record-payment-only.webp`, `p3-085-invoices-persisted-inv-0001-inv-0002-ar35.webp`.
- Not leftover (created, then deleted and verified empty): technician `qa-zt5-plumbing-2026-11-10-tech2` (final list “No technicians yet,” `p3-197-no-technicians-final.webp` / fb25da20); Price Book items `qa-zt5-plumbing-2026-11-10-pb2` and `qa-zt5-plumbing-2026-11-10-huge` (list empty at `p3-173-price-book-empty-after-huge-delete.webp` and `p3-203-price-book-empty-final.webp` / a5e382e8).
- Complete on job-a, Record Payment, Log Visit, and Record Result were not clicked. Pre-existing harness jobs `tzI026220427mi*` were not touched.
- Needs UI or backend cleanup of job-a, the parts row, the client, the service plan, INSP-001, INV-0001 ($25), and INV-0002 ($10) on **zuko_qa_t1**.
- (5:50 AM ET) Bridge, account zuko_qa_t1: Concord Link Frontier link `qa-zt4-bridge-2026-11-10-frontier`. There's no delete control (FIX-bridge-003).

## Command Center leftovers on zuko_qa_t1 (ZT2, 2026-11-10 5:55 AM ET)
- Walked on **zuko_qa_t1** (`/api/auth/me` showed `zuko_qa_t1`, member; no sign-in/out; no create/edit/delete). Started about 5:21 AM ET, paused around 5:30 AM ET for the mining return, then resumed. Lens closed FAIL. Evidence in `evidence/command-center/` and `evidence/command-center/run1-report.md`.
- No Command Center panel fixtures were created, so there is nothing to delete in the lens itself. Evidence: `evidence/command-center/12-cleanup.png`.
- LEFT on **zuko_qa_t1**: the case 9 Ask turn was appended to the existing Mining Mine Plan Chat conversation already logged under "Mining leftovers on zuko_qa_t1" (FIX-mining-006). The conversation-list entry stayed titled “In the Mining lens’s Mine Plan view, what are the default pit depth and bench he...” and showed 4 messages. No thread ID was displayed; the URL only showed `context=command-center`. Question: “What can I do in this Command Center lens?” The answer claimed dashboards, alert-rule management, incidents, system health, runbooks, on-call schedules, and other capabilities not shown on the Command Center page (which showed only “No alert in front of you,” File an alert, and Refresh) (FIX-command-center-004; same wrong-thread routing as FIX-parenting-005). This is not a Command Center panel fixture. Evidence: `evidence/command-center/09-ask-answer.png`, `09-ask-thread.png`.
- Needs UI or backend cleanup of that Chat conversation on **zuko_qa_t1**, or a way to select and delete the added turn.

## All / Lens Hub leftovers on zuko_qa_t1 — pass 1 (ZT5, 2026-11-10 5:55 AM ET)
- Pass 1 walk ~5:33–5:49 AM ET (PNG assets ~5:33–5:43 AM ET; late frames 5:44:08–5:49:07 AM ET, walker `sand-subagent-4f858b76-4839-b683-3846-43cea71f39f3`) on **zuko_qa_t1**. The all claim stays IN_PROGRESS. This is a progress note, not a close. Evidence: `evidence/all/zt5/`.
- LEFT on **zuko_qa_t1**, pending delete: Docs page `qa-zt5-all-2026-11-10-doc`. Created as Untitled, renamed, and the title is image-verified (`011-docs-renamed-qa-zt5-all-2026-11-10-doc-persisted.webp`). The sidebar delete confirm named the fixture (`013-docs-delete-confirm-named-fixture.webp`). Escape did not dismiss it (FIX-all-003, RCA-escape-focus-trap; `014-docs-delete-confirm-escape-did-not-dismiss.webp`). The walker canceled; the fixture is still present. A follow-up walk will confirm the delete. Do not click Delete a second time if the confirm flickers or stays.
- LEFT on **zuko_qa_t1**, pending: the Ask / Chat conversation used for the substrate-pulse question. At 05:40 AM ET a banner said “This conversation belongs to a different account. Starting a new chat.” The user asked “What domains and counts are shown in the substrate pulse?” at 05:40 AM ET; the reply at 05:41 AM ET was the raw `run_lens_action` / `db.status` admin-role error (FIX-all-002). No thread ID was visible in the still. Evidence: `017-ask-run-lens-action-forbidden-db-status.webp`.
- Needs a follow-up walk on **zuko_qa_t1** to confirm the docs delete and, if a delete control appears, to clean up the Ask conversation. Pre-existing harness jobs `tzI026220427mi*` were not touched.

## crafting (ZT1, zuko_qa_t1, 2026-11-10 6:02 AM ET)
- Bench piece deleted. 3 derived DTUs remain in My vault (Vault is BLOCKED for ZT1): dtu_3849e4676dc5d78568b5 'Lens:crafting create recipe', dtu_13c98f6df14f86c41b5b 'Lens:crafting update recipe', dtu_0ab0c8ca5a0128b4db8a 'Lens:crafting delete recipe'. Activity log entries publish/delete remain (not deletable).
- The piece was accidentally Published 5:40:58-5:46:19 AM ET (scope local, no feed/market consent); not found in Global, Explore or the public profile.

## All / Lens Hub leftovers on zuko_qa_t1 — close (ZT5, 2026-11-10 6:16 AM ET)
- Cleanup walk ~5:52–6:01 AM ET (frames 5:52:06–6:01:23 AM ET, walker `sand-subagent-d4a0143a-a985-2062-601e-eba68e02517d`) plus gap walk ~6:07–6:09 AM ET (walker `sand-subagent-80a75f16-7241-6de0-3042-bb3f6f2faf2e`) on **zuko_qa_t1**. Account checks passed twice on the cleanup walk (auth/me stills not copied). Lens closed FAIL. This updates the 5:55 AM ET pass-1 leftover note.
- CLEANED on **zuko_qa_t1**: Docs page `qa-zt5-all-2026-11-10-doc`. The page was still present at 5:54:04 AM ET. One Delete click opened a confirm that named the fixture (`Delete "qa-zt5-all-2026-11-10-doc"?`). After the confirm, a toast read `Deleting "qa-zt5-all-2026-11-10-doc"... Undo`, the list showed “No pages — create one.” (the Workspace Pages metric stayed stale at 1 until reload), and after a reload at 5:55:02 AM ET Workspace Pages was 0 with “No pages — create one.” / “Select or create a page.” Evidence: `evidence/all/zt5/030-cleanup-docs-before-delete-fixture-present.webp`, `031-cleanup-docs-delete-confirm-named.webp`, `032-cleanup-docs-deleting-toast-list-empty.webp`, `033-cleanup-docs-reload-splash.webp`, `034-cleanup-docs-after-reload-0-pages.webp`. No second Delete click.
- STILL LEFT on **zuko_qa_t1**: the Ask / Chat conversation from pass 1 (question “What domains and counts are shown in the substrate pulse?”; raw `run_lens_action` / `db.status` admin-role error at 05:41 AM ET; FIX-all-002). Cleanup searched Threads at `/lenses/thread` for that question (the field shows the suffix “re shown in the substrate pulse”); the UI said “No threads match your search.” No matching thread and no delete control were found, so deletion was not attempted. Evidence: `evidence/all/zt5/035-cleanup-threads-search-no-match-ask-leftover.webp`, `017-ask-run-lens-action-forbidden-db-status.webp`.
- Needs UI or backend cleanup of that Ask conversation on **zuko_qa_t1**, or a way to select and delete it once a list entry is visible. Pre-existing harness jobs `tzI026220427mi*` were not touched.
- crafting addendum 6:30 AM ET: keyboard fixture qa-zt1-crafting-kb-2026-11-10 deleted; its Lens:crafting create/delete DTUs probably also remain in My vault (unverified, Vault BLOCKED).

- defense (ZT2, 2026-11-10 6:38 AM ET, zuko_qa_t1): no leftovers. All 7 qa-zt2-defense-2026-11-10-* fixtures deleted and reload-verified. Lens paused mid-walk for handoff.

## diy (ZT1, zuko_qa_t1, 2026-11-10 6:46 AM ET, partial)
- Deleted: qa-zt1-diy-2026-11-10 project, -tool, -material, -idea, -workshop. Possibly remaining: qa-zt1-diy-2026-11-10-step and -bom (nested under the deleted Workshop build; not independently verified). No instruction or cut saved.
