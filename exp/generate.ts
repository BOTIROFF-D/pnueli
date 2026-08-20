/**
 * A generator of small specifications, for finding out whether a condition
 * is load-bearing.
 *
 * The portfolio in `specs/` cannot answer that question. Its members are
 * textbook problems, and they sit at the two ends of the range: either
 * everything is shared, so the ample set degenerates to the full enabled set
 * and no condition ever binds, or everything is private, so every condition
 * holds trivially. Neither shape puts a condition under load.
 *
 * The shape that does is a process with a *private* variable that the
 * invariant nonetheless reads. Writing only its own variable makes the action
 * independent of every other process, so C1 is satisfied; being read by the
 * invariant makes it visible, so C2 is the only thing left rejecting it. That
 * is the configuration where removing C2 has somewhere to go wrong, and it is
 * what this generator produces.
 *
 * Determinism matters more here than anywhere else in the repository: a
 * witness is only useful if the reader can run the same seed and get the same
 * specification. So the randomness is a linear congruential generator with an
 * explicit seed, and nothing consults the clock.
 */

import type { Action, Spec } from "../src/types.js";

export interface GenState {
  /** Each process's program counter. */
  readonly pc: readonly number[];
  /** Variables: the first `procs` are private, one per process; the rest shared. */
  readonly v: readonly number[];
}

export interface GenMeta {
  readonly seed: number;
  readonly processes: number;
  readonly variables: number;
  readonly programLength: number;
  /** Which variables the invariant observes. */
  readonly invariantReads: readonly number[];
}

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * @param seed     selects the specification; the same seed is the same model
 * @param density  probability that the invariant observes any given variable.
 *                 It is a parameter rather than a constant because C2 and C3
 *                 respond to it in opposite directions — see `conditions`
 *                 in the experiment.
 */
export function generate(seed: number, density = 0.55): { spec: Spec<GenState>; meta: GenMeta } {
  const rnd = lcg(seed);
  const pick = (n: number) => Math.floor(rnd() * n);

  const processes = 2 + pick(2); // 2..3
  const shared = 1 + pick(2); // 1..2
  const programLength = 2 + pick(2); // 2..3
  const variables = processes + shared;

  const program = Array.from({ length: processes }, (_, p) =>
    Array.from({ length: programLength }, () => {
      const writes: number[] = [];
      const reads: number[] = [];
      // The process's own variable, most of the time: that is what makes an
      // action independent of everyone else and so lets C2 be the binding one.
      if (rnd() < 0.65) writes.push(p);
      for (let k = 0; k < shared; k++) {
        const v = processes + k;
        if (rnd() < 0.35) writes.push(v);
        else if (rnd() < 0.4) reads.push(v);
      }
      if (writes.length === 0) writes.push(p);
      return { reads, writes, value: pick(2) };
    }),
  );

  const invariantReads: number[] = [];
  for (let v = 0; v < variables; v++) if (rnd() < density) invariantReads.push(v);
  if (invariantReads.length === 0) invariantReads.push(pick(variables));

  const actions: Action<GenState>[] = [];
  for (let p = 0; p < processes; p++) {
    for (let j = 0; j < programLength; j++) {
      const instruction = program[p]?.[j];
      if (!instruction) continue;
      actions.push({
        name: `p${p}:${j}`,
        process: p,
        // Declared truthfully. A generator that lied here would be measuring
        // the consequences of a bad specification, not of a missing condition.
        reads: [`pc${p}`, ...instruction.reads.map((v) => `v${v}`)],
        writes: [`pc${p}`, ...instruction.writes.map((v) => `v${v}`)],
        step: (s) => {
          if (s.pc[p] !== j) return [];
          const v = [...s.v];
          for (const w of instruction.writes) v[w] = instruction.value;
          return [{ pc: s.pc.map((x, i) => (i === p ? (j + 1) % programLength : x)), v }];
        },
      });
    }
  }

  const spec: Spec<GenState> = {
    name: `gen(${seed}, d=${density})`,
    processes,
    init: [
      {
        pc: Array.from({ length: processes }, () => 0),
        v: Array.from({ length: variables }, () => 0),
      },
    ],
    actions,
    invariants: [
      {
        name: "not every observed variable is raised",
        reads: invariantReads.map((v) => `v${v}`),
        holds: (s) => invariantReads.some((v) => s.v[v] !== 1),
      },
    ],
    show: (s) => `pc=${s.pc.join("")} v=${s.v.join("")}`,
  };

  return {
    spec,
    meta: { seed, processes, variables, programLength, invariantReads },
  };
}
