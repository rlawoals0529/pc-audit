/**
 * Graphics settings are reported only when the collected evidence matches the claim.
 */
import type { Check, Finding } from "../model.ts";
import { list } from "../shape.ts";

const STALE_DRIVER_DAYS = 120;

export const gameDvr: Check = {
  id: "game-dvr",
  rationale:
    "The collector currently reads the general Game DVR switch. That tells us Game DVR is enabled, " +
    "but it does not prove that historical/background recording is enabled, so this finding never " +
    "recommends changing the Record what happened setting.",

  run(snapshot) {
    if (snapshot.graphics?.gameDvr !== true) return [];
    return [{
      id: "game-dvr",
      title: "Game DVR is enabled",
      detail:
        "Windows reports the general Game DVR setting as enabled. This is not the same measurement " +
        "as the historical-capture buffer used by the Settings option named Record what happened. " +
        "Because this snapshot does not contain the historical-capture value, the audit does not " +
        "claim that background recording is running and does not tell you to turn that setting off. " +
        "If background recording matters to your workload, check Settings > Gaming > Captures directly.",
      impact: { measured: {}, unquantified: ["frameTimeMs", "cpuPercent"] },
      tier: "situational",
      sources: [{ from: "HKCU\\System\\GameConfigStore\\GameDVR_Enabled", note: "1" }],
      remedy: "Settings > Gaming > Captures",
    }];
  },
};

export const hags: Check = {
  id: "hags",
  rationale:
    "Hardware-accelerated GPU scheduling is a workload-dependent setting, so the audit reports " +
    "its state without pretending there is a universal FPS gain.",

  run(snapshot) {
    if (snapshot.graphics?.hags !== false) return [];
    return [{
      id: "hags",
      title: "Hardware-accelerated GPU scheduling is off",
      detail:
        "This changes where GPU scheduling work is performed. Whether it helps depends on the GPU, " +
        "driver, game, and capture or overlay software in use. It is listed as a setting to test, " +
        "not as a guaranteed performance loss, and this audit does not assign it an FPS value.",
      impact: { measured: {}, unquantified: ["frameTimeMs"] },
      tier: "situational",
      sources: [{ from: "HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers\\HwSchMode" }],
      remedy: "Settings > System > Display > Graphics > Change default graphics settings",
    }];
  },
};

export const driverAge: Check = {
  id: "gpu-driver-age",
  rationale:
    "Driver age is measurable, but age alone is not proof that a driver is bad. This check flags " +
    "unusually old drivers as something worth checking rather than promising a performance gain.",

  run(snapshot) {
    const findings: Finding[] = [];
    const now = Date.parse(snapshot.collectedAt);
    for (const gpu of list(snapshot.gpu)) {
      if (!gpu.driverDate || !gpu.name) continue;
      const date = Date.parse(gpu.driverDate);
      if (!Number.isFinite(date) || !Number.isFinite(now)) continue;
      const days = Math.floor((now - date) / 86_400_000);
      if (days < STALE_DRIVER_DAYS) continue;
      findings.push({
        id: `gpu-driver-age:${gpu.name}`,
        title: `${gpu.name} is on a driver from ${days} days ago`,
        detail:
          `Driver version ${gpu.driverVersion ?? "unknown"}, dated ${gpu.driverDate.slice(0, 10)}. ` +
          `Age is not a fault on its own and newer is not automatically better. It is worth checking ` +
          `the vendor's current driver and release notes when the driver predates the game or workload ` +
          `you are troubleshooting.`,
        impact: { measured: {}, unquantified: ["frameTimeMs"] },
        tier: "situational",
        sources: [{ from: "Win32_VideoController", note: `driver dated ${gpu.driverDate}` }],
        remedy: null,
      });
    }
    return findings;
  },
};
