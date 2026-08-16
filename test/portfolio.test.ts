/**
 * The same properties the other two repositories test by sampling, proven
 * here instead.
 *
 * bulwark runs Raft under seeded partitions and crashes and checks Election
 * Safety on each run; adya generates concurrent transactions and looks for
 * dependency cycles in the histories. Both find real violations and both say
 * plainly that a clean result means "not found", not "impossible".
 *
 * These are the small instances where "impossible" is available. Every
 * reachable state is visited, so a passing check is a statement about the
 * model rather than about the schedules that happened to be drawn.
 */

import { describe, expect, it } from "vitest";
import { checkExhaustive } from "../src/index.js";
import { raftElection } from "../specs/raft-election.js";
import { writeSkew } from "../specs/write-skew.js";

describe("raft election safety", () => {
  it("holds for every reachable configuration of three nodes", () => {
    const result = checkExhaustive(raftElection({ nodes: 3, maxTerm: 3, oneVotePerTerm: true }));
    expect(result.ok).toBe(true);
    // Not a sample. Every state the model can reach.
    expect(result.states).toBeGreaterThan(2000);
    console.log(`  3 nodes, terms ≤ 3: ${result.states} states, no two leaders in a term`);
  });

  it("holds for five nodes as well", () => {
    const result = checkExhaustive(raftElection({ nodes: 5, maxTerm: 2, oneVotePerTerm: true }));
    expect(result.ok).toBe(true);
    console.log(`  5 nodes, terms ≤ 2: ${result.states} states, no two leaders in a term`);
  });

  it("fails the moment a node may vote twice in one term", () => {
    // This is bulwark's unpersisted-vote exhibit, which it reaches by killing
    // a node in the one-tick window between granting a vote and writing it
    // down. Here the same thing is simply a reachable state.
    const result = checkExhaustive(raftElection({ nodes: 3, maxTerm: 2, oneVotePerTerm: false }));
    expect(result.ok).toBe(false);
    expect(result.violation?.name).toBe("at most one leader per term");

    const actions = (result.violation?.trace ?? []).map((s) => s.action).filter(Boolean);
    // Two candidates in one term, each collecting the other's vote.
    expect(actions.filter((a) => a?.includes("stand for election"))).toHaveLength(2);
    expect(actions.filter((a) => a?.includes("vote for"))).toHaveLength(2);
    expect(actions.filter((a) => a?.includes("take office"))).toHaveLength(2);
    console.log(`  without one-vote-per-term: two leaders in ${result.violation?.trace.length} steps`);
  });
});

describe("write skew", () => {
  it("is reachable under snapshot isolation", () => {
    const result = checkExhaustive(writeSkew({ preventWriteSkew: false }));
    expect(result.ok).toBe(false);

    const trace = result.violation?.trace ?? [];
    const actions = trace.map((s) => s.action).filter(Boolean);
    // Both snapshots must be taken before either commit: that overlap is
    // what makes it skew rather than an ordinary serial execution.
    expect(actions[0]).toContain("take snapshot");
    expect(actions[1]).toContain("take snapshot");
    expect(trace[trace.length - 1]?.state).toMatchObject({ x: 0, y: 0 });
    console.log(`  snapshot isolation: constraint broken in ${trace.length} steps`);
  });

  it("is unreachable once an overtaken snapshot aborts", () => {
    const result = checkExhaustive(writeSkew({ preventWriteSkew: true }));
    expect(result.ok).toBe(true);
    console.log(`  with the abort rule: ${result.states} states, constraint always holds`);
  });
});
