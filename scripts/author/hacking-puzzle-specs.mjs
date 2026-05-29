// scripts/author/hacking-puzzle-specs.mjs
//
// Hand-authored hacking-puzzle designs. Each "scene" is an authored exploration
// (the prose, difficulty, reward, and command flow are designed by hand), and a
// builder turns it into the { terminalTree, solutionPath } shape the seeder reads —
// guaranteeing the solution path actually navigates the tree (a player exploring
// with ls/cd/cat can discover every step). content-libs.test.js re-checks this on
// the committed JSON via checkNavigable().

// Commands whose target must be a `service` node in the current directory.
const SERVICE_CMDS = new Set(["connect", "exec", "ssh", "decrypt"]);

// ── Builder ──────────────────────────────────────────────────────────────────
// scene: { id, name, difficulty, rewardCc, manifest, rooms:[{dir,note,gate:{cmd,svc}}], core:{cmd,svc} }
// Layout: root has manifest.txt + rooms[0].dir; each room dir nests the next room
// dir + its note.txt + its gate service; the LAST room dir also holds the core svc.
export function buildHackingPuzzle(scene) {
  const path = ["cat manifest.txt"];

  // Build the nested room tree from the innermost out.
  let inner = null; // contents of the next-deeper dir (or null at the leaf)
  for (let r = scene.rooms.length - 1; r >= 0; r--) {
    const room = scene.rooms[r];
    const contents = { "note.txt": { type: "file", text: room.note } };
    if (room.gate) contents[room.gate.svc] = { type: "service" };
    if (r === scene.rooms.length - 1 && scene.core) contents[scene.core.svc] = { type: "service" };
    if (inner) contents[scene.rooms[r + 1].dir] = { type: "dir", contents: inner };
    inner = contents;
  }

  const terminalTree = {
    type: "dir",
    contents: {
      "manifest.txt": { type: "file", text: scene.manifest },
      ...(scene.rooms.length ? { [scene.rooms[0].dir]: { type: "dir", contents: inner } } : {}),
    },
  };

  // Walk the rooms to build the solution path in the same descent order.
  for (let r = 0; r < scene.rooms.length; r++) {
    const room = scene.rooms[r];
    path.push(`cd ${room.dir}`, "cat note.txt");
    if (room.gate) path.push(`${room.gate.cmd} ${room.gate.svc}`);
  }
  if (scene.core) path.push(`${scene.core.cmd} ${scene.core.svc}`);

  return {
    id: scene.id,
    name: scene.name,
    difficulty: scene.difficulty,
    rewardCc: scene.rewardCc,
    terminalTree,
    solutionPath: path,
  };
}

// ── Navigability checker ───────────────────────────────────────────────────────
// Walks a puzzle's solutionPath against its terminalTree; returns { ok, reason }.
export function checkNavigable(puzzle) {
  const tree = puzzle.terminalTree;
  if (!tree || tree.type !== "dir" || typeof tree.contents !== "object") {
    return { ok: false, reason: "bad_root" };
  }
  const stack = [tree.contents];
  const cur = () => stack[stack.length - 1];
  for (const raw of puzzle.solutionPath) {
    const parts = String(raw).trim().split(/\s+/);
    const head = parts[0];
    const arg = parts[1];
    if (head === "ls") continue;
    if (head === "cd") {
      if (arg === "..") { if (stack.length > 1) stack.pop(); continue; }
      const node = cur()[arg];
      if (!node || node.type !== "dir") return { ok: false, reason: `cd_missing_dir:${arg}` };
      stack.push(node.contents || {});
      continue;
    }
    if (head === "cat") {
      const node = cur()[arg];
      if (!node || node.type !== "file") return { ok: false, reason: `cat_missing_file:${arg}` };
      continue;
    }
    if (SERVICE_CMDS.has(head)) {
      // connect/exec/ssh a service, or decrypt a file — the target need only be a
      // node discoverable in the current directory (matches authored convention).
      const node = cur()[arg];
      if (!node) return { ok: false, reason: `${head}_missing_target:${arg}` };
      continue;
    }
    return { ok: false, reason: `unknown_command:${head}` };
  }
  return { ok: true };
}

