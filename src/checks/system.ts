/**
 * The machine underneath: memory, storage, power, and the two things this tool will not let
 * you turn off without saying so.
 */
import type { Check, Finding } from "../model.ts";
import { list } from "../shape.ts";

const LOW_DISK_PERCENT = 10;

export const systemDrive: Check = {
  id: "system-drive",
  rationale:
    "A nearly full system drive can leave Windows with less room for updates, paging and other " +
    "temporary work. The report uses the actual free-space measurement rather than claiming a fixed performance loss.",

  run(snapshot) {
    const findings: Finding[] = [];
    for (const drive of list(snapshot.storage)) {
      if (!drive.system || drive.freeGb == null || drive.totalGb == null || drive.totalGb <= 0) continue;
      const percent = (drive.freeGb / drive.totalGb) * 100;
      if (percent >= LOW_DISK_PERCENT) continue;
      findings.push({
        id: `system-drive:${drive.drive}`,
        title: `${drive.drive} has ${drive.freeGb.toFixed(0)}GB free of ${drive.totalGb.toFixed(0)}GB`,
        detail:
          `That is ${percent.toFixed(1)}% free on the drive Windows is installed on. Low free space ` +
          `can constrain update staging, paging and temporary files; the exact performance effect ` +
          `depends on what the machine is doing. This finding does not claim that the missing space ` +
          `itself costs a particular number of milliseconds.`,
        impact: { measured: {}, unquantified: ["loadSeconds", "bootMs"] },
        tier: "certain",
        sources: [{ from: "Win32_LogicalDisk", note: `${drive.freeGb.toFixed(1)}GB free` }],
        remedy: "Settings > System > Storage",
      });
    }
    return findings;
  },
};

export const fragmentation: Check = {
  id: "fragmentation",
  rationale:
    "Kept for compatibility with older snapshots, but current collectors do not populate a " +
    "machine-readable fragmentation percentage, so this check deliberately produces no finding.",

  run(snapshot) {
    const findings: Finding[] = [];
    for (const drive of list(snapshot.storage)) {
      if (drive.mediaType !== "HDD" || drive.fragmentationPercent == null) continue;
      if (drive.fragmentationPercent < 15) continue;
      findings.push({
        id: `fragmentation:${drive.drive}`,
        title: `${drive.drive} is a spinning disk at ${drive.fragmentationPercent}% fragmentation`,
        detail:
          `The snapshot contains an explicit fragmentation measurement for this HDD. That value ` +
          `is reported rather than inferred from free space or media type.`,
        impact: { measured: {}, unquantified: ["loadSeconds"] },
        tier: "likely",
        sources: [{ from: "collector-provided fragmentation analysis" }],
        remedy: null,
      });
    }
    return findings;
  },
};

export const memoryPressure: Check = {
  id: "memory-pressure",
  rationale:
    "Commit charge against the commit limit is the useful indicator of memory pressure; free RAM " +
    "alone is not a reliable measure of whether Windows is short of memory.",

  run(snapshot) {
    const { committedMb, commitLimitMb } = snapshot.memory ?? {};
    if (committedMb == null || commitLimitMb == null || commitLimitMb <= 0) return [];
    const used = committedMb / commitLimitMb;
    if (used < 0.85) return [];
    return [{
      id: "memory-pressure",
      title: `Commit charge is at ${(used * 100).toFixed(0)}% of the commit limit`,
      detail:
        `${Math.round(committedMb)}MB committed against a limit of ${Math.round(commitLimitMb)}MB. ` +
        `High commit charge means Windows has less commit headroom available. This is a state ` +
        `measurement, not a memory cost imposed by one application, so it is not placed in the ` +
        `memory total as though the remaining headroom were a cost.`,
      impact: { measured: {}, unquantified: ["loadSeconds"] },
      tier: "certain",
      sources: [{
        from: "Win32_PerfRawData_PerfOS_Memory",
        note: `${Math.round(committedMb)}MB committed, limit ${Math.round(commitLimitMb)}MB`,
      }],
      remedy: null,
    }];
  },
};

export const powerPlan: Check = {
  id: "power-plan",
  rationale:
    "A power-saving plan can trade peak performance for efficiency. The report only raises it " +
    "when the machine reports that it is on mains power and the active plan is Balanced or a saving plan.",

  run(snapshot) {
    const plan = snapshot.power?.activePlan;
    if (!plan || snapshot.power?.onBattery !== false) return [];
    if (!/saver|balanced/i.test(plan)) return [];
    return [{
      id: "power-plan",
      title: `On mains power, using the "${plan}" power plan`,
      detail:
        `Balanced and saving-oriented plans are designed to trade some peak performance for efficiency. ` +
        `The exact effect varies by Windows version, firmware, workload and processor, so this audit ` +
        `does not claim a fixed FPS or frame-time penalty. On a desktop without a battery, "on mains" ` +
        `simply means Windows is not reporting battery operation.`,
      impact: { measured: {}, unquantified: ["frameTimeMs", "cpuPercent"] },
      tier: "situational",
      sources: [{ from: "powercfg /getactivescheme" }],
      remedy: "Settings > System > Power & battery > Power mode",
    }];
  },
};

export const defenderOff: Check = {
  id: "defender-off",
  rationale:
    "Disabling real-time protection is a security risk, not a performance optimization the report should recommend.",

  run(snapshot) {
    if (snapshot.defender?.realtimeEnabled !== false) return [];
    return [{
      id: "defender-off",
      kind: "risk",
      title: "Real-time protection is off",
      detail:
        "Real-time protection being off can be intentional when another security product is providing protection. " +
        "If no replacement protection is active, the machine is less protected. The audit reports the state " +
        "without assuming why it is off.",
      impact: { measured: {}, unquantified: [] },
      tier: "certain",
      sources: [{ from: "Get-MpComputerStatus" }],
      remedy: "Windows Security > Virus & threat protection",
      refusal: "disable-defender",
    }];
  },
};

export const updatesDisabled: Check = {
  id: "updates-disabled",
  rationale: "A disabled Windows Update service is a security and maintenance state worth surfacing.",

  run(snapshot) {
    if (snapshot.updates?.serviceStartMode !== "Disabled") return [];
    const days = snapshot.updates.lastInstalledDays;
    const timing = days == null ? "The latest installed update date was not measurable." : `The latest measured update is ${days} days old.`;
    return [{
      id: "updates-disabled",
      kind: "risk",
      title: "The Windows Update service is disabled",
      detail:
        `${timing} Disabling the service can prevent normal Windows Update operation. The audit does not claim ` +
        `that a particular update is missing; it reports the service state and the available update-date evidence.`,
      impact: { measured: {}, unquantified: [] },
      tier: "certain",
      sources: [{ from: "Win32_Service wuauserv" }],
      remedy: "Settings > Windows Update",
      refusal: "disable-windows-update",
    }];
  },
};
