// server/domains/code-intel.js
//
// Code Sprint D — real code-intel macros (LSP-equivalent for TS/JS).

import { findDefinition, findReferences, hover, fileSymbols, diagnostics } from "../lib/code/code-intel.js";

export default function registerCodeIntelMacros(register) {
  register("code", "intel_definition", async (_ctx, input = {}) => findDefinition(input), {
    note: "Go-to-definition. TS/JS via TypeScript Compiler API; others via git grep.",
  });
  register("code", "intel_references", async (_ctx, input = {}) => findReferences(input), {
    note: "Find references. TS/JS via TypeScript Compiler API; others via git grep.",
  });
  register("code", "intel_hover", async (_ctx, input = {}) => hover(input), {
    note: "Hover info — TS/JS returns type + JSDoc; others return surrounding lines.",
  });
  register("code", "intel_symbols", async (_ctx, input = {}) => fileSymbols(input), {
    note: "Outline of symbols in a file (function/class/const/etc.).",
  });
  register("code", "intel_diagnostics", async (_ctx, input = {}) => diagnostics(input), {
    note: "TS/JS compiler diagnostics for a single file.",
  });
}
