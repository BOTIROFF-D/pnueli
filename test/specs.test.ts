/**
 * Specifications whose answers were settled before this checker existed.
 *
 * If the tool disagrees with Peterson's algorithm, the tool is wrong. That is
 * the only way to find out whether it works: point it at problems the
 * literature has already decided, and check that it decides them the same
 * way — including the shape of the counterexample, not just the verdict.
 */

import { describe, expect, it } from "vitest";
import { checkExhaustive, checkLiveness } from "../src/index.js";
import { peterson, petersonCheckThenSet, spinlock, process0Enters } from "../specs/mutex.js";
import { philosophers } from "../specs/philosophers.js";
import { workers } from "../specs/workers.js";

describe("mutual exclusion", () => {
  it("holds for Peterson's algorithm", () => {
    const result = checkExhaustive(peterson());
    expect(result.ok).toBe(true);
    expect(result.states).toBeGreaterThan(10);
  });

  it("fails when the check comes before the announcement", () => {
    // Both processes look, both see a lowered flag, both walk in. The classic
    // reason the flag has to go up first.
    const result = checkExhaustive(petersonCheckThenSet());
    expect(result.ok).toBe(false);
    expect(result.violation?.kind).toBe("invariant");

    const trace = result.violation?.trace ?? [];
    // Breadth-first, so this is the shortest way to break it: two checks and
    // two entries.
    expect(trace).toHaveLength(5);
    expect(trace.filter((s) => s.action?.includes("check"))).toHaveLength(2);
    expect(trace[trace.length - 1]?.state.pc).toEqual([3, 3]);
  });

  it("holds for a plain lock too — safety is not the lock's problem", () => {
    expect(checkExhaustive(spinlock()).ok).toBe(true);
  });
});

describe("liveness under weak fairness", () => {
  it("Peterson does not starve a process", () => {
    const result = checkLiveness(peterson(), process0Enters);
    expect(result.ok).toBe(true);
  });

  it("a plain lock does", () => {
    // The counterexample is the whole reason Peterson has a turn variable:
    // process 1 can take the lock every time it comes free, and process 0's
    // acquire is disabled in between, so weak fairness never obliges anyone
    // to let it in.
    const result = checkLiveness(spinlock(), process0Enters);
    expect(result.ok).toBe(false);
    expect(result.violation?.kind).toBe("liveness");
    expect(result.violation?.detail).toMatch(/loop forever/);
    expect(result.violation?.cycle?.length).toBeGreaterThan(0);
    // The cycle must be process 1 going round on its own.
    expect(result.violation?.cycle?.every((step) => step.process === 1)).toBe(true);
  });
});

describe("dining philosophers", () => {
  it("deadlocks when everyone reaches the same way", () => {
    const result = checkExhaustive(philosophers(3, false));
    expect(result.ok).toBe(false);
    expect(result.violation?.kind).toBe("deadlock");
    // Every philosopher holding exactly one fork.
    const final = result.violation?.trace[result.violation.trace.length - 1]?.state;
    expect(final?.pc).toEqual([1, 1, 1]);
  });

  it("does not once a single philosopher reaches the other way", () => {
    expect(checkExhaustive(philosophers(3, true)).ok).toBe(true);
    expect(checkExhaustive(philosophers(4, true)).ok).toBe(true);
    expect(checkExhaustive(philosophers(5, true)).ok).toBe(true);
  });

  it("deadlocks at every size when it is symmetric", () => {
    for (const n of [3, 4, 5]) {
      expect(checkExhaustive(philosophers(n, false)).ok, `n=${n}`).toBe(false);
    }
  });
});

describe("terminating systems", () => {
  it("are not reported as deadlocked", () => {
    // Everyone finishing is the end of the run, not a system that got stuck.
    // Without the distinction every terminating model fails.
    const result = checkExhaustive(workers(3));
    expect(result.ok).toBe(true);
  });
});
