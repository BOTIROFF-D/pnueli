/**
 * Two searches, and why there are two.
 *
 * `checkExhaustive` visits every reachable state. It is slow and it is the
 * ground truth: whatever it says about a specification is what is true of the
 * model, and its counterexamples are shortest by construction because the
 * search is breadth-first.
 *
 * `checkReduced` visits far fewer states by refusing to explore interleavings
 * that cannot matter. That is where the interesting algorithm is, and also
 * where the danger is — a reduction that silently drops the wrong states
 * produces exactly the same output as one that works, namely "no violation
 * found", only faster. There is no way to detect that from inside.
 *
 * So the two exist as a pair. Every specification in this repository is run
 * through both, and the reduced verdict is required to match the exhaustive
 * one. The reduction is trusted because it agrees with a search that cannot
 * be wrong, on every case small enough to run both.
 */

import { stateKey } from "./key.js";
import type { Action, Result, Spec, Step, VarName, Violation } from "./types.js";

interface Node<S> {
  readonly state: S;
  readonly parent: string | null;
  readonly action: string | null;
  readonly process: number | null;
  readonly depth: number;
}

function canonicalise<S>(spec: Spec<S>, state: S): S {
  return spec.symmetry ? spec.symmetry(state) : state;
}

function enabledIn<S>(spec: Spec<S>, state: S): { action: Action<S>; next: readonly S[] }[] {
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

// ── exhaustive ──────────────────────────────────────────────────────────────

export function checkExhaustive<S>(spec: Spec<S>): Result<S> {
  const nodes = new Map<string, Node<S>>();
  const queue: string[] = [];
  let transitions = 0;
  let depth = 0;

  for (const state of spec.init) {
    const canonical = canonicalise(spec, state);
    const key = stateKey(canonical);
    if (nodes.has(key)) continue;
    nodes.set(key, { state: canonical, parent: null, action: null, process: null, depth: 0 });
    queue.push(key);
  }

  // An index rather than shift(): removing the head of an array is linear, and
  // on a state space of any size that turns the search quadratic.
  for (let head = 0; head < queue.length; head++) {
    const key = queue[head] as string;
    const node = nodes.get(key) as Node<S>;
    depth = Math.max(depth, node.depth);

    const broken = brokenInvariant(spec, node.state);
    if (broken) {
      return failed(spec, "exhaustive", nodes, queue.length, transitions, depth, {
        kind: "invariant",
        name: broken,
        detail: `invariant "${broken}" does not hold`,
        trace: traceTo(nodes, key),
      });
    }

    const enabled = enabledIn(spec, node.state);
    if (enabled.length === 0 && !(spec.terminal?.(node.state) ?? false)) {
      return failed(spec, "exhaustive", nodes, queue.length, transitions, depth, {
        kind: "deadlock",
        detail: "no action is enabled and the system cannot move",
        trace: traceTo(nodes, key),
      });
    }

    for (const { action, next } of enabled) {
      for (const successor of next) {
        transitions += 1;
        const canonical = canonicalise(spec, successor);
        const successorKey = stateKey(canonical);
        if (nodes.has(successorKey)) continue;
        nodes.set(successorKey, {
          state: canonical,
          parent: key,
          action: action.name,
          process: action.process,
          depth: node.depth + 1,
        });
        queue.push(successorKey);
      }
    }
  }

  return {
    spec: spec.name,
    mode: "exhaustive",
    ok: true,
    violation: null,
    states: nodes.size,
    transitions,
    depth,
  };
}

// ── reduced ─────────────────────────────────────────────────────────────────

/**
 * Two actions are independent when neither can affect the other: they belong
 * to different processes, and neither writes anything the other reads or
 * writes. Independent actions commute, so exploring both orders of them
 * cannot reveal anything exploring one order does not.
 */
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

/**
 * An ample set: the subset of enabled actions worth exploring here.
 *
 * Conditions, following Clarke, Grumberg and Peled:
 *
 *   C0  if anything is enabled, the ample set is non-empty — otherwise the
 *       search would invent deadlocks that do not exist
 *   C1  nothing outside the ample set that depends on something inside it can
 *       run before something inside it runs. Checked structurally: no action
 *       of any other process is dependent on the chosen ones. That is
 *       conservative — it rejects some sets that would have been legal — and
 *       conservative is the correct direction to be wrong in
 *   C2  the chosen actions are invisible to the property, meaning they write
 *       nothing any invariant reads. An action that can change the truth of
 *       what is being checked cannot be commuted away
 *   C3  the cycle proviso, handled by the caller: an ample set whose every
 *       successor is already on the search stack may postpone an action
 *       forever, so it is rejected and the state expanded in full
 */
function ampleSet<S>(
  spec: Spec<S>,
  enabled: { action: Action<S>; next: readonly S[] }[],
  visibleVars: ReadonlySet<VarName>,
): { action: Action<S>; next: readonly S[] }[] {
  const byProcess = new Map<number, { action: Action<S>; next: readonly S[] }[]>();
  for (const entry of enabled) {
    const list = byProcess.get(entry.action.process) ?? [];
    list.push(entry);
    byProcess.set(entry.action.process, list);
  }

  let best: { action: Action<S>; next: readonly S[] }[] | null = null;

  for (const [process, candidate] of byProcess) {
    // C2 — invisible to every invariant.
    if (candidate.some((e) => e.action.writes.some((w) => visibleVars.has(w)))) continue;

    // C1 — nothing another process does may depend on these.
    const clashes = spec.actions.some(
      (other) =>
        other.process !== process && candidate.some((e) => !independent(e.action, other)),
    );
    if (clashes) continue;

    if (!best || candidate.length < best.length) best = candidate;
  }

  return best ?? enabled;
}

export function checkReduced<S>(spec: Spec<S>): Result<S> {
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

    let chosen = ampleSet(spec, enabled, visibleVars);
    let successors = materialise(chosen);

    // C3 — if every successor is already on the stack, this ample set closes a
    // cycle and could starve the actions it postponed. Expand in full instead.
    if (chosen.length < enabled.length && successors.every((s) => onStack.has(s.key))) {
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
    if (!("successors" in first)) {
      return failed(spec, "reduced", nodes, 0, transitions, depth, first);
    }
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
      if (!("successors" in next)) {
        return failed(spec, "reduced", nodes, 0, transitions, depth, next);
      }
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

// ── shared ──────────────────────────────────────────────────────────────────

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

function failed<S>(
  spec: Spec<S>,
  mode: Result<S>["mode"],
  nodes: ReadonlyMap<string, unknown>,
  _queued: number,
  transitions: number,
  depth: number,
  violation: Violation<S>,
): Result<S> {
  return {
    spec: spec.name,
    mode,
    ok: false,
    violation,
    states: nodes.size,
    transitions,
    depth,
  };
}
