/**
 * What a finding is, and the rule that shapes everything else here.
 *
 * The genre this belongs to is full of numbers nobody measured. "Saves 2GB of RAM", "adds
 * 15 FPS" - repeated for a decade, sourced from nothing. The rule that keeps this tool out
 * of that company is simple and absolute:
 *
 *   A finding may report a number ONLY in a dimension it has evidence for.
 *
 * Not a default of zero, not an estimate, not a plausible-looking range. If a background
 * service is running and nobody knows what it costs in frame time, the honest output is
 * that it is UNQUANTIFIED in frame time - and it still gets reported, still gets ranked,
 * just never gets a fabricated millisecond count standing next to measured ones in the
 * same column. A zero would be worse than silence: a reader adds up a column without
 * reading the prose beside it, and prose cannot defuse a number.
 *
 * That is why `Impact` has two halves that cannot be mixed, and why the report has two
 * sections with only one total.
 */

/** The units anything here can cost you. Kept small on purpose: a dimension exists only if
 *  some check can actually measure it from the collected snapshot. */
export type Dimension =
  | "bootMs"
  | "frameTimeMs"
  | "loadSeconds"
  | "memoryMb"
  | "cpuPercent"
  | "watts";

export const DIMENSIONS: readonly Dimension[] = [
  "bootMs", "frameTimeMs", "loadSeconds", "memoryMb", "cpuPercent", "watts",
];

/** How the units read in a report. */
export const UNITS: Record<Dimension, { short: string; label: string }> = {
  bootMs: { short: "ms", label: "boot time" },
  frameTimeMs: { short: "ms/frame", label: "frame time" },
  loadSeconds: { short: "s", label: "load time" },
  memoryMb: { short: "MB", label: "memory" },
  cpuPercent: { short: "%", label: "CPU" },
  watts: { short: "W", label: "power" },
};

/**
 * How sure we are that an unquantified finding matters at all.
 *
 * This is the ONLY ordering allowed for things without numbers, and it is deliberately
 * coarse - three tiers, not a 0-100 score, because a score is a number and a number invites
 * arithmetic. You cannot add tiers up, which is the point.
 */
export type Tier = "certain" | "likely" | "situational";

export const TIER_ORDER: Record<Tier, number> = { certain: 0, likely: 1, situational: 2 };

/** Where a number came from. Every measured figure carries one, so the report can show its
 *  working and a reader can go and check it. */
export interface Source {
  /** The API, log or registry path the evidence was read from. */
  from: string;
  /** What was read, in the reader's own words. */
  note?: string;
}

export interface Impact {
  /**
   * Dimensions this finding has EVIDENCE for, with the number.
   *
   * A dimension absent from here is not zero. It is unknown, and if the profile cares about
   * it, it belongs in `unquantified` instead.
   */
  measured: Partial<Record<Dimension, number>>;
  /** Dimensions this finding plausibly affects but which nothing here can measure. */
  unquantified: Dimension[];
}

export interface Finding {
  /** Stable across runs and versions, so a report can be diffed against an older one. */
  id: string;
  /**
   * Whether this costs you something, or endangers you.
   *
   * A risk finding is what this tool says when it notices that one of the popular "tweaks"
   * has already been applied - real-time protection off, Windows Update disabled. It has no
   * cost in any dimension, so cost ranking says nothing about it and profile filtering would
   * drop it from every report. It is carried in its own section instead, shown whatever the
   * profile, because "your machine is fast and unpatched" is not a finding to bury.
   */
  kind?: "cost" | "risk";
  /** One line. What is true, not what to do about it. */
  title: string;
  /** The reasoning, including what would make this finding wrong. */
  detail: string;
  impact: Impact;
  tier: Tier;
  sources: Source[];
  /**
   * The command a person would run to change this, printed and never executed.
   *
   * Null where there is nothing to run - a hardware fact, or something that is a setting in
   * an application rather than in Windows.
   */
  remedy: string | null;
  /** Cross-reference into the refusal list, when the obvious "fix" for this is one of the
   *  things this tool argues against. */
  refusal?: string;
}

/** A check reads the snapshot and returns what it found. Returning [] is the normal case on
 *  a healthy machine and is not an error. */
