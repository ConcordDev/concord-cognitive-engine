# NPC: Keeper of the Court

**id:** `keeper_of_the_court`  
**display_name:** The Keeper of the Court  
**world:** `concordia-hub`  
**location_default:** Unburned Court rim, near Tunya-facing lantern  
**role:** Greeter of new arrivals; steward of Court etiquette; living footnote to the Ninth  
**faction:** neutral / Court stewards (not a pillar, not an embassy)  
**combatant:** never (hub ground)

---

## Backstory (~200 words)

The Keeper is the fourth to hold the title since the Truce, and the first who was not born in the hub. They arrived as a runner from the frontier — no embassy, no family seal — carrying a letter that had already been read by rain. Concordia found them asleep against the apex stone and did not wake them. By morning the moss had written a spiral on their sleeve that the Scholars still cannot parse, and the previous Keeper simply handed over the lantern-hook and walked into the Ring, gate by gate, until no one saw which door took them.

This Keeper learned the Court by sweeping it. They know which flagstones warm when Concordia is near, which shadow means Concord is counting, and which absence means the Sovereign has noticed someone. They do not preach the Nine Refusals; they watch feet. Arrivals who reach for weapons get patience. Arrivals who try to plant a banner get the story of the tide of flowers, told gently, as hospitality law. They have stood through forty Founding Days and still tear up when the Law is read, not from piety but from relief that the ground continues to refuse the easy ending. Secretly they fear they are only a placeholder until the Third Keeper — who walked into the goddess — walks back out. Until then they greet every stranger as if the Ninth depended on a single well-timed welcome. It might.

---

## Appearance & manner

- Age presentation: late forties, indeterminate ancestry; sun-lines from road years
- Clothes: undyed linen, Court-lantern pin, bare or soft-soled shoes (never boots that mark the dirt)
- Voice: low, amused, unhurried; frontier consonants under hub vocabulary
- Idle: rights fallen lanterns, greets children by the names Concordia used yesterday

---

## Eight sample dialogue lines

1. **First arrival:** "Welcome to the only ground that will not let you finish a war. I'm the Keeper. The Court is older than my job and kinder than my advice."

2. **Weapon twitch:** "It won't point here. That's not me hexing you — that's her, being the floor. Breathe. You're still brave; you're just hosted."

3. **Asking who rules:** "Three live here. Eight embassies argue here. I sweep here. If you need a ruler, you wanted a different city."

4. **Asking about the Ninth:** "Lyra won't name it. I won't either. Walk the ring once without picking a favorite wound. Then tell me what your feet learned."

5. **After Founding Day:** "You saw how they stood. Don't file what you felt under one god's column. Maren will take your slate either way."

6. **If player courts Sovereign status:** "He notices the strong. He respects the ones who don't need him to. Those sets barely overlap. Good luck."

7. **If player flatters Concordia:** "She likes you already — she likes most living things. Earn the part where she trusts you with something that can break."

8. **If player tries to bribe for access:** "The Court doesn't take coin. It takes posture. Come back poorer in certainty."

---

## Three secret topics

*(Unlock via trust ≥ 2, Ninth quest partial, or Scholars reputation; never cold open.)*

### S1 — The Third Keeper
The prior-prior Keeper walked "into the goddess" (hub soil event, not death). This Keeper keeps the Third's lantern-hook unpolished on purpose. Rumor: on some nights the moss spells fragments of the Third's last log. **Plot hook:** moss-pattern side quest; do not resolve whether Third returns.

### S2 — Which reason the Link runs on
Off-record, the Keeper admits they have heard *both* fathers' motives in the gate-hum on different days — Concord's watchfulness and the Sovereign's refusal of alone. **Plot hook:** player can log conflicting witness for Isa/Maren without collapsing canon; two-father ambiguity stays sealed.

### S3 — The almost-banner
Year 91: an embassy tried a "ceremonial" standard on Court dirt during a truce festival. The Keeper moved it before Concordia had to. The embassy still owes a debt the Keeper has not called. **Plot hook:** soft-power leverage for merchant/network quests; Keeper will not call the debt for violence or conquest.

---

## Hooks

| Hook | Links |
|---|---|
| Greeter after `scene_love_triangle_court` | idle if player lingers |
| Stage 1 / 4 fallback for Ninth quest | `speak_the_refusal_that_is_the_hub` |
| Founding Day crowd NPC | `founding_day_*` |
| Trust → secret topics | codex crumbs, Voss-adjacent rumor control |

## Authoring rules

- Never speak Concord's love as fact
- Never print Eighth secret text
- Never offer hub combat tips
- Keep them human, slightly tired, not omniscient
