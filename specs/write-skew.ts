/**
 * Write skew, as a specification.
 *
 * [adya](https://github.com/BOTIROFF-D/adya) implements snapshot isolation and
 * finds write skew in it by generating concurrent transactions and checking
 * the resulting histories for dependency cycles — G2-item, in Adya's
 * numbering. It found one at seed 25 of 300.
 *
 * This is the same fact without the seed. Two transactions, a bounded state
 * space, every interleaving visited: under snapshot isolation the constraint
 * is *reachably* false, and the shortest way to break it is printed. Under a
 * rule that aborts a transaction whose snapshot has been overtaken, it is
 * unreachable — which is a proof for this instance rather than a clean run.
 *
 * The scenario is the textbook one. Two variables, a constraint that their
 * sum stays positive, and two transactions each checking the constraint
 * against its own snapshot before zeroing one of them. Neither writes what
 * the other writes, so first-committer-wins has nothing to catch, and both
 * commit into a world neither of them saw.
 */

import type { Spec } from "../src/types.js";

export interface SkewState {
  readonly x: number;
  readonly y: number;
  /** 0 not started, 1 holding a snapshot, 2 finished. */
  readonly pc: readonly number[];
  readonly snapX: readonly number[];
  readonly snapY: readonly number[];
  /** How many commits had happened when this transaction took its snapshot. */
  readonly snapAt: readonly number[];
  readonly commits: number;
}

const set = (xs: readonly number[], i: number, value: number): number[] => {
  const copy = [...xs];
  copy[i] = value;
  return copy;
};

export interface SkewOptions {
  /**
   * Abort a transaction whose snapshot was overtaken by another commit.
   *
   * Both transactions read both variables, so any commit landing after a
   * snapshot invalidates it. This is the shape of what serializable snapshot
   * isolation does — refuse the transaction that would close the cycle —
   * reduced to what this two-variable model needs.
   */
  readonly preventWriteSkew: boolean;
}

export function writeSkew(options: SkewOptions): Spec<SkewState> {
  const { preventWriteSkew } = options;

  const initial: SkewState = {
    x: 1,
    y: 1,
    pc: [0, 0],
    snapX: [0, 0],
    snapY: [0, 0],
    snapAt: [0, 0],
    commits: 0,
  };

  const actions = [0, 1].flatMap((i) => [
    {
      name: `t${i}: take snapshot`,
      process: i,
      reads: ["x", "y", `pc${i}`],
      writes: [`pc${i}`, `snap${i}`],
      step: (s: SkewState) =>
        s.pc[i] === 0
          ? [
              {
                ...s,
                pc: set(s.pc, i, 1),
                snapX: set(s.snapX, i, s.x),
                snapY: set(s.snapY, i, s.y),
                snapAt: set(s.snapAt, i, s.commits),
              },
            ]
          : [],
    },
    {
      // Zero one variable, but only if this transaction's own snapshot says
      // the constraint survives. Each transaction is individually correct.
      name: `t${i}: commit (zero ${i === 0 ? "x" : "y"})`,
      process: i,
      reads: [`pc${i}`, `snap${i}`],
      writes: [`pc${i}`, i === 0 ? "x" : "y", "commits"],
      step: (s: SkewState) => {
        if (s.pc[i] !== 1) return [];

        const overtaken = s.commits > (s.snapAt[i] as number);
        if (preventWriteSkew && overtaken) {
          // Aborted: finishes without writing anything.
          return [{ ...s, pc: set(s.pc, i, 2) }];
        }

        // Each transaction zeroes one variable, so what it must check is the
        // *other* one — the value that will be carrying the constraint once
        // this write lands. Checking the sum instead would let a transaction
        // zero the last non-zero variable, and the constraint would break in
        // a plain serial run with no concurrency involved at all.
        const carrier = i === 0 ? (s.snapY[i] as number) : (s.snapX[i] as number);
        if (carrier < 1) return [{ ...s, pc: set(s.pc, i, 2) }];

        return [
          {
            ...s,
            ...(i === 0 ? { x: 0 } : { y: 0 }),
            pc: set(s.pc, i, 2),
            commits: s.commits + 1,
          },
        ];
      },
    },
  ]);

  return {
    name: `write skew (${preventWriteSkew ? "abort on overtaken snapshot" : "snapshot isolation"})`,
    processes: 2,
    init: [initial],
    actions,
    invariants: [
      {
        name: "x + y stays at least 1",
        reads: ["x", "y"],
        holds: (s) => s.x + s.y >= 1,
      },
    ],
    terminal: (s) => s.pc.every((pc) => pc === 2),
    show: (s) => `x=${s.x} y=${s.y} pc=${s.pc.join("")}`,
  };
}
