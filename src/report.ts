/**
 * Turning a snapshot into a bill.
 *
 * The shape of the output is the argument this repo is making, so it is worth stating:
 *
 *   costs        findings relevant to the chosen profile, ranked
 *   totals       ONE number, in the profile's currency, over findings that measured it
 *   risks        never filtered by profile, never ranked against a cost, always shown
 *   gaps         sources the collector could not read
 *   unmeasured   how many of the costs carry no number at all
 *
 * `gaps` is not decoration. A check that finds nothing and a check that could not look
 * produce the same empty list, and only one of them is good news; without this the report
 * quietly congratulates a machine whose event log was denied.
 */
import type { Dimension, Finding, Snapshot } from "./model.ts";
import { list } from "./shape.ts";
import { UNITS } from "./model.ts";
import { CHECKS } from "./checks/index.ts";
import { PROFILES, rank, relevantTo, type Profile } from "./profiles.ts";
import { refusalById, type Refusal } from "./refusals.ts";

export interface Total {
  dimension: Dimension;
  value: number;
  /** How many findings contributed. The other findings in the report did not measure this
   *  dimension, which is not the same as having contributed zero. */
  from: number;
  /** How many relevant findings had no number in this dimension, so a reader can see how
   *  much of the report the total does NOT speak for. */
  silent: number;
}

export interface Report {
  profile: Profile;
  collectedAt: string;
  real: boolean;
  costs: Finding[];
  risks: Finding[];
  total: Total;
  gaps: string[];
  /** Every refusal referenced by a finding in this report, so the reader meets the argument
   *  where it is relevant rather than only at the bottom of a README. */
  refusals: Refusal[];
}

export class ReportError extends Error {}

export function build(snapshot: Snapshot, profile: Profile): Report {
  if (snapshot.schema !== 1) {
    throw new ReportError(
      `this build reads schema 1 and the snapshot says ${JSON.stringify(snapshot.schema)}. ` +
      `Re-run collect/pc-audit.ps1 from the same version as this analyzer.`,
    );
  }

  const all: Finding[] = [];
  for (const check of CHECKS) {
    /*
     * One broken check must not take the report with it.
     *
     * These run against whatever a stranger's machine reported, through a collector nobody
     * here can run. A field that is a string where the schema says number is an ordinary
     * event, and the useful behaviour is fourteen findings and one loud gap rather than a
     * stack trace and nothing.
     */
    try {
      all.push(...check.run(snapshot));
    } catch (error) {
      all.push({
        id: `check-failed:${check.id}`,
        kind: "risk",
        title: `The ${check.id} check failed to run`,
        detail:
          `${error instanceof Error ? error.message : String(error)}. Everything else in this ` +
          `report is unaffected, but whatever this check would have found is missing from it.`,
        impact: { measured: {}, unquantified: [] },
        tier: "certain",
        sources: [{ from: "pc-audit" }],
        remedy: null,
      });
    }
  }

  const risks = all.filter((f) => f.kind === "risk");
  const costs = rank(profile, all.filter((f) => f.kind !== "risk" && relevantTo(profile, f)));

  const contributing = costs.filter((f) => f.impact.measured[profile.currency] != null);
  const total: Total = {
    dimension: profile.currency,
    value: contributing.reduce((sum, f) => sum + f.impact.measured[profile.currency]!, 0),
    from: contributing.length,
    silent: costs.length - contributing.length,
  };

  const refusals = [...new Set(all.map((f) => f.refusal).filter((r): r is string => !!r))]
    .map(refusalById)
    .filter((r): r is Refusal => !!r);

  return {
    profile,
    collectedAt: snapshot.collectedAt,
    real: snapshot.real,
    costs,
    risks,
    total,
    gaps: list(snapshot.machine?.unreadable),
    refusals,
  };
}

/** The total as a sentence, including what it does not cover. Rendering it in one place
 *  keeps the CLI and the web page from drifting into two different claims. */
export function describeTotal(total: Total): string {
  const unit = UNITS[total.dimension];
  if (total.from === 0) {
    return `Nothing in this report measured ${unit.label}, so there is no total.`;
  }
  const value = total.dimension === "bootMs"
    ? `${(total.value / 1000).toFixed(1)}s`
    : `${total.value.toFixed(total.value < 10 ? 2 : 0)}${unit.short}`;
  const tail = total.silent
    ? ` from ${total.from} of ${total.from + total.silent} findings; the other ${total.silent} measured no ${unit.label} and are not in this number.`
    : ` from all ${total.from} findings.`;
  return `${value} of ${unit.label}${tail}`;
}

export { PROFILES };
