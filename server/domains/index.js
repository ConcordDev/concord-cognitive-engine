/**
 * Domain Action Module Loader
 *
 * Loads all 23 super-lens domain modules and exports them as an array.
 * Each module exports a default function: (registerLensAction) => void
 *
 * Usage in server.js:
 *   import domainModules from './domains/index.js';
 *   domainModules.forEach(mod => mod(registerLensAction));
 */

import healthcare from './healthcare.js';
import trades from './trades.js';
import food from './food.js';
import retail from './retail.js';
import household from './household.js';
import accounting from './accounting.js';
import agriculture from './agriculture.js';
import logistics from './logistics.js';
import education from './education.js';
import legal from './legal.js';
import nonprofit from './nonprofit.js';
import realestate from './realestate.js';
import fitness from './fitness.js';
import creative from './creative.js';
import manufacturing from './manufacturing.js';
import environment from './environment.js';
import government from './government.js';
import aviation from './aviation.js';
import events from './events.js';
import science from './science.js';
import security from './security.js';
import services from './services.js';
import notary from './notary.js';
import insurance from './insurance.js';
import crypto from './crypto.js';
import code from './code.js';
import math from './math.js';
import bio from './bio.js';
import quantum from './quantum.js';
import art from './art.js';
import answers from './answers.js';
import platform from './platform.js';
import neuro from './neuro.js';
import physics from './physics.js';
import chem from './chem.js';
import hypothesis from './hypothesis.js';
import timeline from './timeline.js';
import ethics from './ethics.js';
import debug from './debug.js';
import lab from './lab.js';
import research from './research.js';
import chat from './chat.js';
import commandcenter from './commandcenter.js';
import commonsense from './commonsense.js';
import docs from './docs.js';
import eco from './eco.js';
import entity from './entity.js';
import goals from './goals.js';
import grounding from './grounding.js';
import organ from './organ.js';
import suffering from './suffering.js';
import temporal from './temporal.js';
import vote from './vote.js';
import transfer from './transfer.js';
import inference from './inference.js';
import fractal from './fractal.js';
import globalDomain from './global.js';
import market from './market.js';
import markets from './markets.js';
import message from './message.js';
import meta from './meta.js';
import metacognition from './metacognition.js';
import metalearning from './metalearning.js';
import news from './news.js';
import meditation from './meditation.js';
import social from './social.js';
import dxPlatform from './dx-platform.js';
import observe from './observe.js';
import ops from './ops.js';
import productivity from './productivity.js';
import reflection from './reflection.js';
import wellness from './wellness.js';
import repos from './repos.js';
import resonance from './resonance.js';
import admin from './admin.js';
import affect from './affect.js';
import alliance from './alliance.js';
import ar from './ar.js';
import attention from './attention.js';
import audit from './audit.js';
import billing from './billing.js';
import board from './board.js';
import anon from './anon.js';
import appmaker from './appmaker.js';
import cri from './cri.js';
import integrations from './integrations.js';
import legacy from './legacy.js';
import offline from './offline.js';
import queue from './queue.js';
import schema from './schema.js';
import tick from './tick.js';
import lock from './lock.js';
import fork from './fork.js';
import invariant from './invariant.js';
import pets from './pets.js';
import parenting from './parenting.js';
import questmarket from './questmarket.js';
import diy from './diy.js';
import materials from './materials.js';
import agents from './agents.js';
import analytics from './analytics.js';
import animation from './animation.js';
import astronomy from './astronomy.js';
import automotive from './automotive.js';
import bridge from './bridge.js';
import calendar from './calendar.js';
import carpentry from './carpentry.js';
import collab from './collab.js';
import construction from './construction.js';
import consulting from './consulting.js';
import cooking from './cooking.js';
import council from './council.js';
import creativewriting from './creativewriting.js';
import custom from './custom.js';
import daily from './daily.js';
import database from './database.js';
import dtus from './dtus.js';
import debate from './debate.js';
import defense from './defense.js';
import desert from './desert.js';
import disputes from './disputes.js';
import electrical from './electrical.js';
import emergencyservices from './emergencyservices.js';
import energy from './energy.js';
import engineering from './engineering.js';
import experience from './experience.js';
import exportdomain from './exportdomain.js';
import fashion from './fashion.js';
import feed from './feed.js';
import filmstudios from './filmstudios.js';
import finance from './finance.js';
import forestry from './forestry.js';
import forum from './forum.js';
import game from './game.js';
import gamedesign from './gamedesign.js';
import geology from './geology.js';
import history from './history.js';
import homeimprovement from './homeimprovement.js';
import hr from './hr.js';
import hvac from './hvac.js';
import landscaping from './landscaping.js';
import lawenforcement from './lawenforcement.js';
import linguistics from './linguistics.js';
import marketing from './marketing.js';
import masonry from './masonry.js';
import mentalhealth from './mentalhealth.js';
import mentorship from './mentorship.js';
import mining from './mining.js';
import ocean from './ocean.js';
import pharmacy from './pharmacy.js';
import philosophy from './philosophy.js';
import photography from './photography.js';
import plumbing from './plumbing.js';
import podcast from './podcast.js';
import poetry from './poetry.js';
import privacy from './privacy.js';
import projects from './projects.js';
import robotics from './robotics.js';
import space from './space.js';
import sports from './sports.js';
import supplychain from './supplychain.js';
import telecommunications from './telecommunications.js';
import travel from './travel.js';
import deities from './deities.js';
import urbanplanning from './urbanplanning.js';
import veterinary from './veterinary.js';
import artistry from './artistry.js';
import atlas from './atlas.js';
import graph from './graph.js';
import importdomain from './importdomain.js';
import ingest from './ingest.js';
import law from './law.js';
import marketplace from './marketplace.js';
import ml from './ml.js';
import musicDomain from './music.js';
import paper from './paper.js';
import reasoning from './reasoning.js';
import sim from './sim.js';
import srs from './srs.js';
import studioDomain from './studio.js';
import thread from './thread.js';
import voice from './voice.js';
import wallet from './wallet.js';
import welding from './welding.js';
import whiteboard from './whiteboard.js';
import world from './world.js';
import all from './all.js';
import crafting from './crafting.js';
import settings from './settings.js';
import creator from './creator.js';
import federation from './federation.js';
import blackMarket from './black-market.js';
import society from './society.js';
import gallery from './gallery.js';
import classroom from './classroom.js';
import syncLens from './sync.js';
import uxSuite from './ux-suite.js';
import worldCreator from './world-creator.js';
import expeditionJournal from './expedition-journal.js';
import bounties from './bounties.js';
import subWorlds from './sub-worlds.js';
import sentinelLens from './sentinel.js';
import tournamentsLens from './tournaments.js';
import meshLens from './mesh.js';
import cognitiveReplay from './cognitive-replay.js';
import forgeLens from './forge.js';
import understandingLens from './understanding.js';
import selfLens from './self.js';
import worldmodelLens from './worldmodel.js';
import savedLens from './saved.js';
import inheritance from './inheritance.js';
import personas from './personas.js';
import psyops from './psyops.js';
import tools from './tools.js';
import goddessLens from './goddess.js';
import cognitionLens from './cognition.js';
import sandboxLens from './sandbox.js';
import rootLens from './root.js';
import codeQualityDomain from './code-quality.js';
import genesisDomain from './genesis.js';
import sponsorshipDomain from './sponsorship.js';
import stakingDomain from './staking.js';
import systemDomain from './system.js';
import standardsDomain from './standards.js';
import registerSensorActions from './sensor.js';
import serviceMarket from './service-market.js';
import digitalTwin from './digital-twin.js';

