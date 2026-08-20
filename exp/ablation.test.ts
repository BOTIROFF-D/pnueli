/**
 * What the reductions cost and what they are worth.
 *
 * The README quotes two rows of a table. This measures the whole shape: each
 * reduction alone, both together, the price per state, and the specifications
 * where the answer is that they are worth nothing at all.
 *
 * The state counts are assertions rather than observations, on purpose. They
 * are exact functions of n, and a run that produced different ones would mean
 * something changed in the search rather than in the machine — which is worth
 * failing over. The timings are printed and asserted on nothing; they are the
 * one part of this file that a different machine will not reproduce.
 *
 *   npm run exp
 */

import { describe, expect, it } from "vitest";
import { checkExhaustive, checkReduced } from "../src/index.js";
import { peterson, petersonCheckThenSet, spinlock } from "../specs/mutex.js";
import { philosophers } from "../specs/philosophers.js";
import { workers, workersWithoutSymmetry } from "../specs/workers.js";
import { raftElection } from "../specs/raft-election.js";
import { writeSkew } from "../specs/write-skew.js";
import type { Spec } from "../src/types.js";
import { ABLATIONS, ALL, checkAblated, verdict } from "./ablated.js";

const anySpec = <S,>(spec: Spec<S>) => spec as unknown as Spec<never>;

