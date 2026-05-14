// server/tests/coverage-smoke-heartbeats-2.test.js
// Slice 2 of 4 — see coverage-smoke-heartbeats.test.js for context.

import test from "node:test";
import assert from "node:assert/strict";
import { HEARTBEATS, probe } from "./_coverage-smoke-heartbeats-shared.mjs";

probe(test, assert, HEARTBEATS.slice(10, 20));
