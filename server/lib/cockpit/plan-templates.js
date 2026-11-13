// Plan templates for the task shapes Concord already does well (CKPT-10).
// A template is used instead of a model plan whenever its match() is true.
import { wants3dModel } from "../chat-agent.js";
import { listRecipes } from "../chat/tool-recipes/index.js";

const OK = { kind: "ok" };
const step = (key, goal, tool, args, expects, dependsOn = [], required = true) =>
  ({ key, goal, tool, args, expects, dependsOn, required });

/** @type {Array<{ id: string, match: (goal:string)=>boolean, build: (goal:string)=>object[] }>} */
export const PLAN_TEMPLATES = [
  {
    id: "research_report",
    match: (g) => /\b(research|investigate|look into|find out)\b/i.test(g) && /\b(report|summary|write[- ]?up|document|brief)\b/i.test(g),
    build: (g) => [
      step("s1", "Search the web for the topic", "web_search", { query: g }, [OK, { kind: "nonempty", path: "results" }]),
      step("s2", "Search again with a more specific query based on the first results", null, null, [OK], ["s1"], false),
      step("s3", "Open the most relevant source and read it", null, null, [OK], ["s1"], false),
      step("s4", "Write the report from the sources found", "create_document", null, [OK], ["s1"], true),
    ],
  },
  {
    id: "size_and_model",
    match: (g) => /\b(beam|cantilever|bracket|shaft|column|truss)\b/i.test(g) && wants3dModel(g),
    build: (g) => [
      step("s1", "Size the design and check it", "conkay_design", { text: g }, [OK]),
      step("s2", "Make the 3D model", "generate_3d", { prompt: g }, [OK], ["s1"], false),
    ],
  },
  {
    id: "recipe_calc",
    match: (g) => /\b(size|check|calculate|compute|compare|convert)\b/i.test(g) && listRecipes(g).length > 0,
    build: (g) => [
      step("s1", "Find the tested calculation that fits", "list_recipes", { query: g }, [OK, { kind: "nonempty", path: "recipes" }]),
      step("s2", "Run the matching tested calculation with the user's numbers", "run_recipe", null, [OK, { kind: "receipt" }], ["s1"], true),
    ],
  },
  {
    id: "find_and_act",
    match: (g) => /\b(add|create|log|schedule|book|record|save|track)\b/i.test(g),
    build: (g) => [
      step("s1", "Find the action that does this", "find_lens_actions", { query: g }, [OK, { kind: "nonempty", path: "actions" }]),
      step("s2", "Run the action that does what was asked, with the user's details", null, null, [OK], ["s1"], true),
    ],
  },
];