export default [
  healthcare,
  answers,
  trades,
  food,
  retail,
  household,
  accounting,
  agriculture,
  logistics,
  education,
  legal,
  nonprofit,
  realestate,
  fitness,
  creative,
  manufacturing,
  environment,
  government,
  aviation,
  events,
  science,
  security,
  services,
  notary,
  insurance,
  crypto,
  code,
  math,
  bio,
  quantum,
  art,
  platform,
  neuro,
  physics,
  chem,
  hypothesis,
  timeline,
  ethics,
  debug,
  lab,
  research,
  chat,
  commandcenter,
  commonsense,
  docs,
  eco,
  entity,
  goals,
  grounding,
  organ,
  suffering,
  temporal,
  vote,
  transfer,
  inference,
  fractal,
  globalDomain,
  market,
  markets,
  message,
  meta,
  metacognition,
  metalearning,
  news,
  meditation,
  social,
  observe,
  ops,
  productivity,
  reflection,
  wellness,
  repos,
  resonance,
  admin,
  affect,
  alliance,
  ar,
  attention,
  audit,
  billing,
  board,
  anon,
  appmaker,
  cri,
  integrations,
  legacy,
  offline,
  queue,
  schema,
  tick,
  lock,
  fork,
  invariant,
  pets,
  parenting,
  questmarket,
  diy,
  materials,
  agents,
  analytics,
  animation,
  astronomy,
  automotive,
  bridge,
  calendar,
  carpentry,
  collab,
  construction,
  consulting,
  cooking,
  council,
  creativewriting,
  custom,
  daily,
  database,
  dtus,
  debate,
  defense,
  desert,
  disputes,
  electrical,
  emergencyservices,
  energy,
  engineering,
  experience,
  exportdomain,
  fashion,
  feed,
  filmstudios,
  finance,
  forestry,
  forum,
  game,
  gamedesign,
  geology,
  history,
  homeimprovement,
  hr,
  hvac,
  landscaping,
  lawenforcement,
  linguistics,
  marketing,
  masonry,
  mentalhealth,
  mentorship,
  mining,
  ocean,
  pharmacy,
  philosophy,
  photography,
  plumbing,
  podcast,
  poetry,
  privacy,
  projects,
  robotics,
  space,
  sports,
  supplychain,
  telecommunications,
  travel,
  deities,
  urbanplanning,
  veterinary,
  artistry,
  atlas,
  graph,
  importdomain,
  ingest,
  law,
  marketplace,
  ml,
  musicDomain,
  paper,
  reasoning,
  sim,
  srs,
  studioDomain,
  thread,
  voice,
  wallet,
  welding,
  whiteboard,
  world,
  all,
  crafting,
  settings,
  creator,
  federation,
  blackMarket,
  society,
  gallery,
  classroom,
  syncLens,
  uxSuite,
  worldCreator,
  bounties,
  expeditionJournal,
  subWorlds,
  inheritance,
  personas,
  psyops,
  tools,
  savedLens,
  sentinelLens,
  tournamentsLens,
  worldmodelLens,
  meshLens,
  cognitiveReplay,
  forgeLens,
  selfLens,
  understandingLens,
  dxPlatform,
  goddessLens,
  cognitionLens,
  sandboxLens,
  rootLens,
  codeQualityDomain,
  genesisDomain,
  sponsorshipDomain,
  stakingDomain,
  systemDomain,
  standardsDomain,
  registerSensorActions,
  serviceMarket,
  digitalTwin,
];
