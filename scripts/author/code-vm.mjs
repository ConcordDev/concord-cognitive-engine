// scripts/author/code-vm.mjs
//
// Pure mirror of the programming-puzzle VM (server/lib/programming-puzzle.js#_runVm).
// Kept standalone so the authoring builder + the content-libs test can prove every
// hand-authored code puzzle is solvable WITHOUT booting the engine or a DB. Ops:
// MOV / ADD / JMP / JEZ / OUT, registers R0..R3, INP input-stream cursor, immediates.

const MAX_CYCLES = Number(process.env.CONCORD_CODE_PUZZLE_MAX_CYCLES) || 10_000;

function regIdx(token) {
  const m = /^R([0-3])$/.exec(String(token));
  return m ? Number(m[1]) : null;
}
function resolve(token, reg, input, cursor) {
  if (typeof token === "number") return token;
  if (typeof token !== "string") return 0;
  if (token === "INP") {
    const v = input[cursor.i] ?? 0;
    cursor.i++;
    return v;
  }
  const idx = regIdx(token);
  if (idx != null) return reg[idx];
  return Number(token) || 0;
}

/** Run a program over one input array; returns { tape, cycles }. */
export function runVm(program, input) {
  const reg = [0, 0, 0, 0];
  const tape = [];
  let ip = 0;
  let cycles = 0;
  const cursor = { i: 0 };
  while (ip < program.length && cycles < MAX_CYCLES) {
    const instr = program[ip];
    cycles++;
    switch (instr.op) {
      case "MOV": {
        const dst = regIdx(instr.dst);
        if (dst == null) return { tape, cycles };
        reg[dst] = resolve(instr.src, reg, input, cursor);
        ip++;
        break;
      }
      case "ADD": {
        const dst = regIdx(instr.dst);
        if (dst == null) return { tape, cycles };
        reg[dst] = reg[dst] + resolve(instr.src, reg, input, cursor);
        ip++;
        break;
      }
      case "JMP":
        ip = Math.max(0, Number(instr.to) || 0);
        break;
      case "JEZ":
        if (resolve(instr.src, reg, input, cursor) === 0) ip = Math.max(0, Number(instr.to) || 0);
        else ip++;
        break;
      case "OUT":
        tape.push(resolve(instr.src, reg, input, cursor));
        ip++;
        break;
      default:
        return { tape, cycles };
    }
  }
  return { tape, cycles };
}

export { MAX_CYCLES };
