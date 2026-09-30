# Hub guest redesign

Eighteen canon presences. Fifteen are `Canon.HubGuests`. Three are `Canon.Pillars`. Do not merge them into generic villagers and do not give them Quaternius bodies.

Shared rules:

- CX humanoid, Concordia face, height from the `GuestDef.height` already in `Canon.cs`.
- Palette starts from `GuestDef.color` and then takes Court limestone and lantern brass so they belong in the plaza.
- Steel reads as a flower inside 42m. Arena Warden Gale is the exception when he is on the sand.
- GTA wear on cloth and metal. Palworld read: one prop taller or brighter than the torso so each guest is identifiable with the face in shadow.
- No romance staging for Concord and Concordia. Do not put "Concord admits he loves her" in a caption.

## Guests

### The Lamplighter (`lamplighter`, 1.72m)
Eastern path. Soft cap, soot on one cheek, brass rod with a real lantern. Coat is limestone-dusted canvas. He is the night version of `npc_role_court_labor` plus the lantern prop. Eyes are tired, not mystic.

### Elias Voss (`elias`, 1.84m)
Anti-Sovereign. Narrow dark coat, no armor, ink under a fingernail, a tower-key he does not flourish. Color `#3d4a62`. Stands like a man who works two streets over from a war. Not a hooded villain. Face fully visible. Fight style if pressed: Wing Chun, scholars' neighbor, not his vocation.

### Vesper Kane (`vesper`, 1.78m)
Luminary. Pale coat `#e8e4dc`, clean relative to the plaza and still worn at the cuffs. Bread basket or a paper ledger, never both as a clutter pile. No halo, no eye glow. She is the adult of `npc_role_dawn_mystic` visiting the Court. Karate only if the Dawn law is being demonstrated: she does not take a finishing blow.

### Lady Seraphine Voss (`seraphine`, 1.76m)
Crimson Court. Deep red `#6a2030` in a glove and a lining, not a full ballgown that hides the legs. Court dress cut for walking. A closed fan that is wood and silk. Smile is a facial blend. Etiquette skill is hers. She is not an assassin silhouette.

### Jax Rivera (`jax`, 1.80m)
The Ghost. Dark travel clothes `#2a241c`, one satchel, soft shoes, no mask. Contracts from all eight, loyalty from none: eight small worn cords on the satchel strap, one per gate color, frayed. Capoeira stance when idle, weight on the back foot. Courier role scaled up, not a ninja.

### Mama Iron Rose (`mama`, 1.62m)
Delgado Syndicate. Shorter, heavier presence, rose pin `prop_rose_pin` at the collar, dark red-brown `#5c3038`. Dock cloth cut well, rain still in the hem even in the Court. A flower in the other hand because the plaza forbids her knife. The knife exists; it is not drawn here. Muay Thai shoulders.

### Kael Nakamura (`zero`, 1.86m)
Zero. Tall, `#1a1028`, Grid visor pushed up onto the forehead so the Concordia face is the point. One ground-off serial plate as a pendant, not armor. He is studying the gap. Hands empty. Do not give him a rifle.

### Nyx Torres (`nyx`, 1.70m)
Blackout. Practical dark layers `#12121a`, cable coil over one shoulder, shoes that can run. Hair tied for work. She organizes the uncounted: a slate with names scratched out, matching `prop_count_slate`. Sibling silhouette to Zero; she is shorter and she carries tools, he carries a question.

### Thorne Blackroot (`thorne`, 1.96m)
Tallest guest. `#1a3028`. Travel coat with pine resin and mud, hands wrapped in clean cloth (`npc_role_sunder_mystic` at hero scale). A loose braid he refuses to tighten. No antlers, no dragon features. The curse is the cloth and the posture, inward. Sword style only outside the plaza, and even then the fold comes before the cut.

### Lyra Silentchant (`lyra`, 1.68m)
Second hour. `#3a3850`. Simple robe, brass-ring staff `wpn_focus_lyra_staff`, hood down. Quiet face. The staff is wood. She does not teach a ninth Refusal and the costume must not look like a final-form mage.

### Arena Warden Gale (`warden`, 1.90m)
Iron Wardens. `#6a6860`. Open helm, gray chest plate on CX, fauld, flower at his side in the plaza, estoc on the sand. Stands at Arena (0, 18). Poise, not luck: his idle is a settled guard, not a flourish. Face visible through the open helm.

### Asbir Thelane (`asbir`, 1.74m)
Lord Curator. `#8aa0b4`. Three notebooks (facts, inferences, the difference) as `prop_notebook` variants, one in hand and two in a case. Ink cuff. No robe that swallows him. Scholar role, precise, a little vain about the case and not about himself.

### Maren Ashveil (`archivist_maren`, 1.70m)
Archivist. Cooler gray-blue `#7a8aa0`. One book, chain, shorter hood than a Ruins keeper. She writes what she sees. Quill or stylus, ash-free because she is in the Court; the Ruins stay on her boots.

### Brackish (`brackish`, 1.42m)
Plaza urchin. `#6a5a40`. Smallest. Oversized shirt, flower scrap, bare feet or one shoe. Capoeira play in the idle, not a weapon. Use the urchin role's scale. Do not age him up to fill a hero frame.

### Old Seam (`oldseam`, 1.58m)
Lantern path. `#7a6a58`. Stooped, mending kit, cobble dust ground into the knees. Shorter than the laborers because of the stoop, not because of a different species. Hands are the hero prop: needle, cord, a cracked paver.

## Pillars

They stand on the unpaved ring. Concordia at the warm apex (0, −6.4). Concord facing her (0, 6.2). The Sovereign with his back to both (8.6, 0.3).

### Concordia (`concordia`, 1.78m)
The First Breath. `#c8721a`. Warm Court cloth, no crown, no armor, flowers that are real and slightly wilted. Open hands. She is not a goddess statue and not a bride. The ground is hers; the costume is a person who walks it.

### Concord (`concord`, 1.82m)
The First Law. `#8aa0b4`. Plain clothes a measurer would ruin with chalk. A cord or a folded rod, not a sword. Face calm, not cold-royal. He is measuring. That is enough. No love confession in the staging.

### The Sovereign (`sovereign`, 1.94m)
The First Refusal. `#2a1c14`. Taller, back mostly toward the other two, coat dark, no face performance required while his back is turned. When he must be seen, the face is a Concordia face with nothing comic and nothing skeletal. His line is "…". Do not fill the silence with a monologue caption. No death-god scythe.

## Plate notes for Aura

Generate each guest as a turnaround plus a plaza idle. State the height in the prompt. Background is Unburned Court limestone, not a white cyclorama and not a neon city. Gale gets a second frame on Arena sand with steel. Zero and Nyx may show a rain-gloss from the Grid but they are standing in the Court when the plate is the Hub plate.
