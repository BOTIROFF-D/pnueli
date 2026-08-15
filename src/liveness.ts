/**
 * Liveness: does something good eventually happen?
 *
 * Safety is a reachability question — is there a path to a bad state — and
 * breadth-first search answers it. Liveness is not. "The system always
 * eventually reaches the goal" is violated by an infinite run that never
 * does, and an infinite run in a finite state space is a lasso: a path into a
 * cycle, then the cycle forever.
 *
 * So the search is for a reachable strongly connected component containing no
 * goal state. That alone is not enough, because most such cycles are absurd —
 * they require a process that could run to simply never be scheduled. Weak
 * fairness rules those out: if a process is continuously enabled it must
 * eventually move. A cycle is therefore a real counterexample only if every
 * process either moves somewhere inside it, or is disabled somewhere inside
 * it and so has no claim to being scheduled.
 *
 * Without that condition every concurrent program "fails" liveness, and the
 * checker would be useless.
 */

import { stateKey } from "./key.js";
import type { Invariant, Result, Spec, Step, Violation } from "./types.js";

interface Edge {
  readonly to: string;
  readonly action: string;
  readonly process: number;
}

interface GraphNode<S> {
  readonly state: S;
  readonly edges: Edge[];
  /** Which processes have at least one enabled action here. */
  readonly enabledProcesses: Set<number>;
}

export function buildGraph<S>(spec: Spec<S>): {
  nodes: Map<string, GraphNode<S>>;
  initial: string[];
} {
  const canonical = (state: S): S => (spec.symmetry ? spec.symmetry(state) : state);
  const nodes = new Map<string, GraphNode<S>>();
  const initial: string[] = [];
  const queue: { key: string; state: S }[] = [];

  for (const state of spec.init) {
    const c = canonical(state);
    const key = stateKey(c);
    if (nodes.has(key)) continue;
    nodes.set(key, { state: c, edges: [], enabledProcesses: new Set() });
    initial.push(key);
    queue.push({ key, state: c });
  }

  for (let head = 0; head < queue.length; head++) {
    const { key, state } = queue[head] as { key: string; state: S };
    const node = nodes.get(key) as GraphNode<S>;

    for (const action of spec.actions) {
      const successors = action.step(state);
      if (successors.length === 0) continue;
      node.enabledProcesses.add(action.process);

      for (const successor of successors) {
        const c = canonical(successor);
        const successorKey = stateKey(c);
        if (!nodes.has(successorKey)) {
          nodes.set(successorKey, { state: c, edges: [], enabledProcesses: new Set() });
          queue.push({ key: successorKey, state: c });
        }
        node.edges.push({ to: successorKey, action: action.name, process: action.process });
      }
    }
  }

  return { nodes, initial };
}

