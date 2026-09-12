/**
 * The tests that matter here are not "does it add up". They are the two promises the README
 * makes: that a profile answers the question you asked and drops the rest, and that a number
 * never appears in a column it was not measured for.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { build, describeTotal } from "./report.ts";
import { PROFILES, profileById, rank, relevantTo } from "./profiles.ts";
import { CHECKS } from "./checks/index.ts";
import { REFUSALS } from "./refusals.ts";
import { DIMENSIONS, type Snapshot } from "./model.ts";

const sample = JSON.parse(readFileSync(new URL("../fixtures/sample.json", import.meta.url), "utf8")) as Snapshot;
const profile = (id: string) => profileById(id)!;

describe("the fixture", () => {
  it("is marked synthetic, so no demo built on it can be mistaken for a real machine", () => {
    expect(sample.real).toBe(false);
  });
});

describe("checks", () => {
  it("every one returns nothing on an empty snapshot instead of throwing", () => {
    // A machine where every source was denied is a real machine, not a bad input.
    const bare: Snapshot = { schema: 1, collectedAt: "2026-09-12T09:00:00Z", real: true };
    for (const check of CHECKS) expect(check.run(bare), check.id).toEqual([]);
  });

  it("never puts a number in a dimension it also calls unquantified", () => {
    // The two halves of Impact mean opposite things. An id in both is a contradiction, and
    // the one that would survive into the total is the fabricated one.
    for (const check of CHECKS) {
      for (const finding of check.run(sample)) {
        for (const dimension of finding.impact.unquantified) {
          expect(finding.impact.measured[dimension], `${finding.id} ${dimension}`).toBeUndefined();
        }
      }
    }
  });

  it("never measures a dimension that does not exist, or a value that is not a number", () => {
    for (const check of CHECKS) {
      for (const finding of check.run(sample)) {
        for (const [dimension, value] of Object.entries(finding.impact.measured)) {
          expect(DIMENSIONS, `${finding.id}`).toContain(dimension);
          expect(Number.isFinite(value), `${finding.id} ${dimension} = ${value}`).toBe(true);
          expect(value, `${finding.id} ${dimension}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("gives every finding a stable, unique id", () => {
    const ids = CHECKS.flatMap((c) => c.run(sample)).map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("backs every measured number with a source that says what was read", () => {
    /*
     * The closest a test can get to "this number is not made up".
     *
     * Nothing can mechanically prove a figure came from somewhere, but a check that measures a
     * dimension and cites no reading for it is either fabricating or has lost its evidence,
     * and both are worth failing on. A source note is the string a reader follows to go and
     * check the number themselves, which is the whole basis on which this report asks to be
     * believed.
     */
    for (const check of CHECKS) {
      for (const finding of check.run(sample)) {
        if (!Object.keys(finding.impact.measured).length) continue;
        const noted = finding.sources.filter((s) => s.note && s.note.length > 3);
        expect(noted.length, `${finding.id} measures something but cites no reading`).toBeGreaterThan(0);
      }
    }
  });

  it("cites a source for everything, because the report shows its working", () => {
    for (const check of CHECKS) {
      for (const finding of check.run(sample)) {
        expect(finding.sources.length, finding.id).toBeGreaterThan(0);
        for (const source of finding.sources) expect(source.from, finding.id).toBeTruthy();
      }
    }
  });
});

describe("profiles", () => {
  it("answer different questions about the same machine", () => {
    const fps = build(sample, profile("fps"));
    const boot = build(sample, profile("boot"));
    const fpsIds = fps.costs.map((f) => f.id);
    const bootIds = boot.costs.map((f) => f.id);

    // The refresh rate is the whole point of the fps profile and is silent about startup.
    expect(fpsIds.some((id) => id.startsWith("display-refresh"))).toBe(true);
    expect(bootIds.some((id) => id.startsWith("display-refresh"))).toBe(false);
    // And the reverse: what Windows blamed for the boot is not an answer about frame rate.
    expect(bootIds.some((id) => id.startsWith("boot-degraded"))).toBe(true);
    expect(fpsIds.some((id) => id.startsWith("boot-degraded"))).toBe(false);
  });

  it("drop what they exclude rather than listing it last", () => {
    // Demoting is not the same as excluding: a boot finding at the bottom of an fps report is
    // still a line somebody reads and acts on.
    const fps = build(sample, profile("fps"));
    for (const finding of fps.costs) expect(relevantTo(profile("fps"), finding), finding.id).toBe(true);
  });

  it("put the biggest measured number in the profile's own currency first", () => {
    const boot = build(sample, profile("boot"));
    const measured = boot.costs
      .map((f) => f.impact.measured.bootMs)
      .filter((v): v is number => v != null);
    expect(measured.length).toBeGreaterThan(1);
    expect([...measured].sort((a, b) => b - a)).toEqual(measured);
  });

  it("rank the same findings the same way twice, so two reports can be diffed", () => {
    const findings = CHECKS.flatMap((c) => c.run(sample));
    const once = rank(profile("fps"), findings).map((f) => f.id);
    const twice = rank(profile("fps"), [...findings].reverse()).map((f) => f.id);
    expect(twice).toEqual(once);
  });

  it("every profile declares a currency it also calls relevant", () => {
    for (const p of PROFILES) expect(p.relevant, p.id).toContain(p.currency);
  });
});

