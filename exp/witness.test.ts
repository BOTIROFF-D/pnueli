/**
 * Are the ample-set conditions load-bearing?
 *
 * `ablation.test.ts` removes one condition at a time from every specification
 * in `specs/` and finds that no verdict changes. The honest reading of that is
 * not "the conditions are redundant" but "this portfolio does not test them".
 *
 * So here the specifications are generated instead of chosen, in the shape
 * where a condition has somewhere to go wrong (see `generate.ts`), and the
 * question is asked directly: is there a model on which removing this
 * condition loses a reachable violation? For C2 and C3 the answer is yes, and
 * the smallest witness is printed together with the counterexample it throws
 * away.
 *
 * For C1 the answer is that this search did not find one. That is reported as
 * what it is — a null result of a bounded search, not a discovery.
 *
 *   npm run exp
 */

import { describe, expect, it } from "vitest";
import { checkExhaustive } from "../src/index.js";
import { ALL, checkAblated, verdict } from "./ablated.js";
import { generate } from "./generate.js";

/** Per density. Five densities, so five times this many models in total. */
const TRIALS = 20_000;
const DENSITIES = [0.2, 0.35, 0.5, 0.65, 0.8];
const CONDITIONS = [
  { label: "−C1", cond: { c1: false, c2: true, c3: true } },
  { label: "−C2", cond: { c1: true, c2: false, c3: true } },
  { label: "−C3", cond: { c1: true, c2: true, c3: false } },
];

interface Witness {
  readonly seed: number;
  readonly density: number;
  readonly states: number;
}

const pad = (s: string | number, n: number) => String(s).padStart(n);

describe("necessity of the ample-set conditions", () => {
  it("finds witnesses for C2 and C3, and none for C1", () => {
    const smallest: Record<string, Witness | null> = { "−C1": null, "−C2": null, "−C3": null };
    const totals: Record<string, number> = { "−C1": 0, "−C2": 0, "−C3": 0 };
    let baselineDisagreements = 0;
    let compared = 0;

    console.log("\n  density | models | baseline wrong |    −C1 |    −C2 |    −C3");
    console.log("  --------+--------+----------------+--------+--------+-------");

    for (const density of DENSITIES) {
      const hits: Record<string, number> = { "−C1": 0, "−C2": 0, "−C3": 0 };

      for (let seed = 1; seed <= TRIALS; seed++) {
        const { spec } = generate(seed, density);
        const truth = checkExhaustive(spec);
        const truthVerdict = verdict(truth);

        // The reduced search is only worth comparing where the unreduced one
        // is the arbiter, and it always is — that is the whole point of
        // keeping it. Asserted on every model rather than assumed.
        const baseline = checkAblated(spec, ALL);
        if (verdict(baseline) !== truthVerdict) {
          baselineDisagreements += 1;
          continue;
        }
        compared += 1;

        for (const { label, cond } of CONDITIONS) {
          const ablated = checkAblated(spec, cond);
          if (verdict(ablated) === truthVerdict) continue;
          hits[label] = (hits[label] ?? 0) + 1;
          totals[label] = (totals[label] ?? 0) + 1;
          const current = smallest[label];
          if (!current || ablated.states < current.states) {
            smallest[label] = { seed, density, states: ablated.states };
          }
        }
      }

      console.log(
        `  ${pad(density, 7)} | ${pad(TRIALS, 6)} | ${pad(baselineDisagreements, 14)} | ` +
          `${pad(hits["−C1"] ?? 0, 6)} | ${pad(hits["−C2"] ?? 0, 6)} | ${pad(hits["−C3"] ?? 0, 6)}`,
      );
    }

    // The strongest statement in this repository about the reduced search
    // being right: a hundred thousand independent comparisons against a search
    // that cannot be wrong, and not one disagreement.
    expect(baselineDisagreements, "the full configuration must never disagree").toBe(0);
    expect(compared).toBe(TRIALS * DENSITIES.length);

    for (const { label, cond } of CONDITIONS) {
      const found = smallest[label];
      if (!found) {
        console.log(`\n  ${label}: no witness at any density`);
        continue;
      }

      const { spec, meta } = generate(found.seed, found.density);
      const truth = checkExhaustive(spec);
      const ablated = checkAblated(spec, cond);

      console.log(
        `\n  ${label}: smallest witness is seed ${found.seed} at density ${found.density}` +
          `\n     ${meta.processes} processes, ${meta.variables} variables, program length ` +
          `${meta.programLength}, invariant reads ${meta.invariantReads.map((v) => `v${v}`).join(", ")}` +
          `\n     exhaustive:        ${truth.states} states, ${verdict(truth)}` +
          `\n     without ${label.slice(1)}:        ${ablated.states} states, ${verdict(ablated)}` +
          "\n     the counterexample that is thrown away:",
      );
      for (const step of truth.violation?.trace ?? []) {
        console.log(
          `       ${(step.action ?? "(initial)").padEnd(10)} ${spec.show?.(step.state) ?? ""}`,
        );
      }
    }

    // C2 governs visibility, so the denser the invariant the more often it is
    // the condition doing the rejecting. C3 governs cycles, and the denser the
    // invariant the more often C2 has already rejected the candidate before C3
    // could matter. The two move in opposite directions, which is why the
    // sweep exists at all — at any single density one of them looks harmless.
    expect(totals["−C2"], "C2 must be necessary somewhere").toBeGreaterThan(0);
    expect(totals["−C3"], "C3 must be necessary somewhere").toBeGreaterThan(0);

    // And the null result, pinned so a change in either direction shows up.
    // C1 is necessary in the theory; this search does not exhibit it, for two
    // reasons worth stating rather than hiding. The implementation's C1 is a
    // structural over-approximation, so it rejects sets a sharper test would
    // allow — conservative, and therefore hard to refute. And in this family
    // C1 and C2 overlap almost entirely: a candidate satisfying C2 writes only
    // invisible variables, which here are nearly always private, and private
    // implies independent. Loading C1 on its own needs a shared but unobserved
    // variable, which this generator produces rarely.
    expect(totals["−C1"], "no C1 witness — a null result, not a proof").toBe(0);

    console.log(
      "\n  C2 and C3: necessary, with reproducible minimal witnesses.\n" +
        `  C1: no witness in ${(TRIALS * DENSITIES.length).toLocaleString("en-US")} models. ` +
        "Absence of a witness is not absence of a\n" +
        "      requirement — C1 is necessary in the theory, and this experiment lacks the\n" +
        "      power to show it. The comment above says why.",
    );
  }, 600_000);
});
