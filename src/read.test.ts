/**
 * The encodings a Windows machine will actually hand you.
 *
 * Every case here is one somebody can produce without doing anything unusual: `>` in
 * Windows PowerShell 5.1 gives UTF-16LE with a mark, `Out-File -Encoding utf8` in the same
 * shell gives UTF-8 WITH a mark, and PowerShell 7 gives UTF-8 without one. All three are the
 * documented command on somebody's machine.
 */
import { describe, expect, it } from "vitest";
import { decodeSnapshot, parseSnapshot, SnapshotReadError } from "./read.ts";

const json = '{"schema":1,"real":true,"collectedAt":"2026-09-12T09:00:00Z"}';

const utf8 = (text: string) => new TextEncoder().encode(text);
const withBom = (bom: number[], body: Uint8Array) => Uint8Array.from([...bom, ...body]);

/** What PowerShell 5.1's `>` produces: UTF-16LE, byte then zero, with a mark in front. */
function utf16le(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    out[i * 2] = text.charCodeAt(i) & 0xff;
    out[i * 2 + 1] = text.charCodeAt(i) >> 8;
  }
  return out;
}

function utf16be(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    out[i * 2] = text.charCodeAt(i) >> 8;
    out[i * 2 + 1] = text.charCodeAt(i) & 0xff;
  }
  return out;
}

describe("decoding a snapshot", () => {
  it("reads plain UTF-8, which is what PowerShell 7 writes", () => {
    expect(decodeSnapshot(utf8(json))).toBe(json);
  });

  it("reads UTF-8 with a byte order mark, which is what Out-File -Encoding utf8 writes on 5.1", () => {
    expect(decodeSnapshot(withBom([0xef, 0xbb, 0xbf], utf8(json)))).toBe(json);
  });

  it("reads UTF-16LE with a mark, which is what `>` writes on Windows PowerShell 5.1", () => {
    // The bug this file exists for. Without it, JSON.parse fails on byte one with a message
    // that names no encoding, and every reader following the README hits it.
    expect(decodeSnapshot(withBom([0xff, 0xfe], utf16le(json)))).toBe(json);
  });

  it("reads UTF-16BE with a mark", () => {
    expect(decodeSnapshot(withBom([0xfe, 0xff], utf16be(json)))).toBe(json);
  });

  it("reads UTF-16 with no mark at all, from the nulls", () => {
    // Redirection through some shells drops the mark and keeps the encoding.
    expect(decodeSnapshot(utf16le(json))).toBe(json);
    expect(decodeSnapshot(utf16be(json))).toBe(json);
  });

  it("does not mistake ordinary UTF-8 for UTF-16", () => {
    // The null test has to be safe in the other direction, or a perfectly good file is
    // mangled into nonsense and the error message blames the JSON.
    const wide = '{"name":"éèê 你好 😀","schema":1}';
    expect(decodeSnapshot(utf8(wide))).toBe(wide);
  });
});

describe("parsing", () => {
  it("parses each encoding into the same object", () => {
    for (const bytes of [
      utf8(json),
      withBom([0xef, 0xbb, 0xbf], utf8(json)),
      withBom([0xff, 0xfe], utf16le(json)),
      withBom([0xfe, 0xff], utf16be(json)),
    ]) {
      expect(parseSnapshot(bytes)).toEqual({ schema: 1, real: true, collectedAt: "2026-09-12T09:00:00Z" });
    }
  });

  it("says the file is empty rather than complaining about JSON", () => {
    expect(() => parseSnapshot(utf8("   "))).toThrow(SnapshotReadError);
    expect(() => parseSnapshot(utf8("   "))).toThrow(/empty/);
  });

  it("suggests truncation, which is what a stopped collection actually looks like", () => {
    expect(() => parseSnapshot(utf8('{"schema":1,"services":[{"name":'))).toThrow(/truncated/);
  });
});
