# ConKay existing-surfaces inventory (SXC-38)

The inventory pin: every pre-catalogue ConKay surface that the SX-ORC /
SX-CAD rows generalize, where it lives at f4f1f77ff, and the regression leg
that keeps it working while PRG-17 / PRG-C1 generalize it. Pin suite:
`server/tests/conkay-surfaces-pin.test.js` (hermetic legs; DB- or
loop-bound legs are named as such and pin their honest-refusal shape).

| # | Surface (ticket's words) | Locus at f4f1f77ff | Generalized by | Pin leg |
|---|---|---|---|---|
| 1 | workspace + conversation pane | `chat/session.js` (`ChatSession`, SESSION_VERSION) · `chat/run.js` (`designFromChat`) | SX-ORC-13 (workspace) · SX-ORC-01 (intent) · SXC-26 (chain reachability) | designFromChat("") → {ok:false, stage:"parse"}; SESSION_VERSION present |
| 2 | workbench | `chat/workbench.js` (`explainCheck`, `checkReceipt`, `feaFrameOf`, `assemblySnapshot`, `attachSessionAnalyses`) | SX-ORC-13 · SX-ORC-10 | checkReceipt echoes runId/status of a fabricated envelope; explainCheck names the method |
| 3 | beam-study deterministic commands | `beam-study.js` (`normalizeBeamStudyInputs`, `hashBeamStudyInputs`, `buildBeamCalcReceipt`, `buildAnalysisReceipt`) | SX-ORC-10 (edit-commands) | input hash deterministic; a changed dimension changes the hash; receipt echoes normalized inputs |
| 4 | brief routing — car | `chat/brief-parser.js` (`detectDomain`, `parseChatBrief`) · `car-chat-assembly.js` (`buildCarChatAssembly`) | SX-ORC-01 | car brief routes to the car domain; empty brief → null assembly |
| 5 | brief routing — bracket | `chat/brief-parser.js` · `chat/structures.js` (`solveBracket`) | SX-ORC-01 · SX-ORC-05 | solveBracket with missing fields → {ok:false, missing:[…]} (never a guessed design) |
| 6 | brief routing — beam | `chat/brief-parser.js` · `chat/structures.js` (`cantilever`) | SX-ORC-01 · SX-ORC-05 | cantilever closed form: σ = Mc/I, δ = PL³/3EI (textbook values) |
| 7 | brief routing — truss, incl. bridges→truss | `chat/brief-parser.js` lines 41–45 (BRIDGE_RE; a bridge is a planar truss, a "beam bridge" stays a beam) | SX-ORC-01 · SX-ORC-03 | detectDomain("footbridge…") = "truss"; "bridge beam" phrasing ≠ "truss" |
| 8 | brief routing — sentinel-part | `chat/brief-parser.js` (sentinel rule) · `chat/sentinel-part.js` (`sentinelJointLoad`, `solveSentinelBracket`) | SX-ORC-01 · SX-ORC-05 | unknown joint → {ok:false} naming the valid joints |
| 9 | class problems | `chat/session.js` (chat session for class problems — turns joined and re-read by the loop) | SX-ORC-01 · SX-ORC-02 | ChatSession constructs; session version pinned |
| 10 | architectures | `concept-assembly.js` (`buildConceptAssembly`) · `robot-assembly.js` (`buildRobotAssembly`, `parseRobotAsk`) · `car-chat-assembly.js` | SX-ORC-03 (system-architecture) | unmatched concept text → null (no fabricated architecture); robot ask parses to a spec |
| 11 | feasibility | `compiler/feasibility.js` (`checkFeasibility`, ELECTRIC_AIRCRAFT_BOUNDS) · `chat/what-if.js` | SX-ORC-04 | a design kind with no screen → {status:"NO_SCREEN", "nothing is assumed to be feasible"} |
| 12 | iterate / orchestrator | `iterate/loop.js` (`iterateToPhysical`) · `chat/orchestrator.js` (`orchestrate`, `carEvaluator`) | SX-ORC-08 (iterate) · SXC-26 (orchestrator's chain) | DesignGraph path on the corrected plate IR: mass.part + cost.part PASS with echo integrity (SC-05 helper) |
| 13 | mates | `assembly-mates.js` (`solveMateTransform`, `applyMate`) | SX-CAD-06 (assembly-constraints) | coincident mate drives b onto a's axis coordinate; unsupported mate → {ok:false, unsupported_mate} |
| 14 | drawings | `drawings/sheet.js` (`ascii`, `textWidth`, `fitText`, `toSvg`) · `drawings/ga-drawing.js` (`buildGaSheets`) · `assembly-drawing.js` | SX-CAD-07 (drawings-detail) | ascii() symbol folding is exact; fitText is deterministic |
| 15 | BOM | `erp-bom.js` (`buildErpBom`, `parseVendorPriceList`, `estimatePartMassProps`, `erpBomToCsv`) | SX-ORC-07 (mass-bom) · SX-CAD-08 (bom-structure) | vendor price list parses to rows; a part with unknown material gets NO mass (null + reason — no stand-in density) |

## Exists vs missing (against the catalogue's expectations)

- All fifteen named surfaces EXIST at f4f1f77ff as code surfaces. What does
  not exist yet is their generalization: solve.direct (SC-00), the ordered
  chain runner (SXC-26), and the registry-level input-validity gate
  (CK-CR-03's territory) — recorded in the SC-foundations evidence, not
  re-litigated here.
- The shipped `CONKAY_IR_MINI_EXAMPLE` does not compile at this build
  (geometry keys) — the pin suite uses the compiler-correct keys
  (length/width/height); see the SC-foundations evidence file.
- DB-bound legs (applyMate, buildErpBom's store walk) pin through their
  pure siblings above; their store shapes are CI-seeded legs, named here
  so the generalization work keeps them in view.

## How the pin is used

Every PRG-17 / PRG-C1 commit runs this suite in CI. A red pin means the
generalization changed an existing surface's behaviour — intended changes
update the pin and this inventory in the same commit, with the change
named; unintended changes are regressions and block the stack.
