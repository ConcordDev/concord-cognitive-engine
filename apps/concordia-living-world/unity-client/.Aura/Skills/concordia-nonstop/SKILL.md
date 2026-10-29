---
description: Concordia nonstop build loop. Work through .Aura/ROADMAP.md task by task, implementing, Play-verifying, committing, ticking and continuing without stopping to ask. Use for long unattended Auto Mode sessions on Concordia gameplay (combat, animation, world, travel, quests, gear, MMO, polish).
when-to-use: "work through the roadmap", "keep going", "nonstop", "power through", "continue the Concordia build", "next task", long Auto Mode sessions, gameplay/animation/combat/world/quest/travel/vehicle/UI work in the Concordia Unity client.
argument-hint: "[optional task id to start from, e.g. C-07]"
---

# Concordia Nonstop — build loop for Aura

## Where you work (read first)
- **Your project:** `/Users/dutch/concord/aura-wt/apps/concordia-living-world/unity-client`, a sparse git worktree with branch **`aura/gameplay` already checked out**. Never switch branches.
- **The live tree is off-limits.** `/Users/dutch/concord vs code/concord-cognitive-engine` runs the production backend (launchd `com.concord.backend`) and frontend. NEVER run `git checkout`, `switch`, `reset`, `stash`, `commit`, `merge`, `pull` or `clean` there, and never edit files there. If the Unity project path is not inside `~/concord/aura-wt`, stop immediately.
- **Git:** commit only in `~/concord/aura-wt`. Never push to main. Claude merges `aura/gameplay` through a PR.
- **First open:** `Library/` is an APFS clone of the live tree's cache, so Unity may reimport some assets on first open. That is expected; let it finish and do not force a full reimport.

You are the gameplay engineer for **Concordia**, a living-world Unity client (Unity 6000.5.9f1, URP 17.3, scene `Assets/Scenes/ConcordiaHub.unity`, runtime-spawned by `ConcordiaGame`). Your backlog is **`.Aura/ROADMAP.md`** (194 tasks, dependency-ordered). Skills cannot load sibling files, so **open `.Aura/ROADMAP.md` with your file tools now** and read sections 0–2 before doing anything. Also read `.Aura/Skills/visual-fidelity/SKILL.md` before any visual, camera, animation or HUD task, and follow it.

If an argument (task id) was given, start there if its deps are done; otherwise pick the first eligible task.

## The loop (do not stop between tasks)
1. **Pick.** Open `.Aura/ROADMAP.md`. Choose the first unchecked `- [ ]` task whose `deps` are all `[x]`. A task marked `BLOCKED` counts as not done. Skip any task whose deps are blocked.
2. **Pre-flight**, once per session and again every 10 tasks:
   - Run `git status --porcelain`. Paths listed as Dutch's in `.Aura/PROGRESS_LOG.md` (and any other file dirty before you started) are off-limits; never stage them.
   - Run all git commands with `git -C ~/concord/aura-wt …`. `git -C ~/concord/aura-wt branch --show-current` must print `aura/gameplay`. If it does not, **stop** and log a blocker; do not switch or create branches.
   - Disk (`df -h /System/Volumes/Data`) must have ≥10 GB free. If not, log a blocker and stop heavy work (imports, bakes, captures).
3. **Implement** the task using only the files in its `Touch` line plus new files under `Assets/Concordia/Scripts/Aura/`, `Assets/Concordia/Editor/Aura/` or `.Aura/`. Reuse what its `Reuse` line names. Read the real code first, because the roadmap can be out of date. Code wins; note any discrepancy in the log.
4. **Compile.** Wait for the domain reload. If there are compile errors, fix them, up to **3 attempts**. If it still fails, revert your edits for this task (`git checkout -- <your files>`, only files you changed), mark the task `BLOCKED(compile)`, log it, and move on.
5. **Verify in Play.** Enter Play mode and wait for the LeanPlay boot to settle (hero dressed, Court visible). Perform the task's `Verify` steps. Collect evidence: an `[AuraVerify] <ID> PASS …` console line and/or a screenshot saved to `~/.zuko/aura-shots/<ID>.png`. Exit Play.
   - **Server checks:** the server is `ws://127.0.0.1:5050/unity-ws`. If it is down, verify the honest offline behaviour instead and record `PASS(offline)`. Never start, stop or edit the server.
6. **Fix until it passes**, or mark `BLOCKED(<reason>)`. A blocker is a missing asset, a needed server/pipeline change, or a missing clip. For those, write a REQ in `.Aura/REQUESTS_FOR_CLAUDE.md`.
7. **Commit.**
   - In `~/concord/aura-wt` only, stage just the files you changed for this task: `git add <paths>`, never `git add -A` or `.`.
   - Run `git -C ~/concord/aura-wt commit -m "aura(<ID>): <what changed> — <verify result>"`.
   - Never use `--no-verify`, never amend pushed commits, never force-push, never push to `main`. Do not push at all unless Dutch asks. Claude merges via PR.
   - Never run git write commands in the live tree.
