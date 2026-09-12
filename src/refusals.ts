/**
 * The tweaks this tool will not recommend, and why.
 *
 * This list is the reason the repo exists. Anyone can enumerate services to disable; the
 * useful and missing artifact is a written account of which of the famous tweaks are
 * harmful, which do nothing, and which were once true and have not been for a decade. Every
 * entry names the claim as it is usually made, so it can be found by someone who has just
 * read it somewhere else.
 *
 * A refusal is not "never do this". Several are marked `depends`, and that is the honest
 * verdict for them. What is refused is the recommendation - this tool will not tell you to
 * do it, and where a finding's obvious fix is one of these, the finding links here.
 */

export type Verdict =
  /** Trades a small or situational gain for a large or unbounded loss. */
  | "harmful"
  /** No measurable effect. Not dangerous, just not true. */
  | "no-effect"
  /** Was true once, on hardware or a Windows version that is no longer what you have. */
  | "obsolete"
  /** Genuinely depends, and the usual advice states it as though it does not. */
  | "depends";

export interface Refusal {
  id: string;
  /** What you are told to do, in the words it is usually put in. */
  tweak: string;
  /** What it is claimed to achieve. */
  claim: string;
  verdict: Verdict;
  why: string;
}

export const REFUSALS: Refusal[] = [
  {
    id: "disable-defender",
    tweak: "Turn off Windows Defender real-time protection",
    claim: "Removes file-scanning overhead, especially during compilation and game loading",
    verdict: "harmful",
    why:
      "The overhead is real and is usually small; the exposure it buys is not bounded by " +
      "anything. If you want the compile-time part of this without the rest, exclude a " +
      "specific build directory rather than turning protection off - that is a supported " +
      "setting and it is the narrow version of the same idea.",
  },
  {
    id: "disable-windows-update",
    tweak: "Set the Windows Update service to Disabled",
    claim: "Stops background downloads and forced restarts",
    verdict: "harmful",
    why:
      "It does not stop updates, it defers them into a pile. The catch-up run is longer and " +
      "more disruptive than the thing being avoided, and in the meantime nothing is patched. " +
      "Active hours and pause-for-a-week are the supported versions of this complaint.",
  },
  {
    id: "defragment-an-ssd",
    tweak: "Run a defragmenter over your drives regularly",
    claim: "Keeps files contiguous, so reads are faster",
    verdict: "obsolete",
    why:
      "Contiguity matters when a head has to physically move. An SSD has no head; the " +
      "operation becomes writes that consume endurance for no benefit. Windows already does " +
      "the right thing per drive - TRIM on solid state, defrag on spinning - which is why " +
      "the scheduled task is called Optimize Drives rather than Defragment.",
  },
  {
    id: "force-timer-resolution",
    tweak: "Force the system timer to 0.5ms with a resolution tool",
    claim: "Lower input latency and smoother frame pacing",
    verdict: "depends",
    why:
      "The timer resolution is global and raising it raises power draw and wakeups across " +
      "the whole machine. Windows 10 2004 changed how a process's request affects other " +
      "processes, so a lot of advice written before it describes behaviour that is no longer " +
      "current. If you want this, measure frame times with and without it on your own " +
      "machine - it is exactly the kind of claim that is easy to test and rarely tested.",
  },
  {
    id: "disable-sysmain",
    tweak: "Disable SysMain, formerly Superfetch",
    claim: "Stops constant background disk activity",
    verdict: "depends",
    why:
      "On a spinning disk it earns its keep by reading ahead. On solid state the benefit is " +
      "small and the service is cheap, so disabling it is close to a no-op in both " +
      "directions. The advice dates from a period when a specific bug made it pathological, " +
      "and it has outlived the bug by a decade.",
  },
  {
    id: "disable-pagefile",
    tweak: "Turn the pagefile off because you have enough RAM",
    claim: "Stops Windows writing to disk when memory is free",
    verdict: "harmful",
    why:
      "Applications commit far more address space than they ever touch, and the commit limit " +
      "is physical memory plus the pagefile. Removing it lowers the ceiling on allocations " +
      "that were never going to be written anywhere, so programs start failing on a machine " +
      "with free RAM. It also removes crash dumps, which is how you would have diagnosed it.",
  },
  {
    id: "registry-cleaner",
    tweak: "Run a registry cleaner",
    claim: "A smaller registry is a faster registry",
    verdict: "no-effect",
    why:
      "The registry is indexed, not scanned end to end, so its size is close to irrelevant " +
      "to lookup cost. There is no measurement showing otherwise in any of the two decades " +
      "this has been sold, and the failure mode - removing a key something needed - is silent " +
      "until it is not.",
  },
  {
    id: "msconfig-processor-count",
    tweak: "Tick the processor count box in msconfig and set it to your core count",
    claim: "Makes Windows use all your cores at boot",
    verdict: "no-effect",
    why:
      "That box is a debugging limiter. Unticked, Windows uses every core. Ticking it and " +
      "entering your core count changes nothing at best, and entering a smaller number - " +
      "which the dropdown makes easy - permanently restricts the machine. The advice has the " +
      "control exactly backwards.",
  },
  {
    id: "delete-winsxs",
    tweak: "Delete the contents of WinSxS to reclaim space",
    claim: "Frees tens of gigabytes of duplicated files",
    verdict: "harmful",
    why:
      "Most of what looks duplicated there is hard links, so the space reported is not the " +
      "space you get. It is the component store servicing depends on; removing it by hand " +
      "breaks updates and repair. DISM /StartComponentCleanup is the supported way to reclaim " +
      "the part that is genuinely reclaimable.",
  },
  {
    id: "service-disable-lists",
    tweak: "Apply a list of services to set to Disabled",
    claim: "Frees memory and reduces background activity",
    verdict: "harmful",
    why:
      "The lists in circulation were written for Windows 7 and are copied between posts " +
      "without revision. Several entries now break printing, the Store, or Windows Hello. " +
      "This tool reports what is running on your machine and what depends on it instead, " +
      "because that is a fact about your machine and a list is not.",
  },
  {
    id: "network-tweak-registry",
    tweak: "Set NetworkThrottlingIndex to ffffffff and disable Nagle",
    claim: "Lower ping and less lag in games",
    verdict: "depends",
    why:
      "Both are real settings with real effects in specific conditions - the throttle exists " +
      "to protect multimedia streaming, and Nagle trades latency for efficiency on small " +
      "packets. Neither changes the network between you and the server, which is where " +
      "almost all of the latency you notice lives. Measure before and after with something " +
      "that reports percentiles, not with a single ping.",
  },
];

export const refusalById = (id: string): Refusal | undefined => REFUSALS.find((r) => r.id === id);
