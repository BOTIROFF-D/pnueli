/**
 * `checkReduced` with the ample-set conditions on switches.
 *
 * The reductions are trusted because they agree with the unreduced search.
 * That answers "is this implementation right" and leaves a different question
 * open: is every condition in it actually doing something, or is one of them
 * inherited from the paper and never binding?
 *
 * The only way to find out is to remove one and look. So this is a copy of
 * `src/explore.ts`'s reduced search with C1, C2 and C3 behind flags, and it is
 * deliberately a copy rather than a refactor of the original — the searches
 * being compared must not share a code path, or a bug in the shared part would
 * cancel itself out and the comparison would prove nothing.
 *
 * C0 has no flag. Without it the ample set may be empty where actions are
 * enabled, and the search reports deadlocks that do not exist — not a subtle
 * unsoundness, just a broken checker.
 */

import { stateKey } from "../src/index.js";
import type { Action, Result, Spec, Step, VarName, Violation } from "../src/types.js";

export interface Conditions {
  /** Nothing outside the ample set may depend on something inside it. */
  readonly c1: boolean;
  /** The chosen actions write nothing an invariant reads. */
  readonly c2: boolean;
  /** The cycle proviso: reject an ample set whose successors are all on the stack. */
  readonly c3: boolean;
}

export const ALL: Conditions = { c1: true, c2: true, c3: true };

export const ABLATIONS: readonly { label: string; cond: Conditions }[] = [
  { label: "−C1", cond: { c1: false, c2: true, c3: true } },
  { label: "−C2", cond: { c1: true, c2: false, c3: true } },
  { label: "−C3", cond: { c1: true, c2: true, c3: false } },
  { label: "−all", cond: { c1: false, c2: false, c3: false } },
];

interface Node<S> {
  readonly state: S;
  readonly parent: string | null;
  readonly action: string | null;
  readonly process: number | null;
  readonly depth: number;
}

const canonicalise = <S,>(spec: Spec<S>, state: S): S =>
  spec.symmetry ? spec.symmetry(state) : state;

function enabledIn<S>(spec: Spec<S>, state: S) {
  const enabled: { action: Action<S>; next: readonly S[] }[] = [];
  for (const action of spec.actions) {
    const next = action.step(state);
    if (next.length > 0) enabled.push({ action, next });
  }
  return enabled;
}

function brokenInvariant<S>(spec: Spec<S>, state: S): string | null {
  for (const invariant of spec.invariants ?? []) {
    if (!invariant.holds(state)) return invariant.name;
  }
  return null;
}

function independent<S>(a: Action<S>, b: Action<S>): boolean {
  if (a.process === b.process) return false;
  const writesA = new Set(a.writes);
  const writesB = new Set(b.writes);
  for (const v of b.reads) if (writesA.has(v)) return false;
  for (const v of b.writes) if (writesA.has(v)) return false;
  for (const v of a.reads) if (writesB.has(v)) return false;
  for (const v of a.writes) if (writesB.has(v)) return false;
  return true;
}

function ampleSet<S>(
  spec: Spec<S>,
  enabled: { action: Action<S>; next: readonly S[] }[],
  visibleVars: ReadonlySet<VarName>,
  cond: Conditions,
) {
  const byProcess = new Map<number, { action: Action<S>; next: readonly S[] }[]>();
  for (const entry of enabled) {
    const list = byProcess.get(entry.action.process) ?? [];
    list.push(entry);
    byProcess.set(entry.action.process, list);
  }

  let best: { action: Action<S>; next: readonly S[] }[] | null = null;

  for (const [process, candidate] of byProcess) {
    if (cond.c2 && candidate.some((e) => e.action.writes.some((w) => visibleVars.has(w)))) continue;
    if (
      cond.c1 &&
      spec.actions.some(
        (other) => other.process !== process && candidate.some((e) => !independent(e.action, other)),
      )
    )
      continue;
    if (!best || candidate.length < best.length) best = candidate;
  }

  return best ?? enabled; // C0
}

