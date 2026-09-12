/**
 * Boot cost, taken from the one source that already measured it.
 *
 * Windows times its own boot and writes the result to
 * Microsoft-Windows-Diagnostics-Performance/Operational. Event 100 carries the totals; events
 * 101 to 110 name the individual applications, services and drivers it considers to have
 * degraded the boot, each with a millisecond figure. That log is on by default, nobody reads
 * it, and it is strictly better evidence than any list of programs to disable: it is your
 * machine's own measurement of your machine.
 */
import type { BootRecord, Check } from "../model.ts";

/** The middle value, so one pathological boot after a Windows update does not set the tone. */
export function median(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Everything Windows blamed, summed per name across the boots we have. */
export function blamed(boots: BootRecord[]): { name: string; kind: string; ms: number; boots: number }[] {
  const totals = new Map<string, { name: string; kind: string; ms: number; boots: number }>();
  for (const boot of boots) {
    for (const item of boot.degraded ?? []) {
      if (!Number.isFinite(item.ms)) continue;
      const seen = totals.get(item.name) ?? { name: item.name, kind: item.kind, ms: 0, boots: 0 };
      seen.ms += item.ms;
      seen.boots += 1;
      totals.set(item.name, seen);
    }
  }
  // The median across the boots it appeared in, not the sum: the sum grows with how long
  // the log happens to go back, which is a property of the log rather than of the machine.
  return [...totals.values()].map((t) => ({ ...t, ms: t.ms / t.boots }));
}

export const bootDegraded: Check = {
  id: "boot-degraded",
  rationale:
    "Windows already timed each thing that slowed the boot down and wrote the number to the " +
    "event log. Reading it beats any general list of programs to disable.",

  run(snapshot) {
    const boots = snapshot.boot ?? [];
    if (!boots.length) return [];
    return blamed(boots)
      // Under a fifth of a second is below what anybody notices, and reporting it turns a
      // short actionable list into a long one nobody finishes.
      .filter((item) => item.ms >= 200)
      .map((item) => ({
        id: `boot-degraded:${item.name}`,
        title: `${item.name} added ${(item.ms / 1000).toFixed(1)}s to boot`,
        detail:
          `Windows recorded this ${item.kind} as degrading the boot in ${item.boots} of the last ` +
          `${boots.length} boots, costing ${Math.round(item.ms)}ms on average. This is its own ` +
          `measurement, not an estimate. It is not automatically something to remove: the number ` +
          `says what it costs, not whether you want it.`,
        impact: { measured: { bootMs: item.ms }, unquantified: [] },
        tier: "certain" as const,
        sources: [{
          from: "Microsoft-Windows-Diagnostics-Performance/Operational, events 101-110",
          note: `${item.boots} of ${boots.length} boots`,
        }],
        remedy:
          item.kind === "service"
            ? `Get-Service '${item.name}' | Select-Object Name,StartType,Status`
            : "Task Manager > Startup apps",
      }));
  },
};

export const bootTrend: Check = {
  id: "boot-trend",
  rationale:
    "One boot time is noise. A median over the last several, next to the median of the ones " +
    "before them, is the only way to say whether a machine is actually getting slower.",

  run(snapshot) {
    const boots = (snapshot.boot ?? []).filter((b) => Number.isFinite(b.bootMs));
    // Three each side, so "recent" and "earlier" are each a median rather than a reading.
    if (boots.length < 6) return [];
    const times = boots.map((b) => b.bootMs!);
    const recent = median(times.slice(0, Math.floor(times.length / 2)))!;
    const earlier = median(times.slice(Math.floor(times.length / 2)))!;
    const growth = recent - earlier;
    // A fifth slower AND at least two seconds. Either alone fires on a machine that boots in
    // three seconds and now boots in three and a half, which is not news.
    if (growth < 2000 || recent < earlier * 1.2) return [];

    return [{
      id: "boot-trend",
      title: `Boot is ${(growth / 1000).toFixed(1)}s slower than it was`,
      detail:
        `Median of the ${Math.floor(times.length / 2)} most recent boots is ` +
        `${(recent / 1000).toFixed(1)}s against ${(earlier / 1000).toFixed(1)}s for the ones before. ` +
        `Medians rather than averages, because one boot after a Windows update is not evidence ` +
        `of anything. This says something changed; the findings above say what.`,
      /*
       * Deliberately not measured in bootMs, though a millisecond figure is right there.
       *
       * This finding is a summary of the others, not a charge alongside them: the seconds
       * the trend is up ARE the seconds the degraded items below cost. The first version put
       * growth in the currency and the report totalled 25 seconds on a machine that had lost
       * about nine - the trend counted once as itself and again as its own causes. A total is
       * only meaningful over independent charges, so a summary carries none.
       */
      impact: { measured: {}, unquantified: [] },
      tier: "certain" as const,
      sources: [{
        from: "Microsoft-Windows-Diagnostics-Performance/Operational, event 100",
        note: `${times.length} boots on record`,
      }],
      remedy: null,
    }];
  },
};

export const startupItems: Check = {
  id: "startup-items",
  rationale:
    "The things that run when you log in. Cross-referenced against the boot log, so the ones " +
    "Windows actually timed carry their number and the rest are honest about having none.",

  run(snapshot) {
    const enabled = (snapshot.startup ?? []).filter((s) => s.enabled !== false && s.name);
    if (!enabled.length) return [];
    const timed = new Set(blamed(snapshot.boot ?? []).map((b) => b.name.toLowerCase()));
    // Anything the boot log already timed is reported by boot-degraded, with its cost. Listing
    // it again here without one would be the same item twice, worse the second time.
    const untimed = enabled.filter((s) => !timed.has((s.name ?? "").toLowerCase()));
    if (!untimed.length) return [];

    return [{
      id: "startup-items",
      title: `${untimed.length} programs start when you log in, none of them timed by Windows`,
      detail:
        `${untimed.map((s) => s.name).join(", ")}. Windows did not record any of these as ` +
        `degrading the boot, which is weak evidence that they are cheap and no evidence at all ` +
        `about what they cost while running. They are listed because you may not know they are ` +
        `there, not because there is a number attached to them.`,
      impact: { measured: {}, unquantified: ["bootMs", "memoryMb", "cpuPercent"] },
      tier: "situational" as const,
      sources: [{
        from: "Win32_StartupCommand and Explorer StartupApproved",
        note: `${enabled.length} enabled, ${untimed.length} with no entry in the boot log`,
      }],
      remedy: "Task Manager > Startup apps",
    }];
  },
};