/** Median of a few runs. Enough to keep one unlucky GC pause out of the table. */
function timed<T>(fn: () => T, runs = 5): { value: T; ms: number } {
  const samples: number[] = [];
  let value!: T;
  for (let i = 0; i < runs; i++) {
    const started = performance.now();
    value = fn();
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  return { value, ms: samples[Math.floor(samples.length / 2)] as number };
}

const pad = (s: string | number, n: number) => String(s).padStart(n);
const padEnd = (s: string | number, n: number) => String(s).padEnd(n);

/** n choose k, for the closed form of the symmetry-reduced count. */
function choose(n: number, k: number): number {
  let acc = 1;
  for (let i = 0; i < k; i++) acc = (acc * (n - i)) / (i + 1);
  return Math.round(acc);
}

describe("what each reduction is worth", () => {
  it("turns 5^n into 4n+1, but only when both are on", () => {
    console.log("\n  n |     none |  symmetry |      POR |     both | none/both | t(none) | t(both)");
    console.log("  ---+----------+-----------+----------+----------+-----------+---------+--------");

    for (let n = 2; n <= 8; n++) {
      const plain = anySpec(workersWithoutSymmetry(n));
      const symmetric = anySpec(workers(n));
      const runs = n >= 7 ? 3 : 5;

      const none = timed(() => checkExhaustive(plain), runs);
      const symmetry = timed(() => checkExhaustive(symmetric), runs);
      const por = timed(() => checkReduced(plain), runs);
      const both = timed(() => checkReduced(symmetric), runs);

      console.log(
        `  ${n} | ${pad(none.value.states, 8)} | ${pad(symmetry.value.states, 9)} | ` +
          `${pad(por.value.states, 8)} | ${pad(both.value.states, 8)} | ` +
          `${pad(`${(none.value.states / both.value.states).toFixed(0)}×`, 9)} | ` +
          `${pad(none.ms.toFixed(1), 7)} | ${pad(both.ms.toFixed(1), 6)}`,
      );

      // Each column is an exact closed form, and each says which source of
      // combinatorics its reduction removes.
      //
      //   none      5^n            every worker in every phase, told apart
      //   symmetry  C(n+4, 4)      multisets of n workers over 5 phases
      //   POR       2^n + 3n       identities kept, interleavings dropped
      //   both      4n + 1         neither identity nor order survives
      //
      // The pair matters more than either row: one reduction alone leaves the
      // other's exponential standing, so the choice between them is not a
      // choice — it is both or neither.
      expect(none.value.states, `none, n=${n}`).toBe(5 ** n);
      expect(symmetry.value.states, `symmetry, n=${n}`).toBe(choose(n + 4, 4));
      expect(por.value.states, `POR, n=${n}`).toBe(2 ** n + 3 * n);
      expect(both.value.states, `both, n=${n}`).toBe(4 * n + 1);
    }
  });

  it("charges about twice per state for the privilege", () => {
    console.log("\n  n | µs/state none | µs/state both | ratio");
    console.log("  ---+---------------+---------------+------");

    const ratios: number[] = [];
    for (let n = 3; n <= 7; n++) {
      const none = timed(() => checkExhaustive(anySpec(workersWithoutSymmetry(n))), 3);
      const both = timed(() => checkReduced(anySpec(workers(n))), 3);
      const perNone = (none.ms * 1000) / none.value.states;
      const perBoth = (both.ms * 1000) / both.value.states;
      ratios.push(perBoth / perNone);
      console.log(
        `  ${n} | ${pad(perNone.toFixed(2), 13)} | ${pad(perBoth.toFixed(2), 13)} | ` +
          `${pad(`${(perBoth / perNone).toFixed(1)}×`, 5)}`,
      );
    }

    // Canonicalising is a sort and the ample set is a quadratic scan, so a
    // reduced state costs more than an unreduced one. The point of measuring
    // it is that the overhead is a constant factor rather than a growing one:
    // where the reduction wins it wins by orders of magnitude, and where it
    // does not, this is the whole bill.
    const worst = Math.max(...ratios);
    expect(worst, "per-state overhead should stay a small constant").toBeLessThan(4);
  });
});

describe("where the reductions are worth nothing", () => {
  it("gives up on specifications that share everything", () => {
    const portfolio = [
      { label: "peterson", spec: anySpec(peterson()), reduces: false },
      { label: "spinlock", spec: anySpec(spinlock()), reduces: false },
      { label: "philosophers(3)", spec: anySpec(philosophers(3, true)), reduces: false },
      { label: "philosophers(4)", spec: anySpec(philosophers(4, true)), reduces: false },
      { label: "philosophers(5)", spec: anySpec(philosophers(5, true)), reduces: false },
      { label: "workers(4)", spec: anySpec(workers(4)), reduces: true },
      { label: "workers(6)", spec: anySpec(workers(6)), reduces: true },
      {
        label: "raft(3, term<=2)",
        spec: anySpec(raftElection({ nodes: 3, maxTerm: 2, oneVotePerTerm: true })),
        reduces: false,
      },
      {
        label: "raft(3, term<=3)",
        spec: anySpec(raftElection({ nodes: 3, maxTerm: 3, oneVotePerTerm: true })),
        reduces: false,
      },
      {
        label: "raft(5, term<=2)",
        spec: anySpec(raftElection({ nodes: 5, maxTerm: 2, oneVotePerTerm: true })),
        reduces: false,
      },
    ];

    console.log("\n  specification     | exhaustive |  reduced | factor | t(exh) | t(red)");
    console.log("  ------------------+------------+----------+--------+--------+-------");

    for (const { label, spec, reduces } of portfolio) {
      const full = timed(() => checkExhaustive(spec), 3);
      const reduced = timed(() => checkReduced(spec), 3);
      const factor = full.value.states / reduced.value.states;

      console.log(
        `  ${padEnd(label, 17)} | ${pad(full.value.states, 10)} | ${pad(reduced.value.states, 8)} | ` +
          `${pad(`${factor.toFixed(2)}×`, 6)} | ${pad(full.ms.toFixed(1), 6)} | ${pad(reduced.ms.toFixed(1), 6)}`,
      );

      // Seven of these ten reduce by exactly nothing, and that is the correct
      // answer: Peterson's processes read each other's flags, the philosophers
      // share forks, and a Raft node's vote and term are everybody's business.
      // Independent actions are what the reduction removes, and there are none.
      // A tool reporting a saving here would be reporting one that is not real.
      if (reduces) expect(factor, label).toBeGreaterThan(1);
      else expect(reduced.value.states, label).toBe(full.value.states);
    }

    console.log(
      "\n  Seven of ten reduce by 1.00× and still pay the per-state overhead:\n" +
        "  turning partial-order reduction on by default is not a free insurance policy.",
    );
  });
});

describe("ablation on the repository's own portfolio", () => {
  it("does not distinguish the conditions, and says why", () => {
    const cases = [
      { label: "peterson", spec: anySpec(peterson()) },
      { label: "peterson (check-then-set)", spec: anySpec(petersonCheckThenSet()) },
      { label: "spinlock", spec: anySpec(spinlock()) },
      { label: "philosophers(3) deadlock", spec: anySpec(philosophers(3, false)) },
      { label: "philosophers(4) deadlock", spec: anySpec(philosophers(4, false)) },
      { label: "philosophers(5) deadlock", spec: anySpec(philosophers(5, false)) },
      { label: "philosophers(3) safe", spec: anySpec(philosophers(3, true)) },
      { label: "philosophers(4) safe", spec: anySpec(philosophers(4, true)) },
      { label: "workers(4)", spec: anySpec(workers(4)) },
      { label: "workers(6)", spec: anySpec(workers(6)) },
      {
        label: "raft(3) safe",
        spec: anySpec(raftElection({ nodes: 3, maxTerm: 2, oneVotePerTerm: true })),
      },
      {
        label: "raft(3) no vote rule",
        spec: anySpec(raftElection({ nodes: 3, maxTerm: 2, oneVotePerTerm: false })),
      },
      { label: "write skew", spec: anySpec(writeSkew({ preventWriteSkew: false })) },
      { label: "write skew fixed", spec: anySpec(writeSkew({ preventWriteSkew: true })) },
    ];

    console.log(
      "\n  specification             | truth            |" +
        ABLATIONS.map((a) => ` ${padEnd(a.label, 9)}|`).join(""),
    );
    console.log(
      "  --------------------------+------------------+" + ABLATIONS.map(() => "----------+").join(""),
    );

    let singleConditionDisagreements = 0;
    let allOffDisagreements = 0;

    for (const { label, spec } of cases) {
      const truth = checkExhaustive(spec);
      const truthVerdict = verdict(truth);

      const baseline = checkAblated(spec, ALL);
      expect(verdict(baseline), `${label}: baseline must agree with the unreduced search`).toBe(
        truthVerdict,
      );

      const cells = ABLATIONS.map(({ label: name, cond }) => {
        const result = checkAblated(spec, cond);
        const agrees = verdict(result) === truthVerdict;
        if (!agrees) {
          if (name === "−all") allOffDisagreements += 1;
          else singleConditionDisagreements += 1;
        }
        return padEnd(`${result.states}${agrees ? "" : " x"}`, 9) + "|";
      });

      console.log(
        `  ${padEnd(label, 25)} | ${padEnd(`${truth.states} (${truthVerdict})`, 16)} | ${cells.join(" ")}`,
      );
    }

    // The negative result, and the reason this file has a second half.
    //
    // Removing any one condition changes no verdict anywhere in the portfolio.
    // That is not evidence the conditions are redundant — it is evidence that
    // these specifications never load them. They are textbook problems, and
    // they sit at the two extremes: either everything is shared, so the ample
    // set is already the full enabled set, or everything is private, so every
    // condition holds without being asked. The shape in between is what
    // `conditions.test.ts` generates.
    expect(singleConditionDisagreements, "no single condition binds on this portfolio").toBe(0);
    expect(allOffDisagreements, "removing all three must lose violations").toBeGreaterThan(0);

    console.log(
      `\n  Removing one condition: ${singleConditionDisagreements} disagreements.\n` +
        `  Removing all three:     ${allOffDisagreements} disagreements.\n` +
        "  A portfolio of textbook problems does not put the conditions under load.\n" +
        "  Note the rows where an ablated search visited 3 states of 12 and still\n" +
        "  agreed: agreeing is not the same as being right.",
    );
  });
});
