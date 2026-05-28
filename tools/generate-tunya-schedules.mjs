// tools/generate-tunya-schedules.mjs
// Phase F1.1 — back-fill 6-block daily_schedule for the 25 tunya NPCs missing them.
// Writes in place to content/world/tunya/npcs.json.
//
// Per-NPC narrative context (each NPC has a known role + clan affiliation)
// drives location + activity per block. Phases are fixed at the standard
// 6-block Concordia cadence (Dominus 1-4 / Stratus 5-8 / Freeus 9-12 /
// Quartus 13-16 / Penanus 17-20 / Solnus 21-24).
//
// Idempotent: only writes schedules to NPCs that currently lack them.

import { readFileSync, writeFileSync } from "node:fs";

const FILE = "content/world/tunya/npcs.json";
const arr = JSON.parse(readFileSync(FILE, "utf8"));

// Per-NPC schedule maps: 6 blocks each. The location + activity reflect the
// NPC's narrative role and clan from their existing personality + background.
const SCHEDULES = {
  dinye_chair_oren: [
    { phase: "Dominus",  hours: [1, 4],   loc: "dinye_chair_private_chamber",       act: "reviews overnight clan reports; quiet meditation",                 need: "clan_governance",     i: false },
    { phase: "Stratus",  hours: [5, 8],   loc: "dinye_council_hall",                act: "morning chair audience; signs decrees with the registrar",         need: "clan_governance",     i: true  },
    { phase: "Freeus",   hours: [9, 12],  loc: "dinye_marketplace",                 act: "walks the market; receives petitions",                             need: "clan_governance",     i: true  },
    { phase: "Quartus",  hours: [13, 16], loc: "dinye_council_hall",                act: "private chair council; faction policy",                            need: "clan_governance",     i: false },
    { phase: "Penanus",  hours: [17, 20], loc: "dinye_chair_dining_hall",           act: "open dinner with senior clan members",                             need: "clan_governance",     i: true  },
    { phase: "Solnus",   hours: [21, 24], loc: "dinye_chair_private_chamber",       act: "private correspondence; closes the day with the registrar",        need: "clan_governance",     i: false },
  ],
  dinye_registrar_kira: [
    { phase: "Dominus",  hours: [1, 4],   loc: "dinye_records_archive",             act: "early indexing pass on overnight filings",                          need: "archive_work",        i: false },
    { phase: "Stratus",  hours: [5, 8],   loc: "dinye_council_hall_anteroom",       act: "attends Chair Oren's morning audience as scribe",                   need: "archive_work",        i: true  },
    { phase: "Freeus",   hours: [9, 12],  loc: "dinye_records_archive",             act: "open archive hours; citizens come to verify lineage",               need: "archive_work",        i: true  },
    { phase: "Quartus",  hours: [13, 16], loc: "dinye_archive_back_office",         act: "cross-checks contested filings; coordinates with Sahm",             need: "archive_work",        i: false },
    { phase: "Penanus",  hours: [17, 20], loc: "dinye_marketplace_tavern",          act: "supper with the merchant guild liaisons",                           need: "archive_work",        i: true  },
    { phase: "Solnus",   hours: [21, 24], loc: "dinye_registrar_quarters",          act: "personal study; reads forbidden Sandrun mirror-letters",            need: "archive_work",        i: false },
  ],
  dinye_guard_volk: [
    { phase: "Dominus",  hours: [1, 4],   loc: "dinye_guard_barracks",              act: "rotates night-watch; checks the south gate seal",                   need: "patrol",              i: false },
    { phase: "Stratus",  hours: [5, 8],   loc: "dinye_council_hall_perimeter",      act: "secures the chair's morning audience",                              need: "patrol",              i: true  },
    { phase: "Freeus",   hours: [9, 12],  loc: "dinye_marketplace",                 act: "open patrol; market dispute mediation",                             need: "patrol",              i: true  },
    { phase: "Quartus",  hours: [13, 16], loc: "dinye_guard_drill_yard",            act: "drills new recruits; ember-discipline practice",                    need: "patrol",              i: true  },
    { phase: "Penanus",  hours: [17, 20], loc: "dinye_marketplace_tavern",          act: "off-duty supper with the watch",                                    need: "patrol",              i: true  },
    { phase: "Solnus",   hours: [21, 24], loc: "dinye_guard_barracks",              act: "sleeps; on call",                                                   need: "patrol",              i: false },
  ],
  aekon_warden_hild: [
    { phase: "Dominus",  hours: [1, 4],   loc: "aekon_warden_tower",                act: "private vigil at the ice-glass altar",                              need: "warden_duty",         i: false },
    { phase: "Stratus",  hours: [5, 8],   loc: "aekon_perimeter_ice_wall",          act: "walks the perimeter; checks the seal-stones",                       need: "warden_duty",         i: true  },
    { phase: "Freeus",   hours: [9, 12],  loc: "aekon_warden_audience_hall",        act: "receives the clan's morning grievances",                            need: "warden_duty",         i: true  },
    { phase: "Quartus",  hours: [13, 16], loc: "aekon_council_chamber",             act: "war-council with the smith and the courier",                        need: "warden_duty",         i: false },
    { phase: "Penanus",  hours: [17, 20], loc: "aekon_warden_audience_hall",        act: "evening audience; permits travel out of Aekon",                     need: "warden_duty",         i: true  },
    { phase: "Solnus",   hours: [21, 24], loc: "aekon_warden_tower",                act: "writes the day's report; sleeps",                                   need: "warden_duty",         i: false },
  ],
  aekon_smith_jera: [
    { phase: "Dominus",  hours: [1, 4],   loc: "aekon_ice_forge",                   act: "banks the forge fire; checks ice-tempering vats",                   need: "forge_work",          i: false },
    { phase: "Stratus",  hours: [5, 8],   loc: "aekon_ice_forge",                   act: "morning forging; ice-glass blade work",                             need: "forge_work",          i: true  },
    { phase: "Freeus",   hours: [9, 12],  loc: "aekon_forge_shopfront",             act: "open shop; sells finished work",                                    need: "forge_work",          i: true  },
    { phase: "Quartus",  hours: [13, 16], loc: "aekon_ice_forge",                   act: "afternoon commissions; apprentice training",                        need: "forge_work",          i: true  },
    { phase: "Penanus",  hours: [17, 20], loc: "aekon_smith_residence",             act: "supper; consults with the courier on caravan orders",               need: "forge_work",          i: false },
    { phase: "Solnus",   hours: [21, 24], loc: "aekon_smith_residence",             act: "private study; reads forge-master letters",                         need: "forge_work",          i: false },
  ],
  aekon_courier_yon: [
    { phase: "Dominus",  hours: [1, 4],   loc: "aekon_courier_post",                act: "sorts overnight mail; preps the morning run",                       need: "courier_work",        i: false },
    { phase: "Stratus",  hours: [5, 8],   loc: "aekon_perimeter_road",              act: "first run to Asbir; observes patrol shifts",                        need: "courier_work",        i: false },
    { phase: "Freeus",   hours: [9, 12],  loc: "aekon_courier_post",                act: "receives outbound mail; sorts by destination",                      need: "courier_work",        i: true  },
    { phase: "Quartus",  hours: [13, 16], loc: "aekon_perimeter_road",              act: "afternoon run to Sandrun; carries the mirror-letter",               need: "courier_work",        i: false },
    { phase: "Penanus",  hours: [17, 20], loc: "aekon_courier_post",                act: "evening drop-off; reconciles the day's ledger",                     need: "courier_work",        i: true  },
    { phase: "Solnus",   hours: [21, 24], loc: "aekon_courier_quarters",            act: "sleeps; on emergency-call rotation",                                need: "courier_work",        i: false },
  ],
  asbir_keeper_vera: [
    { phase: "Dominus",  hours: [1, 4],   loc: "asbir_archive_inner_vault",         act: "early indexing; checks the sealed records",                         need: "archive_work",        i: false },
    { phase: "Stratus",  hours: [5, 8],   loc: "asbir_archive_main_hall",           act: "opens the archive; receives morning scholars",                      need: "archive_work",        i: true  },
    { phase: "Freeus",   hours: [9, 12],  loc: "asbir_archive_main_hall",           act: "research consultations; runs lineage searches",                     need: "archive_work",        i: true  },
    { phase: "Quartus",  hours: [13, 16], loc: "asbir_archive_inner_vault",         act: "private cataloguing; coordinates with hub curator",                 need: "archive_work",        i: false },
    { phase: "Penanus",  hours: [17, 20], loc: "asbir_keeper_residence",            act: "supper; reads correspondence",                                      need: "archive_work",        i: false },
    { phase: "Solnus",   hours: [21, 24], loc: "asbir_archive_main_hall",           act: "evening lock-up walk; reads in the dim",                            need: "archive_work",        i: false },
  ],
  asbir_engineer_rann: [
    { phase: "Dominus",  hours: [1, 4],   loc: "asbir_engineering_workshop",        act: "pre-dawn calibration of focus-lattice components",                  need: "engineering",         i: false },
    { phase: "Stratus",  hours: [5, 8],   loc: "asbir_engineering_workshop",        act: "morning bench work; correspondence with Lyra in the hub",           need: "engineering",         i: false },
    { phase: "Freeus",   hours: [9, 12],  loc: "asbir_engineering_yard",            act: "field-test of lattice apparatus; apprentice training",              need: "engineering",         i: true  },
    { phase: "Quartus",  hours: [13, 16], loc: "asbir_engineering_workshop",        act: "afternoon bench work; consults the archive",                        need: "engineering",         i: true  },
    { phase: "Penanus",  hours: [17, 20], loc: "asbir_engineer_residence",          act: "supper with Keeper Vera",                                           need: "engineering",         i: true  },
    { phase: "Solnus",   hours: [21, 24], loc: "asbir_engineer_residence",          act: "personal study; writes reports",                                    need: "engineering",         i: false },
  ],
  asbir_guard_lior: [
    { phase: "Dominus",  hours: [1, 4],   loc: "asbir_archive_perimeter",           act: "night watch on the sealed records vault",                           need: "patrol",              i: false },
    { phase: "Stratus",  hours: [5, 8],   loc: "asbir_archive_main_gate",           act: "morning shift; admits incoming scholars",                           need: "patrol",              i: true  },
    { phase: "Freeus",   hours: [9, 12],  loc: "asbir_archive_main_hall",           act: "interior watch; coordinates with the keeper",                       need: "patrol",              i: true  },
    { phase: "Quartus",  hours: [13, 16], loc: "asbir_archive_main_gate",           act: "afternoon shift; logs visitors",                                    need: "patrol",              i: true  },
    { phase: "Penanus",  hours: [17, 20], loc: "asbir_guard_barracks",              act: "off-duty supper",                                                   need: "patrol",              i: true  },
    { phase: "Solnus",   hours: [21, 24], loc: "asbir_guard_barracks",              act: "sleeps; on call",                                                   need: "patrol",              i: false },
  ],
  fluxom_lord_skarn: [
    { phase: "Dominus",  hours: [1, 4],   loc: "fluxom_lord_war_chamber",           act: "private dawn-vigil; speaks to no one",                              need: "rule",                i: false },
    { phase: "Stratus",  hours: [5, 8],   loc: "fluxom_war_hall",                   act: "morning hall; receives the war captains",                           need: "rule",                i: true  },
    { phase: "Freeus",   hours: [9, 12],  loc: "fluxom_drill_yard",                 act: "inspects the levy; cactem-mount training",                          need: "rule",                i: true  },
    { phase: "Quartus",  hours: [13, 16], loc: "fluxom_war_hall",                   act: "war-council; receives Sandrun and Akeia envoys",                    need: "rule",                i: false },
    { phase: "Penanus",  hours: [17, 20], loc: "fluxom_great_hall_dining",          act: "open supper; clan business",                                        need: "rule",                i: true  },
    { phase: "Solnus",   hours: [21, 24], loc: "fluxom_lord_war_chamber",           act: "private correspondence; sleeps lightly",                            need: "rule",                i: false },
  ],
  fluxom_breeder_rena: [
    { phase: "Dominus",  hours: [1, 4],   loc: "fluxom_cactem_pens",                act: "checks the night-born calves; tends the herd",                      need: "breeding",            i: false },
    { phase: "Stratus",  hours: [5, 8],   loc: "fluxom_cactem_pens",                act: "morning rotation; feeds and waters the herd",                       need: "breeding",            i: true  },
    { phase: "Freeus",   hours: [9, 12],  loc: "fluxom_breeder_shopfront",          act: "open shop; sells mounts and breeding rights",                       need: "breeding",            i: true  },
    { phase: "Quartus",  hours: [13, 16], loc: "fluxom_cactem_pens",                act: "afternoon training; mounts the new riders",                         need: "breeding",            i: true  },
    { phase: "Penanus",  hours: [17, 20], loc: "fluxom_breeder_residence",          act: "supper; reviews the breeder ledger",                                need: "breeding",            i: false },
    { phase: "Solnus",   hours: [21, 24], loc: "fluxom_cactem_pens",                act: "last walk of the pens; sleeps in the herd-loft",                    need: "breeding",            i: false },
  ],
  fluxom_refugee_tova: [
    { phase: "Dominus",  hours: [1, 4],   loc: "fluxom_refugee_tent_cluster",       act: "tends the sick through the cold hours",                             need: "healing",             i: false },
    { phase: "Stratus",  hours: [5, 8],   loc: "fluxom_refugee_kitchens",           act: "distributes morning rations; logs need",                            need: "healing",             i: true  },
    { phase: "Freeus",   hours: [9, 12],  loc: "fluxom_refugee_clinic",             act: "open clinic; treats the wounded and the wandering",                 need: "healing",             i: true  },
    { phase: "Quartus",  hours: [13, 16], loc: "fluxom_refugee_clinic",             act: "afternoon clinic; receives Medici supplies",                        need: "healing",             i: true  },
    { phase: "Penanus",  hours: [17, 20], loc: "fluxom_refugee_kitchens",           act: "evening rations; comforts the children",                            need: "healing",             i: true  },
    { phase: "Solnus",   hours: [21, 24], loc: "fluxom_refugee_clinic",             act: "night rounds; sleeps in the clinic loft",                           need: "healing",             i: false },
  ],
  nil_elder_mevra: [
    { phase: "Dominus",  hours: [1, 4],   loc: "nil_elder_grove",                   act: "moon-vigil at the stone circle",                                    need: "spirit_walk",         i: false },
    { phase: "Stratus",  hours: [5, 8],   loc: "nil_elder_residence",               act: "morning meditation; brews the day's tea",                           need: "spirit_walk",         i: false },
    { phase: "Freeus",   hours: [9, 12],  loc: "nil_council_circle",                act: "open audience; receives petitioners",                               need: "spirit_walk",         i: true  },
    { phase: "Quartus",  hours: [13, 16], loc: "nil_elder_grove",                   act: "spirit-walk along the wind-paths",                                  need: "spirit_walk",         i: false },
    { phase: "Penanus",  hours: [17, 20], loc: "nil_council_circle",                act: "evening audience; clan disputes",                                   need: "spirit_walk",         i: true  },
    { phase: "Solnus",   hours: [21, 24], loc: "nil_elder_residence",               act: "private prayer; sleeps",                                            need: "spirit_walk",         i: false },
  ],
  akeia_matriarch_iola: [
    { phase: "Dominus",  hours: [1, 4],   loc: "akeia_matriarch_chambers",          act: "private prayer at the tide-altar",                                  need: "matriarchal_rule",    i: false },
    { phase: "Stratus",  hours: [5, 8],   loc: "akeia_council_hall",                act: "morning hall; receives clan elders",                                need: "matriarchal_rule",    i: true  },
    { phase: "Freeus",   hours: [9, 12],  loc: "akeia_tide_temple",                 act: "tide-blessing of fishing fleets",                                   need: "matriarchal_rule",    i: true  },
    { phase: "Quartus",  hours: [13, 16], loc: "akeia_matriarch_chambers",          act: "private correspondence; consults the tidesinger",                   need: "matriarchal_rule",    i: false },
    { phase: "Penanus",  hours: [17, 20], loc: "akeia_council_hall",                act: "evening hall; settles disputes",                                    need: "matriarchal_rule",    i: true  },
    { phase: "Solnus",   hours: [21, 24], loc: "akeia_matriarch_chambers",          act: "sleeps; the night belongs to the tide",                             need: "matriarchal_rule",    i: false },
  ],
  akeia_tidesinger_vesh: [
    { phase: "Dominus",  hours: [1, 4],   loc: "akeia_tide_temple",                 act: "low-tide vigil; reads the receding sea",                            need: "tide_singing",        i: false },
    { phase: "Stratus",  hours: [5, 8],   loc: "akeia_tide_temple",                 act: "morning tide-song; blesses the fleet",                              need: "tide_singing",        i: true  },
    { phase: "Freeus",   hours: [9, 12],  loc: "akeia_tide_temple_garden",          act: "trains the tidesinger acolytes",                                    need: "tide_singing",        i: true  },
    { phase: "Quartus",  hours: [13, 16], loc: "akeia_dock_promenade",              act: "walks the docks; receives sailors' offerings",                      need: "tide_singing",        i: true  },
    { phase: "Penanus",  hours: [17, 20], loc: "akeia_tide_temple",                 act: "high-tide song; meditation",                                        need: "tide_singing",        i: false },
    { phase: "Solnus",   hours: [21, 24], loc: "akeia_tidesinger_quarters",         act: "reads the celestial tide-charts; sleeps",                           need: "tide_singing",        i: false },
  ],
  akeia_dock_jano: [
    { phase: "Dominus",  hours: [1, 4],   loc: "akeia_dock_master_office",          act: "logs overnight arrivals; updates the harbour ledger",               need: "dock_work",           i: false },
    { phase: "Stratus",  hours: [5, 8],   loc: "akeia_main_pier",                   act: "morning fleet departure; assigns berths",                           need: "dock_work",           i: true  },
    { phase: "Freeus",   hours: [9, 12],  loc: "akeia_main_pier",                   act: "open hours; receives cargo and travellers",                         need: "dock_work",           i: true  },
    { phase: "Quartus",  hours: [13, 16], loc: "akeia_dock_master_office",          act: "afternoon logs; arbitrates dockside disputes",                      need: "dock_work",           i: true  },
    { phase: "Penanus",  hours: [17, 20], loc: "akeia_dockside_tavern",             act: "evening with the captains",                                         need: "dock_work",           i: true  },
    { phase: "Solnus",   hours: [21, 24], loc: "akeia_dock_master_residence",       act: "sleeps; rises for emergencies",                                     need: "dock_work",           i: false },
  ],
  sangree_chief_thal: [
    { phase: "Dominus",  hours: [1, 4],   loc: "sangree_chief_war_tent",            act: "pre-dawn drill; sharpens his own blade",                            need: "clan_war",            i: false },
    { phase: "Stratus",  hours: [5, 8],   loc: "sangree_war_council",               act: "morning council; receives scouts",                                  need: "clan_war",            i: true  },
    { phase: "Freeus",   hours: [9, 12],  loc: "sangree_drill_yard",                act: "drills the war-band; takes challenges",                             need: "clan_war",            i: true  },
    { phase: "Quartus",  hours: [13, 16], loc: "sangree_war_council",               act: "afternoon council; coordinates Medici war",                         need: "clan_war",            i: false },
    { phase: "Penanus",  hours: [17, 20], loc: "sangree_clan_hall",                 act: "open clan supper; settles internal grievances",                     need: "clan_war",            i: true  },
    { phase: "Solnus",   hours: [21, 24], loc: "sangree_chief_war_tent",            act: "reads scout reports; sleeps with the blade beside him",             need: "clan_war",            i: false },
  ],
  sangree_smith_orla: [
    { phase: "Dominus",  hours: [1, 4],   loc: "sangree_war_forge",                 act: "banks the forge; checks the quench vats",                           need: "forge_work",          i: false },
    { phase: "Stratus",  hours: [5, 8],   loc: "sangree_war_forge",                 act: "morning forging; blades for the war-band",                          need: "forge_work",          i: true  },
    { phase: "Freeus",   hours: [9, 12],  loc: "sangree_forge_shop",                act: "open shop; sells finished work",                                    need: "forge_work",          i: true  },
    { phase: "Quartus",  hours: [13, 16], loc: "sangree_war_forge",                 act: "afternoon commissions; trains the apprentices",                     need: "forge_work",          i: true  },
    { phase: "Penanus",  hours: [17, 20], loc: "sangree_smith_residence",           act: "supper; rolls the day's edge-scraps",                               need: "forge_work",          i: false },
    { phase: "Solnus",   hours: [21, 24], loc: "sangree_smith_residence",           act: "studies the war-blade ledgers; sleeps",                             need: "forge_work",          i: false },
  ],
  medici_archhealer_yev: [
    { phase: "Dominus",  hours: [1, 4],   loc: "medici_archhealer_private_clinic",  act: "tends the gravely wounded through the cold hours",                  need: "healing",             i: false },
    { phase: "Stratus",  hours: [5, 8],   loc: "medici_main_clinic",                act: "open clinic; treats the morning queue",                             need: "healing",             i: true  },
    { phase: "Freeus",   hours: [9, 12],  loc: "medici_clinic_garden",              act: "tends the medicinal herb beds",                                     need: "healing",             i: true  },
    { phase: "Quartus",  hours: [13, 16], loc: "medici_main_clinic",                act: "afternoon clinic; receives Medici cartel envoys",                   need: "healing",             i: true  },
    { phase: "Penanus",  hours: [17, 20], loc: "medici_archhealer_private_clinic",  act: "private surgeries; teaches the apprentice",                         need: "healing",             i: true  },
    { phase: "Solnus",   hours: [21, 24], loc: "medici_archhealer_residence",       act: "sleeps; on emergency call",                                         need: "healing",             i: false },
  ],
  medici_apprentice_lin: [
    { phase: "Dominus",  hours: [1, 4],   loc: "medici_apprentice_quarters",        act: "studies the herbarium; sleeps four hours",                          need: "apprenticeship",      i: false },
    { phase: "Stratus",  hours: [5, 8],   loc: "medici_main_clinic",                act: "morning prep; sterilises instruments; arranges the day",            need: "apprenticeship",      i: true  },
    { phase: "Freeus",   hours: [9, 12],  loc: "medici_main_clinic",                act: "assists Arch-Healer Yev; takes notes",                              need: "apprenticeship",      i: true  },
    { phase: "Quartus",  hours: [13, 16], loc: "medici_clinic_garden",              act: "studies the herb beds; runs errands",                               need: "apprenticeship",      i: true  },
    { phase: "Penanus",  hours: [17, 20], loc: "medici_archhealer_private_clinic",  act: "evening lecture from Yev; observed surgeries",                      need: "apprenticeship",      i: true  },
    { phase: "Solnus",   hours: [21, 24], loc: "medici_apprentice_quarters",        act: "private reading; writes letters home to Sahm",                      need: "apprenticeship",      i: false },
  ],
  sahm_provost_kez: [
    { phase: "Dominus",  hours: [1, 4],   loc: "sahm_provost_residence",            act: "reads overnight correspondence; meditates",                         need: "provostship",         i: false },
    { phase: "Stratus",  hours: [5, 8],   loc: "sahm_chancellery",                  act: "morning hall; signs decrees and travel papers",                     need: "provostship",         i: true  },
    { phase: "Freeus",   hours: [9, 12],  loc: "sahm_chancellery",                  act: "open hours; receives faculty and merchants",                        need: "provostship",         i: true  },
    { phase: "Quartus",  hours: [13, 16], loc: "sahm_council_chamber",              act: "scholar's council; coordinates with the Asbir keeper",              need: "provostship",         i: false },
    { phase: "Penanus",  hours: [17, 20], loc: "sahm_provost_dining_hall",          act: "private supper with the visiting scholars",                         need: "provostship",         i: true  },
    { phase: "Solnus",   hours: [21, 24], loc: "sahm_provost_residence",            act: "writes the day's letter to the chancellor of Iyatte's son",         need: "provostship",         i: false },
  ],
  bahiij_caravan_master_rema: [
    { phase: "Dominus",  hours: [1, 4],   loc: "bahiij_caravan_camp",               act: "checks the wagons; reviews the day's route",                        need: "caravan_work",        i: false },
    { phase: "Stratus",  hours: [5, 8],   loc: "bahiij_caravan_road",               act: "morning trek; the caravan moves",                                   need: "caravan_work",        i: false },
    { phase: "Freeus",   hours: [9, 12],  loc: "bahiij_marketplace",                act: "open trade at the next post; sells and buys",                       need: "caravan_work",        i: true  },
    { phase: "Quartus",  hours: [13, 16], loc: "bahiij_caravan_road",               act: "afternoon trek; tends the mahout train",                            need: "caravan_work",        i: false },
    { phase: "Penanus",  hours: [17, 20], loc: "bahiij_caravan_camp",               act: "evening camp; ledger reconciliation with the mahout",               need: "caravan_work",        i: true  },
    { phase: "Solnus",   hours: [21, 24], loc: "bahiij_caravan_camp",               act: "sleeps in the master tent",                                         need: "caravan_work",        i: false },
  ],
  bahiij_mahout_dev: [
    { phase: "Dominus",  hours: [1, 4],   loc: "bahiij_mahout_yards",               act: "tends the mahout train; checks the elephants' feet",                need: "mahout_work",         i: false },
    { phase: "Stratus",  hours: [5, 8],   loc: "bahiij_caravan_road",               act: "leads the train at the head of the caravan",                        need: "mahout_work",         i: false },
    { phase: "Freeus",   hours: [9, 12],  loc: "bahiij_marketplace_yard",           act: "waters the train; shows the trade-bulls",                           need: "mahout_work",         i: true  },
    { phase: "Quartus",  hours: [13, 16], loc: "bahiij_caravan_road",               act: "afternoon march; rotates the working pairs",                        need: "mahout_work",         i: false },
    { phase: "Penanus",  hours: [17, 20], loc: "bahiij_mahout_yards",               act: "evening feed; checks for foot-injuries",                            need: "mahout_work",         i: true  },
    { phase: "Solnus",   hours: [21, 24], loc: "bahiij_mahout_quarters",            act: "sleeps in the yard-loft above the train",                           need: "mahout_work",         i: false },
  ],
  ruins_scholar_aldra: [
    { phase: "Dominus",  hours: [1, 4],   loc: "ruins_scholar_camp_tent",           act: "transcribes overnight rubbings by lamp-light",                      need: "scholarship",         i: false },
    { phase: "Stratus",  hours: [5, 8],   loc: "ruins_excavation_site",             act: "morning excavation; documents new findings",                        need: "scholarship",         i: true  },
    { phase: "Freeus",   hours: [9, 12],  loc: "ruins_excavation_site",             act: "supervises diggers; takes rubbings",                                need: "scholarship",         i: true  },
    { phase: "Quartus",  hours: [13, 16], loc: "ruins_scholar_camp_tent",           act: "afternoon cataloguing; cross-references with Asbir",                need: "scholarship",         i: true  },
    { phase: "Penanus",  hours: [17, 20], loc: "ruins_camp_communal_fire",          act: "supper with the dig crew; tells the day's discovery",               need: "scholarship",         i: true  },
    { phase: "Solnus",   hours: [21, 24], loc: "ruins_scholar_camp_tent",           act: "private writing; the contested theory takes shape",                 need: "scholarship",         i: false },
  ],
  strip_captain_mara: [
    { phase: "Dominus",  hours: [1, 4],   loc: "strip_captain_office",              act: "reviews the night watch; checks the strip's lock-ups",              need: "patrol",              i: false },
    { phase: "Stratus",  hours: [5, 8],   loc: "strip_main_avenue",                 act: "morning patrol; checks every storefront and beggar",                need: "patrol",              i: true  },
    { phase: "Freeus",   hours: [9, 12],  loc: "strip_main_avenue",                 act: "open patrol; mediates merchant disputes",                           need: "patrol",              i: true  },
    { phase: "Quartus",  hours: [13, 16], loc: "strip_captain_office",              act: "afternoon paperwork; coordinates with the dock-master",             need: "patrol",              i: true  },
    { phase: "Penanus",  hours: [17, 20], loc: "strip_taverns_row",                 act: "evening rounds; keeps the brawls contained",                        need: "patrol",              i: true  },
    { phase: "Solnus",   hours: [21, 24], loc: "strip_captain_quarters",            act: "sleeps in the strip-house; rises for trouble",                      need: "patrol",              i: false },
  ],
};

function makeBlocks(schedSpec) {
  return schedSpec.map((b) => ({
    phase: b.phase,
    phase_hours: b.hours,
    location: b.loc,
    activity: b.act,
    need_addressed: b.need,
    interactable_by_player: b.i,
  }));
}

let patched = 0;
let alreadyHad = 0;
let missingFromMap = 0;
for (const npc of arr) {
  const existing = Array.isArray(npc.daily_schedule) && npc.daily_schedule.length > 0;
  if (existing) { alreadyHad++; continue; }
  const spec = SCHEDULES[npc.id];
  if (!spec) { missingFromMap++; console.warn("missing spec for", npc.id); continue; }
  npc.daily_schedule = makeBlocks(spec);
  patched++;
}

writeFileSync(FILE, JSON.stringify(arr, null, 2) + "\n", "utf8");
console.log({ patched, alreadyHad, missingFromMap });
