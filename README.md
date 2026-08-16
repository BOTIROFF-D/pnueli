# pnueli

**An explicit-state model checker.** Exhaustive search, symmetry reduction, partial-order reduction and liveness under weak fairness — with every reduction validated against the unreduced search it is supposed to replace.

[![CI](https://github.com/BOTIROFF-D/pnueli/actions/workflows/ci.yml/badge.svg)](https://github.com/BOTIROFF-D/pnueli/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40botiroff%2Fpnueli)](https://www.npmjs.com/package/@botiroff/pnueli)
![node](https://img.shields.io/badge/node-%E2%89%A518-blue)
![license](https://img.shields.io/badge/license-MIT-blue)

Named for [Amir Pnueli](https://amturing.acm.org/award_winners/pnueli_4725172.cfm), who won the Turing Award for introducing temporal logic to program verification and gave the field the language to ask whether something *always* holds or *eventually* happens.

---

This exists because of a sentence in [unflake](https://github.com/BOTIROFF-D/unflake)'s limits section:

> Hundreds of seeds is hundreds of schedules from an astronomically larger space. It is a very good fuzz run, not a theorem.

Sampling schedules finds bugs and can never prove their absence. Proving absence means visiting every reachable state — which is exponential, which is why the interesting part of a model checker is not the search but everything done to avoid searching.

## The reductions, measured

```
spec               none  symmetry    both  factor
workers(4)          625        70      17     37×
workers(6)        15625       210      25    625×
```

**Symmetry reduction.** When processes are interchangeable, states differing only by permuting them are the same state. Six workers each in one of five phases is 5⁶ = 15,625 assignments but only 210 multisets, and the checker never needs to know which worker is which.

**Partial-order reduction.** When two actions touch nothing in common they commute, so exploring both orders reveals nothing exploring one does not. This is done with ample sets, whose four conditions each earn their place — drop C2 and the checker will confidently miss violations. They are spelled out in [`explore.ts`](./src/explore.ts).

And on a specification where processes read and write each other's variables constantly, the reduction correctly does nothing at all:

```
peterson             20        20      20      1×
```

That row is in the test suite as an assertion. A tool that claimed a reduction there would be claiming something false.

## Why there are two searches

A partial-order reduction that drops the wrong states produces exactly the same output as one that works. Both say *no violation found*. One of them is a lie, and nothing inside the reduced search can tell you which you are holding.

So the exhaustive search is kept — slow, complete, and unable to be wrong — and **every specification here is run through both, with the reduced verdict required to match**. The reduction is trusted because it agrees with something that cannot be mistaken, on every case small enough to run both. That check is [`test/reduction.test.ts`](./test/reduction.test.ts) and it is the file the rest of the project rests on.

## Specifications with settled answers

The other way to find out whether a checker works is to point it at problems the literature already decided.

| Specification | Expected | Found |
| --- | --- | --- |
| Peterson's algorithm | mutual exclusion holds | holds, 20 states |
| Peterson, check-then-set | mutual exclusion fails | fails, 4-step counterexample |
| Plain spinlock | safe but starves | safe; starvation counterexample |
| Dining philosophers | deadlocks | deadlocks at n = 3, 4, 5 |
| Philosophers, one lefty | no deadlock | none at n = 3, 4, 5 |

The counterexamples are the output that matters, and breadth-first search makes them shortest by construction:

```
✗ peterson (check then set) — invariant "at most one process in the critical section"

  trace
    (initial)                    pc=00 flag=00
    p0: check the other flag     pc=10 flag=00
    p1: check the other flag     pc=11 flag=00
    p0: raise flag and enter     pc=31 flag=10
    p1: raise flag and enter     pc=33 flag=11
```

Both look, both see a lowered flag, both walk in. That is the whole reason the flag has to go up first.

## Proving what the other repositories sample

[bulwark](https://github.com/BOTIROFF-D/bulwark) tests Raft's Election Safety by running the implementation under seeded partitions, crashes and reordered messages. [adya](https://github.com/BOTIROFF-D/adya) finds write skew by generating concurrent transactions and looking for dependency cycles in the histories. Both work, and both say plainly that a clean result means *not found*, not *impossible*.

Here are the same two properties on instances small enough for *impossible* to be available.

| Property | Sampled | Proven here |
| --- | --- | --- |
| Election Safety, 3 nodes, terms ≤ 3 | hundreds of schedules | **2,428 states**, exhaustive |
| Election Safety, 5 nodes, terms ≤ 2 | hundreds of schedules | **148,318 states**, exhaustive |
| Election Safety, 5 nodes, terms ≤ 3 | hundreds of schedules | **6,801,084 states**, exhaustive |
| Write skew under snapshot isolation | found at seed 25 of 300 | reachable in **5 steps**, shortest |

And the failure modes line up with the ones bulwark had to construct by hand. Its unpersisted-vote exhibit crashes a node in the one-tick window between granting a vote and writing it down — a window a random search never lands in, so bulwark builds that scenario directly. Take the same rule out of the specification and it is simply a reachable state:

```
✗ raft election (3 nodes, terms ≤ 2, one-vote-per-term OFF)
  invariant "at most one leader per term" does not hold

  trace
    (initial)                 n0:f0 n1:f0 n2:f0
    n0: stand for election    n0:c1→0 n1:f0   n2:f0
    n1: stand for election    n0:c1→0 n1:c1→1 n2:f0
    n0: vote for n1           n0:c1→1 n1:c1→1 n2:f0
    n1: take office           n0:c1→1 n1:l1→1 n2:f0
    n1: vote for n0           n0:c1→1 n1:l1→0 n2:f0
    n0: take office           n0:l1→1 n1:l1→0 n2:f0
```

Two candidates in term 1, each collecting the other's vote. One vote per term is the only thing standing between that and a split brain — and this is what "only thing" means, stated over every reachable configuration rather than over the ones a seed happened to produce.

The specifications are [`specs/raft-election.ts`](./specs/raft-election.ts) and [`specs/write-skew.ts`](./specs/write-skew.ts); the checks are [`test/portfolio.test.ts`](./test/portfolio.test.ts).

**What this does not prove.** The specification is not the implementation. bulwark's Raft has message loss, duplication, reordering, crash-restart and persistence; this model has none of them, and voting is atomic. A proof about the model is a proof that the *algorithm* is sound at that level of abstraction — it says nothing about whether the code implements the algorithm. That is what the sampling is for, and why both exist.

## Liveness

Safety asks whether a bad state is reachable, and breadth-first search answers it. Liveness asks whether something good always eventually happens, and it is violated by an infinite run that never gets there — in a finite state space, a lasso: a path into a cycle, then the cycle forever.

Most such cycles are absurd, though. They require a process that could run to simply never be scheduled. **Weak fairness** rules those out: a continuously enabled process must eventually move. So a cycle is a real counterexample only if every process either moves inside it or is blocked inside it. Without that condition every concurrent program "fails" liveness and the checker is useless.

The difference shows up exactly where it should — between a lock and Peterson's algorithm:

```
✗ spinlock — can loop forever without process 0 reaching its critical section
  The cycle is fair: process 1 keeps moving; process 0 is blocked

  then forever
    p1: acquire   pc=03 lock=1
    p1: release   pc=00 lock=-1
```

Peterson passes the same check. The turn variable exists for no other reason.

## Usage

```bash
npm install @botiroff/pnueli
```

```ts
import { checkExhaustive, checkReduced, checkLiveness, formatResult } from "@botiroff/pnueli";

const spec = {
  name: "counter",
  processes: 2,
  init: [{ n: 0 }],
  actions: [
    {
      name: "p0: increment",
      process: 0,
      reads: ["n"],
      writes: ["n"],
      step: (s) => (s.n < 3 ? [{ n: s.n + 1 }] : []),
    },
  ],
  invariants: [{ name: "n stays small", reads: ["n"], holds: (s) => s.n <= 3 }],
  terminal: (s) => s.n === 3,
};

console.log(formatResult(checkExhaustive(spec)));
```

An action returns its successor states; an empty array means it is disabled, so a guard and its effect cannot drift apart. `reads` and `writes` are what the partial-order reduction needs, and `symmetry` is what the symmetry reduction needs — declared rather than guessed, for the same reason TLA+ asks you to declare symmetry sets. A wrong declaration is then a bug in the specification, not a silent unsoundness in the tool.

## Limits

**TLC and SPIN are better at this.** They have decades of work behind them, disk-backed state storage, distributed checking, full LTL, and specification languages designed for the job. This is a few hundred lines you can read in an afternoon, which is the only thing it offers that they do not.

**Reductions are sound with respect to what you declare.** If an action writes a variable it did not list, the partial-order reduction may drop states that mattered. There is no analysis here that recovers dependencies from a closure — the declaration is the contract.

**The C1 check is conservative.** It asks structurally whether any action of another process is dependent on the candidate set, rather than reasoning about which of them can actually run next. That rejects some legal ample sets and so reduces less than it could. Conservative is the correct direction to be wrong in.

**Only invariants and one liveness form.** State predicates that must always hold, and "eventually P" under weak fairness. No nested temporal operators, no strong fairness, no LTL.

**Everything is in memory.** State spaces here are thousands of states, not billions. There is no disk-backed store and no symbolic representation.

**No predicate abstraction, no counterexample-guided refinement.** The model you write is the model that is checked.

## Prior art

The algorithms are standard and old, and pretending otherwise would be silly. Partial-order reduction and the ample-set conditions are from [Clarke, Grumberg and Peled's *Model Checking*](https://mitpress.mit.edu/9780262038836/model-checking/); the persistent-set idea is Godefroid's, the stubborn-set variant Valmari's. Symmetry reduction is Clarke, Filkorn and Jha, and Emerson and Sistla. Weak fairness and the temporal framing are Pnueli's, by way of Lamport.

[TLA+ and TLC](https://lamport.azurewebsites.net/tla/tla.html) and [SPIN](https://spinroot.com/) are where this is done properly.

Part of a set: [unflake](https://github.com/BOTIROFF-D/unflake) samples schedules, [bulwark](https://github.com/BOTIROFF-D/bulwark) tests consensus with them, [adya](https://github.com/BOTIROFF-D/adya) tests transaction isolation — and this proves small instances outright instead of sampling.

## Who wrote this

[Doniyor Botirov](https://dbit.one/en/founder), founder of [dbit.one](https://dbit.one/en). The reasoning behind this repository at length — why a green suite says "not found" rather than "not there", and what closes that gap: [Tests do not prove the absence of a bug](https://dbit.one/en/blog/model-checking-proving-absence-of-bugs).

## License

MIT
