/**
 * Making a snapshot's lists behave like lists.
 *
 * PowerShell's ConvertTo-Json unwraps a single-element array into a bare object. A machine
 * with two displays sends `"displays": [{...}, {...}]`; a machine with one sends
 * `"displays": {...}`, and nothing in the document says which you are about to get - it
 * depends on how much hardware the reader happens to own.
 *
 * This was found by CI on a real Windows runner with one display, and it would have broken
 * every check on any machine with exactly one of anything: one display, one GPU, one drive,
 * one boot record on a fresh install. The collector cannot reliably fix it at the source on
 * Windows PowerShell 5.1, and even if it could, snapshots already written by the version that
 * did not would still be out there. So the reader copes, the same way it copes with UTF-16.
 */

/**
 * Whatever a field holds, as an array.
 *
 * `null` and `undefined` become empty, an array passes through, and anything else - the
 * unwrapped single element - is wrapped back up. Deliberately not a type guard on the
 * contents: a check that wants to know whether a field is usable asks about the field it
 * needs, because a snapshot from an older collector is missing fields rather than lying
 * about them.
 */
export function list<T>(value: T[] | T | null | undefined): T[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  return [value];
}