export function checkLiveness<S>(spec: Spec<S>, goal: Invariant<S>): Result<S> {
  const { nodes, initial } = buildGraph(spec);
  const transitions = [...nodes.values()].reduce((n, node) => n + node.edges.length, 0);

  // The counterexample must avoid the goal forever, so it lives entirely
  // inside the subgraph of states where the goal does not hold.
  const outside = new Set<string>();
  for (const [key, node] of nodes) if (!goal.holds(node.state)) outside.add(key);

  // A run that simply stops without ever reaching the goal violates it just
  // as surely as one that loops forever. Finite counterexamples are easy to
  // forget about and are usually the shortest ones.
  for (const key of outside) {
    const node = nodes.get(key) as GraphNode<S>;
    if (node.edges.length > 0) continue;
    const prefix = pathBetween(nodes, initial, key, null);
    if (prefix.length === 0 && !initial.includes(key)) continue;
    return {
      spec: spec.name,
      mode: "exhaustive",
      ok: false,
      violation: {
        kind: "liveness",
        name: goal.name,
        detail: `the system can stop here without ever reaching "${goal.name}"`,
        trace: prefix.map((step) => renderStep(nodes, step)),
      },
      states: nodes.size,
      transitions,
      depth: prefix.length,
    };
  }

  for (const component of sccs(nodes, outside)) {
    if (!hasCycle(nodes, component)) continue;

    const verdict = fairness(spec, nodes, component);
    if (!verdict.fair) continue;

    const entry = reachableEntry(nodes, initial, component);
    if (!entry) continue;

    const prefix = pathBetween(nodes, initial, entry, null);
    const cycle = fairCycle(nodes, component, entry, verdict.required);
    if (!cycle) continue;

    const violation: Violation<S> = {
      kind: "liveness",
      name: goal.name,
      detail:
        `the system can loop forever without ever reaching "${goal.name}". ` +
        `The cycle is fair: ${verdict.explanation}`,
      trace: prefix.map((step) => renderStep(nodes, step)),
      cycle: cycle.map((step) => renderStep(nodes, step)),
    };

    return {
      spec: spec.name,
      mode: "exhaustive",
      ok: false,
      violation,
      states: nodes.size,
      transitions,
      depth: prefix.length,
    };
  }

  return {
    spec: spec.name,
    mode: "exhaustive",
    ok: true,
    violation: null,
    states: nodes.size,
    transitions,
    depth: 0,
  };
}

interface WalkStep {
  readonly key: string;
  readonly action: string | null;
  readonly process: number | null;
}

function renderStep<S>(nodes: ReadonlyMap<string, GraphNode<S>>, step: WalkStep): Step<S> {
  return {
    action: step.action,
    process: step.process,
    state: (nodes.get(step.key) as GraphNode<S>).state,
  };
}

/** Tarjan, restricted to a subset of the graph. */
function sccs<S>(
  nodes: ReadonlyMap<string, GraphNode<S>>,
  inside: ReadonlySet<string>,
): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const found: string[][] = [];
  let counter = 0;

  const visit = (key: string): void => {
    index.set(key, counter);
    low.set(key, counter);
    counter += 1;
    stack.push(key);
    onStack.add(key);

    for (const edge of nodes.get(key)?.edges ?? []) {
      if (!inside.has(edge.to)) continue;
      if (!index.has(edge.to)) {
        visit(edge.to);
        low.set(key, Math.min(low.get(key) as number, low.get(edge.to) as number));
      } else if (onStack.has(edge.to)) {
        low.set(key, Math.min(low.get(key) as number, index.get(edge.to) as number));
      }
    }

    if (low.get(key) === index.get(key)) {
      const component: string[] = [];
      for (;;) {
        const member = stack.pop() as string;
        onStack.delete(member);
        component.push(member);
        if (member === key) break;
      }
      found.push(component);
    }
  };

  for (const key of inside) if (!index.has(key)) visit(key);
  return found;
}

/** A single state is only a cycle if it can step to itself. */
function hasCycle<S>(nodes: ReadonlyMap<string, GraphNode<S>>, component: string[]): boolean {
  if (component.length > 1) return true;
  const only = component[0] as string;
  return (nodes.get(only)?.edges ?? []).some((edge) => edge.to === only);
}

/**
 * Weak fairness: a process that is continuously enabled must eventually move.
 * So a cycle is a legitimate counterexample only if, for every process, it
 * either moves inside the cycle or is disabled at some state of it.
 */
