/**
 * Raft leader election, as a specification.
 *
 * [bulwark](https://github.com/BOTIROFF-D/bulwark) implements Raft and tests
 * Election Safety by sampling schedules: hundreds of seeded runs with
 * partitions, crashes and reordered messages. That finds bugs and, as its own
 * README says, is a very good fuzz run rather than a theorem.
 *
 * This is the theorem, for a small instance. Three nodes, terms bounded, no
 * message passing — voting is atomic, which is sound here because Election
 * Safety is a property of who holds what vote, not of when the messages
 * arrive. Every reachable configuration is visited, so a clean result means
 * no execution of this model can elect two leaders in one term.
 *
 * The rule doing the work is one vote per term (§5.2). It is switchable, and
 * the museum entry is that switching it off produces a counterexample in four
 * steps — the same failure bulwark reaches by crashing a node in a one-tick
 * window between granting a vote and persisting it.
 */

import type { Spec } from "../src/types.js";

export interface ElectionState {
  /** 0 follower, 1 candidate, 2 leader. */
  readonly role: readonly number[];
  readonly term: readonly number[];
  /** Who this node voted for in its current term, or -1. */
  readonly votedFor: readonly number[];
  /** Bitmask of nodes that have voted for this candidate this term. */
  readonly votes: readonly number[];
}

const set = (xs: readonly number[], i: number, value: number): number[] => {
  const copy = [...xs];
  copy[i] = value;
  return copy;
};

const popcount = (mask: number): number => {
  let n = 0;
  for (let m = mask; m > 0; m >>= 1) n += m & 1;
  return n;
};

export interface ElectionOptions {
  readonly nodes: number;
  /** Terms are bounded, or the state space is infinite. */
  readonly maxTerm: number;
  /**
   * §5.2 — a node grants at most one vote per term.
   *
   * This single rule is what makes Election Safety true: two candidates in
   * the same term would each need a majority, and two majorities of the same
   * set must overlap, so some node would have to vote twice.
   */
  readonly oneVotePerTerm: boolean;
}

export function raftElection(options: ElectionOptions): Spec<ElectionState> {
  const { nodes, maxTerm, oneVotePerTerm } = options;
  const majority = Math.floor(nodes / 2) + 1;
  const ids = Array.from({ length: nodes }, (_, i) => i);

  const initial: ElectionState = {
    role: ids.map(() => 0),
    term: ids.map(() => 0),
    votedFor: ids.map(() => -1),
    votes: ids.map(() => 0),
  };

  const actions = ids.flatMap((i) => [
    {
      // A node's election timer fires: new term, votes for itself.
      name: `n${i}: stand for election`,
      process: i,
      reads: [`term${i}`, `role${i}`],
      writes: [`term${i}`, `role${i}`, `votedFor${i}`, `votes${i}`],
      step: (s: ElectionState) => {
        const term = s.term[i] as number;
        if (term >= maxTerm) return [];
        return [
          {
            role: set(s.role, i, 1),
            term: set(s.term, i, term + 1),
            votedFor: set(s.votedFor, i, i),
            votes: set(s.votes, i, 1 << i),
          },
        ];
      },
    },

    {
      // A node with a majority of votes takes office.
      name: `n${i}: take office`,
      process: i,
      reads: [`role${i}`, `votes${i}`],
      writes: [`role${i}`],
      step: (s: ElectionState) =>
        s.role[i] === 1 && popcount(s.votes[i] as number) >= majority
          ? [{ ...s, role: set(s.role, i, 2) }]
          : [],
    },

    // Every node may vote for every candidate. Modelled atomically: the
    // decision and its effect on the candidate's tally happen together,
    // which is sound because Election Safety only cares about which votes
    // exist, not about when the messages carrying them arrive.
    ...ids
      .filter((candidate) => candidate !== i)
      .map((candidate) => ({
        name: `n${i}: vote for n${candidate}`,
        process: i,
        reads: [`term${i}`, `votedFor${i}`, `role${candidate}`, `term${candidate}`],
        writes: [`term${i}`, `role${i}`, `votedFor${i}`, `votes${candidate}`],
        step: (s: ElectionState) => {
          if (s.role[candidate] !== 1) return [];
          const myTerm = s.term[i] as number;
          const theirTerm = s.term[candidate] as number;
          if (theirTerm < myTerm) return [];

          // §5.2 — already spent this term's vote on somebody else.
          const fresh = theirTerm > myTerm;
          if (oneVotePerTerm && !fresh) {
            const spent = s.votedFor[i];
            if (spent !== -1 && spent !== candidate) return [];
          }

          return [
            {
              // Seeing a newer term makes a node a follower in it (§5.1).
              role: fresh ? set(s.role, i, 0) : s.role,
              term: set(s.term, i, theirTerm),
              votedFor: set(s.votedFor, i, candidate),
              votes: set(s.votes, candidate, (s.votes[candidate] as number) | (1 << i)),
            },
          ];
        },
      })),
  ]);

  return {
    name: `raft election (${nodes} nodes, terms ≤ ${maxTerm}${oneVotePerTerm ? "" : ", one-vote-per-term OFF"})`,
    processes: nodes,
    init: [initial],
    actions,
    invariants: [
      {
        name: "at most one leader per term",
        reads: ids.flatMap((i) => [`role${i}`, `term${i}`]),
        holds: (s) => {
          for (let a = 0; a < nodes; a++) {
            if (s.role[a] !== 2) continue;
            for (let b = a + 1; b < nodes; b++) {
              if (s.role[b] === 2 && s.term[a] === s.term[b]) return false;
            }
          }
          return true;
        },
      },
    ],
    // Running out of terms is the edge of the model, not a stuck cluster. A
    // node below the bound can always stand for election, so this is only
    // ever consulted once every node has reached it.
    terminal: (s) => s.term.every((t) => t >= maxTerm),
    show: (s) =>
      s.role
        .map((role, i) => `n${i}:${"fcl"[role as number]}${s.term[i]}${s.votedFor[i] === -1 ? "" : `→${s.votedFor[i]}`}`)
        .join(" "),
  };
}
