// Phase F2.1 — generate 21 sub-world quest chains.
// Each chain has 3 quests with breadcrumbs + reasonable progression.
// Writes to content/quests/sub-worlds/<world>/<chain>.json.

import { writeFileSync, mkdirSync } from "node:fs";

const CHAINS = [
  // ===== FANTASY =====
  {
    world: "fantasy", file: "seraphine-heir.json", domain: "fantasy_main",
    quests: [
      {
        id: "fantasy_seraphine_01_audience", giver: "lady_seraphine_voss",
        title: "Thornwood — The Long Audience",
        description: "Lady Seraphine summons you to a private audience. The court is half-empty; the rest are listening. She has chosen you for a reason.",
        objectives: [
          { id: "obj_sera1_visit", type: "reach_location", target: "fantasy_thornwood_throne", count: 1, desc: "Visit the throne room during her morning audience." },
          { id: "obj_sera1_talk", type: "talk_to", target: "lady_seraphine_voss", count: 1, desc: "Hear what Seraphine asks." }
        ],
        breadcrumbs: [
          { id: "bc_sera1", content: "Seraphine and Iyatte of Sandrun have hidden mirror-children. She wants a courier who can cross both worlds." }
        ],
        followUp: ["fantasy_seraphine_02_lacquer"],
      },
      {
        id: "fantasy_seraphine_02_lacquer", giver: "lady_seraphine_voss",
        title: "Thornwood — The Lacquered Box",
        description: "Carry a lacquered box to the Verge crossroads at sunset. Don't open it. A woman in red will be waiting.",
        objectives: [
          { id: "obj_sera2_carry", type: "deliver", target: "lacquer_box_to_verge_runner", count: 1, desc: "Arrive at the Verge crossroads before sunset with the box sealed." }
        ],
        breadcrumbs: [
          { id: "bc_sera2", content: "The woman in red is a Sandrun courier. The box contains a sealed copy of Iyatte's son's borrowed identity." }
        ],
        prerequisites: ["fantasy_seraphine_01_audience"],
        followUp: ["fantasy_seraphine_03_choice"],
      },
      {
        id: "fantasy_seraphine_03_choice", giver: "lady_seraphine_voss",
        title: "Thornwood — Resolution",
        description: "Return to Seraphine. She'll know whether you opened the box. The keep's future hangs on the next half-hour.",
        objectives: [
          { id: "obj_sera3_choose", type: "any_of", target: "thornwood_resolution", count: 1, desc: "Choose: held faith / opened it / told someone else." }
        ],
        rewards: { xp: 600, items: ["thornwood_sworn_signet"] },
        moralBranch: {
          desc: "Did you hold faith?",
          options: [
            { id: "held", consequence: "Seraphine elevates you. Permanent thornwood faction +0.7." },
            { id: "opened", consequence: "Seraphine knows. She will not say so. -0.5 reputation." },
            { id: "told", consequence: "Iyatte's son is exposed. Cross-world war intensifies." }
          ]
        },
        prerequisites: ["fantasy_seraphine_02_lacquer"],
      },
    ],
  },
  {
    world: "fantasy", file: "lyra-thorne-chain.json", domain: "fantasy_side",
    quests: [
      {
        id: "fantasy_lyra_01_satchel", giver: "apothecary_lyra_thorne",
        title: "The Verge Apothecary — The Smuggled Satchel",
        description: "Lyra's monthly satchel to Pia Thalis is overdue. The Verge road has been unsafe. She needs a runner.",
        objectives: [
          { id: "obj_lyra1_collect", type: "interact", target: "fantasy_verge_shop_back", count: 1, desc: "Receive the satchel from Lyra after hours." },
          { id: "obj_lyra1_carry", type: "deliver", target: "satchel_to_pia_thalis", count: 1, desc: "Deliver to Pia Thalis in the hub infirmary." }
        ],
        breadcrumbs: [
          { id: "bc_lyra1", content: "The smuggling chain has held twenty years. One missed satchel and refugee infirmaries close in both worlds." }
        ],
        followUp: ["fantasy_lyra_02_moonleaf"],
      },
      {
        id: "fantasy_lyra_02_moonleaf", giver: "apothecary_lyra_thorne",
        title: "The Verge Apothecary — Moonleaf Cuttings",
        description: "Pia sends moonleaf cuttings every spring. This year's are seedlings, not cuttings — they need a fast carrier and dawn light.",
        objectives: [
          { id: "obj_lyra2_collect", type: "interact", target: "hub_infirmary_garden", count: 1, desc: "Pick up the seedlings before Stratus phase." },
          { id: "obj_lyra2_plant", type: "interact", target: "fantasy_verge_shop_garden", count: 1, desc: "Plant them in Lyra's garden before midday." }
        ],
        prerequisites: ["fantasy_lyra_01_satchel"],
        followUp: ["fantasy_lyra_03_master"],
      },
      {
        id: "fantasy_lyra_03_master", giver: "apothecary_lyra_thorne",
        title: "The Verge Apothecary — Master and Student",
        description: "Lyra's teacher disappeared into the Moonleaf Vigil twenty years ago. She thinks the bog witch Nymeria knows what happened.",
        objectives: [
          { id: "obj_lyra3_visit", type: "reach_location", target: "fantasy_bog_clearing", count: 1, desc: "Visit Nymeria in the bog at twilight." },
          { id: "obj_lyra3_ask", type: "talk_to", target: "witch_nymeria", count: 1, desc: "Ask about Lyra's teacher." },
          { id: "obj_lyra3_return", type: "talk_to", target: "apothecary_lyra_thorne", count: 1, desc: "Bring back what you learn." }
        ],
        rewards: { xp: 300, skill_xp: { healing: 80 }, items: ["lyra_master_tincture"] },
        prerequisites: ["fantasy_lyra_02_moonleaf"],
      },
    ],
  },
  {
    world: "fantasy", file: "nymeria-crossing.json", domain: "fantasy_lattice",
    quests: [
      {
        id: "fantasy_nymeria_01_fragment", giver: "witch_nymeria",
        title: "The Bog — A Lattice Fragment",
        description: "Nymeria will teach you to cross to the Crucible — but you need to bring her a lattice-fragment first. Any size.",
        objectives: [
          { id: "obj_nym1_find", type: "interact", target: "lattice_fragment_anywhere", count: 1, desc: "Find a lattice-fragment (in the Verge ruins, the hub bazaar, or a hub workshop)." },
          { id: "obj_nym1_bring", type: "deliver", target: "fragment_to_nymeria", count: 1, desc: "Bring it to Nymeria in the bog at any phase." }
        ],
        breadcrumbs: [
          { id: "bc_nym1", content: "The bog shares lattice underbrush with the lattice-Crucible world. Crossings are real but not lightly granted." }
        ],
        followUp: ["fantasy_nymeria_02_steps"],
      },
      {
        id: "fantasy_nymeria_02_steps", giver: "witch_nymeria",
        title: "The Bog — Eight Steps",
        description: "Nymeria teaches you eight steps. Three she makes up each time. You'll walk the bog with her at moonrise.",
        objectives: [
          { id: "obj_nym2_walk", type: "reach_location", target: "fantasy_bog_crossing", count: 1, desc: "Walk the eight steps under Nymeria's guidance." },
          { id: "obj_nym2_emerge", type: "reach_location", target: "lattice_verge_north", count: 1, desc: "Emerge on the Crucible side." }
        ],
        prerequisites: ["fantasy_nymeria_01_fragment"],
        followUp: ["fantasy_nymeria_03_return"],
      },
      {
        id: "fantasy_nymeria_03_return", giver: "witch_nymeria",
        title: "The Bog — The Return Path",
        description: "The path back is the path in. Nymeria warned you. The path has changed.",
        objectives: [
          { id: "obj_nym3_return", type: "reach_location", target: "fantasy_bog_clearing", count: 1, desc: "Find the way back through the bog." },
          { id: "obj_nym3_report", type: "talk_to", target: "witch_nymeria", count: 1, desc: "Report what you saw on the other side." }
        ],
        rewards: { xp: 400, skill_xp: { lattice_awareness: 60 }, items: ["nymeria_crossing_token"] },
        prerequisites: ["fantasy_nymeria_02_steps"],
      },
    ],
  },

  // ===== CRIME =====
  {
    world: "crime", file: "thorpe-bust.json", domain: "crime_main",
    quests: [
      {
        id: "crime_thorpe_01_bell", giver: "detective_iniko_voss",
        title: "Bell's Corner — Buy a Tip",
        description: "Iniko Voss wants Bell's tip about the Thorpe ring's last shipment. Bell will sell it. Cost: 50 sparks.",
        objectives: [
          { id: "obj_thorpe1_bell", type: "interact", target: "crime_alley_corner", count: 1, desc: "Find Bell at the alley corner during Freeus or later." },
          { id: "obj_thorpe1_buy", type: "deliver", target: "sparks_to_bell", count: 50, desc: "Pay 50 sparks for the tip." }
        ],
        breadcrumbs: [
          { id: "bc_thorpe1", content: "The Thorpe ring's last shipment crossed paths with hub-Bazaar goods. Velka and Silas are running the same chain." }
        ],
        followUp: ["crime_thorpe_02_maddox"],
      },
      {
        id: "crime_thorpe_02_maddox", giver: "detective_iniko_voss",
        title: "The Wharf — Get Maddox to Sign",
        description: "Maddox Kray owes Iniko three favours. He has paid none. Lean on him until you have his signature on a witness statement.",
        objectives: [
          { id: "obj_thorpe2_maddox", type: "talk_to", target: "fence_maddox_kray", count: 1, desc: "Confront Maddox at the wharf." },
          { id: "obj_thorpe2_sign", type: "interact", target: "maddox_statement_sealed", count: 1, desc: "Get the statement on paper, sealed." }
        ],
        prerequisites: ["crime_thorpe_01_bell"],
        followUp: ["crime_thorpe_03_haldane"],
      },
      {
        id: "crime_thorpe_03_haldane", giver: "judge_pia_haldane",
        title: "The Courthouse — Hand it to the Judge",
        description: "Judge Haldane has been collecting evidence for an indictment. With Maddox's statement, she can move. Hand it directly — never through Iniko.",
        objectives: [
          { id: "obj_thorpe3_deliver", type: "deliver", target: "statement_to_haldane", count: 1, desc: "Deliver the sealed statement to Judge Haldane in chambers." }
        ],
        rewards: { xp: 500, skill_xp: { investigation: 80 }, items: ["watch_commendation"] },
        prerequisites: ["crime_thorpe_02_maddox"],
      },
    ],
  },
  {
    world: "crime", file: "ada-pell-log.json", domain: "crime_side",
    quests: [
      {
        id: "crime_ada_01_morgue", giver: "coroner_ada_pell",
        title: "The Morgue — An Unusual Cause of Death",
        description: "Ada Pell has been logging cause-of-death anomalies. The latest body looks like cross-world creature predation. She wants a second opinion.",
        objectives: [
          { id: "obj_ada1_visit", type: "reach_location", target: "crime_morgue", count: 1, desc: "Visit Ada at the morgue during open hours." },
          { id: "obj_ada1_examine", type: "observe", target: "ada_anomaly_body", count: 1, desc: "Examine the body Ada has set aside." }
        ],
        breadcrumbs: [
          { id: "bc_ada1", content: "The wounds match Kiren Owl's hub mystery print. The same creature is crossing worlds and killing." }
        ],
        followUp: ["crime_ada_02_cross"],
      },
      {
        id: "crime_ada_02_cross", giver: "coroner_ada_pell",
        title: "The Morgue — Cross-Reference",
        description: "Ada wants you to carry her log to Kiren in the hub. He'll know whether it matches.",
        objectives: [
          { id: "obj_ada2_carry", type: "deliver", target: "ada_log_to_kiren", count: 1, desc: "Bring the log to Kiren Owl at the hub Verge outpost." }
        ],
        prerequisites: ["crime_ada_01_morgue"],
        followUp: ["crime_ada_03_return"],
      },
      {
        id: "crime_ada_03_return", giver: "coroner_ada_pell",
        title: "The Morgue — Cross-World Confirmation",
        description: "Return to Ada with Kiren's confirmation. The two coroners' logs together are evidence enough.",
        objectives: [
          { id: "obj_ada3_return", type: "talk_to", target: "coroner_ada_pell", count: 1, desc: "Bring Kiren's countersignature back to Ada." }
        ],
        rewards: { xp: 400, skill_xp: { tracking: 60 }, items: ["ada_predation_dossier"] },
        prerequisites: ["crime_ada_02_cross"],
      },
    ],
  },
  {
    world: "crime", file: "dahlia-ledger.json", domain: "crime_high",
    quests: [
      {
        id: "crime_dahlia_01_meet", giver: "lawyer_dahlia_kress",
        title: "The Defence Office — A Coffee Meeting",
        description: "Dahlia Kress wants to meet. She defended Silas Thorpe twice. She also defended a kid against Silas once. She wants to know which side you're on.",
        objectives: [
          { id: "obj_dahlia1_visit", type: "reach_location", target: "crime_lawyer_office", count: 1, desc: "Visit Dahlia during her client hours." },
          { id: "obj_dahlia1_choose", type: "any_of", target: "dahlia_alignment", count: 1, desc: "Tell Dahlia which side you stand on." }
        ],
        breadcrumbs: [
          { id: "bc_dahlia1", content: "Dahlia has a copy of Silas's ledger filed under privileged work-product. She is ready to hand it over to the right person." }
        ],
        followUp: ["crime_dahlia_02_steal"],
      },
      {
        id: "crime_dahlia_02_steal", giver: "lawyer_dahlia_kress",
        title: "The Defence Office — The Privileged Folder",
        description: "Dahlia will leave the office unlocked at sixth-bell. The folder is on the third shelf, second from the top. You take it. She did not give it to you.",
        objectives: [
          { id: "obj_dahlia2_enter", type: "stealth_traverse", target: "dahlia_office_after_hours", count: 1, desc: "Enter the office at sixth-bell unobserved." },
          { id: "obj_dahlia2_take", type: "interact", target: "thorpe_ledger_copy", count: 1, desc: "Take the ledger from the third shelf." }
        ],
        prerequisites: ["crime_dahlia_01_meet"],
        followUp: ["crime_dahlia_03_destination"],
      },
      {
        id: "crime_dahlia_03_destination", giver: null,
        title: "The Ledger — Where Does It Go?",
        description: "Three places it can go. Iniko's office (she said never bring it). Judge Haldane's chambers (she said the same). Bell at the corner (he'll sell it back to Silas). Choose.",
        objectives: [
          { id: "obj_dahlia3_choose", type: "any_of", target: "ledger_destination", count: 1, desc: "Decide where the ledger goes." }
        ],
        rewards: { xp: 700, items: ["dahlia_ledger_token"] },
        moralBranch: {
          desc: "Where does the ledger land?",
          options: [
            { id: "iniko", consequence: "Iniko uses it covertly to bust the ring. She owes you. Watch reputation +0.5." },
            { id: "haldane", consequence: "Judge Haldane indicts. Public win for the city. Civic reputation +0.7." },
            { id: "bell", consequence: "Bell sells it back to Silas. You receive 8000 sparks. Watch reputation -0.6." }
          ]
        },
        prerequisites: ["crime_dahlia_02_steal"],
      },
    ],
  },

  // ===== CYBER =====
  {
    world: "cyber", file: "ghost-7-trace.json", domain: "cyber_main",
    quests: [
      {
        id: "cyber_ghost_01_oren", giver: "fixer_oren_lim",
        title: "Neon Quarter — Ask About Ghost-7",
        description: "Oren Lim sells the question for 3000 sparks, the answer for 5000. You pay either way.",
        objectives: [
          { id: "obj_ghost1_pay", type: "deliver", target: "sparks_to_oren_3000", count: 1, desc: "Pay Oren 3000 sparks to ask." },
          { id: "obj_ghost1_pay_more", type: "deliver", target: "sparks_to_oren_5000", count: 1, desc: "Pay 5000 more for the answer." }
        ],
        breadcrumbs: [
          { id: "bc_ghost1", content: "Lavren, above the noodle shop on 7th. Knock twice, then once." }
        ],
        followUp: ["cyber_ghost_02_lavren"],
      },
      {
        id: "cyber_ghost_02_lavren", giver: null,
        title: "Neon Quarter — Lavren's Door",
        description: "Knock twice, then once. Don't kick the door. He's tired.",
        objectives: [
          { id: "obj_ghost2_knock", type: "interact", target: "lavren_door", count: 1, desc: "Knock twice + once at Lavren's door." },
          { id: "obj_ghost2_meet", type: "talk_to", target: "lavren_ghost_7", count: 1, desc: "Meet Lavren." }
        ],
        prerequisites: ["cyber_ghost_01_oren"],
        followUp: ["cyber_ghost_03_choice"],
      },
      {
        id: "cyber_ghost_03_choice", giver: null,
        title: "Lavren — What He Asks of You",
        description: "Lavren asks one thing. Carry it or refuse. Either ends the trace.",
        objectives: [
          { id: "obj_ghost3_choose", type: "any_of", target: "ghost_7_request", count: 1, desc: "Carry it or refuse." }
        ],
        rewards: { xp: 600, items: ["lavren_token"] },
        moralBranch: {
          desc: "What did you choose?",
          options: [
            { id: "carry", consequence: "Lavren returns to silence. You become his only living contact. Information bridge across cyber." },
            { id: "refuse", consequence: "Lavren disconnects. Ghost-7 will not be reached again." }
          ]
        },
        prerequisites: ["cyber_ghost_02_lavren"],
      },
    ],
  },
  {
    world: "cyber", file: "kira-packet-map.json", domain: "cyber_side",
    quests: [
      {
        id: "cyber_kira_01_tea", giver: "datadiver_kira_zane",
        title: "The Runners' Den — Bring Hot Tea",
        description: "Kira Zane hasn't slept. She'll talk in exchange for hot tea. She means it.",
        objectives: [
          { id: "obj_kira1_buy", type: "interact", target: "neon_quarter_tea_stall", count: 1, desc: "Buy a fresh cup of tea, hot." },
          { id: "obj_kira1_deliver", type: "deliver", target: "tea_to_kira", count: 1, desc: "Deliver it to Kira in the runners' den." }
        ],
        followUp: ["cyber_kira_02_map"],
      },
      {
        id: "cyber_kira_02_map", giver: "datadiver_kira_zane",
        title: "The Runners' Den — The Packet Map",
        description: "Kira hands you the map of a packet flow that doesn't terminate. Don't show Oren. Don't show Silver. Use it.",
        objectives: [
          { id: "obj_kira2_receive", type: "interact", target: "kira_map_handoff", count: 1, desc: "Receive the map." }
        ],
        breadcrumbs: [
          { id: "bc_kira2", content: "The packet flow leaks into the hub. The terminal node is a hub workshop." }
        ],
        prerequisites: ["cyber_kira_01_tea"],
        followUp: ["cyber_kira_03_trace"],
      },
      {
        id: "cyber_kira_03_trace", giver: "datadiver_kira_zane",
        title: "The Runners' Den — Follow the Flow",
        description: "Follow the map. The terminal node is in the hub. Find it. Tell only Kira where it leads.",
        objectives: [
          { id: "obj_kira3_follow", type: "reach_location", target: "hub_focus_lattice_workshop", count: 1, desc: "Reach the terminal node Kira's map points to." },
          { id: "obj_kira3_report", type: "talk_to", target: "datadiver_kira_zane", count: 1, desc: "Return with the answer. Tell Kira only." }
        ],
        rewards: { xp: 500, skill_xp: { lattice_awareness: 80 }, items: ["kira_packet_map_complete"] },
        prerequisites: ["cyber_kira_02_map"],
      },
    ],
  },
  {
    world: "cyber", file: "silver-identity.json", domain: "cyber_high",
    quests: [
      {
        id: "cyber_silver_01_visit", giver: "broker_silver_vey",
        title: "Silver's Office — A Quiet Meeting",
        description: "Silver Vey will see you. Be brief. He bills by the minute.",
        objectives: [
          { id: "obj_silver1_visit", type: "reach_location", target: "cyber_silver_office", count: 1, desc: "Visit Silver's office during open hours." },
          { id: "obj_silver1_ask", type: "any_of", target: "silver_request", count: 1, desc: "Ask about identity work — your own, or the borrowed Sahm one." }
        ],
        followUp: ["cyber_silver_02_choose"],
      },
      {
        id: "cyber_silver_02_choose", giver: "broker_silver_vey",
        title: "Silver's Office — Choose Your Path",
        description: "Two paths. Buy new papers for yourself (8000 sparks, three days). Or pay 10000 to learn that Iyatte's son exists and that you must never look further.",
        objectives: [
          { id: "obj_silver2_pay", type: "any_of", target: "silver_payment", count: 1, desc: "Choose: papers or knowledge." }
        ],
        moralBranch: {
          desc: "What did you buy?",
          options: [
            { id: "papers", consequence: "You receive new papers in three days. Useful for crime + cyber stealth surfaces." },
            { id: "knowledge", consequence: "You confirm Iyatte's son is alive. Silver warns you that pressing further ends three lives, his included." }
          ]
        },
        prerequisites: ["cyber_silver_01_visit"],
        followUp: ["cyber_silver_03_close"],
      },
      {
        id: "cyber_silver_03_close", giver: "broker_silver_vey",
        title: "Silver's Office — Close the Door",
        description: "Whichever you chose, Silver closes the file. Whether you press further is on you.",
        objectives: [
          { id: "obj_silver3_leave", type: "reach_location", target: "cyber_neon_quarter", count: 1, desc: "Leave Silver's office and return to the Quarter." }
        ],
        rewards: { xp: 400 },
        prerequisites: ["cyber_silver_02_choose"],
      },
    ],
  },

  // ===== SUPERHERO =====
  {
    world: "superhero", file: "iron-hex-redemption.json", domain: "superhero_main",
    quests: [
      {
        id: "superhero_hex_01_silas", giver: "mentor_old_silas",
        title: "Silas's Garden — The Apprentice's Name",
        description: "Old Silas tells you what Champion does not yet know. Iron Hex is Avery — Silas's best student. The redemption is yours to broker.",
        objectives: [
          { id: "obj_hex1_visit", type: "reach_location", target: "superhero_silas_garden", count: 1, desc: "Visit Silas during his afternoon gardening." },
          { id: "obj_hex1_listen", type: "talk_to", target: "mentor_old_silas", count: 1, desc: "Hear what Silas has to say about Iron Hex." }
        ],
        breadcrumbs: [
          { id: "bc_hex1", content: "Avery was the apprentice Champion failed to save. He believed harder than any of them. He still does." }
        ],
        followUp: ["superhero_hex_02_kor"],
      },
      {
        id: "superhero_hex_02_kor", giver: "champion_kor_blackstar",
        title: "The Skyline — Champion's Conditions",
        description: "Champion will meet Iron Hex. Neutral ground, no mask, no suit. Rooftop above the noodle shop on 7th, midnight any Wednesday. Arrange it.",
        objectives: [
          { id: "obj_hex2_kor", type: "talk_to", target: "champion_kor_blackstar", count: 1, desc: "Confirm Champion's conditions." },
          { id: "obj_hex2_arrange", type: "interact", target: "iron_hex_message_drop", count: 1, desc: "Drop a message in the Iron Hex cell's known dead-letter box." }
        ],
        prerequisites: ["superhero_hex_01_silas"],
        followUp: ["superhero_hex_03_meeting"],
      },
      {
        id: "superhero_hex_03_meeting", giver: null,
        title: "The Rooftop — Midnight",
        description: "Be there when they meet. The city's future hangs on whether either one of them puts a hand out first.",
        objectives: [
          { id: "obj_hex3_attend", type: "reach_location", target: "superhero_rooftop_7th", count: 1, desc: "Be on the rooftop at midnight." },
          { id: "obj_hex3_witness", type: "observe", target: "kor_avery_meeting", count: 1, desc: "Witness the meeting." }
        ],
        rewards: { xp: 900, items: ["silas_personal_token"] },
        moralBranch: {
          desc: "How did the meeting end?",
          options: [
            { id: "reconciled", consequence: "Avery removes the armour. Iron Hex is over. Two heroes, one city." },
            { id: "broken", consequence: "Avery refuses. Champion's pursuit becomes lethal. The city catches fire." }
          ]
        },
        prerequisites: ["superhero_hex_02_kor"],
      },
    ],
  },
  {
    world: "superhero", file: "mira-discretion.json", domain: "superhero_side",
    quests: [
      {
        id: "superhero_mira_01_warn", giver: "reporter_mira_vance",
        title: "The News Office — A Story She Won't Publish",
        description: "Mira Vance is building a profile on Champion's identity. Tell her not to publish. She'll listen if you can give her a reason.",
        objectives: [
          { id: "obj_mira1_visit", type: "reach_location", target: "superhero_news_office", count: 1, desc: "Visit Mira during work hours." },
          { id: "obj_mira1_argue", type: "talk_to", target: "reporter_mira_vance", count: 1, desc: "Make the case." }
        ],
        followUp: ["superhero_mira_02_intel"],
      },
      {
        id: "superhero_mira_02_intel", giver: "reporter_mira_vance",
        title: "The News Office — Trade Intel",
        description: "Mira will sit on the Champion story for intel of equal weight. Tell her something that's both true and runnable.",
        objectives: [
          { id: "obj_mira2_offer", type: "any_of", target: "mira_intel_offer", count: 1, desc: "Offer something — Carver's truce with Iron Hex, Ana Pell's gene treatment, or your own knowledge of Silas Crane's identity." }
        ],
        prerequisites: ["superhero_mira_01_warn"],
        followUp: ["superhero_mira_03_published"],
      },
      {
        id: "superhero_mira_03_published", giver: null,
        title: "The Front Page — Tomorrow Morning",
        description: "Whatever you traded, Mira will publish it tomorrow. Watch the city react.",
        objectives: [
          { id: "obj_mira3_observe", type: "observe", target: "mira_published_column", count: 1, desc: "Read the morning column." }
        ],
        rewards: { xp: 500, items: ["mira_press_card_unofficial"] },
        prerequisites: ["superhero_mira_02_intel"],
      },
    ],
  },
  {
    world: "superhero", file: "sifu-revelation.json", domain: "superhero_high",
    quests: [
      {
        id: "superhero_sifu_01_tell", giver: "champion_kor_blackstar",
        title: "The Skyline — Tell Champion About His Sifu",
        description: "His Sifu is alive in the hub. Champion does not know. Tell him.",
        objectives: [
          { id: "obj_sifu1_visit", type: "reach_location", target: "superhero_skyline", count: 1, desc: "Find Champion during his patrol." },
          { id: "obj_sifu1_tell", type: "talk_to", target: "champion_kor_blackstar", count: 1, desc: "Tell him." }
        ],
        breadcrumbs: [
          { id: "bc_sifu1", content: "Taro Sandren teaches in the hub brawling pit. The Sifu is the same one." }
        ],
        followUp: ["superhero_sifu_02_carry"],
      },
      {
        id: "superhero_sifu_02_carry", giver: "champion_kor_blackstar",
        title: "Cross-World — Take Him to His Sifu",
        description: "Champion will travel to the hub with you. Take him to Taro's pit at morning hours.",
        objectives: [
          { id: "obj_sifu2_cross", type: "reach_location", target: "hub_brawling_pit", count: 1, desc: "Arrive at the hub brawling pit during Stratus." },
          { id: "obj_sifu2_meet", type: "observe", target: "kor_taro_reunion", count: 1, desc: "Witness the reunion." }
        ],
        prerequisites: ["superhero_sifu_01_tell"],
        followUp: ["superhero_sifu_03_gift"],
      },
      {
        id: "superhero_sifu_03_gift", giver: "champion_kor_blackstar",
        title: "The Pit — A Gift",
        description: "Champion teaches you one move from the Sifu's hand. You will carry it.",
        objectives: [
          { id: "obj_sifu3_learn", type: "interact", target: "sifu_combo_lesson", count: 1, desc: "Train with Champion for a single combo." }
        ],
        rewards: { xp: 1000, skill_xp: { combat: 200 }, items: ["sifu_combo_dtu"] },
        prerequisites: ["superhero_sifu_02_carry"],
      },
    ],
  },

  // ===== LATTICE-CRUCIBLE =====
  {
    world: "lattice-crucible", file: "ono-nesha-letter.json", domain: "lattice_main",
    quests: [
      {
        id: "lattice_ono_01_sit", giver: "sage_ono_kell",
        title: "The Sage's Hut — Sit and Wait",
        description: "Ono Kell will write to Nesha if you sit and wait. Drink the tea.",
        objectives: [
          { id: "obj_ono1_visit", type: "reach_location", target: "lattice_sage_hut", count: 1, desc: "Visit Ono during her open audience hours." },
          { id: "obj_ono1_tea", type: "interact", target: "ono_tea_table", count: 1, desc: "Drink the tea while Ono writes." }
        ],
        followUp: ["lattice_ono_02_carry"],
      },
      {
        id: "lattice_ono_02_carry", giver: "sage_ono_kell",
        title: "The Bog — Carry the Letter",
        description: "Carry Ono's letter to Nesha in the hub. The bog is the fastest route — Nymeria will let you through.",
        objectives: [
          { id: "obj_ono2_bog", type: "reach_location", target: "fantasy_bog_clearing", count: 1, desc: "Pass through the bog (Nymeria will recognize Ono's seal)." },
          { id: "obj_ono2_arrive", type: "reach_location", target: "hub_refusal_keep_main_hall", count: 1, desc: "Arrive at the Refusal Keep with the letter intact." },
          { id: "obj_ono2_deliver", type: "deliver", target: "ono_letter_to_nesha", count: 1, desc: "Hand the letter to Nesha." }
        ],
        prerequisites: ["lattice_ono_01_sit"],
        followUp: ["lattice_ono_03_return"],
      },
      {
        id: "lattice_ono_03_return", giver: "oracle_nesha_keep",
        title: "Return Letter — Nesha to Ono",
        description: "Nesha writes back the same day. Carry her letter home.",
        objectives: [
          { id: "obj_ono3_return", type: "deliver", target: "nesha_letter_to_ono", count: 1, desc: "Return to Ono with Nesha's reply." }
        ],
        rewards: { xp: 700, skill_xp: { lattice_awareness: 100 }, items: ["ono_nesha_correspondence_token"] },
        prerequisites: ["lattice_ono_02_carry"],
      },
    ],
  },
  {
    world: "lattice-crucible", file: "voss-pact.json", domain: "lattice_side",
    quests: [
      {
        id: "lattice_voss_01_drill", giver: "leader_voss_dren",
        title: "The Drill Yard — Earn an Audience",
        description: "Voss Dren will speak privately if you drill with the cohort first. Bring a blade you trust.",
        objectives: [
          { id: "obj_voss1_drill", type: "interact", target: "lattice_drill_yard", count: 1, desc: "Drill with the cohort during morning hours." }
        ],
        followUp: ["lattice_voss_02_pact"],
      },
      {
        id: "lattice_voss_02_pact", giver: "leader_voss_dren",
        title: "The Lattice Circle — Hear the Pact",
        description: "Meet Voss at the lattice circle after dusk. He'll explain the cross-world pact with Calla Bren.",
        objectives: [
          { id: "obj_voss2_visit", type: "reach_location", target: "lattice_circle", count: 1, desc: "Meet Voss at the lattice circle after dusk." },
          { id: "obj_voss2_hear", type: "talk_to", target: "leader_voss_dren", count: 1, desc: "Hear the pact." }
        ],
        prerequisites: ["lattice_voss_01_drill"],
        followUp: ["lattice_voss_03_calla"],
      },
      {
        id: "lattice_voss_03_calla", giver: "leader_voss_dren",
        title: "The Ruins — Carry the Confirmation",
        description: "Voss wants you to carry confirmation to Calla Bren. The pact lives or dies on this exchange.",
        objectives: [
          { id: "obj_voss3_carry", type: "deliver", target: "voss_confirmation_to_calla", count: 1, desc: "Deliver to Calla in the ruins." }
        ],
        rewards: { xp: 600, items: ["voss_pact_seal"] },
        prerequisites: ["lattice_voss_02_pact"],
      },
    ],
  },
  {
    world: "lattice-crucible", file: "emer-print.json", domain: "lattice_print",
    quests: [
      {
        id: "lattice_emer_01_sketches", giver: "scout_emer_voss",
        title: "The Verge — Sketches of the Print",
        description: "Emer has tracked the same impossible print as Kiren in the hub. Show Kiren's sketch to Emer.",
        objectives: [
          { id: "obj_emer1_show", type: "deliver", target: "kiren_sketch_to_emer", count: 1, desc: "Bring Kiren's sketch to Emer at the verge." }
        ],
        followUp: ["lattice_emer_02_track"],
      },
      {
        id: "lattice_emer_02_track", giver: "scout_emer_voss",
        title: "The Verge — Track Together",
        description: "Track the creature with Emer. The prints lead to the verge breach.",
        objectives: [
          { id: "obj_emer2_track", type: "reach_location", target: "lattice_verge_breach", count: 1, desc: "Track the prints with Emer to the breach point." }
        ],
        prerequisites: ["lattice_emer_01_sketches"],
        followUp: ["lattice_emer_03_breach"],
      },
      {
        id: "lattice_emer_03_breach", giver: "scout_emer_voss",
        title: "The Breach — Cross to Meet Kiren",
        description: "Emer wants to meet Kiren in person. Lead Emer across the breach to the hub Verge outpost.",
        objectives: [
          { id: "obj_emer3_cross", type: "reach_location", target: "hub_verge_outpost", count: 1, desc: "Bring Emer to Kiren at the hub Verge outpost." },
          { id: "obj_emer3_introduce", type: "talk_to", target: "ranger_kiren_owl", count: 1, desc: "Introduce them." }
        ],
        rewards: { xp: 800, skill_xp: { tracking: 150 }, items: ["cross_world_scout_seal"] },
        prerequisites: ["lattice_emer_02_track"],
      },
    ],
  },

  // ===== SOVEREIGN-RUINS =====
  {
    world: "sovereign-ruins", file: "thanis-glyph.json", domain: "ruins_main",
    quests: [
      {
        id: "ruins_thanis_01_audience", giver: "archon_thanis",
        title: "The Ruined Court — Audience with the Archon",
        description: "Archon Thanis accepts gifts of one kind: glyphs. Bring a fragment of the cross-world glyph you've composed.",
        objectives: [
          { id: "obj_thanis1_compose", type: "interact", target: "hub_glyph_altar", count: 1, desc: "Compose a strength-3 glyph at the hub altar." },
          { id: "obj_thanis1_visit", type: "reach_location", target: "ruins_throne_court", count: 1, desc: "Bring it to the Ruined Court during audience hours." },
          { id: "obj_thanis1_present", type: "talk_to", target: "archon_thanis", count: 1, desc: "Present the glyph to Thanis." }
        ],
        followUp: ["ruins_thanis_02_layer"],
      },
      {
        id: "ruins_thanis_02_layer", giver: "archon_thanis",
        title: "The Ruined Court — A Half-Layer Further",
        description: "Thanis gives you a fragment half a layer further along the same glyph. Carry it back to Nesha.",
        objectives: [
          { id: "obj_thanis2_carry", type: "deliver", target: "thanis_glyph_to_nesha", count: 1, desc: "Bring Thanis's fragment to Nesha in the hub." }
        ],
        prerequisites: ["ruins_thanis_01_audience"],
        followUp: ["ruins_thanis_03_compose"],
      },
      {
        id: "ruins_thanis_03_compose", giver: "oracle_nesha_keep",
        title: "The Refusal Keep — Compose the Composite",
        description: "Nesha and Thanis's fragments compose to a strength-6 glyph. Mint it at the altar.",
        objectives: [
          { id: "obj_thanis3_mint", type: "interact", target: "hub_glyph_altar", count: 1, desc: "Mint the composite glyph at the altar." }
        ],
        rewards: { xp: 1000, skill_xp: { glyph_composition: 200 }, items: ["thanis_nesha_composite_dtu"] },
        prerequisites: ["ruins_thanis_02_layer"],
      },
    ],
  },
  {
    world: "sovereign-ruins", file: "calla-rebellion.json", domain: "ruins_side",
    quests: [
      {
        id: "ruins_calla_01_camp", giver: "rebel_calla_bren",
        title: "The Rebel Camp — Earn Calla's Trust",
        description: "Calla Bren leads the rebellion. Earn an audience by completing a small message run for her.",
        objectives: [
          { id: "obj_calla1_visit", type: "reach_location", target: "ruins_rebel_camp", count: 1, desc: "Visit the rebel camp during her morning drill." },
          { id: "obj_calla1_run", type: "deliver", target: "calla_message_to_zaen", count: 1, desc: "Carry a message to Zaen Drift in the Court." }
        ],
        breadcrumbs: [
          { id: "bc_calla1", content: "Zaen has met Calla in disguise twice. Has not killed her. The Court champion is closer to the rebellion than anyone in the Court suspects." }
        ],
        followUp: ["ruins_calla_02_plan"],
      },
      {
        id: "ruins_calla_02_plan", giver: "rebel_calla_bren",
        title: "The War Tent — The Fourth Uprising",
        description: "Calla shows you the map for the fourth uprising. She wants three things done before dawn.",
        objectives: [
          { id: "obj_calla2_disrupt", type: "interact", target: "ruins_throne_court_guard_shift", count: 1, desc: "Disrupt the guard shift change at the Court." },
          { id: "obj_calla2_signal", type: "interact", target: "ruins_rebel_signal_fire", count: 1, desc: "Light the rebel signal fire at the cliff." },
          { id: "obj_calla2_archive", type: "interact", target: "ruins_scribe_chamber", count: 1, desc: "Slip the rebellion manifesto into Hen Orven's writing pile." }
        ],
        prerequisites: ["ruins_calla_01_camp"],
        followUp: ["ruins_calla_03_dawn"],
      },
      {
        id: "ruins_calla_03_dawn", giver: "rebel_calla_bren",
        title: "Dawn — The Uprising Begins",
        description: "Be at the rebel camp at dawn. The fourth uprising begins with the city watching.",
        objectives: [
          { id: "obj_calla3_attend", type: "reach_location", target: "ruins_rebel_camp", count: 1, desc: "Be at the camp at dawn." },
          { id: "obj_calla3_side", type: "any_of", target: "calla_uprising_role", count: 1, desc: "Choose your role: frontline, courier, or witness." }
        ],
        rewards: { xp: 900, items: ["calla_rebel_signet"] },
        prerequisites: ["ruins_calla_02_plan"],
      },
    ],
  },
  {
    world: "sovereign-ruins", file: "silv-marn-dome.json", domain: "ruins_high",
    quests: [
      {
        id: "ruins_silv_01_circle", giver: "elder_silv_marn",
        title: "The Refused Circle — Find the Refused-Mother",
        description: "Silv Marn refused everything four decades ago. She knows how to undo a compound refusal. Find her at the refused circle at noon.",
        objectives: [
          { id: "obj_silv1_visit", type: "reach_location", target: "ruins_refused_circle", count: 1, desc: "Visit Silv at the refused circle during meditation hours." }
        ],
        followUp: ["ruins_silv_02_teach"],
      },
      {
        id: "ruins_silv_02_teach", giver: "elder_silv_marn",
        title: "The Refused Circle — Learn the Undoing",
        description: "Silv will teach you the undoing if you can compose a strength-6 refusal in her presence.",
        objectives: [
          { id: "obj_silv2_compose", type: "interact", target: "silv_refused_circle_glyph", count: 1, desc: "Compose a strength-6 refusal under Silv's watch." }
        ],
        prerequisites: ["ruins_silv_01_circle"],
        followUp: ["ruins_silv_03_dome"],
      },
      {
        id: "ruins_silv_03_dome", giver: "elder_silv_marn",
        title: "The Hub Dome — Stabilise the Field",
        description: "The hub Refusal Field is thinning. Carry Silv's undoing to the dome and stabilise the field.",
        objectives: [
          { id: "obj_silv3_cross", type: "reach_location", target: "hub_southern_arc_field_line", count: 1, desc: "Travel to the hub southern arc." },
          { id: "obj_silv3_stabilise", type: "interact", target: "silv_undoing_application", count: 1, desc: "Apply Silv's undoing at the field-line crack." }
        ],
        rewards: { xp: 1200, items: ["silv_undoing_token"] },
        prerequisites: ["ruins_silv_02_teach"],
      },
    ],
  },

  // ===== CONCORD-LINK-FRONTIER =====
  {
    world: "concord-link-frontier", file: "zara-perimeter.json", domain: "frontier_main",
    quests: [
      {
        id: "frontier_zara_01_brief", giver: "captain_zara_morn",
        title: "The Perimeter — Captain's Brief",
        description: "Captain Zara Morn has noticed lattice-Crucible scouts probing. She wants a back-channel with Emer Voss.",
        objectives: [
          { id: "obj_zara1_visit", type: "reach_location", target: "frontier_perimeter", count: 1, desc: "Find Zara on her morning patrol." },
          { id: "obj_zara1_talk", type: "talk_to", target: "captain_zara_morn", count: 1, desc: "Hear her plan." }
        ],
        followUp: ["frontier_zara_02_token"],
      },
      {
        id: "frontier_zara_02_token", giver: "captain_zara_morn",
        title: "The Verge — Bring a Token",
        description: "Cross to the lattice-Crucible verge. Find Emer Voss. Bring back any token of recognition.",
        objectives: [
          { id: "obj_zara2_cross", type: "reach_location", target: "lattice_verge_north", count: 1, desc: "Cross to Emer's territory." },
          { id: "obj_zara2_meet", type: "talk_to", target: "scout_emer_voss", count: 1, desc: "Meet Emer." },
          { id: "obj_zara2_token", type: "deliver", target: "emer_token_to_zara", count: 1, desc: "Bring Emer's token back to Zara." }
        ],
        prerequisites: ["frontier_zara_01_brief"],
        followUp: ["frontier_zara_03_watch"],
      },
      {
        id: "frontier_zara_03_watch", giver: "captain_zara_morn",
        title: "The Frontier — Mutual Watch",
        description: "Zara sends a token back. Carry it to Emer. Both sides can stop sleeping with one eye open.",
        objectives: [
          { id: "obj_zara3_carry", type: "deliver", target: "zara_token_to_emer", count: 1, desc: "Deliver Zara's reciprocating token to Emer." }
        ],
        rewards: { xp: 700, skill_xp: { diplomacy: 80 }, items: ["frontier_watch_token"] },
        prerequisites: ["frontier_zara_02_token"],
      },
    ],
  },
  {
    world: "concord-link-frontier", file: "mara-letter.json", domain: "frontier_side",
    quests: [
      {
        id: "frontier_mara_01_call", giver: "councillor_mara_pin",
        title: "The Council Room — Carry a Letter",
        description: "Councillor Mara Pin writes letters. Some get read. Carry one to Elder Mira Lattice in the hub.",
        objectives: [
          { id: "obj_mara1_visit", type: "reach_location", target: "frontier_council_room", count: 1, desc: "Visit Mara during her writing hours." },
          { id: "obj_mara1_collect", type: "interact", target: "mara_third_pencil_pile", count: 1, desc: "Take the letter from the third pencil's pile." }
        ],
        followUp: ["frontier_mara_02_deliver"],
      },
      {
        id: "frontier_mara_02_deliver", giver: "councillor_mara_pin",
        title: "The Assembly Hall — Hand to Mira",
        description: "Deliver the letter to Elder Mira Lattice in person. Do not read it. Do not leave with an aide.",
        objectives: [
          { id: "obj_mara2_carry", type: "deliver", target: "mara_letter_to_mira", count: 1, desc: "Hand it to Mira herself." }
        ],
        prerequisites: ["frontier_mara_01_call"],
        followUp: ["frontier_mara_03_return"],
      },
      {
        id: "frontier_mara_03_return", giver: "elder_mira_lattice",
        title: "The Frontier — Return with Reply",
        description: "Mira writes back. Bring the reply to Mara.",
        objectives: [
          { id: "obj_mara3_return", type: "deliver", target: "mira_letter_to_mara", count: 1, desc: "Return to Mara with Mira's reply." }
        ],
        rewards: { xp: 600, items: ["frontier_courier_seal"] },
        prerequisites: ["frontier_mara_02_deliver"],
      },
    ],
  },
  {
    world: "concord-link-frontier", file: "silas-quinn-portal.json", domain: "frontier_high",
    quests: [
      {
        id: "frontier_silas_01_observe", giver: "rider_silas_quinn",
        title: "The Western Road — Watch the Portal",
        description: "Silas Quinn has seen a portal opening off-schedule on the western perimeter. Same anomaly Kel Sandren tracks in the hub.",
        objectives: [
          { id: "obj_silas1_ride", type: "interact", target: "frontier_western_road", count: 1, desc: "Ride with Silas during his morning route." },
          { id: "obj_silas1_observe", type: "observe", target: "frontier_portal_anomaly", count: 1, desc: "Witness the off-schedule opening." }
        ],
        breadcrumbs: [
          { id: "bc_silas1", content: "Same anomaly Kel Sandren noticed in the hub. The breach is wide enough that two worlds notice." }
        ],
        followUp: ["frontier_silas_02_kel"],
      },
      {
        id: "frontier_silas_02_kel", giver: "rider_silas_quinn",
        title: "The Hub — Find Kel",
        description: "Carry Silas's observation to Kel Sandren at the hub portal plaza.",
        objectives: [
          { id: "obj_silas2_carry", type: "deliver", target: "silas_observation_to_kel", count: 1, desc: "Bring Silas's observation log to Kel." }
        ],
        prerequisites: ["frontier_silas_01_observe"],
        followUp: ["frontier_silas_03_synth"],
      },
      {
        id: "frontier_silas_03_synth", giver: "courier_kel_sandren",
        title: "The Portal Plaza — Synthesise",
        description: "Kel and Silas's observations align. Bring them together at a meeting at the impossible-print breach.",
        objectives: [
          { id: "obj_silas3_arrange", type: "deliver", target: "silas_kel_meeting_arranged", count: 1, desc: "Arrange the meeting." },
          { id: "obj_silas3_attend", type: "reach_location", target: "hub_seven_spokes_cellar_room", count: 1, desc: "Attend the synthesis meeting." }
        ],
        rewards: { xp: 800, skill_xp: { lattice_awareness: 120 }, items: ["frontier_portal_log"] },
        prerequisites: ["frontier_silas_02_kel"],
      },
    ],
  },
];