function fairness<S>(
  spec: Spec<S>,
  nodes: ReadonlyMap<string, GraphNode<S>>,
  component: string[],
): { fair: boolean; required: Edge[]; explanation: string } {
  const inside = new Set(component);
  const moves = new Map<number, Edge>();
  const disabledSomewhere = new Set<number>();

  for (const key of component) {
    const node = nodes.get(key) as GraphNode<S>;
    for (const edge of node.edges) {
      if (inside.has(edge.to) && !moves.has(edge.process)) moves.set(edge.process, edge);
    }
    for (let p = 0; p < spec.processes; p++) {
      if (!node.enabledProcesses.has(p)) disabledSomewhere.add(p);
    }
  }

  const starved: number[] = [];
  for (let p = 0; p < spec.processes; p++) {
    if (!moves.has(p) && !disabledSomewhere.has(p)) starved.push(p);
  }

  const explanation =
    starved.length > 0
      ? `process ${starved.join(", ")} would have to be starved`
      : [
          moves.size > 0 ? `processes ${[...moves.keys()].join(", ")} keep moving` : null,
          disabledSomewhere.size > 0
            ? `processes ${[...disabledSomewhere].join(", ")} are blocked`
            : null,
        ]
          .filter(Boolean)
          .join("; ");

  return { fair: starved.length === 0, required: [...moves.values()], explanation };
}

function reachableEntry<S>(
  nodes: ReadonlyMap<string, GraphNode<S>>,
  initial: readonly string[],
  component: readonly string[],
): string | null {
  const target = new Set(component);
  const seen = new Set<string>(initial);
  const queue = [...initial];
  for (let head = 0; head < queue.length; head++) {
    const key = queue[head] as string;
    if (target.has(key)) return key;
    for (const edge of nodes.get(key)?.edges ?? []) {
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      queue.push(edge.to);
    }
  }
  return null;
}

/**
 * Shortest walk from any of `from` to `to`, optionally confined to a subset.
 *
 * An ordinary breadth-first search with a parent map. Reconstructing the path
 * by looking for plausible predecessors afterwards would be shorter to write
 * and wrong: several states can reach the same successor by the same action,
 * and picking whichever one is found first can produce a "path" whose steps
 * do not join up.
 */
function pathBetween<S>(
  nodes: ReadonlyMap<string, GraphNode<S>>,
  from: readonly string[],
  to: string,
  inside: ReadonlySet<string> | null,
): WalkStep[] {
  if (from.includes(to)) return [{ key: to, action: null, process: null }];

  const parent = new Map<string, { prev: string; action: string; process: number }>();
  const seen = new Set<string>(from);
  const queue = [...from];

  for (let head = 0; head < queue.length && !seen.has(to); head++) {
    const key = queue[head] as string;
    for (const edge of nodes.get(key)?.edges ?? []) {
      if (inside && !inside.has(edge.to)) continue;
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      parent.set(edge.to, { prev: key, action: edge.action, process: edge.process });
      queue.push(edge.to);
    }
  }

  if (!parent.has(to)) return [];

  const walk: WalkStep[] = [];
  let cursor = to;
  for (;;) {
    const step = parent.get(cursor);
    if (!step) {
      walk.push({ key: cursor, action: null, process: null });
      break;
    }
    walk.push({ key: cursor, action: step.action, process: step.process });
    cursor = step.prev;
  }
  return walk.reverse();
}

/**
 * A cycle through the component that actually discharges the fairness
 * obligations — it takes at least one transition of every process that has to
 * move. A shortest cycle would be prettier and would not always be a
 * counterexample.
 */
function fairCycle<S>(
  nodes: ReadonlyMap<string, GraphNode<S>>,
  component: readonly string[],
  entry: string,
  required: readonly Edge[],
): WalkStep[] | null {
  const inside = new Set(component);
  const walk: WalkStep[] = [];
  let cursor = entry;

  for (const edge of required) {
    const source = [...inside].find((key) =>
      (nodes.get(key)?.edges ?? []).some(
        (e) => e.to === edge.to && e.process === edge.process && e.action === edge.action,
      ),
    );
    if (source === undefined) continue;

    if (source !== cursor) {
      const leg = pathBetween(nodes, [cursor], source, inside);
      walk.push(...leg.slice(1));
    }
    walk.push({ key: edge.to, action: edge.action, process: edge.process });
    cursor = edge.to;
  }

  if (cursor !== entry) {
    const back = pathBetween(nodes, [cursor], entry, inside);
    walk.push(...back.slice(1));
  }

  return walk.length > 0 ? walk : null;
}
