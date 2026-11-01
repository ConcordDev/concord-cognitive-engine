# TheVault — founder runbook: installing the founding curator

Audience: the platform founder (Ramaj). Companion to `docs/THEVAULT_SPEC.md` (locked). This is operations only; it changes no behavior.

## Why this exists
TheVault launches empty and admits nothing until a human curator exists. There is no curator in production. The review room on `/lenses/vault` appears only for an **active curator**, and the server refuses every curator action for anyone else (`not_a_curator`). Installing the founding curator is the one step that cannot be done from the UI, and it is deliberately founder-only (INC-148: first-come-first-served let any member seize the vault).

## The product question to settle FIRST (not a bug)
`vault.install_founding_curator` (`server/domains/vault.js`, registration near line 818) installs **the caller** as the founding curator: it passes `curatorId: userId` from the authenticated actor, and only reads `displayName` from the payload. There is no target-user parameter, on purpose.

So whoever runs the call below becomes the founding curator, permanently: the slot is single, cannot be retired, and `installFoundingCurator` refuses a second install (`founding_curator_already_installed`) rather than overwriting. "Who founded this archive" is not a revisable field.

Decide before running it:
- If the founder (the account whose role is `founder` or `sovereign`) should be the founding curator: run the call below as that account.
- If someone else (for example Ramaj's friend) should be the founding curator: that is **not possible with the current code** without a product/engineering change. Adding a target-user parameter, or installing the founder and then inviting the other person as a guest curator, are the two options. Neither is implemented, and neither should be done without Ramaj's decision. Note the difference: a guest's admissions are attributed to the guest (permanent, per record), but only the founding curator can invite guests (`only_founding_curator_may_invite`), and a founding curator cannot be retired.

## The call (founder account, once)
Authority comes from the authenticated session, never from the payload: the actor's role must be `founder` or `sovereign` (`FOUNDING_CURATOR_ROLES`), otherwise the server answers `founder_only`.

```
POST /api/lens/run
{ "domain": "vault", "action": "install_founding_curator", "input": { "displayName": "<the name the roster will show>" } }
```

From the app, this is `lensRun('vault', 'install_founding_curator', { displayName })` while signed in as the founder, or the same POST with that session's normal auth and CSRF handling. I have not run it against any database and did not exercise the HTTP path end to end for this runbook, so confirm the first response rather than assuming it.

Responses (the refusal is in the `reason`/`error` of the body; `/api/lens/run` returns a handler refusal as HTTP 4xx):

| Result | Meaning |
|---|---|
| `{ ok:true, curatorId, role:"founding_curator" }` | Installed. The curator id is the caller's user id. |
| `founder_only` | The signed-in account is not `founder`/`sovereign`. Nothing changed. |
| `missing_display_name` | `displayName` was empty. Nothing changed. |
| `founding_curator_already_installed` (+ `curatorId`) | A founding curator exists. Nothing changed; it cannot be replaced. |
| `no_actor` | Not signed in. |

## Verify (public read, no auth needed)
`vault.curators` is public and is what the roster on the page shows:

```
POST /api/lens/run   { "domain": "vault", "action": "curators", "input": {} }
```
Expect one row: `role: "founding_curator"`, `active: 1`. After this, signing in as that account shows the "Curator review room" on `/lenses/vault`.

## Then, optionally: invite a guest curator
Only the founding curator, acting as themselves:
```
{ "domain": "vault", "action": "invite_curator", "input": { "curatorId": "<the guest's user id>", "displayName": "<roster name>" } }
```
The guest must already have an account (the id is a user id). Refusals: `only_founding_curator_may_invite`, `already_a_curator`, `missing_curator_id`, `missing_display_name`. A guest's admissions are attributed to the guest, not the founder. `retire_curator` exists for guests (past admissions keep their attribution); the founding curator cannot be retired.

## What admission does (so nobody is surprised)
Admitting mints a permanent `vault_record` DTU and the record appears on the public hall at once. The first admission is a real public event; there is no draft or undo (admitted records are permanent: `admitted_records_are_permanent`). The permanence unit that would add protection flags is not registered yet, so a record claims no custody beyond what the page shows (spec section 7.3 and 10.1).
