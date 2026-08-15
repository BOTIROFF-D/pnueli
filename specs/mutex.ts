/**
 * Mutual exclusion, three ways.
 *
 * These are here because their answers are known in advance. A model checker
 * that disagrees with Peterson's algorithm is wrong about Peterson's
 * algorithm, not the other way round — so specifications with settled
 * verdicts are the only way to find out whether the tool works before
 * pointing it at something whose answer you actually want.
 *
 * The three together separate two properties that are easy to confuse.
 * `spinlock` is perfectly safe — two processes are never inside at once — and
 * starves. Peterson is safe *and* starvation-free, and the difference between
 * them is the `turn` variable, which exists for no other reason.
 */

import type { Invariant, Spec } from "../src/types.js";

export interface MutexState {
  /** 0 idle, 1 flag raised, 2 waiting, 3 in the critical section. */
  readonly pc: readonly number[];
  readonly flag: readonly boolean[];
  readonly turn: number;
}

const other = (i: number): number => 1 - i;

const set = <T>(xs: readonly T[], i: number, value: T): T[] => {
  const copy = [...xs];
  copy[i] = value;
  return copy;
};

export const mutualExclusion: Invariant<MutexState> = {
  name: "at most one process in the critical section",
  reads: ["pc0", "pc1"],
  holds: (s) => s.pc.filter((pc) => pc === 3).length <= 1,
};

/** Process 0 gets in eventually — the property a spinlock fails. */
export const process0Enters: Invariant<MutexState> = {
  name: "process 0 reaches its critical section",
  reads: ["pc0"],
  holds: (s) => s.pc[0] === 3,
};

const initial: MutexState = { pc: [0, 0], flag: [false, false], turn: 0 };

/**
 * Peterson's algorithm. Raise your flag, hand the turn to the other process,
 * then wait while they want in and it is their turn.
 */
export function peterson(): Spec<MutexState> {
  const actions = [0, 1].flatMap((i) => [
    {
      name: `p${i}: raise flag`,
      process: i,
      reads: [`pc${i}`],
      writes: [`pc${i}`, `flag${i}`],
      step: (s: MutexState) =>
        s.pc[i] === 0 ? [{ ...s, pc: set(s.pc, i, 1), flag: set(s.flag, i, true) }] : [],
    },
    {
      name: `p${i}: yield turn`,
      process: i,
      reads: [`pc${i}`],
      writes: [`pc${i}`, "turn"],
      step: (s: MutexState) =>
        s.pc[i] === 1 ? [{ ...s, pc: set(s.pc, i, 2), turn: other(i) }] : [],
    },
    {
      name: `p${i}: enter`,
      process: i,
      reads: [`pc${i}`, `flag${other(i)}`, "turn"],
      writes: [`pc${i}`],
      step: (s: MutexState) =>
        s.pc[i] === 2 && !(s.flag[other(i)] === true && s.turn === other(i))
          ? [{ ...s, pc: set(s.pc, i, 3) }]
          : [],
    },
    {
      name: `p${i}: leave`,
      process: i,
      reads: [`pc${i}`],
      writes: [`pc${i}`, `flag${i}`],
      step: (s: MutexState) =>
        s.pc[i] === 3 ? [{ ...s, pc: set(s.pc, i, 0), flag: set(s.flag, i, false) }] : [],
    },
  ]);

  return {
    name: "peterson",
    processes: 2,
    init: [initial],
    actions,
    invariants: [mutualExclusion],
    show: (s) => `pc=${s.pc.join("")} flag=${s.flag.map((f) => (f ? 1 : 0)).join("")} turn=${s.turn}`,
  };
}

/**
 * The mistake everyone makes first: look before you leap.
 *
 * Checking whether the other process wants in *before* announcing that you do
 * leaves a window where both look, both see nothing, and both walk in. It is
 * a two-line change from the correct version and the counterexample is four
 * steps long.
 */
export function petersonCheckThenSet(): Spec<MutexState> {
  const actions = [0, 1].flatMap((i) => [
    {
      name: `p${i}: check the other flag`,
      process: i,
      reads: [`pc${i}`, `flag${other(i)}`],
      writes: [`pc${i}`],
      step: (s: MutexState) =>
        s.pc[i] === 0 && s.flag[other(i)] !== true ? [{ ...s, pc: set(s.pc, i, 1) }] : [],
    },
    {
      name: `p${i}: raise flag and enter`,
      process: i,
      reads: [`pc${i}`],
      writes: [`pc${i}`, `flag${i}`],
      step: (s: MutexState) =>
        s.pc[i] === 1 ? [{ ...s, pc: set(s.pc, i, 3), flag: set(s.flag, i, true) }] : [],
    },
    {
      name: `p${i}: leave`,
      process: i,
      reads: [`pc${i}`],
      writes: [`pc${i}`, `flag${i}`],
      step: (s: MutexState) =>
        s.pc[i] === 3 ? [{ ...s, pc: set(s.pc, i, 0), flag: set(s.flag, i, false) }] : [],
    },
  ]);

  return {
    name: "peterson (check then set)",
    processes: 2,
    init: [initial],
    actions,
    invariants: [mutualExclusion],
    show: (s) => `pc=${s.pc.join("")} flag=${s.flag.map((f) => (f ? 1 : 0)).join("")}`,
  };
}

/**
 * A plain lock: whoever gets there first goes in.
 *
 * Safe and unfair. Nothing stops one process from taking the lock every time
 * it comes free while the other waits forever — and because the loser's
 * acquire is *disabled* while the lock is held, weak fairness has no
 * objection. That is precisely the gap Peterson's turn variable closes.
 */
export function spinlock(): Spec<MutexState> {
  const actions = [0, 1].flatMap((i) => [
    {
      name: `p${i}: acquire`,
      process: i,
      reads: [`pc${i}`, "turn"],
      writes: [`pc${i}`, "turn"],
      // `turn` doubles as the lock: -1 free, otherwise the holder.
      step: (s: MutexState) =>
        s.pc[i] === 0 && s.turn === -1 ? [{ ...s, pc: set(s.pc, i, 3), turn: i }] : [],
    },
    {
      name: `p${i}: release`,
      process: i,
      reads: [`pc${i}`],
      writes: [`pc${i}`, "turn"],
      step: (s: MutexState) =>
        s.pc[i] === 3 ? [{ ...s, pc: set(s.pc, i, 0), turn: -1 }] : [],
    },
  ]);

  return {
    name: "spinlock",
    processes: 2,
    init: [{ pc: [0, 0], flag: [false, false], turn: -1 }],
    actions,
    invariants: [mutualExclusion],
    show: (s) => `pc=${s.pc.join("")} lock=${s.turn}`,
  };
}
