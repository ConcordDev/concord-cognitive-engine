// server/domains/_recent-mine-bulk.js
//
// Phase 2 of the 10-dimension UX completeness sprint.
//
// Bulk registration of `<domain>.recent_mine` + `<domain>.list_mine`
// for every lens whose primary artifact is a DTU. Rather than touching
// 200 domain files, this single registration mounts a uniform DTU-backed
// recent_mine for the whole fleet, with per-lens type filters where the
// lens has a known DTU `type` value.
//
// Lens domains whose primary artifact is NOT a DTU (those with their own
// bespoke artifact table — pharmacy_artifacts, etc.) can override by
// registering a `recent_mine` macro of their own AFTER this registration
// runs; the lens-action registry's last-registration-wins behaviour means
// the per-lens version takes precedence.

import { buildDtuRecentMineMacro } from "./_dtu-recent-mine.js";

/**
 * Map of lens domain → DTU type filter. When the type is null, any DTU
 * created by the user is included. When a type list is given, only DTUs
 * of those types match.
 *
 * If a lens isn't listed here, it gets a generic type-less recent_mine
 * via the DEFAULT_DOMAINS fallback set so even unmapped lenses surface
 * the user's recent work.
 */
const DOMAIN_TYPE_MAP = Object.freeze({
  // Substrate-universal — pull all the user's DTUs.
  dtus:          { type: null },
  feed:          { type: null },
  search:        { type: null },
  all:           { type: null },
  root:          { type: null },

  // Creative authoring lenses.
  art:           { type: ["art_piece", "art"] },
  artistry:      { type: ["artistry", "art_piece"] },
  music:         { type: ["music", "track", "session", "music_recipe"] },
  studio:        { type: ["music", "track", "session", "music_recipe", "soundscape"] },
  podcast:       { type: ["podcast", "episode"] },
  poetry:        { type: ["poem", "poetry"] },
  creative:      { type: ["creative_recipe", "creative"] },
  "creative-writing": { type: ["creative_text", "story"] },
  design:        { type: ["design_spec", "design"] },
  animation:     { type: ["anim_clip", "animation"] },
  whiteboard:    { type: ["whiteboard_session", "whiteboard"] },
  game:          { type: ["game_session", "game"] },
  "game-design": { type: ["game_design", "game_spec"] },
  film_studios:  { type: ["film_project", "film"] },
  "film-studios": { type: ["film_project", "film"] },
  gallery:       { type: ["art_piece", "photo"] },
  photography:   { type: ["photo", "photography"] },

  // Knowledge / reasoning lenses.
  chat:          { type: ["chat_session", "conversation", "message"] },
  paper:         { type: ["paper", "claim", "hypothesis"] },
  research:      { type: ["reasoning_session", "research"] },
  hypothesis:    { type: ["hypothesis"] },
  reasoning:     { type: ["reasoning_session"] },
  debate:        { type: ["debate", "argument"] },
  ethics:        { type: ["ethics_dilemma"] },
  philosophy:    { type: ["philosophy_argument"] },
  science:       { type: ["experiment", "science"] },
  lab:           { type: ["lab_protocol", "experiment"] },
  math:          { type: ["math_proof", "math"] },
  physics:       { type: ["physics", "experiment"] },
  chem:          { type: ["chem_synthesis", "chem"] },
  bio:           { type: ["bio_observation", "bio"] },
  astronomy:     { type: ["astro_observation", "astronomy"] },
  space:         { type: ["astro_observation", "space"] },
  geology:       { type: ["geology"] },
  ocean:         { type: ["ocean"] },
  environment:   { type: ["environment"] },
  history:       { type: ["history"] },
  linguistics:   { type: ["linguistics"] },
  semiotics:     { type: ["semiotics"] },
  quantum:       { type: ["quantum"] },
  neuro:         { type: ["neuro"] },
  cognition:     { type: ["cognition"] },
  understanding: { type: ["understanding"] },
  commonsense:   { type: ["commonsense"] },
  reflection:    { type: ["reflection"] },

  // Productivity lenses.
  daily:         { type: ["daily_ritual", "daily"] },
  goals:         { type: ["goal"] },
  calendar:      { type: ["calendar_event", "calendar"] },
  srs:           { type: ["srs_card", "srs"] },
  projects:      { type: ["project"] },
  productivity:  { type: ["task", "productivity"] },

  // Trades / professional.
  carpentry:     { type: ["trade_carpentry", "diy"] },
  electrical:    { type: ["trade_electrical", "diy"] },
  plumbing:      { type: ["trade_plumbing", "diy"] },
  masonry:       { type: ["trade_masonry"] },
  welding:       { type: ["trade_welding"] },
  hvac:          { type: ["trade_hvac"] },
  landscaping:   { type: ["trade_landscape"] },
  mining:        { type: ["trade_mining"] },
  trades:        { type: ["trade", "diy", "trade_record"] },
  tools:         { type: ["trade_tool"] },
  maker:         { type: ["make_project"] },
  diy:           { type: ["diy"] },
  "home-improvement": { type: ["diy", "home_project"] },

  // Operations / business.
  accounting:    { type: ["accounting_ledger", "trial_balance"] },
  billing:       { type: ["invoice"] },
  hr:            { type: ["hr_policy", "hr"] },
  consulting:    { type: ["consulting_engagement"] },
  marketing:     { type: ["marketing_campaign"] },
  logistics:     { type: ["logistics_route"] },
  supplychain:   { type: ["supply_chain"] },
  "supply-chain": { type: ["supply_chain"] },
  manufacturing: { type: ["manuf_run"] },
  ops:           { type: null },
  observe:       { type: null },

  // Healthcare / wellness (DEMO + REAL_FREE).
  pharmacy:      { type: ["pharmacy_record", "medication"] },
  healthcare:    { type: ["health_record", "encounter"] },
  wellness:      { type: ["wellness_record"] },
  "mental-health": { type: ["mental_health_entry"] },
  meditation:    { type: ["meditation_session"] },
  fitness:       { type: ["workout", "fitness_session"] },
  food:          { type: ["meal", "food"] },
  cooking:       { type: ["recipe", "cooking"] },
  pets:          { type: ["pet_record"] },
  veterinary:    { type: ["vet_record"] },

  // Finance lenses.
  finance:       { type: ["finance_record", "transaction"] },
  markets:       { type: ["market_watch"] },
  market:        { type: ["market_watch"] },
  crypto:        { type: ["crypto_tx"] },
  wallet:        { type: ["wallet_tx"] },
  marketplace:   { type: ["listing"] },
  questmarket:   { type: ["quest_listing"] },
  staking:       { type: ["stake"] },
  sponsorship:   { type: ["sponsorship"] },
  bounties:      { type: ["bounty"] },
  tournaments:   { type: ["tournament"] },
  "black-market": { type: ["black_market_listing"] },
  insurance:     { type: ["insurance_policy"] },
  "death-insurance": { type: ["death_insurance_policy"] },

  // Sociaal / collab.
  collab:        { type: ["collab_session"] },
  forum:         { type: ["forum_post", "thread"] },
  message:       { type: ["message", "inbox"] },
  thread:        { type: ["thread"] },
  threads:       { type: ["thread"] },
  council:       { type: ["council_session", "vote"] },
  alliance:      { type: ["alliance"] },
  federation:    { type: ["federation_peer"] },
  vote:          { type: ["vote"] },
  answers:       { type: ["answer", "question"] },
  questions:     { type: ["question"] },

  // World / Concordia / game lenses.
  world:         { type: null },
  kingdoms:      { type: ["realm_decree", "war_campaign"] },
  crafting:      { type: ["recipe", "blueprint"] },
  dreams:        { type: ["dream"] },
  goddess:       { type: ["goddess_dispatch"] },
  forge:         { type: ["forge_app", "forge_template"] },
  foundry:       { type: ["foundry_world", "foundry_template"] },
  "world-creator": { type: ["world_spec"] },
  "sub-worlds":  { type: ["world_spec"] },
  sim:           { type: ["world_sim"] },
  sandbox:       { type: ["sandbox_spec"] },
  inheritance:   { type: ["npc_legacy"] },
  legacy:        { type: ["legacy"] },
  expedition_journal: { type: ["expedition_entry"] },
  "expedition-journal": { type: ["expedition_entry"] },
  ghost_tracker: { type: ["ghost_sighting"] },
  "ghost-tracker": { type: ["ghost_sighting"] },
  deities:       { type: ["deity"] },
  psyops:        { type: ["psyops_campaign"] },
  crisis_ops:    { type: ["crisis_incident"] },
  "crisis-ops":  { type: ["crisis_incident"] },

  // Government / civic lenses.
  government:    { type: ["gov_record"] },
  law:           { type: ["legal_case"] },
  legal:         { type: ["legal_case"] },
  "law-enforcement": { type: ["le_record"] },
  "emergency-services": { type: ["es_record"] },
  nonprofit:     { type: ["nonprofit"] },
  disputes:      { type: ["dispute"] },

  // Lifestyle.
  travel:        { type: ["trip_plan", "travel"] },
  household:     { type: ["household_task"] },
  parenting:     { type: ["parenting_log"] },
  retail:        { type: ["retail_order"] },
  fashion:       { type: ["fashion_outfit"] },

  // Education.
  education:     { type: ["lesson"] },
  classroom:     { type: ["lesson", "classroom_session"] },
  mentorship:    { type: ["mentorship_session"] },

  // Trades extra.
  construction:  { type: ["construction_project"] },
  engineering:   { type: ["eng_project"] },
  materials:     { type: ["materials_sample"] },
  urban_planning: { type: ["urban_plan"] },
  "urban-planning": { type: ["urban_plan"] },

  // Personas + agency lenses.
  agents:        { type: ["agent_thread", "agent_marathon"] },
  personas:      { type: ["persona"] },
  self:          { type: ["self_profile"] },
  brain:         { type: ["brain_state"] },

  // Defaults: any other lens domain — generic DTU recent.
});

/**
 * Domains that already register their OWN recent_mine via a bespoke
 * implementation. Skip these to avoid double-registration / contract
 * mismatch.
 */
const SKIP_DOMAINS = new Set([
  "drafts",      // covered by drafts.list_mine in Phase 1
  "beats",       // already has beats.list
]);

/**
 * Bulk-register recent_mine + list_mine across the fleet.
 *
 * Call this AFTER all per-domain registrations so per-domain overrides
 * (e.g., a lens that builds recent_mine against its own artifact table)
 * take precedence.
 */
export default function registerBulkRecentMine(register) {
  let count = 0;
  for (const [domain, opts] of Object.entries(DOMAIN_TYPE_MAP)) {
    if (SKIP_DOMAINS.has(domain)) continue;
    buildDtuRecentMineMacro(register, domain, opts);
    count += 1;
  }
  return count;
}

export { DOMAIN_TYPE_MAP, SKIP_DOMAINS };
