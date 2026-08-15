export { checkExhaustive, checkReduced } from "./explore.js";
export { checkLiveness, buildGraph } from "./liveness.js";
export { formatResult } from "./report.js";
export { stateKey } from "./key.js";
export type {
  Action,
  Invariant,
  Mode,
  Result,
  Spec,
  Step,
  VarName,
  Violation,
  ViolationKind,
} from "./types.js";
