/**
 * Every check, in one list.
 *
 * Registered explicitly rather than discovered from the directory: a glob means a file added
 * to the folder silently starts running against everybody's machine, and a check that nobody
 * chose to register is a check nobody reviewed.
 */
import type { Check } from "../model.ts";
import { displayRefresh } from "./display.ts";
import { bootDegraded, bootTrend, startupItems } from "./boot.ts";
import { driverAge, gameDvr, hags } from "./graphics.ts";
import { idleServices, logonTasks } from "./services.ts";
import { defenderOff, fragmentation, memoryPressure, powerPlan, systemDrive, updatesDisabled } from "./system.ts";

export const CHECKS: Check[] = [
  displayRefresh,
  bootDegraded,
  bootTrend,
  startupItems,
  gameDvr,
  hags,
  driverAge,
  idleServices,
  logonTasks,
  systemDrive,
  fragmentation,
  memoryPressure,
  powerPlan,
  defenderOff,
  updatesDisabled,
];
