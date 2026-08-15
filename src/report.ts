/**
 * Rendering a counterexample.
 *
 * A model checker that says "violated" and stops is barely more useful than a
 * type error with no location. The value is the trace: the exact sequence of
 * actions, from the initial state, that gets there — and for liveness, the
 * cycle it can then repeat forever.
 */

import type { Result, Step } from "./types.js";

export function formatResult<S>(result: Result<S>, show?: (state: S) => string): string {
  const head =
    `${result.spec} [${result.mode}] — ` +
    `${result.states} states, ${result.transitions} transitions` +
    (result.depth > 0 ? `, depth ${result.depth}` : "");

  if (result.ok || !result.violation) return `✓ ${head}`;

  const render = show ?? ((state: S) => JSON.stringify(state));
  const lines = [`✗ ${head}`, `  ${result.violation.detail}`, "", "  trace"];
  lines.push(...result.violation.trace.map((step) => renderStep(step, render)));

  if (result.violation.cycle && result.violation.cycle.length > 0) {
    lines.push("", "  then forever");
    lines.push(...result.violation.cycle.map((step) => renderStep(step, render)));
  }

  return lines.join("\n");
}

function renderStep<S>(step: Step<S>, show: (state: S) => string): string {
  const label = step.action === null ? "(initial)" : step.action;
  return `    ${label.padEnd(34)} ${show(step.state)}`;
}