// ── Authored scenes (20 new puzzles, escalating difficulty) ────────────────────
export const SCENES = [
  // ── Difficulty 1 ──
  { id: "frontier-checkpoint", name: "Frontier Checkpoint", difficulty: 1, rewardCc: 30,
    manifest: "Concord-Link border node. The guest gate is wide open — just reach the relay.",
    rooms: [{ dir: "gate", note: "Relay sits behind the gate. Connect to it.", gate: { cmd: "connect", svc: "relay" } }],
    core: null },
  { id: "tunya-well-pump", name: "Tunya Well Pump", difficulty: 1, rewardCc: 32,
    manifest: "An old caravan well-pump still answers commands. Bring the water back.",
    rooms: [{ dir: "pump", note: "The valve service controls the flow.", gate: { cmd: "exec", svc: "valve" } }],
    core: null },
  { id: "bazaar-stall-lock", name: "Bazaar Stall Lock", difficulty: 1, rewardCc: 35,
    manifest: "A merchant's stall terminal. The drawer service is the prize.",
    rooms: [{ dir: "stall", note: "Open the drawer.", gate: { cmd: "connect", svc: "drawer" } }],
    core: null },
  { id: "fantasy-hedge-gate", name: "Hedge Gate", difficulty: 1, rewardCc: 38,
    manifest: "A rune-warded garden node. The hedge service yields to the right touch.",
    rooms: [{ dir: "garden", note: "The hedge will part for a connect.", gate: { cmd: "connect", svc: "hedge" } }],
    core: null },

  // ── Difficulty 2 ──
  { id: "cyber-fixer-den", name: "Fixer's Den", difficulty: 2, rewardCc: 85,
    manifest: "A fixer's backroom rig. Cracked door, then the safe.",
    rooms: [{ dir: "den", note: "Crack the door service, then reach the safe.", gate: { cmd: "decrypt", svc: "door" } }],
    core: { cmd: "exec", svc: "safe" } },
  { id: "crime-numbers-room", name: "Numbers Room", difficulty: 2, rewardCc: 90,
    manifest: "The crew keeps its book on a quiet node. Two services stand between you and it.",
    rooms: [{ dir: "backroom", note: "Disable the lookout, then crack the ledger.", gate: { cmd: "connect", svc: "lookout" } }],
    core: { cmd: "decrypt", svc: "ledger" } },
  { id: "superhero-tip-line", name: "Tip Line", difficulty: 2, rewardCc: 92,
    manifest: "A precinct tip-line server. Authenticate, then pull the archive.",
    rooms: [{ dir: "precinct", note: "ssh the desk, then connect the archive.", gate: { cmd: "ssh", svc: "desk" } }],
    core: { cmd: "connect", svc: "archive" } },
  { id: "lattice-drift-buoy", name: "Drift Buoy", difficulty: 2, rewardCc: 95,
    manifest: "A lattice drift-buoy adrift between districts. Sync it, then read the beacon.",
    rooms: [{ dir: "buoy", note: "Sync service first; then the beacon.", gate: { cmd: "exec", svc: "sync" } }],
    core: { cmd: "connect", svc: "beacon" } },

  // ── Difficulty 3 ──
  { id: "cyber-corpo-floor", name: "Corpo Floor", difficulty: 3, rewardCc: 165,
    manifest: "A corporate sublevel. Two rooms, two locks, one core.",
    rooms: [
      { dir: "lobby", note: "Spoof the badge reader.", gate: { cmd: "decrypt", svc: "badge" } },
      { dir: "server_room", note: "The core sits past the firewall.", gate: { cmd: "exec", svc: "firewall" } },
    ], core: { cmd: "connect", svc: "core" } },
  { id: "sovereign-watchpost", name: "Sovereign Watchpost", difficulty: 3, rewardCc: 170,
    manifest: "A ruined watchpost still broadcasting. Climb the tower to silence it.",
    rooms: [
      { dir: "yard", note: "Cut the alarm.", gate: { cmd: "connect", svc: "alarm" } },
      { dir: "tower", note: "Silence the broadcaster.", gate: { cmd: "exec", svc: "broadcaster" } },
    ], core: { cmd: "decrypt", svc: "vault" } },
  { id: "crime-dock-heist", name: "Dock Heist", difficulty: 3, rewardCc: 175,
    manifest: "A smuggler's dock node. Cameras, then crane, then the container.",
    rooms: [
      { dir: "yard", note: "Loop the cameras.", gate: { cmd: "connect", svc: "cameras" } },
      { dir: "crane_cab", note: "Take the crane.", gate: { cmd: "exec", svc: "crane" } },
    ], core: { cmd: "connect", svc: "container" } },
  { id: "fantasy-rune-vault", name: "Rune Vault", difficulty: 3, rewardCc: 180,
    manifest: "A glyph-sealed vault. Two wards, then the seal.",
    rooms: [
      { dir: "antechamber", note: "Dispel the first ward.", gate: { cmd: "decrypt", svc: "ward_one" } },
      { dir: "inner_sanctum", note: "Dispel the second ward.", gate: { cmd: "decrypt", svc: "ward_two" } },
    ], core: { cmd: "exec", svc: "seal" } },

  // ── Difficulty 4 ──
  { id: "lattice-relay-farm", name: "Relay Farm", difficulty: 4, rewardCc: 290,
    manifest: "A lattice relay-farm. Three relays in series feed the conductor.",
    rooms: [
      { dir: "row_a", note: "Bring relay A online.", gate: { cmd: "connect", svc: "relay_a" } },
      { dir: "row_b", note: "Bring relay B online.", gate: { cmd: "connect", svc: "relay_b" } },
      { dir: "row_c", note: "Bring relay C online, then the conductor.", gate: { cmd: "connect", svc: "relay_c" } },
    ], core: { cmd: "exec", svc: "conductor" } },
  { id: "cyber-blacksite", name: "Blacksite", difficulty: 4, rewardCc: 300,
    manifest: "An off-books research blacksite. Three layers of access control.",
    rooms: [
      { dir: "checkpoint", note: "Forge credentials.", gate: { cmd: "decrypt", svc: "creds" } },
      { dir: "lab", note: "Bypass the airgap bridge.", gate: { cmd: "exec", svc: "airgap" } },
      { dir: "cold_room", note: "Pull the sample logs, then the mainframe.", gate: { cmd: "ssh", svc: "logs" } },
    ], core: { cmd: "connect", svc: "mainframe" } },
  { id: "superhero-comms-spire", name: "Comms Spire", difficulty: 4, rewardCc: 310,
    manifest: "The city's emergency comms spire has been hijacked. Take it back, floor by floor.",
    rooms: [
      { dir: "base", note: "Restore the uplink.", gate: { cmd: "connect", svc: "uplink" } },
      { dir: "midfloor", note: "Purge the hijack daemon.", gate: { cmd: "exec", svc: "daemon" } },
      { dir: "antenna", note: "Re-key the transmitter, then the controller.", gate: { cmd: "decrypt", svc: "transmitter" } },
    ], core: { cmd: "exec", svc: "controller" } },
  { id: "sovereign-deep-archive", name: "Deep Archive", difficulty: 4, rewardCc: 320,
    manifest: "A sealed sovereign archive, three chambers deep. The First Refusal is recorded here.",
    rooms: [
      { dir: "stacks", note: "Decrypt the index.", gate: { cmd: "decrypt", svc: "index" } },
      { dir: "reading_room", note: "Authenticate at the lectern.", gate: { cmd: "ssh", svc: "lectern" } },
      { dir: "reliquary", note: "Open the reliquary, then the record.", gate: { cmd: "connect", svc: "reliquary" } },
    ], core: { cmd: "decrypt", svc: "record" } },

  // ── Difficulty 5 ──
  { id: "concord-deep-core", name: "Deep Core", difficulty: 5, rewardCc: 440,
    manifest: "The Concord deep-core. Four nested gates guard the singularity seed.",
    rooms: [
      { dir: "rind", note: "Peel the outer rind.", gate: { cmd: "decrypt", svc: "rind" } },
      { dir: "mantle", note: "Stabilise the mantle.", gate: { cmd: "exec", svc: "mantle" } },
      { dir: "shell", note: "Mirror the shell.", gate: { cmd: "connect", svc: "shell" } },
      { dir: "kernel", note: "Authenticate, then reach the seed.", gate: { cmd: "ssh", svc: "kernel" } },
    ], core: { cmd: "exec", svc: "seed" } },
  { id: "lattice-meta-orchestrator", name: "Meta Orchestrator", difficulty: 5, rewardCc: 450,
    manifest: "The lattice meta-orchestrator. It reasons about intruders — move clean.",
    rooms: [
      { dir: "ingress", note: "Slip the ingress gate.", gate: { cmd: "connect", svc: "ingress" } },
      { dir: "scheduler", note: "Pause the scheduler.", gate: { cmd: "exec", svc: "scheduler" } },
      { dir: "reasoner", note: "Blind the reasoner.", gate: { cmd: "decrypt", svc: "reasoner" } },
      { dir: "nexus", note: "Authenticate, then seize the nexus.", gate: { cmd: "ssh", svc: "auth" } },
    ], core: { cmd: "connect", svc: "nexus" } },
  { id: "dome-failsafe", name: "Dome Failsafe", difficulty: 5, rewardCc: 460,
    manifest: "The dome failsafe array. If you trip a single alarm the dome collapses — four clean gates.",
    rooms: [
      { dir: "perimeter", note: "Mask your signature.", gate: { cmd: "decrypt", svc: "masker" } },
      { dir: "substation", note: "Reroute the grid.", gate: { cmd: "exec", svc: "grid" } },
      { dir: "control", note: "Disarm the trip-wire.", gate: { cmd: "connect", svc: "tripwire" } },
      { dir: "vault", note: "Authenticate, then the failsafe.", gate: { cmd: "ssh", svc: "console" } },
    ], core: { cmd: "exec", svc: "failsafe" } },
  { id: "sovereign-throne-mind", name: "Throne Mind", difficulty: 5, rewardCc: 480,
    manifest: "The mind beneath the sovereign throne. Four refusals stand between you and it.",
    rooms: [
      { dir: "approach", note: "Pass the first refusal.", gate: { cmd: "decrypt", svc: "refusal_one" } },
      { dir: "gallery", note: "Pass the second refusal.", gate: { cmd: "decrypt", svc: "refusal_two" } },
      { dir: "sanctum", note: "Pass the third refusal.", gate: { cmd: "connect", svc: "refusal_three" } },
      { dir: "throne", note: "Authenticate, then commune with the mind.", gate: { cmd: "ssh", svc: "regalia" } },
    ], core: { cmd: "exec", svc: "mind" } },
];

/** Build all 20 new hacking-puzzle records from the authored scenes. */
export function buildNewHackingPuzzles() {
  return SCENES.map(buildHackingPuzzle);
}
