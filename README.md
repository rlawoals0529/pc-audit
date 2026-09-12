# pc-audit

A read-only audit of a Windows machine, billed against the goal you pick.

It changes nothing, it sends nothing anywhere, and it will not print a number it did not
measure.

**[rlawoals0529.github.io/pc-audit](https://rlawoals0529.github.io/pc-audit/)** - the report,
in your browser, on a synthetic sample or on your own machine.

## Why another one of these

The genre is mostly cargo cult. "Disable these 40 services", "set this timer resolution",
"+15 FPS" - recycled between forum posts for a decade, sourced from nothing, and several of
them actively harmful. What is missing is not another list. It is the two things a list never
has: a number that came from somewhere, and an account of which of the famous tweaks are
wrong.

So this repo has one rule, and it shapes everything else in it:

> A finding may report a number only in a dimension it has evidence for.

Not a default of zero, not an estimate, not a plausible-looking range. If a background service
is running and nobody knows what it costs in frame time, the report says **not measured** in
that column - and still lists the finding, still ranks it, just never lets a fabricated figure
stand next to a measured one where somebody could add them up. A zero would be worse than
silence, because a reader adds up a column without reading the prose beside it, and prose
cannot defuse a number.

## Profiles

The same machine, billed against different goals. A background service holding 40MB is nearly
free while you are playing a game and is real on a 4GB laptop. A service that adds 1.3 seconds
to boot costs you nothing once you are already in the game.

| Profile | Totals in | Excludes |
| --- | --- | --- |
| `default` | boot time | nothing |
| `fps` | frame time | boot time and power draw, neither of which you pay while playing |
| `boot` | boot time | everything that costs you only once you are logged in |
| `battery` | power | boot time, frame time and memory |

A profile is **not** a set of exchange rates. There is no honest number of milliseconds in a
megabyte, so a profile names one currency, totals that column and nothing else, and shows
every other measured figure in its own units beside the total rather than inside it.

Findings a profile excludes are **dropped, not demoted**. A boot-time line at the bottom of an
FPS report is still a line somebody reads and acts on, and the honest answer is that it is not
an answer to the question that was asked.

## What it actually finds

The checks are built around sources that already did the measuring:

- **A display running below its own top mode.** The most common real finding on a machine
  somebody thinks is slow, missing from every tweak list, and exact rather than estimated: a
  144Hz panel at 60Hz puts a 16.67ms floor under every frame where 6.94ms was available. The
  9.73ms is the definition of the two modes, not a guess about your hardware.
- **What Windows itself blamed for the boot.** Events 101-110 of
  `Microsoft-Windows-Diagnostics-Performance/Operational` name each application, service and
  driver that degraded the boot, each with a millisecond figure. The log is on by default and
  nobody reads it. It is strictly better evidence than any list of things to disable.
- **Whether boot is getting worse,** as a median of recent boots against a median of earlier
  ones. One boot time is noise.
- **Third-party services that start themselves and that nothing depends on** - read from your
  machine's own dependency graph rather than from a list written for Windows 7.
- **Scheduled tasks that run at logon,** which are startup items that never appear in Task
  Manager's startup list.
- **Commit charge against the commit limit,** which is the figure that says whether a machine
  is short of memory. "Free RAM" is not that figure and never was.

## What it will not tell you to do

The refusal list is the part of this repo with no equivalent elsewhere, and it is why the tool
is read-only. Eleven entries, each written the way the claim is usually made so you can find
the one you just read somewhere else. A few:

| Tweak | Verdict | Short version |
| --- | --- | --- |
| Turn off Defender real-time protection | harmful | Small situational gain, unbounded loss. Exclude a build directory instead. |
| Tick the processor count box in msconfig | no effect | That box is a debugging *limiter*. The advice has the control backwards. |
| Turn the pagefile off, you have enough RAM | harmful | The commit limit is RAM **plus** pagefile. Programs start failing on a machine with free RAM. |
| Run a registry cleaner | no effect | The registry is indexed, not scanned. Two decades, no measurement. |
| Defragment your drives | obsolete | Contiguity matters when a head physically moves. An SSD has no head. |
| Force the timer to 0.5ms | depends | Global, raises power draw, and Windows 10 2004 changed the behaviour most of the advice describes. |

`node bin/pc-audit.mjs --refusals` prints all eleven.

## Use it

Run this in PowerShell. It reads; there is no cmdlet in it that can change anything.

```
powershell -ExecutionPolicy Bypass -File collect\pc-audit.ps1 > report.json
```

Add `-Redact` before pasting a snapshot anywhere. It replaces your username, your home
directory and your machine name with placeholders, and rewrites any other user directory it
finds. The analyzer never reads paths, so a redacted snapshot produces exactly the same
findings. CI checks on a real Windows runner that the redacted output names neither the
account nor the machine and is still valid JSON - a redaction that quietly corrupts the file
it is protecting is worse than none, because you find out after you have sent it.

```
powershell -ExecutionPolicy Bypass -File collect\pc-audit.ps1 -Redact > report.json
```

Then either drop `report.json` on
[the page](https://rlawoals0529.github.io/pc-audit/) - it is parsed in your tab, and the page
makes no network requests at all after it loads - or run it locally:

```bash
node bin/pc-audit.mjs report.json --profile fps
```

Any encoding works. Windows PowerShell 5.1 - the one that ships with Windows - writes `>`
redirection as UTF-16 with a byte order mark, and the reader handles that, UTF-8 with a mark,
and UTF-8 without one. Telling you to add an encoding flag would have been the lazy fix; this
was found by CI on a real Windows runner rather than by anyone reading the code.

No install and no build step: the CLI imports the analyzer straight from `src/*.ts`, which
Node does on its own from 22.18. That is why every import here carries an explicit `.ts`
extension.

## Read it before you run it

You are being asked to run something from the internet on your own machine, so:

- `collect/pc-audit.ps1` is under 500 lines and written to be read top to bottom.
- **It contains no cmdlet with a mutating verb**, and that is checked rather than promised -
  `src/collector.test.ts` scans the source for all 26 of them, and the test that proves the
  scan can fail is right next to it.
- Nothing is sent anywhere. There is no `Invoke-WebRequest`, no `System.Net`, no redirect into
  a file. The output goes to stdout and where it goes next is yours.
- Every source is read inside its own handler. A source that cannot be read - and several need
  an elevated session - is **reported** in the output rather than stopping the run, because
  "found nothing" and "was not allowed to look" are different answers and only one of them is
  good news.

## What is verified, and what is not

Worth being exact about, since half of this repo targets an operating system:

| | |
| --- | --- |
| The analyzer, profiles, cost model, ranking, report, file encodings | 45 unit tests |
| The page, in all 15 palettes over a white and a black backdrop | 13 browser tests, contrast measured rather than eyeballed |
| The collector cannot write, cannot send, and wraps every source | checked by scanning the source, in the fast suite |
| **The collector actually runs** | **CI, on a real `windows-latest` runner** - it collects, the snapshot is checked for shape, and all four profiles are built from it |

That last row is the one that matters. Everything else about the collector can be checked by
reading; whether it runs can only be answered by running it on Windows, so CI does exactly
that on every push and fails if any check throws against a real snapshot.

A GitHub runner is not a gaming PC - one virtual display, no battery, a boot log going back
minutes - so it proves the collector completes and emits something the analyzer reads. It does
not prove the numbers are interesting on your machine.

## Develop

```bash
npm install
npm run dev      # http://localhost:4192/site/
npm test         # the analyzer and the collector scan
npm run e2e      # the page, including contrast in all fifteen palettes
npm run check    # all of it
```

Colours are [yozora](https://github.com/rlawoals0529/yozora), vendored into `theme/`. Do not
edit anything in there; re-run that repo's `vendor.mjs`.

MIT
