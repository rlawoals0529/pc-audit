/**
 * The shape a real Windows machine sends, which is not always the shape the schema describes.
 *
 * PowerShell's ConvertTo-Json unwraps a single-element array into a bare object, so how a
 * snapshot is shaped depends on how much hardware the reader owns. Two displays give you an
 * array; one display gives you an object. CI on a runner with exactly one display is what
 * found this, and it would have broken every check on any machine with one of anything.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { list } from "./shape.ts";
import { build } from "./report.ts";
import { profileById } from "./profiles.ts";
import type { Snapshot } from "./model.ts";

const sample = JSON.parse(readFileSync(new URL("../fixtures/sample.json", import.meta.url), "utf8")) as Snapshot;

/** What ConvertTo-Json does to a snapshot on a machine with one of everything. */
function unwrapSingles(value: unknown): unknown {
  if (Array.isArray(value)) {
    const mapped = value.map(unwrapSingles);
    return mapped.length === 1 ? mapped[0] : mapped;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unwrapSingles(v)]));
  }
  return value;
}

describe("list", () => {
  it("passes an array through", () => {
    expect(list([1, 2])).toEqual([1, 2]);
  });

  it("wraps the bare object PowerShell sends when there is exactly one", () => {
    expect(list({ name: "one" })).toEqual([{ name: "one" }]);
  });

  it("treats a missing field as empty, which is not the same as a field holding nothing", () => {
    expect(list(undefined)).toEqual([]);
    expect(list(null)).toEqual([]);
  });

  it("does not unwrap an empty array into a one-element list", () => {
    expect(list([])).toEqual([]);
  });
});

describe("a snapshot from a machine with one of everything", () => {
  // The fixture has two displays, so unwrapping it leaves that field an array. A runner with
  // exactly one display is the case that broke, so the snapshot under test has to have one.
  const oneOfEach = { ...sample, displays: [sample.displays![0]!], gpu: [sample.gpu![0]!] };
  const single = unwrapSingles(oneOfEach) as Snapshot;

  it("is the shape this is about: displays came back as an object, not an array", () => {
    // Asserted rather than assumed. The first version assumed it and was quietly exercising an
    // ordinary two-element array: it proved nothing while reporting that it proved everything.
    expect(Array.isArray((single as { displays?: unknown }).displays)).toBe(false);
    expect(Array.isArray((single as { gpu?: unknown }).gpu)).toBe(false);
  });

  it("produces a report rather than crashing a check", () => {
    // The real failure: "(snapshot.displays ?? []).entries is not a function", which the
    // report turns into a check-failed risk - so the run went green everywhere except the one
    // CI step that looks for those.
    const report = build(single, profileById("default")!);
    const crashed = report.risks.filter((f) => f.id.startsWith("check-failed:"));
    expect(crashed.map((f) => f.title)).toEqual([]);
  });

  it("finds the single display the same way it would find it in an array", () => {
    const report = build(single, profileById("fps")!);
    expect(report.costs.some((f) => f.id.startsWith("display-refresh"))).toBe(true);
  });
});
