/**
 * Dining philosophers, deadlocking and fixed.
 *
 * The classic because the failure is not a bug in any one philosopher. Every
 * one of them follows a policy that is locally reasonable — pick up the left
 * fork, then the right — and the system stops anyway, because the policy is
 * symmetric and the resources are in a ring.
 *
 * The fix is to break the symmetry: one philosopher reaches right first. That
 * one change makes a cycle of waiting impossible, and the checker sees the
 * difference as deadlock versus no deadlock rather than as an argument.
 */

import type { Spec } from "../src/types.js";

export interface DiningState {
  /** Which philosopher holds each fork, or -1 for free. */
  readonly forks: readonly number[];
  /** 0 thinking, 1 holding the first fork, 2 eating. */
  readonly pc: readonly number[];
}

const set = <T>(xs: readonly T[], i: number, value: T): T[] => {
  const copy = [...xs];
  copy[i] = value;
  return copy;
};

/**
 * @param n how many philosophers
 * @param breakSymmetry when true the last philosopher reaches right first
 */
export function philosophers(n: number, breakSymmetry: boolean): Spec<DiningState> {
  const left = (i: number): number => i;
  const right = (i: number): number => (i + 1) % n;

  // Which fork each philosopher reaches for first. Reversing exactly one of
  // them is enough; reversing all of them just rotates the deadlock.
  const firstFork = (i: number): number =>
    breakSymmetry && i === n - 1 ? right(i) : left(i);
  const secondFork = (i: number): number =>
    breakSymmetry && i === n - 1 ? left(i) : right(i);

  const actions = Array.from({ length: n }, (_, i) => [
    {
      name: `phil ${i}: take fork ${firstFork(i)}`,
      process: i,
      reads: [`pc${i}`, `fork${firstFork(i)}`],
      writes: [`pc${i}`, `fork${firstFork(i)}`],
      step: (s: DiningState) =>
        s.pc[i] === 0 && s.forks[firstFork(i)] === -1
          ? [{ pc: set(s.pc, i, 1), forks: set(s.forks, firstFork(i), i) }]
          : [],
    },
    {
      name: `phil ${i}: take fork ${secondFork(i)}`,
      process: i,
      reads: [`pc${i}`, `fork${secondFork(i)}`],
      writes: [`pc${i}`, `fork${secondFork(i)}`],
      step: (s: DiningState) =>
        s.pc[i] === 1 && s.forks[secondFork(i)] === -1
          ? [{ pc: set(s.pc, i, 2), forks: set(s.forks, secondFork(i), i) }]
          : [],
    },
    {
      name: `phil ${i}: put both down`,
      process: i,
      reads: [`pc${i}`],
      writes: [`pc${i}`, `fork${left(i)}`, `fork${right(i)}`],
      step: (s: DiningState) => {
        if (s.pc[i] !== 2) return [];
        const forks = set(set(s.forks, left(i), -1), right(i), -1);
        return [{ pc: set(s.pc, i, 0), forks }];
      },
    },
  ]).flat();

  return {
    name: `philosophers(${n})${breakSymmetry ? " with one lefty" : ""}`,
    processes: n,
    init: [{ forks: Array.from({ length: n }, () => -1), pc: Array.from({ length: n }, () => 0) }],
    actions,
    show: (s) => `pc=${s.pc.join("")} forks=${s.forks.join("")}`,
  };
}
