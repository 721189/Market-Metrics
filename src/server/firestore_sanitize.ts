/**
 * Firestore rejects `undefined` as a field value — writing a document that
 * contains an `undefined` key throws:
 *
 *   Value for argument "data" is not a valid Firestore document.
 *   Cannot use "undefined" as a Firestore value (found in field "target_company").
 *
 * Optional document fields (e.g. ResearchJob.target_company / competitors_input)
 * are legitimately `undefined` when a user leaves them blank, so we drop those
 * keys before every write instead of letting the whole call fail.
 *
 * Only plain objects and arrays are traversed. Class instances such as the
 * FieldValue/Timestamp sentinels (serverTimestamp(), Timestamp.fromMillis(...))
 * are returned untouched, so server-side sentinels keep working.
 */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefined(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object' && isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (val === undefined) continue;
      out[key] = stripUndefined(val);
    }
    return out as unknown as T;
  }
  return value;
}

/** True only for `{}` / `Object.create(null)` — never for class instances. */
function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
