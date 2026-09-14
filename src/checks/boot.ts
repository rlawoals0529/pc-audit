/**
 * Boot cost, taken from the one source that already measured it.
 *
 * Windows times its own boot and writes the result to
 * Microsoft-Windows-Diagnostics-Performance/Operational. Event 100 carries the totals; events
 * 101 to 110 name the individual applications, services and drivers it considered to have
 * degraded the boot. The report treats those values as Windows attribution, not as an additive
 * bill: multiple components can overlap in the same boot.
 */
import type { BootRecord, Check } from "../model.ts";
import { list } from "../shape.ts";

export function median(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * For each component, use one value per boot and take the median across those boots. This avoids
 * a long event-log history making a component look more expensive simply because it appeared
 * more often, and it avoids counting duplicate events from the same boot as separate costs.
 */
export function blamed(boots: BootRecord[]): { name: string; kind: string; ms: number; boots: number }[] {
  const perName = new Map<string, { name: string; kind: string; samples: number[] }>();
  for (const boot of boots) {
    const perBoot = new Map<string, { name: string; kind: string; ms: number }>();
    for (const item of list(boot.degraded)) {
      if (!Number.isFinite(item.ms)) continue;
      const previous = perBoot.get(item.name);
      if (!previous) perBoot.set(item.name, { name: item.name, kind: item.kind, ms: item.ms });
      else previous.ms += item.ms;
    }
    for (const item of perBoot.values()) {
      const existing = perName.get(item.name);
      if (existing) existing.samples.push(item.ms);
      else perName.set(item.name, { name: item.name, kind: item.kind, samples: [item.ms] });
    }
  }
  return [...perName.values()]
    .map((item) => ({
      name: item.name,
      kind: item.kind,
      ms: median(item.samples)!,
      boots: item.samples.length,
    }))
    .sort((a, b) => b.ms - a.ms);
}

export const bootDegraded: Check = {
  id: "boot-degraded",
  rationale:
    "Windows already timed the things it attributed to degraded boots. Reading that evidence is " +
    "more defensible than using a generic list of programs to disable.",

  run(snapshot) {
    const boots = list(snapshot.boot);
    if (!boots.length) return [];
    return blamed(boots)
      .filter((item) => item.ms >= 200)
      .map((item) => ({
        id: `boot-degraded:${item.name}`,
        title: `${item.name} added ${(item.ms / 1000).toFixed(1)}s to boot`,
        detail:
          `Windows attributed this ${item.kind} to degraded boot time in ${item.boots} of the last ` +
          `${boots.length} recorded boots, with a median attribution of ${Math.round(item.ms)}ms. ` +
          `That is Windows' measurement for the component, not a claim that the value can be added ` +
          `to every other component: these attributions can overlap. The number says what Windows ` +
          `observed, not whether you should remove the component.`,
        impact: { measured: { bootMs: item.ms }, unquantified: [] },
        tier: "certain" as const,
        sources: [{
          from: "Microsoft-Windows-Diagnostics-Performance/Operational, events 101-110",
          note: `${item.boots} of ${boots.length} boots; median attribution`,
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
    "One boot time is noise. A median over recent boots compared with earlier boots is a more " +
    "stable way to identify a meaningful change.",

  run(snapshot) {
    const boots = list(snapshot.boot).filter((b) => Number.isFinite(b.bootMs));
    if (boots.length < 6) return [];
    const half = Math.floor(boots.length / 2);
    const recent = median(boots.slice(0, half).map((b) => b.bootMs!))!;
    const earlier = median(boots.slice(half).map((b) => b.bootMs!))!;
    const growth = recent - earlier;
    if (growth < 2000 || recent < earlier * 1.2) return [];

    return [{
      id: "boot-trend",
      title: `Boot is ${(growth / 1000).toFixed(1)}s slower than it was`,
      detail:
        `Median of the ${half} most recent recorded boots is ${(recent / 1000).toFixed(1)}s against ` +
        `${(earlier / 1000).toFixed(1)}s for the earlier ${boots.length - half}. Medians reduce the ` +
        `effect of one unusual boot. This is a trend signal, not an additional boot-time charge, ` +
        `so it is deliberately excluded from the total below.`,
      impact: { measured: {}, unquantified: [] },
      tier: "certain" as const,
      sources: [{
        from: "Microsoft-Windows-Diagnostics-Performance/Operational, event 100",
        note: `${boots.length} boots on record`,
      }],
      remedy: null,
    }];
  },
};

export const startupItems: Check = {
  id: "startup-items",
  rationale:
    "The things that run when you log in. Cross-referenced against the boot log so the report " +
    "does not print the same measured component twice.",

  run(snapshot) {
    const enabled = list(snapshot.startup).filter((s) => s.enabled !== false && s.name);
    if (!enabled.length) return [];
    const timed = new Set(blamed(list(snapshot.boot)).map((b) => b.name.toLowerCase()));
    const untimed = enabled.filter((s) => !timed.has((s.name ?? "").toLowerCase()));
    if (!untimed.length) return [];

    return [{
      id: "startup-items",
      title: `${untimed.length} programs start when you log in, none of them timed by Windows`,
      detail:
        `${untimed.map((s) => s.name).join(", ")}. Their absence from the degraded-boot event list ` +
        `does not prove they are cheap; it only means this snapshot has no component-level boot ` +
        `measurement for them. They are listed because you may not know they start automatically.`,
      impact: { measured: {}, unquantified: ["bootMs", "memoryMb", "cpuPercent"] },
      tier: "situational" as const,
      sources: [{
        from: "Win32_StartupCommand and Explorer StartupApproved",
        note: `${enabled.length} enabled, ${untimed.length} without a matching degraded-boot entry`,
      }],
      remedy: "Task Manager > Startup apps",
    }];
  },
};
