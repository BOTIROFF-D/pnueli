/**
 * Turning a state into an identity.
 *
 * Everything the checker does rests on deciding whether two states are the
 * same one. `JSON.stringify` will not do it: object key order follows
 * insertion, so `{a:1,b:2}` and `{b:2,a:1}` serialise differently while being
 * the same state, and the search would revisit half its graph forever.
 *
 * So keys are built from a canonical form with object keys sorted, and
 * `undefined` distinguished from absent. Arrays keep their order — in a state
 * an array is a sequence, and reordering it would merge states that are
 * genuinely different. Where an array really is a set of interchangeable
 * things, that is what the specification's symmetry function is for.
 */

export function stateKey(value: unknown): string {
  return canonical(value);
}

function canonical(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  const type = typeof value;
  if (type === "number") return Number.isNaN(value as number) ? "NaN" : String(value);
  if (type === "boolean" || type === "bigint") return String(value);
  if (type === "string") return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }

  if (value instanceof Set) {
    // A set has no order, so its key must not depend on insertion order.
    return `Set{${[...value].map(canonical).sort().join(",")}}`;
  }

  if (value instanceof Map) {
    return `Map{${[...value.entries()]
      .map(([k, v]) => `${canonical(k)}:${canonical(v)}`)
      .sort()
      .join(",")}}`;
  }

  if (type === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
    return `{${entries.join(",")}}`;
  }

  return String(value);
}