function objectiveOut(o) {
  return {
    id: o.id, type: o.type, target: o.target, required_count: o.count || 1,
    description: o.desc,
  };
}

function breadcrumbOut(b, afterObjId) {
  return {
    id: b.id, content: b.content,
    unlocks_after: afterObjId,
    release_mode: "on_completion",
  };
}

function questOut(q) {
  const last = q.objectives[q.objectives.length - 1];
  const out = {
    id: q.id, title: q.title, description: q.description,
    giver_npc_id: q.giver || null,
    domain: q.domain, difficulty: "intermediate", estimated_time: "15m",
    objectives: q.objectives.map(objectiveOut),
    rewards: q.rewards || { xp: 200 },
    breadcrumbs: (q.breadcrumbs || []).map((b) => breadcrumbOut(b, last.id)),
    follow_up_quest_ids: q.followUp || [],
    prerequisites: q.prerequisites || [],
    tags: [],
  };
  if (q.moralBranch) {
    out.moral_branch = {
      description: q.moralBranch.desc,
      options: q.moralBranch.options.map((o) => ({
        id: o.id, trigger: `${q.objectives[q.objectives.length - 1].id}:${o.id}`,
        consequence: o.consequence,
      })),
    };
  }
  return out;
}

let totalChains = 0, totalQuests = 0;
for (const chain of CHAINS) {
  const dir = `content/quests/sub-worlds/${chain.world}`;
  mkdirSync(dir, { recursive: true });
  const path = `${dir}/${chain.file}`;
  const out = chain.quests.map(questOut);
  out.forEach((q) => { if (!Array.isArray(q.tags)) q.tags = []; q.tags.push(chain.world, chain.domain); });
  writeFileSync(path, JSON.stringify(out, null, 2) + "\n", "utf8");
  totalChains++;
  totalQuests += out.length;
}
console.log({ totalChains, totalQuests });
