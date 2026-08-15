/**
 * Validating the reductions.
 *
 * This is the file the rest of the project depends on, and the reason is
 * uncomfortable: a partial-order reduction that drops the wrong states
 * produces exactly the same output as one that works. Both say "no violation
 * found". One of them is a lie, and nothing inside the reduced search can
 * tell you which you have.
 *
 * The only honest answer is to keep an unreduced search that cannot be wrong,
 * and require the reduced one to agree with it on every specification small
 * enough to run both. That is what happens here. The measured state counts
 * are printed alongside, because a reduction that agrees but reduces nothing
 * is also worth knowing about.
 */

import { describe, expect, it } from "vitest";
import { checkExhaustive, checkReduced } from "../src/index.js";
import { peterson, petersonCheckThenSet, spinlock } from "../specs/mutex.js";
import { philosophers } from "../specs/philosophers.js";
import { workers, workersWithoutSymmetry } from "../specs/workers.js";
import type { Spec } from "../src/types.js";

const specs: Spec<never>[] = [
  peterson(),
  petersonCheckThenSet(),
  spinlock(),
  philosophers(3, false),
  philosophers(3, true),
  philosophers(4, false),
  philosophers(4, true),
  philosophers(5, true),
  workers(3),
  workers(4),
  workers(5),
] as unknown as Spec<never>[];

describe("reduction", () => {
  it("never changes the verdict", () => {
    for (const spec of specs) {
      const full = checkExhaustive(spec);
      const reduced = checkReduced(spec);
      expect(reduced.ok, `${spec.name}: reduced says ${reduced.ok}, exhaustive says ${full.ok}`).toBe(
        full.ok,
      );
      if (!full.ok) {
        expect(reduced.violation?.kind, spec.name).toBe(full.violation?.kind);
      }
    }
  });

  it("never explores more states than the exhaustive search", () => {
    for (const spec of specs) {
      const full = checkExhaustive(spec);
      const reduced = checkReduced(spec);
      // Both searches stop at the first violation, so only compare where the
      // whole space was actually covered.
      if (!full.ok) continue;
      expect(reduced.states, spec.name).toBeLessThanOrEqual(full.states);
    }
  });

  it("actually reduces, by the amounts the README quotes", () => {
    const rows: string[] = [];
    const measure = (label: string, plain: Spec<never>, symmetric: Spec<never>) => {
      const none = checkExhaustive(plain).states;
      const sym = checkExhaustive(symmetric).states;
      const both = checkReduced(symmetric).states;
      rows.push(
        `  ${label.padEnd(14)} ${String(none).padStart(7)} ${String(sym).padStart(9)} ${String(both).padStart(7)}   ${(none / both).toFixed(0)}×`,
      );
      return { none, sym, both };
    };

    rows.push("  spec               none  symmetry    both  factor");
    const four = measure(
      "workers(4)",
      workersWithoutSymmetry(4) as unknown as Spec<never>,
      workers(4) as unknown as Spec<never>,
    );
    const six = measure(
      "workers(6)",
      workersWithoutSymmetry(6) as unknown as Spec<never>,
      workers(6) as unknown as Spec<never>,
    );
    console.log(rows.join("\n"));

    // Symmetry alone collapses permutations of the same multiset.
    expect(four.sym).toBeLessThan(four.none / 5);
    expect(six.sym).toBeLessThan(six.none / 50);
    // Partial order then removes the interleavings of independent local steps.
    expect(six.both).toBeLessThan(six.sym / 5);
    // And the two together are worth two orders of magnitude on this shape.
    expect(six.none / six.both).toBeGreaterThan(100);
  });

  it("gives up reducing when a specification shares everything", () => {
    // Peterson's processes read and write each other's flags constantly, so
    // almost nothing is independent and there is nothing to remove. A tool
    // claiming a reduction here would be claiming something false.
    const full = checkExhaustive(peterson());
    const reduced = checkReduced(peterson());
    expect(reduced.states).toBe(full.states);
  });
});
