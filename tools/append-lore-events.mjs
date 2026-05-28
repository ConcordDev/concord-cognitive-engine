// Phase F2.4 — append 5 lore events per sub-world (35 total).
// Reads the existing lore.json (preserves world_id / world_description),
// appends new items to history[]. Idempotent on `id`.

import { readFileSync, writeFileSync } from "node:fs";

const LORE = {
  fantasy: [
    { id: "fantasy_thornwood_siege_year_03", title: "The Thornwood Siege", type: "war", era: "Year 03 of the Thorns",
      description: "Sandrun-Medici war pressure pushes refugee columns through the Verge. Thornwood holds the high road for nineteen days against a host that should have broken it. Lady Seraphine's father falls on the wall; she takes the keep at twenty-one.",
      significance: "major", factions_involved: ["thornwood_keep", "moonleaf_vigil"], known_by: ["thornwood_keep", "moonleaf_vigil"] },
    { id: "fantasy_lyra_master_disappearance", title: "The Apothecary's Master", type: "mystery", era: "Year -12 of the Thorns",
      description: "Lyra Thorne's teacher walked into the Moonleaf Vigil and never came out. The Vigil says she retired. The bog says otherwise.",
      significance: "minor", factions_involved: ["moonleaf_vigil"], known_by: ["moonleaf_vigil", "thornwood_keep"] },
    { id: "fantasy_bog_drift_event", title: "The Year the Bog Grew", type: "catastrophe", era: "Year 02 of the Thorns",
      description: "The bog expanded forty paces in a single season. Nymeria emerged unchanged; the village of Greenmire never again appeared on any map.",
      significance: "major", factions_involved: ["wildwood_circle"], known_by: ["wildwood_circle", "moonleaf_vigil"] },
    { id: "fantasy_corin_oath", title: "Ser Corin's Oath", type: "personal", era: "Year 01 of the Thorns",
      description: "Ser Corin Hale was knighted at twenty for saving Seraphine's youngest cousin from a Verge ambush. He has not asked for a favour in fifteen years.",
      significance: "minor", factions_involved: ["thornwood_keep"], known_by: ["thornwood_keep"] },
    { id: "fantasy_first_crossing", title: "The First Crossing", type: "founding", era: "Pre-Year 0",
      description: "Three centuries before the Thorns, hedge witches crossed the bog into the lattice. Returned with songs nobody now sings. Nymeria says she remembers one of them.",
      significance: "major", factions_involved: ["wildwood_circle"], known_by: ["wildwood_circle"] },
  ],
  crime: [
    { id: "crime_thorpe_ascendance", title: "Silas Thorpe's Ascendance", type: "founding", era: "Year -15",
      description: "Silas inherited the Pier from his father at thirty-eight after a knife in a back alley. The Watch never charged anyone.",
      significance: "major", factions_involved: ["thorpe_family"], known_by: ["thorpe_family", "crime_watch"] },
    { id: "crime_iniko_first_case", title: "Detective Voss's First Case", type: "personal", era: "Year -20",
      description: "Iniko Voss closed her first murder in three days. She was promoted on the fourth. Demoted on the fifth for refusing to charge the wrong man.",
      significance: "minor", factions_involved: ["crime_watch"], known_by: ["crime_watch"] },
    { id: "crime_haldane_demotion", title: "The Judge Who Refused", type: "personal", era: "Year -8",
      description: "Pia Haldane was demoted from the High Court for refusing the Thorpe bribe. She has not regretted it. The High Court has, twice.",
      significance: "minor", factions_involved: ["city_judiciary"], known_by: ["city_judiciary", "crime_watch"] },
    { id: "crime_anchor_disaster", title: "The Anchor Disaster", type: "catastrophe", era: "Year -7",
      description: "A docking-line failure crushed eleven sailors at the main pier. Old Lou pulled three out of the water alive. The Watch has thrown a memorial every year since.",
      significance: "major", factions_involved: ["crime_watch", "wharf_workers"], known_by: ["crime_watch"] },
    { id: "crime_ada_anomaly_log", title: "The Coroner's Hidden Log", type: "mystery", era: "Year -2 onward",
      description: "Ada Pell has been keeping a second log: causes of death she can't explain by any known animal. The pattern matches a hub ranger's tracking journal.",
      significance: "major", factions_involved: ["crime_watch"], known_by: ["crime_watch"] },
  ],
  cyber: [
    { id: "cyber_quarter_blackout", title: "The Week the Quarter Went Dark", type: "catastrophe", era: "Year 18",
      description: "Neon Quarter lost power for seven days. Three deaths, two riots, one quiet birth in the noodle shop on 7th. The cause was never declared.",
      significance: "major", factions_involved: ["lattice_patrol"], known_by: ["lattice_patrol", "lattice_runners"] },
    { id: "cyber_ghost_7_emergence", title: "The First Ghost-7 Trace", type: "mystery", era: "Year 21",
      description: "A voice appeared on stolen lattice frequencies. It helped a fixer save a child. It vanished within the hour. Three years later it returned.",
      significance: "major", factions_involved: ["lattice_runners"], known_by: ["lattice_runners"] },
    { id: "cyber_silver_first_identity", title: "Silver Vey's First Identity", type: "founding", era: "Year -2",
      description: "Silver wrote his first forged identity at sixteen. The customer was his older sister. She left the city under the new name and never came back.",
      significance: "minor", factions_involved: [], known_by: ["lattice_runners"] },
    { id: "cyber_holt_betrayal", title: "Officer Holt's Promotion", type: "personal", era: "Year 19",
      description: "Officer Jin Holt was promoted twice. The second was the year he started taking Oren Lim's coin. He still hates it. He still hasn't quit.",
      significance: "minor", factions_involved: ["lattice_patrol"], known_by: [] },
    { id: "cyber_kira_first_dive", title: "Kira Zane's First Dive", type: "personal", era: "Year 17",
      description: "Kira stole her first packet at nineteen. Three months later she had mapped a side of the deep-net nobody else had touched. She has never stopped.",
      significance: "minor", factions_involved: ["lattice_runners"], known_by: ["lattice_runners"] },
  ],
  superhero: [
    { id: "superhero_champion_first_save", title: "Champion's First Save", type: "personal", era: "Year 0 of the Skyline",
      description: "A masked man caught a bus suspended over the canal. The city called him 'Champion' before he chose the name himself. He was twenty-three.",
      significance: "major", factions_involved: ["skyline_champions"], known_by: ["skyline_champions"] },
    { id: "superhero_iron_hex_first_bomb", title: "Iron Hex's First Bomb", type: "catastrophe", era: "Year 3 of the Skyline",
      description: "Iron Hex evacuated a building before bombing it. Nobody died. The city argued for a week whether that made him a villain.",
      significance: "major", factions_involved: ["iron_hex_cell"], known_by: ["iron_hex_cell", "skyline_champions"] },
    { id: "superhero_silas_retirement", title: "Silas Crane Retires", type: "personal", era: "Year -20",
      description: "The city's first masked hero hangs up the mask. Cites 'too many right answers' as the reason. Goes home to roses.",
      significance: "minor", factions_involved: ["skyline_champions"], known_by: ["skyline_champions"] },
    { id: "superhero_ana_breakthrough", title: "Dr. Pell's Breakthrough", type: "discovery", era: "Year 5 of the Skyline",
      description: "Dr. Ana Pell isolates the gene responsible for Champion's strength. She does not publish. Three people know.",
      significance: "major", factions_involved: [], known_by: [] },
    { id: "superhero_helen_revelation", title: "Helen Knows", type: "personal", era: "Year 1 of the Skyline",
      description: "Kor's mother knows. She has known since the day after the bus. She has not told him she knows. Some nights she leaves an extra plate at supper.",
      significance: "minor", factions_involved: [], known_by: [] },
  ],
  "lattice-crucible": [
    { id: "lattice_third_drift_event", title: "The Third Drift Event", type: "catastrophe", era: "Year 12 of the Crucible",
      description: "The third drift event reshaped the lattice circle. Voss Dren was promoted to cohort leader within the week. He has not lost a cohort member since.",
      significance: "major", factions_involved: ["lattice_cohort"], known_by: ["lattice_cohort"] },
    { id: "lattice_ono_silence", title: "The Sage's Forty-Year Silence", type: "mystery", era: "Year -40 onward",
      description: "Ono Kell has studied drift signatures for forty years without writing them down. Citizens believe she carries them in her head. She does.",
      significance: "minor", factions_involved: ["kell_circle"], known_by: ["kell_circle"] },
    { id: "lattice_emer_first_crossing", title: "Emer Voss's First Crossing", type: "personal", era: "Year 8 of the Crucible",
      description: "At eighteen Emer crossed the verge alone for three days. Returned with maps the Crucible would not publicly recognize. Has been mapping since.",
      significance: "minor", factions_involved: ["verge_scouts"], known_by: ["verge_scouts"] },
    { id: "lattice_calvex_alloys", title: "The Calvex Alloys", type: "discovery", era: "Year 4 of the Crucible",
      description: "Rina Calvex's master discovered three alloys that harmonize with the focus-lattice. She refused to teach the recipe. Rina rediscovered two of them.",
      significance: "major", factions_involved: ["calvex_forge"], known_by: ["calvex_forge"] },
    { id: "lattice_pact_origin", title: "The Cross-World Pact", type: "war", era: "Year 11 of the Crucible",
      description: "Voss Dren met Calla Bren of the sovereign-ruins at a neutral bog meeting. They have not declared the pact publicly. Three people know.",
      significance: "major", factions_involved: ["lattice_cohort"], known_by: [] },
  ],
  "sovereign-ruins": [
    { id: "ruins_court_unburned", title: "The Court Unburned", type: "founding", era: "Year -300",
      description: "Three centuries before the present, the Court burned. Three centuries after, it was rebuilt. Archon Thanis counts both events in the present tense.",
      significance: "major", factions_invoked: ["ruined_court"], known_by: ["ruined_court"] },
    { id: "ruins_third_uprising", title: "The Third Uprising", type: "war", era: "Year -1",
      description: "Calla Bren led the third uprising. Lost. Buried seventy-three. Is leading the fourth.",
      significance: "major", factions_involved: ["ruin_rebellion"], known_by: ["ruin_rebellion", "ruined_court"] },
    { id: "ruins_silv_refusal", title: "Silv Marn's Refusal", type: "personal", era: "Year -40",
      description: "Silv Marn refused the rite, then four marriages, three kingdoms, two heirs, and the death of one child. She has lived as a refused-mother since.",
      significance: "minor", factions_involved: [], known_by: ["ruin_rebellion"] },
    { id: "ruins_zaen_secret", title: "Zaen's Disguise", type: "mystery", era: "Year -2",
      description: "Court champion Zaen Drift has met Calla Bren in disguise twice. Has not killed her. The Court does not know.",
      significance: "major", factions_involved: ["ruined_court"], known_by: [] },
    { id: "ruins_hen_archive", title: "The Scribe's Hidden Copy", type: "mystery", era: "Year -25",
      description: "Hen Orven made one private copy of the original Refusal Field engraving. He has not declared it. The hub Curator wants it.",
      significance: "major", factions_involved: ["ruined_court"], known_by: [] },
  ],
  "concord-link-frontier": [
    { id: "frontier_third_incursion", title: "The Third Incursion", type: "war", era: "Year -3",
      description: "The third frontier incursion broke against Zara Morn's perimeter. She has not slept eight hours since.",
      significance: "major", factions_involved: ["frontier_militia"], known_by: ["frontier_militia"] },
    { id: "frontier_dust_rose_arrival", title: "Dust Rose Arrives", type: "personal", era: "Year -3",
      description: "A ten-year-old appeared at the militia camp during the incursion. Refused to say from where. Has stayed.",
      significance: "minor", factions_involved: [], known_by: [] },
    { id: "frontier_mara_election", title: "The Letter-Writer's Election", type: "founding", era: "Year -5",
      description: "Mara Pin was elected on a platform of writing letters and refusing the militia's worse ideas. Has done both.",
      significance: "minor", factions_involved: [], known_by: [] },
    { id: "frontier_silas_quinn_route", title: "Silas Quinn's Western Route", type: "discovery", era: "Year -8",
      description: "Long Rider Silas Quinn discovered a passable route through the lattice-touched western waste. He has not declared it on any map.",
      significance: "major", factions_involved: [], known_by: [] },
    { id: "frontier_first_portal_anomaly", title: "The First Portal Anomaly", type: "mystery", era: "Year 0",
      description: "A portal at the western perimeter opened off-schedule for the first time recorded. Six months later it opened a second time. Now it opens weekly.",
      significance: "major", factions_involved: ["frontier_militia"], known_by: ["frontier_militia"] },
  ],
};

let total = 0;
for (const [world, items] of Object.entries(LORE)) {
  const path = `content/world/${world}/lore.json`;
  const j = JSON.parse(readFileSync(path, "utf8"));
  const history = Array.isArray(j) ? j : (j.history || []);
  const existingIds = new Set(history.map((h) => h.id));
  let appended = 0;
  for (const it of items) {
    if (existingIds.has(it.id)) continue;
    const item = { ...it, world_id: world };
    if (!item.factions_involved) item.factions_involved = item.factions_invoked || [];
    delete item.factions_invoked;
    if (!item.known_by) item.known_by = [];
    history.push(item);
    appended++;
  }
  if (Array.isArray(j)) {
    writeFileSync(path, JSON.stringify(history, null, 2) + "\n", "utf8");
  } else {
    j.history = history;
    writeFileSync(path, JSON.stringify(j, null, 2) + "\n", "utf8");
  }
  total += appended;
  console.log(`${world}: appended ${appended} lore items`);
}
console.log("--- total appended:", total);