function traceTo<S>(nodes: ReadonlyMap<string, Node<S>>, key: string): Step<S>[] {
  const steps: Step<S>[] = [];
  let cursor: string | null = key;
  while (cursor !== null) {
    const node: Node<S> | undefined = nodes.get(cursor);
    if (!node) break;
    steps.push({ action: node.action, process: node.process, state: node.state });
    cursor = node.parent;
  }
  return steps.reverse();
}

export function checkAblated<S>(spec: Spec<S>, cond: Conditions): Result<S> {
  const visibleVars = new Set<VarName>();
  for (const invariant of spec.invariants ?? []) {
    for (const v of invariant.reads) visibleVars.add(v);
  }

  const nodes = new Map<string, Node<S>>();
  const onStack = new Set<string>();
  let transitions = 0;
  let depth = 0;

  interface Frame {
    readonly key: string;
    readonly state: S;
    readonly successors: { key: string; state: S; action: Action<S> }[];
    index: number;
  }

  const failure = (violation: Violation<S>): Result<S> => ({
    spec: spec.name,
    mode: "reduced",
    ok: false,
    violation,
    states: nodes.size,
    transitions,
    depth,
  });

  const expand = (key: string, state: S): Frame | Violation<S> => {
    const broken = brokenInvariant(spec, state);
    if (broken) {
      return {
        kind: "invariant",
        name: broken,
        detail: `invariant "${broken}" does not hold`,
        trace: traceTo(nodes, key),
      };
    }

    const enabled = enabledIn(spec, state);
    if (enabled.length === 0 && (spec.terminal?.(state) ?? false)) {
      return { key, state, successors: [], index: 0 };
    }
    if (enabled.length === 0) {
      return {
        kind: "deadlock",
        detail: "no action is enabled and the system cannot move",
        trace: traceTo(nodes, key),
      };
    }

    const materialise = (chosen: typeof enabled) => {
      const out: { key: string; state: S; action: Action<S> }[] = [];
      for (const { action, next } of chosen) {
        for (const successor of next) {
          const canonical = canonicalise(spec, successor);
          out.push({ key: stateKey(canonical), state: canonical, action });
        }
      }
      return out;
    };

    let chosen = ampleSet(spec, enabled, visibleVars, cond);
    let successors = materialise(chosen);

    if (cond.c3 && chosen.length < enabled.length && successors.every((s) => onStack.has(s.key))) {
      chosen = enabled;
      successors = materialise(chosen);
    }

    return { key, state, successors, index: 0 };
  };

  const stack: Frame[] = [];

  for (const initial of spec.init) {
    const canonical = canonicalise(spec, initial);
    const key = stateKey(canonical);
    if (nodes.has(key)) continue;
    nodes.set(key, { state: canonical, parent: null, action: null, process: null, depth: 0 });

    const first = expand(key, canonical);
    if (!("successors" in first)) return failure(first);
    stack.push(first);
    onStack.add(key);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1] as Frame;
      if (frame.index >= frame.successors.length) {
        onStack.delete(frame.key);
        stack.pop();
        continue;
      }

      const edge = frame.successors[frame.index++] as {
        key: string;
        state: S;
        action: Action<S>;
      };
      transitions += 1;
      if (nodes.has(edge.key)) continue;

      const parentDepth = (nodes.get(frame.key) as Node<S>).depth;
      nodes.set(edge.key, {
        state: edge.state,
        parent: frame.key,
        action: edge.action.name,
        process: edge.action.process,
        depth: parentDepth + 1,
      });
      depth = Math.max(depth, parentDepth + 1);

      const next = expand(edge.key, edge.state);
      if (!("successors" in next)) return failure(next);
      stack.push(next);
      onStack.add(edge.key);
    }
  }

  return {
    spec: spec.name,
    mode: "reduced",
    ok: true,
    violation: null,
    states: nodes.size,
    transitions,
    depth,
  };
}

/** The verdict, reduced to the one word the comparisons are made on. */
export function verdict<S>(result: Result<S>): string {
  return result.ok ? "ok" : (result.violation?.kind ?? "?");
}
