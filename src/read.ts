/**
 * Reading a snapshot file, whatever encoding Windows wrote it in.
 *
 * This exists because of a bug that only a real Windows machine could have found. The
 * documented way to save a snapshot is
 *
 *     powershell -File collect\pc-audit.ps1 > report.json
 *
 * and Windows PowerShell 5.1 - the one that ships with Windows, and therefore the one most
 * people will use - writes `>` redirection as **UTF-16LE with a byte order mark**. Node reads
 * that as UTF-8 and JSON.parse fails on the first byte with a message about an unexpected
 * token that names no encoding and points nowhere useful. Every user following the README
 * would have hit it. CI on windows-latest hit it on the first green collection.
 *
 * So the reader copes rather than the reader complaining. There is no version of this where
 * telling people to add an encoding flag is better than handling the file they already have.
 */

/** Decode a file that might be UTF-8, UTF-8 with a BOM, UTF-16LE or UTF-16BE. */
export function decodeSnapshot(bytes: Uint8Array): string {
  // Byte order marks first, because they are unambiguous and cost nothing to check.
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }

  /*
   * No mark, so guess from the nulls - and only for text we already know should be JSON.
   *
   * UTF-16 encodes every ASCII character as the byte followed by a zero, so a document that
   * is mostly ASCII comes out half zeroes. Real UTF-8 JSON contains no zero bytes at all,
   * which makes this a safe test rather than a heuristic: one null in the first stretch of a
   * JSON document means it is not UTF-8.
   */
  const head = bytes.subarray(0, 64);
  const nulls = head.reduce((count, byte) => count + (byte === 0 ? 1 : 0), 0);
  if (nulls > head.length / 4) {
    // Which end the nulls sit on says which byte order it is.
    return new TextDecoder(bytes[0] === 0 ? "utf-16be" : "utf-16le").decode(bytes);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

export class SnapshotReadError extends Error {}

/** Decode and parse, with a message that names the real problem rather than the first byte. */
export function parseSnapshot(bytes: Uint8Array): unknown {
  const text = decodeSnapshot(bytes).trim();
  if (!text) throw new SnapshotReadError("the file is empty");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new SnapshotReadError(
      `that file is not valid JSON (${error instanceof Error ? error.message : String(error)}). ` +
      `If PowerShell wrote it, check it is not truncated - a collection interrupted part way ` +
      `leaves a file that starts correctly and stops mid-object.`,
    );
  }
}
