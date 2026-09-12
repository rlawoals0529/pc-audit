/**
 * The graphics settings that get named in every FPS guide, reported rather than changed -
 * and two of them reported with the caveat the guides leave off.
 */
import type { Check, Finding } from "../model.ts";
import { list } from "../shape.ts";

/** How old a driver has to be before it is worth mentioning. Two release cycles, roughly:
 *  vendors ship monthly, and chasing every release is its own kind of cargo cult. */
const STALE_DRIVER_DAYS = 120;

export const gameDvr: Check = {
  id: "game-dvr",
  rationale:
    "Background recording keeps an encoder running behind every game whether or not you " +
    "ever save a clip. It is on by default on a lot of installs.",

  run(snapshot) {
    if (snapshot.graphics?.gameDvr !== true) return [];
    return [{
      id: "game-dvr",
      title: "Game DVR background recording is on",
      detail:
        "Windows is keeping a rolling buffer of the last few minutes of whatever is running, " +
        "which means an encoder is working during every session whether or not you ever press " +
        "the key to save a clip. The cost depends on the encoder, the resolution and the " +
        "capture settings, so no figure is given here: it is real and it is not measured by " +
        "anything this tool can read. Turning it off does not remove Game Bar or the " +
        "screenshot key; it removes the buffer.",
      impact: { measured: {}, unquantified: ["frameTimeMs", "cpuPercent"] },
      tier: "likely",
      sources: [{ from: "HKCU\\System\\GameConfigStore\\GameDVR_Enabled" }],
      remedy: "Settings > Gaming > Captures > Record what happened",
    }];
  },
};

export const hags: Check = {
  id: "hags",
  rationale:
    "Hardware-accelerated GPU scheduling is on every FPS list as a straight win. It is not " +
    "one, and the honest report says so rather than telling you to flip it.",

  run(snapshot) {
    if (snapshot.graphics?.hags !== false) return [];
    return [{
      id: "hags",
      title: "Hardware-accelerated GPU scheduling is off",
      detail:
        "This hands some scheduling work from the driver to the GPU itself. Whether that helps " +
        "depends on the GPU, the driver and the game, and there are well-documented cases of it " +
        "costing frame time rather than saving it, particularly with capture and overlay " +
        "software running. It is listed here because it is a knob you may not know exists, and " +
        "with no number because the honest answer is to try it both ways and measure - which " +
        "is a thing you can do, and this tool cannot do for you.",
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
    "A driver old enough to predate a game is a common and unglamorous cause of bad frame " +
    "pacing. Age is measurable; what it costs is not.",

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
          `Age is not a fault on its own and newer is not automatically better - a regression in ` +
          `a fresh driver is an ordinary event. It is worth knowing when a driver predates the ` +
          `thing you are trying to run well.`,
        impact: { measured: {}, unquantified: ["frameTimeMs"] },
        tier: "situational",
        sources: [{ from: "Win32_VideoController", note: `driver dated ${gpu.driverDate}` }],
        remedy: null,
      });
    }
    return findings;
  },
};
