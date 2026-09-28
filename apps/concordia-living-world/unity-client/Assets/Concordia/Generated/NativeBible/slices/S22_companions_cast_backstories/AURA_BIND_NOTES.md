# Aura bind notes — S22 companions

Bind after `volume/COMPANIONS.json` and after the Hub guests exist. This facet deepens twelve ids. It does not add a thirteenth, does not move a `GuestDef`, and does not empty a stand when that person is also walking.

Do not commission a new mesh, a wolf for the riddle, a stag for the milepost, a Tessera tile, a Census visor for Nyx, an elf body for Thorne, a rifle, a plasma coat, or a seated mount. Do not download packs. Do not wipe `Library`. Do not re-download pines. Do not stop Concord, Unity, or Claude.

## Spawn order

1. No new transforms. Brackish, Old Seam, Maren, Gale, Vesper, Jax, Nyx, and Thorne keep the `HubGuests` coordinates in `Canon.cs`. Gale's steel bind stays inside the Arena disk, center (0, 18), radius 8 m.
2. Kel binds to the existing schedule rooms `hub_portal_plaza` and `hub_courier_house`. Those rooms have no authored metre. Do not place a pin to satisfy the quest marker. The offer of `q_s22_one_walker` is a talk when he is in the plaza phase, the same window `impossible-print` already uses.
3. Maeris binds to `fantasy_bog_clearing`. Esha binds to `the_open_table_meeting_ground`. Calla binds to `ruins_rebel_war_tent`. None of the three is copied onto the Court.
4. The framed riddle is a prop already implied by Thorne's relationship note ("she framed it") at Nyx's stand (−14.5, −12.2). If the frame mesh does not exist, the line is readable from Nyx without a new hero prop. Do not spawn a wolf, a wall kit, or a messenger.
5. Pinewood Crossing stays (62, −28). `q_s22_milepost_names` walks there and spawns nothing. The 12 m hitch disk stays S01's.
6. Pillars stay on the unpaved ring and are not added to the name list.

## Flags

Write three flags per id: `companion_brackish_intro` and the same shape for `old_seam`, `maren`, `gale`, `thorne`, `maeris`, `nyx`, `jax`, `kel`, `esha`, `calla`, `vesper`, each with `_mid` and `_postboss`.

Before playing a line, check `home_speak_phases` when the companion is in the home world. A silent phase plays nothing. On the Court, a guest with `court_stand_always` may speak at the GuestDef. Gale's steel line still requires the Arena disk.

If `banter_alts` matches at the moment the flag flips, play that line instead of the primary. Do not flip the flag a second time for the other line. Nyx's quiet is a spoken instruction not to fill it, not a blank caption. Calla's Dominus vigil does not open. Esha's night door does not open.

Ignore the volume file's shared flag strings when this slice is bound. Leave the volume file itself untouched on disk.

Postboss checks, in order: the player is at that companion's stand or room; the remembrance from a real encounter is still in inventory; it was not sold, inked, set in gold, or equipped as a mask; Maren's line additionally requires the player to have been inside that encounter's circle. Fail the check in silence. Do not play a generic consolation line.

## Who may be named on `q_s22_one_walker`

Thorne, only if `q_fantasy_held_offer` was a refusal. Maeris, only inside the bog limit already in `fantasy_maeris_02_steps`. Nyx, Jax, Kel, Calla, if their unlock quest is turned in. Naming Brackish, Old Seam, Maren, Gale, Esha, or Vesper as the gate walker fails objective 2. Naming Jax and Vesper into one party fails objective 3. Naming none completes the quest.

If the player later accepts the Held Curse offer, or takes a bone bead during `q_s22_bead_count`, clear Thorne from the walker slot. He returns to (12.8, −14.5). Do not delete the guest. Do not spawn a bead as loot.

`q_s22_penanus_minute` offers at Penanus in the portal plaza and turns in at Solnus in the courier house. Both rooms still have no metre. Failing by entering the portal, reading the log, or reporting the minute does not spawn a creature and does not write a faction delta.

## Hit resolution

Brackish's assist does not enter `HitResolver`. Gale's parry enters it only inside the Arena disk. Thorne's fold, Jax's invoice, and Calla's unburial use the verbs' existing startup, active, and recovery. They do not gain new damage numbers in this file. Inside the 42 m Court and outside the Arena disk, their steel resolves as a flower. Do not apply damage and a flower.

Nyx's refuse-count, Maren's witness, Kel's witness, Esha's name-holder, Seam's lantern step, Maeris's second-hour stop, and Vesper's bargain do not deal damage.

No skill id is added to a reward list. `q_fantasy_held_offer` remains the grant for the player's copy of `skill_steel_curse_fold`.

## Quest mouths

`q_s22_one_walker` offers and turns in on Kel during plaza hours.

`q_s22_milepost_names` offers on Brackish after the three prerequisite quests. Turn-in is the bell-tower return. Talking to Nesha is not an objective and does not advance it.

`q_s22_not_a_pair` offers and turns in on Maren. Speaking the unit betrayal fails it. Do not write a faction delta to recover the fail.

`q_s22_framed_riddle` offers and turns in on Nyx. Thorne's stand is a look, not a dialogue that unlocks the apprentice.

`q_s22_bead_count` offers on Thorne only if the Held Curse was refused. The turn-in is the finished count. Asking for the apprentice, or whether that person is alive, is not an objective and does not advance it.

Nyx's elbows and pupils stay dark. One knuckle is the emissive. Jax's neck mark stays unlit and he wears no mask. The eight cords are the prop. Vesper still has no halo. Do not age Brackish up. Do not give Esha a Tessera tile to fill `npc_role_sere_enforcer`. Do not give Kel a rifle to fill `npc_role_frontier_guard`.

Hidden truths listed on each companion's `secrets_not_spoken` stay off the voiced lines. Gossip on complete is the public sentence only.

## Plates

Generate nothing new for this facet. Existing guest plates stand. If a plate is missing for Kel, Maeris, Esha, or Calla, leave the slot empty rather than borrowing a Quaternius body or the wrong role's armor. Esha's `npc_role_sere_enforcer` must not be used as a Tessera uniform. Kel's `npc_role_frontier_guard` must not be used as a rifle warden. Nyx's `npc_role_grid_officer` must not be used as a Census uniform.

Heights, where `GuestDef` has them, are binding. Do not age Brackish up to 1.7 m to match a hero frame.
