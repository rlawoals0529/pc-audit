/**
 * Services and scheduled tasks: things that start automatically without a declared service
 * dependency. The report names them for review; it does not treat absence of a dependency as
 * proof that an application does not need them.
 */
import type { Check, Finding, ServiceItem } from "../model.ts";
import { list } from "../shape.ts";

export function unclaimed(services: ServiceItem[]): ServiceItem[] {
  return services.filter(
    (s) =>
      s.state === "Running" &&
      /^auto/i.test(s.startMode ?? "") &&
      s.microsoft === false &&
      list(s.dependents).length === 0,
  );
}

export const idleServices: Check = {
  id: "idle-services",
  rationale:
    "Third-party services that are running now, start automatically, and have no declared " +
    "service dependents. The third-party classification is only used when the collector could " +
    "verify the service executable as non-Microsoft; unknown signatures are not called third-party.",

  run(snapshot) {
    const found = unclaimed(list(snapshot.services));
    if (!found.length) return [];
    const withMemory = found.filter((s) => Number.isFinite(s.memoryMb));
    const totalMb = withMemory.reduce((sum, s) => sum + (s.memoryMb ?? 0), 0);

    return [{
      id: "idle-services",
      title: `${found.length} third-party services start automatically and have no declared dependents`,
      detail:
        `${found.map((s) => s.display ?? s.name).join(", ")}. "No declared dependents" means no ` +
        `other Windows service declares one of these as a dependency. It does not mean that no ` +
        `application needs it. Updaters, license daemons, VPN agents, RGB tools and driver helpers ` +
        `can be intentionally independent. This is a review list, not a disable list.` +
        (withMemory.length < found.length
          ? ` Memory is shown for ${withMemory.length} of ${found.length}; the rest had no working-set reading.`
          : ""),
      impact: {
        measured: withMemory.length ? { memoryMb: totalMb } : {},
        unquantified: ["cpuPercent", "bootMs"],
      },
      tier: "likely" as const,
      sources: [{
        from: "Win32_Service and Win32_DependentService",
        note: `${found.length} matched, ${withMemory.length} reported memory`,
      }],
      remedy: "Get-Service | Where-Object { $_.Status -eq 'Running' } | Sort-Object DisplayName",
    }] satisfies Finding[];
  },
};

export const logonTasks: Check = {
  id: "logon-tasks",
  rationale:
    "Scheduled tasks that fire at logon are another startup mechanism. They are listed when " +
    "the collector can identify them as non-Microsoft; the task list does not measure their boot cost.",

  run(snapshot) {
    const atLogon = list(snapshot.tasks).filter(
      (t) => t.state === "Ready" && list(t.triggers).some((x) => /logon/i.test(x)),
    );
    const third = atLogon.filter(
      (t) => !/^Microsoft$/i.test(t.author ?? "") && !(t.path ?? "").startsWith("\\Microsoft\\"),
    );
    if (!third.length) return [];

    return [{
      id: "logon-tasks",
      title: `${third.length} scheduled tasks run at logon and are outside Task Manager's startup list`,
      detail:
        `${third.map((t) => t.name ?? t.path).join(", ")}. Scheduled tasks are a second startup ` +
        `mechanism. Their presence does not establish a boot-time cost; they are listed because ` +
        `they can be easy to miss and may be worth reviewing individually.`,
      impact: { measured: {}, unquantified: ["bootMs", "cpuPercent"] },
      tier: "situational" as const,
      sources: [{ from: "Get-ScheduledTask", note: `${atLogon.length} at logon, ${third.length} classified as non-Microsoft` }],
      remedy: "Get-ScheduledTask | Where-Object { $_.Triggers.CimClass.CimClassName -match 'Logon' }",
    }];
  },
};
