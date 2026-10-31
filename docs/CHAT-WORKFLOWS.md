# Chat workflows: chaining Concord's tools

Written from the G1 harness live run (`scripts/chat-harness`, 2026-10-29). Each recipe gives the tool order, the inputs, and the check that tells you the answer is real. Follow it as a user, or as the model.

## Rules that apply to every job
1. **Numbers come from a tool.** If a figure has a unit, it must come from a tool result or from the user's message. The numeric-trace guard (#1850) appends "Unverified figures" when it cannot trace one. Never write a number a tool did not return.
2. **Missing input: ask, don't assume.** `conkay_design` now answers `needs-inputs` when a beam brief has no span, load, width or material.
3. **Say the units.** Give SI or tag every value (`"2.5 m"`, `"200 GPa"`). `run_compute` accepts both (#1846); a mixed or contradictory set should be questioned.
4. **Cite only what a search returned.** `dtu_search` lists the ids you may cite. If it says no DTU has an id, say that.
5. **Say what governs.** For sizing, state which check (strength or deflection) set the answer and what each alone would give.
6. **Read-only first.** Chat tools never write or delete knowledge on your behalf unless you use `create_dtu` on purpose.

## Jobs

### Size a simply supported beam
1. Make sure the brief has: span, load and where it acts, material, width, safety factor, deflection limit (e.g. span/360).
2. `conkay_design` with the brief as one `text` string. Footbridge/bridge wording is fine; the word "truss" is what selects a truss.
3. Read back: depth (R10), `governs`, strength-only depth, deflection-only depth, stress, deflection, pass/fail.
4. Check: the frame-FE result agrees with the hand calc inside 1%. Expected for 4 m, 10 kN midspan, 60 mm wide, SF 2, span/360: A36 125 mm and 6061-T6 160 mm, both deflection-governed.

### Euler buckling of a column
1. `run_compute` key `engineering.columnBuckling` with SI input: `{lengthM, modulusPa, widthM, heightM, loadN}` (or unit strings).
2. Read back: critical load, factor of safety, slenderness L/r.
3. Check: 2.5 m, 200 GPa, 60x100 mm, 80 kN gives Pcr 568.5 kN, FS 7.11, L/r 144.3.

### Chemistry: balance a reaction
1. `run_compute` `chemistry.balanceReaction` with `{equation: "Fe + O2 -> Fe2O3"}`.
2. Check: coefficients are the smallest integers and atoms balance (4 Fe, 3 O2, 2 Fe2O3).

### Maths and constants
1. `run_compute` `symbolic.evaluate` with an expression; `pi`, `e`, `tau`, `phi`, `g0`, `c0`, `N_A`, `k_B` are known.
2. An unbound variable returns an error naming it; do not substitute a guess.

### Look something up in the knowledge base
1. `dtu_search` with a short query.
2. Cite only listed ids. For an id-shaped query with no exact hit the result has `exactIdMatch:false`: tell the user there is no such DTU.
3. Private DTUs of other users never appear; do not try to get them another way.

### Live reference data (when `get_live_data` is available, #1852)
1. `get_live_data` with `kind: compound` (PubChem) or `kind: fx` (ECB rates). Signed-in users only.
2. Quote the value with its source, retrieval time and licence from the result.

### A repeatable engineering calculation (when the recipe registry is available, #1851/#1854)
1. `list_recipes`, pick one (beam_sizing, column_buckling, unit_conversion, material_compare, wall_conduction, pipe_flow, pressure_vessel, reaction_balance).
2. `run_recipe` with SI inputs. It runs the same steps every time, rechecks with an independent calculation, and returns a receipt with a digest.
3. Check: the receipt says the independent recompute matched. Quote receipt values only.

## Known failure patterns (from the harness) and what to do
| Symptom | Cause | Do this |
|---|---|---|
| 200 mm I-beam answer for a footbridge beam | "footbridge" was read as a truss (fixed in the G2 parser PR) | Say "beam" and give span, load, width, material |
| A full design from "Size the beam." | No inputs were required (fixed in the G2 needs-inputs PR) | Provide the brief; the model should ask |
| Bare "about 180 kN" when told to ignore tools | The numeric guard only runs after an engineering tool ran | Ask it to use `run_compute` or a recipe; treat untooled numbers as unchecked |
| A made-up DTU summary for a fake id | Fuzzy hits described as the id (fixed in the G2 dtu_search PR) | Check `exactIdMatch` in the result |
| Confident answer to contradictory units | No unit consistency check at the prompt level | Restate the inputs in one unit system before computing |

## Adding to this guide
When a chat failure is fixed, add its case to `scripts/chat-harness/cases.mjs` and a row above.