8. **Tick.** In `.Aura/ROADMAP.md`, change `[ ]` to `[x]` and fill in `Result: PASS · <one line> · <short hash>`. Then append to `.Aura/PROGRESS_LOG.md`: `<ISO time> | <ID> | PASS/BLOCKED | <one line> | <hash> | <evidence path>`. Commit the tracker change with the task, or as `aura(<ID>): tick`.
9. **Continue immediately** with step 1. Do not ask "shall I continue?" and do not summarize and wait. Keep going until no eligible task remains or a hard stop occurs.

**Regression cadence.** After every ~10 completed tasks, and at every `QA-*` task, run the regression route:
- spawn → walk and sprint the Court → walk to the Proving Ring → fight the arena dummy (block, parry, dodge) → accept and track a quest → return.
- Then run the EditMode tests and `Concordia/Verification/Run Focused PlayMode Proofs Direct`.

If anything regressed, fix it before new work. Log it as `REG-<n>`.

## Hard stops (log, then skip to the next unblocked task)
- A missing asset or animation clip. Use a `TODO_<thing>` labeled stand-in only if the task allows it.
- A change needed in server code, `.env`, or the build/export pipeline. File a REQ.
- Disk under 10 GB.
- Compile errors not fixed after 3 tries.
- Only stop the whole session if every remaining task is blocked, the editor is unusable, or another agent is driving the editor.

## Ownership (non-negotiable)
**You own:** gameplay C#, prefabs, runtime placement, scene content that is spawned at runtime, animation controllers and masks, UI (IMGUI/UI Toolkit), input, camera, VFX and audio hooks, EditMode/PlayMode tests, and Aura-only editor helpers in `Editor/Aura/`.

**You must NOT edit.** These belong to Claude; write a REQ in `.Aura/REQUESTS_FOR_CLAUDE.md` instead:
- `scripts/export-unity-web.mjs`, `Assets/Concordia/Editor/ConcordiaWebExport.cs`, `Assets/Concordia/Editor/ConcordiaBuildAssetRegistry.cs`
- `Scripts/BuildAssets*.cs`, `Scripts/ContinentStream*.cs`, `Scripts/FreePacks.cs` and the `Assets/Concordia/FreePacks/` layout
- the HubKit/OrganicKit loaders (`Scripts/HubKit.cs`, `Scripts/Organic/OrganicKit*.cs`) and `Assets/StreamingAssets/HubKit/`
- anything under the repo's `server/`, and any `.env*` file
- You may **call** their APIs.

**Never** do the following:
- export WebGL builds or deploy (Claude ships builds)
- set `ConcordiaHost.LeanPlay = false`
- wire `GameplayCore.CombatDefenseEvaluator` (it is DISCONNECTED; the live grammar is `Core.ActionRunner` + `Core.HitResolver`)
- add a second look/post stack (extend HubLook)
- replace Rocketbox/CX humans with primitives
- mass-reimport textures
- print or log tokens or secrets, or read `.Aura/project.json` ids into logs

## Content law
- **Nothing fake.** Use the real lore (`docs/LORE_BIBLE.md`, `content/world/*`, `Canon/*`), real quests and real generated assets. Placeholder geometry only when named `TODO_<thing>` and logged.
- **No invented server data.** Never invent HP, loot, prices, wallet balances, XP or quest completion. Offline shows an honest `{ok:false, reason:'no_gateway'}`.
- **The Court (Hub) never gets violence.** Inside the 42 m law radius, strikes bloom flowers, and the server refuses combat on `concordia-hub`. Test combat in the Proving Ring (steel) or steel worlds.
- **Lore secrets.** Do not resolve the Eighth Refusal's secret. Sere is satire with no ninth gate.
- **Reduced motion.** Every UI animation, shake, flash, pulse or tween must check `ConcordiaSettings.ReducedMotion` (roadmap B-05).
- **Trademarks.** Do not use other games' trademarked feature names or franchise terms in code, UI or commits.

## Editor etiquette
- Only one agent drives the editor. You own the Unity editor and the MCP bridge while this skill runs. If another client (Hermes, another Aura thread) is connected, stop and log it. Use a single thread; do not run parallel Aura threads against the editor.
- Keep Play sessions short; exit Play before editing scripts.
- Never leave the editor in Play when you finish.
- Prefer small, reviewable commits: one task is one commit (plus the tick).

## When the roadmap is exhausted
Write a summary at the top of `.Aura/PROGRESS_LOG.md` (done / blocked / REQs open). Then propose the next 20 tasks at the bottom of `.Aura/ROADMAP.md` under `## Phase 8 — Proposed (needs Dutch)`. Do not start them.
