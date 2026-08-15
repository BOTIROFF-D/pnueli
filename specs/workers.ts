/**
 * The specification the reductions were built for.
 *
 * N workers, each grinding through a few private steps before touching one
 * shared counter. Nothing about it is clever — it is here because it is the
 * shape where both reductions have everything to work with, and measuring
 * them needs a case where they can show what they do.
 *
 * Symmetry: the workers are interchangeable, so a state is fully described by
 * *how many* workers are at each step rather than which. That turns an
 * exponential in N into a count of multisets.
 *
 * Partial order: a worker's private step writes one variable that nobody else
 * reads and no invariant looks at, so it is both independent and invisible.
 * Exploring one worker's private step in place of every interleaving of all
 * of them loses nothing.
 *
 * State space is 5^N unreduced, which is where the numbers in the README come
 * from.
 */

import type { Spec } from "../src/types.js";

export interface WorkerState {
  /** Each worker's progress: 0..3 working, 4 finished. */
  readonly step: readonly number[];
  readonly finished: number;
}

const set = (xs: readonly number[], i: number, value: number): number[] => {
  const copy = [...xs];
  copy[i] = value;
  return copy;
};

export function workers(n: number): Spec<WorkerState> {
  const actions = Array.from({ length: n }, (_, i) => [
    {
      name: `worker ${i}: private step`,
      process: i,
      // Reads and writes nothing but its own progress. This is what makes it
      // independent of every other action in the system.
      reads: [`step${i}`],
      writes: [`step${i}`],
      step: (s: WorkerState) =>
        s.step[i] !== undefined && (s.step[i] as number) < 3
          ? [{ ...s, step: set(s.step, i, (s.step[i] as number) + 1) }]
          : [],
    },
    {
      name: `worker ${i}: report finished`,
      process: i,
      reads: [`step${i}`, "finished"],
      writes: [`step${i}`, "finished"],
      step: (s: WorkerState) =>
        s.step[i] === 3 ? [{ step: set(s.step, i, 4), finished: s.finished + 1 }] : [],
    },
  ]).flat();

  return {
    name: `workers(${n})`,
    processes: n,
    init: [{ step: Array.from({ length: n }, () => 0), finished: 0 }],
    actions,
    invariants: [
      {
        name: "no more finishers than workers",
        // Only the shared counter. Private steps are therefore invisible to
        // the property, which is the second half of what partial-order
        // reduction needs.
        reads: ["finished"],
        holds: (s) => s.finished <= n,
      },
    ],
    // Everyone finished is the end of the run, not a deadlock.
    terminal: (s) => s.step.every((step) => step === 4),
    // Workers are interchangeable, so sorting their progress gives a canonical
    // representative of every permutation of the same multiset.
    symmetry: (s) => ({ ...s, step: [...s.step].sort((a, b) => a - b) }),
    show: (s) => `steps=${s.step.join("")} finished=${s.finished}`,
  };
}

/** The same model without the symmetry declaration, for the benchmark. */
export function workersWithoutSymmetry(n: number): Spec<WorkerState> {
  const spec = workers(n);
  const { symmetry: _ignored, ...rest } = spec;
  return { ...rest, name: `${spec.name} [no symmetry]` };
}
