/**
 * Profiles: the same machine, billed against different goals.
 *
 * A background service holding 40MB is nearly free while you are playing a game and is a
 * real cost on a 4GB laptop. A service that adds 1.3 seconds to boot costs you nothing at
 * all once you are in the game. Ranking every machine by one list is how the genre ends up
 * telling a gamer to disable startup items and telling a laptop owner to unpark cores.
 *
 * What a profile is NOT
 * ---------------------
 * It is not a set of exchange rates. There is no honest number of milliseconds in a
 * megabyte, and inventing one would be the same sin as the fabricated "+15 FPS" this tool
 * exists to argue with. So a profile names ONE currency - the single dimension its bill
 * totals in - and every other dimension is shown in its own units, beside the total rather
 * than inside it.
 *
 * What a profile does
 * -------------------
 *   picks the currency      which column gets a total at the bottom
 *   picks what is relevant  a finding touching none of these is dropped, not demoted
 *   orders the rest         measured in the currency first, then tier, then everything else
 *
 * Dropping rather than demoting matters. A boot-time finding shown at the bottom of an FPS
 * report is still a line somebody reads and acts on; the honest answer is that it is not an
 * answer to the question asked.
 */
import type { Dimension, Finding } from "./model.ts";
import { TIER_ORDER } from "./model.ts";

export interface Profile {
  id: string;
  label: string;
  /** What question this profile answers, in one line. */
  summary: string;
  /** The one dimension this bill totals in. */
  currency: Dimension;
  /** Every dimension this goal cares about. A finding touching none of them is not shown. */
  relevant: Dimension[];
  /** Shown at the top of the report, so the reader knows what was left out and why. */
  excludes: string;
  /**
   * What adding the currency column up does and does not mean.
   *
   * Every total in this tool is a sum of separately attributed figures, and separately
   * attributed is not the same as independent: two services that both delayed the boot may
   * have been delaying it at the same time. Saying so next to the number is the difference
   * between a measurement and a claim.
   */
  totalMeans: string;
}

export const PROFILES: Profile[] = [
  {
    id: "default",
    label: "Everything",
    summary: "Every finding, ranked by what is measurable.",
    currency: "bootMs",
    relevant: ["bootMs", "frameTimeMs", "loadSeconds", "memoryMb", "cpuPercent", "watts"],
    excludes: "Nothing is excluded, so the ordering is the weakest of the four.",
    totalMeans:
      "Windows attributed each of these separately. Where two of them were slow at the same " +
      "time the sum counts both, so read it as an upper bound.",
  },
  {
    id: "fps",
    label: "Frame rate",
    summary: "What is costing you frame time and load time while a game is running.",
    currency: "frameTimeMs",
    // Not bootMs: a service that adds a second to boot has finished by the time the game
    // starts. Not watts: a desktop under load is not trying to save any.
    relevant: ["frameTimeMs", "cpuPercent", "loadSeconds", "memoryMb"],
    excludes: "Boot time and power draw, neither of which you are paying while playing.",
    totalMeans:
      "Frame time floors are properties of the display mode, so they do not overlap and the " +
      "sum is exact.",
  },
  {
    id: "boot",
    label: "Startup",
    summary: "What is between you pressing the button and having a usable desktop.",
    currency: "bootMs",
    relevant: ["bootMs", "loadSeconds"],
    excludes: "Everything that costs you only once you are already logged in.",
    totalMeans:
      "Windows attributed each of these separately, from its own boot log. Two of them slow " +
      "at the same time are counted twice, so this is an upper bound on what you would get " +
      "back rather than a promise.",
  },
  {
    id: "battery",
    label: "Battery",
    summary: "What is drawing power you are not getting anything for.",
    currency: "watts",
    // Memory is deliberately absent. Holding a page of RAM is close to free in power terms;
    // the CPU waking up to touch it is not, and that lands in cpuPercent.
    relevant: ["watts", "cpuPercent"],
    excludes: "Boot time, frame time, and memory, none of which is what a battery buys.",
    totalMeans: "An upper bound: draws that overlap in time are counted once each.",
  },
];

export const profileById = (id: string): Profile | undefined => PROFILES.find((p) => p.id === id);

/** A finding belongs in this profile if it touches any dimension the profile cares about,
 *  whether or not that dimension turned out to be measurable. */
export function relevantTo(profile: Profile, finding: Finding): boolean {
  const touched = [
    ...(Object.keys(finding.impact.measured) as Dimension[]),
    ...finding.impact.unquantified,
  ];
  return touched.some((d) => profile.relevant.includes(d));
}

/**
 * The order findings are read in.
 *
 * Measured-in-the-currency first, largest first, because that is the only column with a
 * number a reader can act on. Then tier, then anything else measured, then id so the order
 * is stable between runs of the same snapshot - a report that reshuffles on re-run cannot
 * be diffed against yesterday's.
 */
export function rank(profile: Profile, findings: Finding[]): Finding[] {
  const currency = (f: Finding) => f.impact.measured[profile.currency] ?? null;
  const otherMeasured = (f: Finding) =>
    (Object.entries(f.impact.measured) as [Dimension, number][])
      .filter(([d]) => d !== profile.currency && profile.relevant.includes(d))
      .length;

  return [...findings].sort((a, b) => {
    const ca = currency(a);
    const cb = currency(b);
    if (ca !== null && cb !== null && ca !== cb) return cb - ca;
    if (ca !== null && cb === null) return -1;
    if (ca === null && cb !== null) return 1;
    const tier = TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
    if (tier !== 0) return tier;
    const other = otherMeasured(b) - otherMeasured(a);
    if (other !== 0) return other;
    return a.id.localeCompare(b.id);
  });
}