describe("the total", () => {
  it("sums only the currency, and says how much of the report it does not speak for", () => {
    const report = build(sample, profile("boot"));
    const expected = report.costs
      .map((f) => f.impact.measured.bootMs)
      .filter((v): v is number => v != null);
    expect(report.total.from).toBe(expected.length);
    expect(report.total.value).toBeCloseTo(expected.reduce((a, b) => a + b, 0), 6);
    expect(report.total.silent).toBe(report.costs.length - expected.length);
  });

  it("never quietly counts a finding that measured something else", () => {
    // The failure this guards is a memory figure landing in a millisecond total because both
    // are numbers. The fps profile's currency is frame time, and only the display check has it.
    const fps = build(sample, profile("fps"));
    const contributors = fps.costs.filter((f) => f.impact.measured.frameTimeMs != null);
    expect(contributors.map((f) => f.id).every((id) => id.startsWith("display-refresh"))).toBe(true);
    expect(fps.total.from).toBe(contributors.length);
  });

  it("says there is no total rather than printing a zero", () => {
    const bare: Snapshot = { schema: 1, collectedAt: "2026-09-12T09:00:00Z", real: true };
    const report = build(bare, profile("fps"));
    expect(report.total.from).toBe(0);
    expect(describeTotal(report.total)).toMatch(/no total/);
    expect(describeTotal(report.total)).not.toMatch(/\b0\b/);
  });
});

describe("risks", () => {
  it("show up whatever profile was asked for, because they are not a cost", () => {
    for (const p of PROFILES) {
      const report = build(sample, p);
      expect(report.risks.map((f) => f.id), p.id).toContain("defender-off");
    }
  });

  it("are kept out of the cost ranking entirely", () => {
    const report = build(sample, profile("default"));
    expect(report.costs.map((f) => f.id)).not.toContain("defender-off");
  });
});

describe("honesty about what was not read", () => {
  it("carries the collector's unreadable list into the report", () => {
    const report = build(sample, profile("default"));
    expect(report.gaps).toContain("Get-MpComputerStatus (needs an elevated session)");
  });

  it("refuses a snapshot from a schema it does not know", () => {
    expect(() => build({ ...sample, schema: 2 as unknown as 1 }, profile("default")))
      .toThrow(/schema 1/);
  });

  it("reports a check that throws instead of losing the whole run", () => {
    const exploding = { ...sample, displays: { length: "not an array" } as unknown as [] };
    const report = build(exploding, profile("fps"));
    expect(report.risks.map((f) => f.id)).toContain("check-failed:display-refresh");
    // And the rest of the report survived.
    expect(report.costs.length).toBeGreaterThan(0);
  });
});

describe("the refusal list", () => {
  it("is reachable from the findings that would otherwise recommend one", () => {
    const report = build(sample, profile("default"));
    expect(report.refusals.map((r) => r.id)).toContain("defragment-an-ssd");
  });

  it("has a unique id, a claim and a reason for every entry", () => {
    expect(new Set(REFUSALS.map((r) => r.id)).size).toBe(REFUSALS.length);
    for (const refusal of REFUSALS) {
      expect(refusal.claim, refusal.id).toBeTruthy();
      expect(refusal.why.length, refusal.id).toBeGreaterThan(80);
    }
  });

  it("every refusal a finding points at actually exists", () => {
    const ids = new Set(REFUSALS.map((r) => r.id));
    for (const check of CHECKS) {
      for (const finding of check.run(sample)) {
        if (finding.refusal) expect(ids, finding.id).toContain(finding.refusal);
      }
    }
  });
});
