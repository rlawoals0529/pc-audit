import { describe, expect, it } from "vitest";
import { gameDvr } from "./graphics.ts";
import type { Snapshot } from "../model.ts";

const snapshot = (gameDvr: boolean): Snapshot => ({
  schema: 1,
  collectedAt: "2026-09-13T00:00:00Z",
  real: true,
  graphics: { gameDvr },
});

describe("Game DVR finding", () => {
  it("never calls the general Game DVR switch background recording", () => {
    const finding = gameDvr.run(snapshot(true))[0]!;
    expect(finding.title).toBe("Game DVR is enabled");
    expect(finding.detail).toContain("does not claim that background recording is running");
    expect(finding.sources[0]?.from).toContain("GameDVR_Enabled");
    expect(finding.remedy).toBe("Settings > Gaming > Captures");
  });

  it("does not report when Game DVR is off", () => {
    expect(gameDvr.run(snapshot(false))).toEqual([]);
  });
});
