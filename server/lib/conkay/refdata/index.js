/**
 * Reference-data store — SXE-41 singleton.
 *
 * The store directory comes from CONKAY_REFDATA_DIR; the default sits
 * beside the server's other durable state. Tests and tools should build
 * their own store with createRefdataStore({dir, ...}) instead.
 */

import { join } from "node:path";
import { createRefdataStore, DEFAULT_BUDGET_BYTES } from "./store.js";

export { createRefdataStore, isPublicIp, DEFAULT_BUDGET_BYTES } from "./store.js";

let singleton = null;

export function refdataStore() {
  if (!singleton) {
    const dir = process.env.CONKAY_REFDATA_DIR || join(process.cwd(), "server", "data", "conkay-refdata");
    const budget = Number(process.env.CONKAY_REFDATA_BUDGET_BYTES || DEFAULT_BUDGET_BYTES);
    singleton = createRefdataStore({ dir, budgetBytes: budget });
  }
  return singleton;
}
