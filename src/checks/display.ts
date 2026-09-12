/**
 * The refresh rate the panel is actually running at.
 *
 * This is the first check in the repo because it is the one that most often finds something
 * real, it is measured exactly rather than guessed, and it is missing from every tweak list
 * in the genre. A monitor sold as 144Hz will happily run at 60 forever: plugged into the
 * wrong port, driven by a cable that cannot carry the mode, or simply never switched over
 * after a driver reinstall put it back to the safe default.
 *
 * Unlike almost everything else here, the cost is arithmetic rather than judgement. A
 * display cannot show you a frame sooner than its own refresh interval, so running a 144Hz
 * panel at 60Hz puts a 16.67ms floor under every frame where 6.94ms was available. The
 * 9.73ms difference is not an estimate of anything - it is the definition of the two modes.
 */
import type { Check, Display, Finding } from "../model.ts";
import { list } from "../shape.ts";

/** Frames arrive no faster than the panel refreshes, whatever the GPU manages. */
export const frameIntervalMs = (hz: number): number => 1000 / hz;

/** The highest mode the panel advertises. Null when nothing usable was reported - a remote
 *  session and some virtual displays report no mode list at all. */
export function bestMode(display: Display): number | null {
  const modes = list(display.availableHz).filter((hz) => Number.isFinite(hz) && hz > 0);
  return modes.length ? Math.max(...modes) : null;
}

/** Half a hertz of slack, because panels report 59.94 as 60 and 143.98 as 144 depending on
 *  which API you ask, and a report that nags about 0.02Hz is a report nobody finishes. */
const SLACK_HZ = 0.5;

export const displayRefresh: Check = {
  id: "display-refresh",
  rationale:
    "A panel running below its own top mode puts a floor under frame time that no amount " +
    "of tuning elsewhere can lift. It is measurable exactly, and it is the single most " +
    "common real finding on a machine somebody thinks is slow.",

  run(snapshot) {
    const findings: Finding[] = [];
    for (const [index, display] of list(snapshot.displays).entries()) {
      const current = display.currentHz;
      const best = bestMode(display);
      if (!current || !best) continue;
      if (current >= best - SLACK_HZ) continue;

      const cost = frameIntervalMs(current) - frameIntervalMs(best);
      const name = display.name ?? `Display ${index + 1}`;
      findings.push({
        id: `display-refresh:${name}`,
        title: `${name} is running at ${current}Hz on a panel that offers ${best}Hz`,
        detail:
          `At ${current}Hz a frame cannot be shown sooner than ${frameIntervalMs(current).toFixed(2)}ms; ` +
          `at ${best}Hz that floor is ${frameIntervalMs(best).toFixed(2)}ms. The difference is the ` +
          `definition of the two modes rather than a measurement of your hardware, so it holds ` +
          `whatever the GPU is managing - and it still helps when the GPU cannot reach ${best} ` +
          `frames a second, because a finished frame waits less time to be shown. ` +
          `This finding is wrong if the higher mode is one the cable or the port cannot carry, ` +
          `in which case Windows will refuse to set it and the fix is a cable rather than a setting.`,
        impact: { measured: { frameTimeMs: cost }, unquantified: [] },
        tier: "certain",
        sources: [{
          from: "QueryDisplayConfig / Win32_VideoController",
          note: `${current}Hz current, modes offered: ${list(display.availableHz).join(", ")}`,
        }],
        remedy: "Settings > System > Display > Advanced display > Choose a refresh rate",
      });
    }
    return findings;
  },
};
