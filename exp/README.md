# exp — measuring the reductions

```bash
npm run exp
```

Not part of `npm test`. The suite in [`test/`](../test) checks that the
checker is right; this measures what the reductions are worth, which is a
different question and answers it in numbers that depend on the machine.

## What is here

| file | what it does |
| --- | --- |
| [`ablated.ts`](./ablated.ts) | `checkReduced` with C1, C2 and C3 behind flags |
| [`generate.ts`](./generate.ts) | deterministic generator of small specifications |
| [`ablation.test.ts`](./ablation.test.ts) | what each reduction is worth, and what it costs |
| [`witness.test.ts`](./witness.test.ts) | whether each condition is load-bearing |

`ablated.ts` is a copy of the reduced search from [`src/explore.ts`](../src/explore.ts),
not a refactor of it. Two searches being compared must not share a code path,
or a bug in the shared part cancels itself out and the comparison proves
nothing.

## What it found

**Each reduction removes a different exponential, and only the pair is
linear.** On `workers(n)` every column is an exact closed form, asserted for
n = 2…8:

| mode | states | growth |
| --- | --- | --- |
| none | 5ⁿ | exponential, base 5 |
| symmetry only | C(n+4, 4) | polynomial, degree 4 |
| partial order only | 2ⁿ + 3n | exponential, base 2 |
| both | 4n + 1 | linear |

Symmetry collapses *which* worker; partial order collapses *in which order*.
Either one alone leaves the other's exponential standing, so choosing between
them is not a choice — it is both or neither.

**A reduced state costs about twice an unreduced one**, and the overhead is a
constant factor rather than a growing one. Where the reduction wins it wins by
four orders of magnitude and the overhead is invisible; where it does not win,
the overhead is the entire result.

**Seven specifications out of ten reduce by exactly 1.00×** and still pay it.
Peterson's processes read each other's flags, philosophers share forks, a Raft
node's vote and term are everybody's business — there is nothing independent
to remove, and reporting a saving there would be reporting one that is not
real. Turning partial-order reduction on by default is not free insurance.

**C2 and C3 are load-bearing; C1 was not shown to be.** Removing one condition
at a time changes no verdict anywhere in `specs/` — those are textbook
problems and they never load the conditions. On a hundred thousand generated
models, removing C2 or C3 does lose reachable violations, and the smallest
witness for each is printed with the counterexample it throws away. Removing
C1 lost nothing, which is a null result of a bounded search rather than a
finding: C1 here is a structural over-approximation and overlaps C2 almost
entirely on this family. `witness.test.ts` says so at the assertion.

**The full configuration did not disagree with the unreduced search once** in
100,000 comparisons.

## Reproducing a witness

Every model is a seed. `generate(7266, 0.8)` and `generate(87, 0.2)` are the
minimal witnesses for C2 and C3; nothing consults the clock, so they are the
same specifications on any machine.
