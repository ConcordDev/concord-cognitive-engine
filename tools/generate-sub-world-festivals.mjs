// Phase F2.3 — author 35 festivals across 7 sub-worlds (5 each).
// Each festival keys (season_idx, day_in_season_start) so the
// festival-trigger-cycle picks them up on calendar match. Writes
// to content/festivals/ — same flat directory the loader walks.

import { writeFileSync } from "node:fs";

const FESTIVALS = [
  // ===== FANTASY (5) =====
  { id: "fantasy_moonleaf_harvest",      world: "fantasy", name: "Moonleaf Harvest",        season_idx: 2, day: 4,  tag: "silver_leaf_garlands",  synopsis: "The Moonleaf Vigil opens the autumn harvest. Silver-leaf garlands over every threshold. Bread baked with moonleaf flour." },
  { id: "fantasy_thornwood_investiture", world: "fantasy", name: "Thornwood Investiture",   season_idx: 0, day: 14, tag: "thorn_banners",         synopsis: "The Lady reaffirms her oaths to the Keep. Thornwood banners across the great hall. Knights kneel and rise." },
  { id: "fantasy_bog_crossing_night",    world: "fantasy", name: "Bog Crossing Night",      season_idx: 5, day: 0,  tag: "bog_lanterns",          synopsis: "Once a year Nymeria opens the bog to anyone brave enough to cross. Bog-lanterns mark the eight steps." },
  { id: "fantasy_verge_bardic_contest",  world: "fantasy", name: "Verge Bardic Contest",    season_idx: 4, day: 12, tag: "tavern_ribbons",        synopsis: "Bards from across the Verge compete at the tavern. Three rounds: history, satire, lament." },
  { id: "fantasy_hunters_vigil",         world: "fantasy", name: "Hunters' Vigil",          season_idx: 3, day: 21, tag: "antler_torches",        synopsis: "Old Brann leads the Moonleaf hunters on the longest dawn-watch. Antler torches mark the path." },

  // ===== CRIME (5) =====
  { id: "crime_pier_watch_day",          world: "crime", name: "Pier Watch Day",            season_idx: 1, day: 7,  tag: "watch_blue_banners",    synopsis: "The Watch parades the pier. Half-civic, half-warning. Silas Thorpe never attends." },
  { id: "crime_anchor_memorial",         world: "crime", name: "Anchor Memorial",           season_idx: 3, day: 14, tag: "candles_at_the_wharf",  synopsis: "Names of every sailor lost are read at the wharf. A candle per name. Ada Pell never misses." },
  { id: "crime_justice_walk",            world: "crime", name: "The Justice Walk",          season_idx: 4, day: 0,  tag: "judge_robes",           synopsis: "Judge Haldane walks from the courthouse to the morgue to the pier and back. The city walks behind." },
  { id: "crime_ledger_audit",            world: "crime", name: "Smugglers' Ledger Audit",   season_idx: 2, day: 28, tag: "open_ledger",           synopsis: "Comic civic ritual. The Watch publishes a satirical 'ledger' of last year's smuggling figures. Maddox Kray hates it." },
  { id: "crime_coroners_reckoning",      world: "crime", name: "Coroner's Reckoning",       season_idx: 5, day: 35, tag: "white_robes",           synopsis: "Ada Pell publishes the city's annual cause-of-death summary at the courthouse steps. Citizens come to read names." },

  // ===== CYBER (5) =====
  { id: "cyber_neon_anniversary",        world: "cyber", name: "Neon Quarter Anniversary",  season_idx: 2, day: 0,  tag: "neon_strips",           synopsis: "Anniversary of the Quarter going dark for a week in Year 18. Strips of neon strung across every alley." },
  { id: "cyber_deepnet_hackfest",        world: "cyber", name: "Deepnet Hackfest",          season_idx: 4, day: 7,  tag: "blue_glow",             synopsis: "Sanctioned (kind of) 72-hour hack festival. Kira Zane sleeps less than usual. Officer Holt patrols quietly." },
  { id: "cyber_lattice_patrol_parade",   world: "cyber", name: "Lattice Patrol Parade",     season_idx: 0, day: 28, tag: "blue_armor",            synopsis: "The Patrol parades down the Avenue. Polished armour. The Quarter watches from rooftops, drinking." },
  { id: "cyber_codeword_burning",        world: "cyber", name: "Codeword Burning",          season_idx: 5, day: 21, tag: "ash_in_buckets",        synopsis: "Once a year, expired identities are publicly burned in front of Silver Vey's office. The smoke smells like solder." },
  { id: "cyber_ghost_7_day",             world: "cyber", name: "Ghost-7 Day",               season_idx: 3, day: 14, tag: "static_on_every_radio", synopsis: "Folk holiday. Children leave bread at the noodle shop on 7th. Lavren takes none of it; some neighbor always does." },

  // ===== SUPERHERO (5) =====
  { id: "superhero_champions_festival",  world: "superhero", name: "Champion's Festival",   season_idx: 1, day: 14, tag: "blue_silver_banners",   synopsis: "Annual recognition of Champion's first save. Champion never attends. Helen Blackstar bakes." },
  { id: "superhero_anti_mask_march",     world: "superhero", name: "Anti-Mask March",       season_idx: 3, day: 21, tag: "red_armbands",          synopsis: "Civilian rights group marches against masked-hero impunity. Iron Hex used to attend. Doesn't anymore." },
  { id: "superhero_roof_rendezvous",     world: "superhero", name: "Roof Rendezvous",       season_idx: 4, day: 0,  tag: "string_lights",         synopsis: "Once a year the city's rooftops open for public dinner. Silas Crane lights string lights over his garden." },
  { id: "superhero_skyline_marathon",    world: "superhero", name: "Skyline Marathon",      season_idx: 2, day: 14, tag: "race_numbers",          synopsis: "Civilian race from one skyline tower to another. Officer Carver runs every year." },
  { id: "superhero_hidden_heroes_day",   world: "superhero", name: "Hidden Heroes Day",     season_idx: 5, day: 28, tag: "small_red_pins",        synopsis: "Honors un-masked everyday rescues. Reporter Mira Vance runs the column. Robin Orange wears the pin all year." },

  // ===== LATTICE-CRUCIBLE (5) =====
  { id: "lattice_drift_festival",        world: "lattice-crucible", name: "Drift Festival", season_idx: 0, day: 7,  tag: "shimmering_ribbons",    synopsis: "The Crucible celebrates a year without a major drift cascade. Ribbons that catch the air-currents above the circle." },
  { id: "lattice_cohort_drill_day",      world: "lattice-crucible", name: "Cohort Drill Day", season_idx: 2, day: 21, tag: "ash_grey_pennants",   synopsis: "Voss Dren leads the cohort through the full drill set in public. Citizens watch from the wall." },
  { id: "lattice_sage_audience",         world: "lattice-crucible", name: "Sage's Audience", season_idx: 3, day: 0,  tag: "white_robes_silver_thread", synopsis: "Once a year Ono Kell takes audience from anyone who walks to her hut. The line is long and quiet." },
  { id: "lattice_verge_crossing",        world: "lattice-crucible", name: "Verge Crossing", season_idx: 4, day: 14, tag: "lattice_lanterns",      synopsis: "Calvex Forge fires the public kiln. Citizens cross the verge in pairs and return with a lattice-stone." },
  { id: "lattice_calvex_hammering",      world: "lattice-crucible", name: "Calvex Forge Hammering", season_idx: 1, day: 21, tag: "iron_sparks",   synopsis: "Public smithing day. Rina Calvex shows the Crucible's strange alloys to anyone who asks." },

  // ===== SOVEREIGN-RUINS (5) =====
  { id: "ruins_refusal_day",             world: "sovereign-ruins", name: "Refusal Day",     season_idx: 5, day: 0,  tag: "purple_ash",            synopsis: "The day the Ruined Court was unbroken. Purple ash strewn at the throne. Archon Thanis speaks once." },
  { id: "ruins_rebel_memorial",          world: "sovereign-ruins", name: "Rebel Memorial",  season_idx: 2, day: 7,  tag: "red_ribbons",           synopsis: "Names of every rebel who fell in three uprisings. Calla Bren reads. The Court does not attend." },
  { id: "ruins_court_audience",          world: "sovereign-ruins", name: "Court Audience",  season_idx: 0, day: 14, tag: "porcelain_masks",       synopsis: "Citizens may petition the Archon directly. Once a year. Zaen Drift stands as champion." },
  { id: "ruins_sun_bleach_festival",     world: "sovereign-ruins", name: "Sun-Bleach Festival", season_idx: 3, day: 35, tag: "white_canvas",      synopsis: "Caravans bleach their canvases on the high road. Pol Rim throws a small market. Children climb." },
  { id: "ruins_silv_walk",               world: "sovereign-ruins", name: "Silv's Walk",     season_idx: 4, day: 28, tag: "seven_brass_clasps",    synopsis: "Silv Marn walks the refused circle one full loop. Citizens may walk behind her if they refuse to speak." },

  // ===== CONCORD-LINK-FRONTIER (5) =====
  { id: "frontier_perimeter_day",        world: "concord-link-frontier", name: "Perimeter Day", season_idx: 1, day: 0,  tag: "frontier_flags",     synopsis: "Captain Zara Morn leads a full-perimeter patrol with civilians. Free supper at the militia hall after." },
  { id: "frontier_long_rider_race",      world: "concord-link-frontier", name: "Long Rider Race", season_idx: 3, day: 14, tag: "dust_streamers", synopsis: "Race from the eastern mile-marker to the western. Silas Quinn wins three years running. Sometimes." },
  { id: "frontier_smithing_festival",    world: "concord-link-frontier", name: "Smithing Festival", season_idx: 2, day: 28, tag: "iron_filings", synopsis: "Hane Okra opens the smithy. Repairs free that day. The militia brings broken rifles in stacks." },
  { id: "frontier_caravan_arrival",      world: "concord-link-frontier", name: "Trader's Caravan", season_idx: 4, day: 21, tag: "trade_ribbons", synopsis: "Hub-bound caravans arrive together once per quarter. The frontier eats well for a week." },
  { id: "frontier_council_letters_day",  world: "concord-link-frontier", name: "Council Letters Day", season_idx: 5, day: 14, tag: "ink_jars",   synopsis: "Councillor Mara Pin reads the year's most-replied-to letters aloud. The civic equivalent of a sermon." },
];

let written = 0;
for (const f of FESTIVALS) {
  const out = {
    id: f.id,
    name: f.name,
    world_id: f.world,
    season_idx: f.season_idx,
    day_in_season_start: f.day,
    day_in_season_end: f.day,
    repeats_yearly: true,
    decoration_tag: f.tag,
    synopsis: f.synopsis,
    achievements: [],
    quest_seeds: [],
  };
  const path = `content/festivals/${f.id}.json`;
  writeFileSync(path, JSON.stringify(out, null, 2) + "\n", "utf8");
  written++;
}
console.log({ written });
