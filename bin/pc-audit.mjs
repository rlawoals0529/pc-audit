#!/usr/bin/env node
/**
 * The command-line half.
 *
 * Imports the analyzer straight from `src/*.ts` with no build step, which Node does on its
 * own from 22.18 onwards. That is why every import in this repo carries an explicit `.ts`
 * extension: it is the one thing Node's type stripping needs that a bundler does not.
 *
 *   node bin/pc-audit.mjs report.json --profile fps
 *   node bin/pc-audit.mjs fixtures/sample.json --profile boot --json
 *   node bin/pc-audit.mjs --refusals
 */
import { readFileSync } from "node:fs";
import { build, describeTotal } from "../src/report.ts";
import { PROFILES, profileById } from "../src/profiles.ts";
import { REFUSALS } from "../src/refusals.ts";
import { UNITS } from "../src/model.ts";

const argv = process.argv.slice(2);
const flag = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : undefined;
};
const has = (name) => argv.includes(`--${name}`);

const die = (message) => {
  console.error(`pc-audit: ${message}`);
  process.exit(1);
};

if (has("refusals")) {
  for (const r of REFUSALS) {
    console.log(`\n${r.tweak}\n  claim    ${r.claim}\n  verdict  ${r.verdict}\n  why      ${wrap(r.why, 11)}`);
  }
  console.log("");
  process.exit(0);
}

const file = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--profile");
if (!file) {
  die(
    "give a snapshot file.\n" +
    "  Collect one on Windows:  powershell -ExecutionPolicy Bypass -File collect\\pc-audit.ps1 > report.json\n" +
    `  Profiles: ${PROFILES.map((p) => p.id).join(", ")}\n` +
    "  Or try it on the bundled synthetic sample: node bin/pc-audit.mjs fixtures/sample.json",
  );
}

const profileId = flag("profile") ?? "default";
const profile = profileById(profileId);
if (!profile) die(`unknown profile "${profileId}". One of: ${PROFILES.map((p) => p.id).join(", ")}`);

let snapshot;
try {
  snapshot = JSON.parse(readFileSync(file, "utf8"));
} catch (error) {
  die(`could not read ${file}: ${error.message}`);
}

let report;
try {
  report = build(snapshot, profile);
} catch (error) {
  die(error.message);
}

if (has("json")) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

function wrap(text, indent) {
  const width = 92 - indent;
  const pad = " ".repeat(indent);
  const out = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if ((line + " " + word).trim().length > width) { out.push(line.trim()); line = word; }
    else line += ` ${word}`;
  }
  if (line.trim()) out.push(line.trim());
  return out.join(`\n${pad}`);
}

/*
 * The amount column carries the profile's currency and nothing else.
 *
 * Falling back to "whatever this finding did measure" was the first version, and it put a
 * megabyte figure in the same column as a millisecond one, under a heading that totals
 * milliseconds. One column, one unit. Anything else a finding measured is named on the line
 * below, in its own units, where it cannot be read as part of the total.
 */
const amount = (finding) => {
  const value = finding.impact.measured[profile.currency];
  if (value == null) return "         -";
  const unit = UNITS[profile.currency];
  const shown = profile.currency === "bootMs"
    ? `${(value / 1000).toFixed(1)}s`
    : `${value.toFixed(value < 10 ? 2 : 0)}${unit.short}`;
  return shown.padStart(10);
};

/** Everything else this finding measured, for the line under the title. */
const alsoMeasured = (finding) =>
  Object.entries(finding.impact.measured)
    .filter(([d]) => d !== profile.currency)
    .map(([d, v]) => `${v.toFixed(v < 10 ? 2 : 0)}${UNITS[d].short} of ${UNITS[d].label}`);

console.log(`\npc-audit - ${profile.label}`);
console.log(`${profile.summary}`);
console.log(`Excluded: ${profile.excludes}`);
if (!report.real) {
  console.log(`\n  !  This snapshot is marked synthetic. These are not numbers from a real machine.`);
}
console.log(`\nCollected ${report.collectedAt}\n`);

if (!report.costs.length) {
  console.log("  Nothing found for this profile.");
} else {
  for (const finding of report.costs) {
    console.log(`${amount(finding)}  ${finding.title}`);
    const unquantified = finding.impact.unquantified.length
      ? `unquantified in ${finding.impact.unquantified.map((d) => UNITS[d].label).join(" and ")}`
      : null;
    console.log(`            ${[finding.tier, ...alsoMeasured(finding), unquantified].filter(Boolean).join(", ")}`);
    console.log(`            ${wrap(finding.detail, 12)}`);
    for (const source of finding.sources) console.log(`            source: ${source.from}${source.note ? ` (${source.note})` : ""}`);
    if (finding.remedy) console.log(`            run: ${finding.remedy}`);
    if (finding.refusal) console.log(`            see --refusals: ${finding.refusal}`);
    console.log("");
  }
  console.log(`  TOTAL   ${describeTotal(report.total)}`);
  if (report.total.from) console.log(`          ${wrap(profile.totalMeans, 10)}`);
  console.log("");
}

if (report.risks.length) {
  console.log(`Risks, shown whatever profile you asked for:\n`);
  for (const finding of report.risks) {
    console.log(`  !  ${finding.title}`);
    console.log(`     ${wrap(finding.detail, 5)}`);
    if (finding.remedy) console.log(`     fix: ${finding.remedy}`);
    console.log("");
  }
}

if (report.gaps.length) {
  console.log(`Not read, so not reported on:\n`);
  for (const gap of report.gaps) console.log(`  -  ${gap}`);
  console.log(`\n  "Nothing found" and "did not look" are different answers.\n`);
}

if (report.refusals.length) {
  console.log(`Findings above touch these refusals - run --refusals for the full list:\n`);
  for (const r of report.refusals) console.log(`  -  ${r.tweak} (${r.verdict})`);
  console.log("");
}
