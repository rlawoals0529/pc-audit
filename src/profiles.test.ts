/**
 * The arithmetic promise, tested on its own.
 *
 * A total is only meaningful over charges that are independent of each other, and the two
 * ways to break that are both easy to write by accident: a summary finding that measures the
 * same seconds its causes measured, and a column that mixes units. Both happened here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { build } from "./report.ts";
import { PROFILES, profileById } from "./profiles.ts";
import { CHECKS } from "./checks/index.ts";
import type { Snapshot } from "./model.ts";

const sample = JSON.parse(readFileSync(new URL("../fixtures/sample.json", import.meta.url), "utf8")) as Snapshot;

describe("totals", () => {
  it("do not count a summary finding alongside the findings it summarises", () => {
    // boot-trend says the boot got 16s slower, which IS the seconds the items below cost.
    // Measuring both and adding them reported 25s of loss on a machine that had lost 9.
    const trend = CHECKS.flatMap((c) => c.run(sample)).find((f) => f.id === "boot-trend");
    expect(trend, "the fixture should still produce a trend finding").toBeDefined();
    expect(trend!.impact.measured).toEqual({});
  });

  it("never exceed the sum of the individually attributed findings", () => {
    const boot = build(sample, profileById("boot")!);
    const parts = boot.costs
      .filter((f) => f.id.startsWith("boot-degraded"))
      .map((f) => f.impact.measured.bootMs!);
    expect(parts.length).toBeGreaterThan(1);
    expect(boot.total.value).toBeCloseTo(parts.reduce((a, b) => a + b, 0), 6);
  });

  it("come with a sentence saying what summing them means", () => {
    // A number without this reads as a promise of what you would get back.
    for (const p of PROFILES) {
      expect(p.totalMeans.length, p.id).toBeGreaterThan(40);
      expect(p.totalMeans, p.id).toMatch(/exact|upper bound|counted/i);
    }
  });
});
