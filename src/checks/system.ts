/**
 * The machine underneath: memory, storage, power, and the two things this tool will not let
 * you turn off without saying so.
 */
import type { Check, Finding } from "../model.ts";
import { list } from "../shape.ts";

/** Below this, Windows starts struggling to stage updates and grow the pagefile. The number
 *  is a rule of thumb rather than a documented threshold, which is why the finding carries
 *  the free space itself rather than a cost. */
const LOW_DISK_PERCENT = 10;

export const systemDrive: Check = {
  id: "system-drive",
  rationale:
    "A nearly full system drive slows everything in ways that are easy to blame on something " +
    "else, and it is the one storage finding that is worth the space in a short report.",

  run(snapshot) {
    const findings: Finding[] = [];
    for (const drive of list(snapshot.storage)) {
      if (!drive.system || !drive.freeGb || !drive.totalGb) continue;
      const percent = (drive.freeGb / drive.totalGb) * 100;
      if (percent >= LOW_DISK_PERCENT) continue;
      findings.push({
        id: `system-drive:${drive.drive}`,
        title: `${drive.drive} has ${drive.freeGb.toFixed(0)}GB free of ${drive.totalGb.toFixed(0)}GB`,
        detail:
          `That is ${percent.toFixed(1)}% free on the drive Windows is installed on. Below roughly ` +
          `ten percent, update staging, the pagefile and shadow copies all start competing for ` +
          `what is left, and an SSD with little free space has less room to spread writes. No cost ` +
          `figure is given because the effect depends entirely on what the machine is asked to do ` +
          `next; the free space is the measurement.`,
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
    "Defragmenting is the genre's oldest ritual, and on an SSD it is wear for nothing. This " +
    "check exists mostly to say that, and only reports when the drive is actually spinning.",

  run(snapshot) {
    const findings: Finding[] = [];
    for (const drive of list(snapshot.storage)) {
      if (drive.mediaType !== "HDD" || drive.fragmentationPercent == null) continue;
      if (drive.fragmentationPercent < 15) continue;
      findings.push({
        id: `fragmentation:${drive.drive}`,
        title: `${drive.drive} is a spinning disk at ${drive.fragmentationPercent}% fragmentation`,
        detail:
          `Fragmentation costs seek time, and seek time is a thing only a spinning disk has. ` +
          `This finding appears only because Windows reports this drive's media type as HDD. ` +
          `On an SSD the same operation is writes for no benefit, which is why the check reads ` +
          `the media type first.`,
        impact: { measured: {}, unquantified: ["loadSeconds"] },
        tier: "likely",
        sources: [{ from: "MSFT_PhysicalDisk MediaType and Optimize-Volume -Analyze" }],
        remedy: `Optimize-Volume -DriveLetter ${(drive.drive ?? "C:").replace(":", "")} -Defrag`,
        refusal: "defragment-an-ssd",
      });
    }
    return findings;
  },
};

export const memoryPressure: Check = {
  id: "memory-pressure",
  rationale:
    "Commit charge against the commit limit is the figure that actually says whether a machine " +
    "is short of memory. Free RAM is not that figure and never was.",

  run(snapshot) {
    const { committedMb, commitLimitMb } = snapshot.memory ?? {};
    if (!committedMb || !commitLimitMb) return [];
    const used = committedMb / commitLimitMb;
    if (used < 0.85) return [];
    return [{
      id: "memory-pressure",
      title: `Commit charge is at ${(used * 100).toFixed(0)}% of the commit limit`,
      detail:
        `${Math.round(committedMb)}MB committed against a limit of ${Math.round(commitLimitMb)}MB. ` +
        `This is the number that matters, not "free RAM": Windows is supposed to use memory, and ` +
        `an empty-looking free figure on a healthy machine is cache doing its job. Commit ` +
        `approaching the limit is different - it is the point where allocations start failing and ` +
        `the pagefile starts absorbing the difference.`,
      /*
       * No number in the cost column, and this one is worth spelling out because the first
       * version got it wrong: it measured commitLimit minus committed and put that in
       * memoryMb. That figure is the headroom LEFT, not a cost anything is imposing - it
       * printed as "this is costing you 2776MB" while meaning "you have 2776MB left". A
       * dimension is for what a finding costs you, and pressure is a state rather than a
       * charge, so the numbers stay in the evidence where nothing can sum them.
       */
      impact: { measured: {}, unquantified: ["loadSeconds"] },
      tier: "certain",
      sources: [{
        from: "Win32_OperatingSystem and Win32_PageFileUsage",
        note: `${Math.round(committedMb)}MB committed, limit ${Math.round(commitLimitMb)}MB`,
      }],
      remedy: null,
    }];
  },
};

export const powerPlan: Check = {
  id: "power-plan",
  rationale:
    "A power-saving plan caps processor state, which is a real cost under load. It is also " +
    "exactly what you want on a laptop away from a socket, so the finding depends on both.",

  run(snapshot) {
    const plan = snapshot.power?.activePlan;
    if (!plan || snapshot.power?.onBattery !== false) return [];
    if (!/saver|balanced/i.test(plan)) return [];
    return [{
      id: "power-plan",
      title: `Plugged in, on the "${plan}" power plan`,
      detail:
        `A saving plan holds the processor below its top states and parks cores more eagerly, ` +
        `which is the right trade on battery and not obviously the right one on mains. No figure ` +
        `is given because what it costs depends on whether the workload is one the machine was ` +
        `having to throttle for in the first place. On modern Windows the difference between ` +
        `Balanced and High Performance is much smaller than the guides from 2012 suggest.`,
      impact: { measured: {}, unquantified: ["frameTimeMs", "cpuPercent"] },
      tier: "situational",
      sources: [{ from: "powercfg /getactivescheme" }],
      remedy: "powercfg /list   then   powercfg /setactive <guid>",
    }];
  },
};

/* ---- The two that are risks rather than costs -------------------------------------- */

export const defenderOff: Check = {
  id: "defender-off",
  rationale:
    "Disabling real-time protection is the most-recommended and worst idea in the genre. " +
    "This tool will not do it, and says so when it finds it has already been done.",

  run(snapshot) {
    if (snapshot.defender?.realtimeEnabled !== false) return [];
    return [{
      id: "defender-off",
      kind: "risk",
      title: "Real-time protection is off",
      detail:
        "Every optimization list recommends this and it is the one thing here that trades a " +
        "small, situational gain for an unbounded loss. If a third-party product has taken over, " +
        "this is expected and fine. If nothing has, the machine is unprotected. Shown whatever " +
        "profile you asked for, because it is not a cost and cannot be ranked against one.",
      impact: { measured: {}, unquantified: [] },
      tier: "certain",
      sources: [{ from: "Get-MpComputerStatus" }],
      remedy: "Windows Security > Virus and threat protection",
      refusal: "disable-defender",
    }];
  },
};

export const updatesDisabled: Check = {
  id: "updates-disabled",
  rationale: "Same shape as Defender: a popular tweak, found after the fact.",

  run(snapshot) {
    if (snapshot.updates?.serviceStartMode !== "Disabled") return [];
    return [{
      id: "updates-disabled",
      kind: "risk",
      title: "The Windows Update service is disabled",
      detail:
        `Last install was ${snapshot.updates.lastInstalledDays ?? "an unknown number of"} days ago. ` +
        `Disabling the service does not stop updates so much as break them: they accumulate, and ` +
        `the eventual catch-up is slower and more disruptive than the thing being avoided.`,
      impact: { measured: {}, unquantified: [] },
      tier: "certain",
      sources: [{ from: "Get-Service wuauserv" }],
      remedy: "Set-Service wuauserv -StartupType Manual",
      refusal: "disable-windows-update",
    }];
  },
};