export interface Check {
  id: string;
  /** Why this check exists, shown in `--explain`. */
  rationale: string;
  run(snapshot: Snapshot): Finding[];
}

/* ------------------------------------------------------------------------------------ */
/* The snapshot: exactly what collect/pc-audit.ps1 emits.                                  */
/* ------------------------------------------------------------------------------------ */

/**
 * Every field is optional, and that is load-bearing rather than lazy.
 *
 * The collector runs on Windows versions and editions nobody here can enumerate, without
 * administrator rights unless you give them, and several of its sources simply are not
 * present on some machines - a desktop has no battery, a fresh install has no boot history,
 * a locked-down build denies the event log. A check that assumes a field exists crashes the
 * run and takes every other finding with it. So the schema says "may be absent" everywhere,
 * and a check that needs a field says so by returning nothing without it.
 */
export interface Snapshot {
  schema: 1;
  collectedAt: string;
  /** True only when the collector was told it was looking at a real machine. The bundled
   *  sample sets this false, so a demo can never be mistaken for somebody's readout. */
  real: boolean;
  machine?: {
    windows?: string;
    build?: string;
    elevated?: boolean;
    /** Whether the collector could read each source. A source it could NOT read is reported,
     *  rather than silently producing no findings - "nothing found" and "did not look" are
     *  different answers and only one of them is good news. */
    unreadable?: string[];
  };
  displays?: Display[];
  boot?: BootRecord[];
  startup?: StartupItem[];
  services?: ServiceItem[];
  tasks?: TaskItem[];
  memory?: { totalMb?: number; availableMb?: number; committedMb?: number; commitLimitMb?: number };
  storage?: StorageItem[];
  gpu?: GpuItem[];
  power?: { activePlan?: string; activePlanGuid?: string; onBattery?: boolean };
  graphics?: {
    /** Hardware-accelerated GPU scheduling. */
    hags?: boolean;
    /** Game DVR background recording. */
    gameDvr?: boolean;
    gameBar?: boolean;
    /** Variable refresh rate, as Windows reports it. */
    vrr?: boolean;
  };
  defender?: { realtimeEnabled?: boolean; signatureAgeDays?: number };
  updates?: { serviceStartMode?: string; lastInstalledDays?: number };
}

export interface Display {
  name?: string;
  /** What it is running at right now. */
  currentHz?: number;
  /** Every mode the panel advertises at the current resolution. */
  availableHz?: number[];
  width?: number;
  height?: number;
  primary?: boolean;
}

/** One row of Microsoft-Windows-Diagnostics-Performance/Operational, event 100. */
export interface BootRecord {
  at: string;
  bootMs?: number;
  mainPathBootMs?: number;
  postBootMs?: number;
  /** Events 101-110: the individual things Windows itself blamed, with their cost. */
  degraded?: { name: string; kind: "app" | "service" | "driver"; ms: number }[];
}

export interface StartupItem {
  name?: string;
  command?: string;
  publisher?: string;
  /** Explorer records this; it is the only place "disabled in Task Manager" lives. */
  enabled?: boolean;
}

export interface ServiceItem {
  name?: string;
  display?: string;
  state?: string;
  startMode?: string;
  /** Signed by Microsoft. Used to rank, never to accuse: plenty of third-party services
   *  are load-bearing, and plenty of Microsoft ones are not needed on a given machine. */
  microsoft?: boolean;
  /** Services that depend on this one. Empty means nothing would break. */
  dependents?: string[];
  memoryMb?: number;
}

export interface TaskItem {
  path?: string;
  name?: string;
  state?: string;
  triggers?: string[];
  author?: string;
}

export interface StorageItem {
  drive?: string;
  /** "SSD", "HDD", "Unspecified" - as Windows reports MediaType. */
  mediaType?: string;
  busType?: string;
  totalGb?: number;
  freeGb?: number;
  /** Only meaningful on spinning disks, which is the whole point of reading MediaType. */
  fragmentationPercent?: number;
  system?: boolean;
}

export interface GpuItem {
  name?: string;
  driverVersion?: string;
  driverDate?: string;
  memoryMb?: number;
}
