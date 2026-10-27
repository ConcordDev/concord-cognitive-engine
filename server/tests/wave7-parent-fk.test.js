// A supplied parent id must already exist in the caller's collection.
// Omitting an optional parent still creates the child.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerForum from "../domains/forum.js";
import registerProjects from "../domains/projects.js";
import registerCreativeWriting from "../domains/creativewriting.js";
import registerReflection from "../domains/reflection.js";
import registerTravel from "../domains/travel.js";
import registerArtistry from "../domains/artistry.js";
import registerFood from "../domains/food.js";
import registerForestry from "../domains/forestry.js";
import registerGame from "../domains/game.js";
import registerGameDesign from "../domains/gamedesign.js";
import registerLandscaping from "../domains/landscaping.js";
import registerMl from "../domains/ml.js";
import registerProductivity from "../domains/productivity.js";
import registerQuestmarket from "../domains/questmarket.js";
import registerUrban from "../domains/urbanplanning.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(domain, name, ctx, params = {}) {
  const fn = ACTIONS.get(`${domain}.${name}`);
  if (!fn) throw new Error(`${domain}.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  for (const reg of [
    registerForum, registerProjects, registerCreativeWriting, registerReflection,
    registerTravel, registerArtistry, registerFood, registerForestry, registerGame,
    registerGameDesign, registerLandscaping, registerMl, registerProductivity,
    registerQuestmarket, registerUrban,
  ]) reg(register);
});

beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function refuse(domain, name, ctx, params, error, countFn) {
  const before = countFn();
  const r = call(domain, name, ctx, params);
  assert.equal(r.ok, false, `${domain}.${name} stored a missing parent`);
  assert.equal(r.error, error);
  assert.equal(countFn(), before, `${domain}.${name} wrote a child for a missing parent`);
  return r;
}

describe("wave 7 parent ids", () => {
  it("forum topic-create refuses an unknown category and subforum", () => {
    refuse("forum", "topic-create", ctxA, { title: "Hello", categoryId: "cat_missing" }, "category not found",
      () => call("forum", "topic-list", ctxA, {}).result.count);
    refuse("forum", "topic-create", ctxA, { title: "Hello", subforumId: "sf_missing" }, "subforum not found",
      () => call("forum", "topic-list", ctxA, {}).result.count);
    const cat = call("forum", "category-create", ctxA, { name: "Sealed", visibility: "private" }).result.category;
    refuse("forum", "topic-create", ctxB, { title: "Sneak", categoryId: cat.id }, "category not found",
      () => call("forum", "topic-list", ctxB, {}).result.count);
    const open = call("forum", "topic-create", ctxA, { title: "Loose" });
    assert.equal(open.ok, true);
    assert.equal(open.result.topic.categoryId, null);
    assert.equal(open.result.topic.subforumId, null);
  });

  it("projects task-create refuses a missing assignee, sprint, milestone, or parent", () => {
    const project = call("projects", "project-create", ctxA, { name: "Ship" }).result.project;
    const other = call("projects", "project-create", ctxA, { name: "Other" }).result.project;
    const member = call("projects", "member-add", ctxA, { projectId: other.id, name: "Ada" }).result.member;
    const sprint = call("projects", "sprint-create", ctxA, { projectId: other.id, name: "S" }).result.sprint;
    const milestone = call("projects", "milestone-create", ctxA, { projectId: other.id, name: "M" }).result.milestone;
    const parent = call("projects", "task-create", ctxA, { projectId: other.id, title: "Parent" }).result.task;
    const count = () => call("projects", "task-list", ctxA, { projectId: project.id }).result.count;
    refuse("projects", "task-create", ctxA, { projectId: project.id, title: "T", assigneeId: "mbr_missing" }, "assignee not found", count);
    refuse("projects", "task-create", ctxA, { projectId: project.id, title: "T", assigneeId: member.id }, "assignee not found", count);
    refuse("projects", "task-create", ctxA, { projectId: project.id, title: "T", sprintId: sprint.id }, "sprint not found", count);
    refuse("projects", "task-create", ctxA, { projectId: project.id, title: "T", milestoneId: milestone.id }, "milestone not found", count);
    refuse("projects", "task-create", ctxA, { projectId: project.id, title: "T", parentId: parent.id }, "parent task not found", count);
    assert.equal(call("projects", "project-list", ctxA, {}).result.projects.find((p) => p.id === project.id).seq, 0);
    const ok = call("projects", "task-create", ctxA, { projectId: project.id, title: "Bare" });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.task.assigneeId, null);
    assert.equal(ok.result.task.sprintId, null);
    assert.equal(ok.result.task.parentId, null);
  });

  it("creative-writing scene-add refuses a chapter from another project", () => {
    const book = call("creative-writing", "project-create", ctxA, { title: "Book" }).result.project;
    const other = call("creative-writing", "project-create", ctxA, { title: "Other" }).result.project;
    const chapter = call("creative-writing", "chapter-add", ctxA, { projectId: other.id, title: "Ch" }).result.chapter;
    const scenes = () => call("creative-writing", "project-dashboard", ctxA, { projectId: book.id }).result.scenes;
    refuse("creative-writing", "scene-add", ctxA, { projectId: book.id, chapterId: "chp_missing" }, "chapter not found", scenes);
    refuse("creative-writing", "scene-add", ctxA, { projectId: book.id, chapterId: chapter.id }, "chapter not found", scenes);
    const ok = call("creative-writing", "scene-add", ctxA, { projectId: book.id, title: "Opening" });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.scene.chapterId, null);
  });

  it("reflection entry and voice entry refuse an unknown journal", async () => {
    const entries = () => call("reflection", "entry-list", ctxA, {}).result.count;
    refuse("reflection", "entry-create", ctxA, { text: "note", journalId: "j_missing" }, "journal not found", entries);
    const voice = await call("reflection", "voice-entry-create", ctxA, { audioUrl: "data:audio/webm;base64,AA", journalId: "j_missing" });
    assert.equal(voice.ok, false);
    assert.equal(voice.error, "journal not found");
    refuse("reflection", "entry-from-template", ctxA, { templateId: "gratitude", journalId: "j_missing" }, "journal not found", entries);
    assert.equal(entries(), 0);
    const ok = call("reflection", "entry-create", ctxA, { text: "loose" });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.entry.journalId, null);
  });

  it("travel loyalty-account-add refuses an unknown trip", () => {
    const accounts = () => call("travel", "loyalty-account-list", ctxA, {}).result.count;
    refuse("travel", "loyalty-account-add", ctxA, { program: "MileagePlus", tripId: "trip_missing" }, "trip not found", accounts);
    const ok = call("travel", "loyalty-account-add", ctxA, { program: "MileagePlus" });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.account.tripId, null);
  });

  it("artistry commentAdd refuses a project that was never saved", () => {
    refuse("artistry", "commentAdd", ctxA, { projectId: "proj_missing", body: "nice" }, "project not found",
      () => call("artistry", "commentList", ctxA, { projectId: "proj_missing" }).result.count);
    const project = call("artistry", "projectCreate", ctxA, { title: "Study" }).result.project;
    const ok = call("artistry", "commentAdd", ctxB, { projectId: project.id, body: "seen it" });
    assert.equal(ok.ok, true);
    assert.equal(call("artistry", "commentList", ctxA, { projectId: project.id }).result.count, 1);
  });

  it("food recipe-photo-add refuses a recipe the caller does not own", () => {
    const photos = () => call("food", "recipe-photo-list", ctxA, {}).result.count;
    refuse("food", "recipe-photo-add", ctxA, { recipeId: "rec_missing", dataUrl: "data:image/png;base64,AA" }, "recipe not found", photos);
    const theirs = call("food", "recipe-add", ctxB, { title: "Soup" }).result.recipe;
    refuse("food", "recipe-photo-add", ctxA, { recipeId: theirs.id, dataUrl: "data:image/png;base64,AA" }, "recipe not found", photos);
    const mine = call("food", "recipe-add", ctxA, { title: "Stew" }).result.recipe;
    assert.equal(call("food", "recipe-photo-add", ctxA, { recipeId: mine.id, dataUrl: "data:image/png;base64,AA" }).ok, true);
  });

  it("forestry replant and carbon refuse a stand the caller does not own", () => {
    const replants = () => call("forestry", "replant-list", ctxA, {}).result.count;
    const credits = () => call("forestry", "carbon-credit-list", ctxA, {}).result.count;
    const stand = call("forestry", "stand-add", ctxB, { name: "North" }).result.stand;
    refuse("forestry", "replant-project-create", ctxA, { name: "Plant", acres: 2, standId: "std_missing" }, "stand not found", replants);
    refuse("forestry", "replant-project-create", ctxA, { name: "Plant", acres: 2, standId: stand.id }, "stand not found", replants);
    refuse("forestry", "carbon-credit-issue", ctxA, { projectName: "Sink", tonsCO2: 4, standId: stand.id }, "stand not found", credits);
    const ok = call("forestry", "replant-project-create", ctxA, { name: "Plant", acres: 2 });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.project.standId, null);
  });

  it("game reminderCreate refuses an unknown task", () => {
    const reminders = () => call("game", "reminderList", ctxA, {}).result.count;
    refuse("game", "reminderCreate", ctxA, { title: "Water", time: "09:00", taskId: "tsk_missing" }, "task not found", reminders);
    const task = call("game", "taskCreate", ctxB, { title: "Theirs" }).result.task;
    refuse("game", "reminderCreate", ctxA, { title: "Water", time: "09:00", taskId: task.id }, "task not found", reminders);
    const ok = call("game", "reminderCreate", ctxA, { title: "Water", time: "09:00" });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.reminder.taskId, null);
  });

  it("game-design animation and behavior refuse an entity from another game", () => {
    const game = call("game-design", "game-create", ctxA, { title: "One" }).result.game;
    const other = call("game-design", "game-create", ctxA, { title: "Two" }).result.game;
    const entity = call("game-design", "entity-add", ctxA, { gameId: other.id, name: "Slime" }).result.entity;
    const anims = () => call("game-design", "animation-list", ctxA, { gameId: game.id }).result.count;
    const behaviors = () => call("game-design", "behavior-list", ctxA, { gameId: game.id }).result.count;
    refuse("game-design", "animation-create", ctxA, { gameId: game.id, name: "Walk", entityId: entity.id }, "entity not found", anims);
    refuse("game-design", "behavior-create", ctxA, { gameId: game.id, name: "Patrol", entityId: "ent_missing" }, "entity not found", behaviors);
    const ok = call("game-design", "animation-create", ctxA, { gameId: game.id, name: "Idle" });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.animation.entityId, null);
  });

  it("landscaping diary-add refuses an unknown bed", () => {
    const entries = () => call("landscaping", "diary-timeline", ctxA, {}).result.count;
    refuse("landscaping", "diary-add", ctxA, { plant: "Rose", bedId: "bed_missing" }, "bed not found", entries);
    const ok = call("landscaping", "diary-add", ctxA, { plant: "Rose" });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.entry.bedId, "");
  });

  it("ml experiment-start refuses an unknown dataset", () => {
    const experiments = () => call("ml", "experiment-list", ctxA, {}).result.count;
    refuse("ml", "experiment-start", ctxA, { name: "Run", datasetId: "ds_missing" }, "dataset not found", experiments);
    const ds = call("ml", "dataset-register", ctxB, { name: "Theirs", samples: 10 }).result.dataset;
    refuse("ml", "experiment-start", ctxA, { name: "Run", datasetId: ds.id }, "dataset not found", experiments);
    const ok = call("ml", "experiment-start", ctxA, { name: "Run" });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.experiment.datasetId, "");
  });

  it("productivity task-add and focus-log refuse a missing project or task", () => {
    const tasks = () => call("productivity", "task-list", ctxA, {}).result.count;
    const sessions = () => call("productivity", "focus-stats", ctxA, {}).result.totalSessions;
    const project = call("productivity", "project-create", ctxB, { name: "Theirs" }).result.project;
    refuse("productivity", "task-add", ctxA, { content: "Write", projectId: project.id }, "project not found", tasks);
    const task = call("productivity", "task-add", ctxB, { content: "Theirs" }).result.task;
    refuse("productivity", "focus-log", ctxA, { durationMin: 25, taskId: task.id }, "task not found", sessions);
    const ok = call("productivity", "task-add", ctxA, { content: "Write" });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.task.projectId, null);
    const focus = call("productivity", "focus-log", ctxA, { durationMin: 25 });
    assert.equal(focus.ok, true);
    assert.equal(focus.result.session.taskId, null);
  });

  it("questmarket postQuest refuses a guild the poster is not in, before escrow", () => {
    const total = () => call("questmarket", "listQuests", ctxA, { mine: true }).result.total;
    const wallet = () => call("questmarket", "walletGet", ctxA, {}).result;
    refuse("questmarket", "postQuest", ctxA, { title: "Hunt", reward: 40, guildId: "g_missing" }, "guild not found", total);
    assert.equal(wallet().escrowed, 0);
    const guild = call("questmarket", "createGuild", ctxB, { name: "Wolves" }).result.guild;
    const before = wallet().balance;
    refuse("questmarket", "postQuest", ctxA, { title: "Hunt", reward: 40, guildId: guild.id }, "guild not found", total);
    assert.equal(wallet().balance, before);
    assert.equal(wallet().escrowed, 0);
    const own = call("questmarket", "createGuild", ctxA, { name: "Pack" }).result.guild;
    const ok = call("questmarket", "postQuest", ctxA, { title: "Hunt", guildId: own.id });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.quest.guildId, own.id);
    const loose = call("questmarket", "postQuest", ctxA, { title: "Solo" });
    assert.equal(loose.ok, true);
    assert.equal(loose.result.quest.guildId, null);
  });

  it("urban-planning scenario-create refuses a parcel the caller does not own", () => {
    const scenarios = () => call("urban-planning", "scenario-list", ctxA, {}).result.scenarios.length;
    const parcel = call("urban-planning", "parcel-add", ctxB, { apn: "12-34" }).result.parcel;
    refuse("urban-planning", "scenario-create", ctxA, { name: "Rezone", parcelId: parcel.id }, "parcel not found", scenarios);
    const ok = call("urban-planning", "scenario-create", ctxA, { name: "Rezone" });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.scenario.parcelId, null);
  });
});
