/**
 * The collector, checked as text.
 *
 * These started life as Pester tests and are better here, for a reason worth writing down:
 * every property below is a property of the SOURCE, and checking it needs a reader rather
 * than a PowerShell host. Moving them means the most important guarantee this repo makes -
 * that the thing you are asked to run on your own machine cannot change anything - is
 * verified by the suite that runs on every developer's machine in under a second, instead of
 * by one that needs a container.
 *
 * What genuinely needs a PowerShell host is whether the collector RUNS, and that is answered
 * in CI on a real Windows runner rather than approximated in a fixture here. Attempting it
 * locally is what proved it could not be done honestly: PowerShell in Docker on Apple
 * Silicon aborts the .NET runtime outright, and a test that cannot run is worse than one
 * that is somewhere else.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../collect/pc-audit.ps1", import.meta.url), "utf8");

/**
 * PowerShell's approved verbs make this a reliable classifier rather than a guess: anything
 * that changes state is named with one of these by convention, and the convention is enforced
 * hard enough that violating it warns at module load.
 */
const MUTATING = [
  "Set", "New", "Remove", "Clear", "Stop", "Start", "Restart", "Disable", "Enable",
  "Rename", "Move", "Copy", "Add", "Install", "Uninstall", "Register", "Unregister",
  "Optimize", "Repair", "Reset", "Suspend", "Resume", "Invoke", "Write", "Export", "Import",
];

/**
 * Changes nothing outside this process. Named one by one rather than loosening the pattern,
 * so every exception stays visible in the diff that adds it.
 *
 * New-Object is the interesting one. The verb is on the list because New-Item and
 * New-ItemProperty write to disk and to the registry, but New-Object only constructs a .NET
 * object in memory - an ArrayList, a WindowsPrincipal - and in PowerShell 5.1 there is no
 * other way to do that.
 */
const ALLOWED = new Set(["Set-StrictMode", "Set-Location", "New-Object"]);

/**
 * The code, with the prose taken out.
 *
 * Scanning the whole file was the first version, and it failed on the script's own
 * documentation: the .EXAMPLE block shows `pc-audit.ps1 > report.json`, which is the READER
 * redirecting stdout in their own shell rather than the script writing anywhere. A comment
 * that names a cmdlet is likewise a comment. Anything genuinely dangerous has to appear as
 * code in order to run.
 */
export function code(text: string): string {
  return text.replace(/<#[\s\S]*?#>/g, "").replace(/(^|\s)#.*$/gm, "$1");
}

export function mutatingCalls(text: string): string[] {
  const found = new Set<string>();
  for (const verb of MUTATING) {
    for (const match of code(text).matchAll(new RegExp(`\\b${verb}-[A-Za-z]+`, "g"))) {
      if (!ALLOWED.has(match[0])) found.add(match[0]);
    }
  }
  return [...found].sort();
}

describe("the collector cannot change anything", () => {
  it("calls no cmdlet with a mutating verb", () => {
    // You are being asked to run this on your own machine. A promise nobody can check is
    // worth what it costs to make, which is nothing.
    expect(mutatingCalls(source)).toEqual([]);
  });

  it("would catch one if it were added", () => {
    // The guard above passes trivially on an empty file, and a guard that cannot fail is
    // the thing this whole repo is about.
    expect(mutatingCalls("Set-ItemProperty -Path HKLM:\\x -Name y -Value 1")).toEqual(["Set-ItemProperty"]);
    expect(mutatingCalls("Stop-Service wuauserv")).toEqual(["Stop-Service"]);
  });

  it("lets the two harmless ones through, and only those two", () => {
    expect(mutatingCalls("Set-StrictMode -Version 2.0")).toEqual([]);
    expect(mutatingCalls("Set-Content out.txt")).toEqual(["Set-Content"]);
  });

  it("never redirects into a file", () => {
    // A script that calls no writing cmdlet can still write through the shell.
    expect(code(source)).not.toMatch(/\s>\s*[A-Za-z$'"]/);
    expect(code(source)).not.toMatch(/Out-File|Tee-Object/);
  });

  it("would catch a redirect if one were added, and still ignore the documented one", () => {
    expect(code("Get-Thing > out.json")).toMatch(/\s>\s*[A-Za-z$'"]/);
    const help = "<#\n.EXAMPLE\n  pc-audit.ps1 > report.json\n#>\nGet-Thing";
    expect(code(help)).not.toMatch(/\s>\s*[A-Za-z$'"]/);
  });

  it("sends nothing anywhere", () => {
    expect(source).not.toMatch(/Invoke-RestMethod|Invoke-WebRequest|System\.Net\.|Start-BitsTransfer/);
  });
});

describe("the collector is readable before it is run", () => {
  it("says what it does at the top, in comment-based help", () => {
    expect(source).toMatch(/\.SYNOPSIS/);
    expect(source).toMatch(/\.EXAMPLE/);
  });

  it("stays short enough to actually read", () => {
    // Not a style rule. The security argument for this script is "read it first", and that
    // argument expires somewhere around a thousand lines.
    const lines = source.split("\n").length;
    expect(lines).toBeLessThan(600);
  });

  it("routes every source through the handler that records what it could not read", () => {
    // A source read outside Read-Source takes the whole run down when it is denied, which on
    // a machine without administrator rights is most of them.
    const cims = [...source.matchAll(/Get-CimInstance/g)].length;
    const readers = [...source.matchAll(/Read-Source -Name/g)].length;
    expect(cims).toBeGreaterThan(5);
    expect(readers).toBeGreaterThan(8);
  });

  it("targets Windows PowerShell 5.1, so a stock machine needs nothing installed", () => {
    // The modern operators are the easy way to break that without noticing.
    expect(source).not.toMatch(/\?\?|\?\./);
    expect(source).not.toMatch(/-Parallel/);
  });
});
