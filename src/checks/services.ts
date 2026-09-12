/**
 * Services and scheduled tasks: what is running that nothing asked for.
 *
 * The genre's version of this is a list of service names to set to Disabled, copied between
 * forum posts since Windows 7, several of which now break printing or the Store. This version
 * names nothing in advance. It reads what is actually running on THIS machine, which of it
 * nothing else depends on, and leaves the decision where it belongs.
 */
import type { Check, Finding, ServiceItem } from "../model.ts";
import { list } from "../shape.ts";

/** Running, starts itself, and nothing would break. Microsoft-signed services are excluded
 *  not because they are sacred but because the dependency graph understates them badly:
 *  plenty are started on demand by components that do not declare a dependency. */
export function unclaimed(services: ServiceItem[]): ServiceItem[] {
  return services.filter(
    (s) =>
      s.state === "Running" &&
      /^auto/i.test(s.startMode ?? "") &&
      s.microsoft === false &&
      (list(s.dependents).length) === 0,
  );
}

export const idleServices: Check = {
  id: "idle-services",
  rationale:
    "Third-party services that start themselves, are running now, and that nothing else " +
    "depends on. Named from this machine rather than from a list.",

  run(snapshot) {
    const found = unclaimed(list(snapshot.services));
    if (!found.length) return [];
    const withMemory = found.filter((s) => Number.isFinite(s.memoryMb));
    const totalMb = withMemory.reduce((sum, s) => sum + (s.memoryMb ?? 0), 0);

    return [{
      id: "idle-services",
      title: `${found.length} third-party services start themselves and nothing depends on them`,
      detail:
        `${found.map((s) => s.display ?? s.name).join(", ")}. "Nothing depends on them" means no ` +
        `other service declares them as a requirement - it does not mean no application needs ` +
        `them, and updaters, licence daemons and driver helpers routinely appear here while being ` +
        `things you want. This is a list to read, not a list to disable.` +
        (withMemory.length < found.length
          ? ` Memory is shown for ${withMemory.length} of the ${found.length}; the rest did not report a working set.`
          : ""),
      impact: {
        // Only the ones that actually reported a working set contribute. Treating a missing
        // reading as zero would understate the total while looking precise.
        measured: withMemory.length ? { memoryMb: totalMb } : {},
        unquantified: ["cpuPercent", "bootMs"],
      },
      tier: "likely" as const,
      sources: [{
        from: "Win32_Service and Get-Service RequiredServices",
        note: `${found.length} matched, ${withMemory.length} reported memory`,
      }],
      remedy: "Get-Service | Where-Object { $_.Status -eq 'Running' } | Sort-Object DisplayName",
    }] satisfies Finding[];
  },
};

export const logonTasks: Check = {
  id: "logon-tasks",
  rationale:
    "Scheduled tasks that fire at logon are startup items that do not appear in Task Manager's " +
    "startup list, which is why a machine can look clean there and still be busy.",

  run(snapshot) {
    const atLogon = list(snapshot.tasks).filter(
      (t) => t.state === "Ready" && list(t.triggers).some((x) => /logon/i.test(x)),
    );
    // Windows ships plenty of its own, and a report that lists forty Microsoft maintenance
    // tasks is one nobody reads to the end.
    const third = atLogon.filter((t) => !/^Microsoft$/i.test(t.author ?? "") && !(t.path ?? "").startsWith("\\Microsoft\\"));
    if (!third.length) return [];

    return [{
      id: "logon-tasks",
      title: `${third.length} scheduled tasks run at logon and are not in Task Manager's startup list`,
      detail:
        `${third.map((t) => t.name ?? t.path).join(", ")}. Scheduled tasks are a second, quieter ` +
        `startup mechanism: a machine whose Startup tab looks empty can still have a dozen of ` +
        `these. Nothing here is measured - they are reported because they are hard to find.`,
      impact: { measured: {}, unquantified: ["bootMs", "cpuPercent"] },
      tier: "situational" as const,
      sources: [{ from: "Get-ScheduledTask", note: `${atLogon.length} at logon, ${third.length} not Microsoft` }],
      remedy: "Get-ScheduledTask | Where-Object { $_.Triggers.CimClass.CimClassName -match 'Logon' }",
    }];
  },
};
