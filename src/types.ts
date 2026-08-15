/**
 * What a specification is.
 *
 * A model checker is only as good as what the model tells it. Two of the
 * three reductions here depend on information no analysis can recover from a
 * closure: which state variables an action touches, and which processes are
 * interchangeable. So the specification declares them.
 *
 * That is not a shortcut — TLA+ asks you to declare symmetry sets for the
 * same reason, and SPIN recovers the dependency relation only because Promela
 * restricts what a statement may do. Asking for it explicitly is the honest
 * version: the reduction is then sound with respect to what you declared, and
 * a wrong declaration is a bug in the specification rather than a silent
 * unsoundness in the tool.
 */

export type VarName = string;

export interface Action<S> {
  readonly name: string;
  /**
   * Which process performs it. Weak fairness is defined per process, and the
   * ample sets are built from one process's enabled actions at a time.
   */
  readonly process: number;
  /** State variables the action may read. */
  readonly reads: readonly VarName[];
  /** State variables the action may write. */
  readonly writes: readonly VarName[];
  /**
   * The successor states. An empty array means the action is disabled here,
   * which is how enabledness is expressed — there is no separate guard, so a
   * guard and its effect cannot drift apart.
   */
  readonly step: (state: S) => readonly S[];
}

export interface Invariant<S> {
  readonly name: string;
  /**
   * The variables the predicate looks at.
   *
   * Partial-order reduction may only drop an interleaving if the actions it
   * drops are invisible to the property being checked. Without knowing what
   * the invariant reads, every action must be assumed visible and no
   * reduction is sound.
   */
  readonly reads: readonly VarName[];
  readonly holds: (state: S) => boolean;
}

export interface Spec<S> {
  readonly name: string;
  readonly init: readonly S[];
  readonly actions: readonly Action<S>[];
  readonly invariants?: readonly Invariant<S>[];
  /**
   * A canonical representative of the state under permutations of
   * interchangeable processes. States that differ only by such a permutation
   * are then the same state, which is where the factorial goes.
   */
  readonly symmetry?: (state: S) => S;
  /** How many processes exist, for the fairness check. */
  readonly processes: number;
  /**
   * States where having nothing left to do is the correct outcome.
   *
   * A state with no enabled action is a deadlock in a system that is supposed
   * to keep running, and simply the end in a system that terminates. No
   * analysis can tell those apart — the difference is intent — so the
   * specification says which it means. Without this every terminating model
   * "deadlocks" at its final state and the report is noise.
   */
  readonly terminal?: (state: S) => boolean;
  /** Rendering for counterexample traces. */
  readonly show?: (state: S) => string;
}

export interface Step<S> {
  /** The action taken to get here; null for an initial state. */
  readonly action: string | null;
  readonly process: number | null;
  readonly state: S;
}

export type ViolationKind = "invariant" | "deadlock" | "liveness";

export interface Violation<S> {
  readonly kind: ViolationKind;
  /** The invariant's name, when one was broken. */
  readonly name?: string;
  readonly detail: string;
  /** How the checker got there. Shortest, in the exhaustive mode. */
  readonly trace: readonly Step<S>[];
  /**
   * For liveness, the cycle the system can loop in forever without ever
   * reaching the goal — the "lasso" that closes the counterexample.
   */
  readonly cycle?: readonly Step<S>[];
}

export type Mode = "exhaustive" | "reduced";

export interface Result<S> {
  readonly spec: string;
  readonly mode: Mode;
  readonly ok: boolean;
  readonly violation: Violation<S> | null;
  /** Distinct states visited. The number the reductions are judged on. */
  readonly states: number;
  readonly transitions: number;
  /** Longest distance from an initial state, in the exhaustive mode. */
  readonly depth: number;
}
