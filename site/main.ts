/**
 * The page: the same analyzer the command line runs, rendering a bill.
 *
 * Two things are worth knowing about how this is wired.
 *
 * It imports `src/report.ts` directly, so there is exactly one implementation of every
 * judgement in this repo and no chance of the page and the CLI disagreeing about what your
 * machine costs you. The only thing here is rendering.
 *
 * And it makes no network requests, ever. Your snapshot is parsed in this tab and stays
 * there. That is not a policy - there is no code here that could send it anywhere, which is
 * the only version of that promise worth making about a file describing your own machine.
 */
import { build, describeTotal, ReportError, type Report } from "../src/report.ts";
import { PROFILES, profileById, type Profile } from "../src/profiles.ts";
import { REFUSALS } from "../src/refusals.ts";
import { UNITS, type Finding, type Snapshot } from "../src/model.ts";
import { createThemeStore, DEFAULT_THEME, grouped, type Theme } from "../lib/theme.ts";
import { wirePalette } from "../lib/palette-keys.ts";
import sample from "../fixtures/sample.json";
import palettes from "../theme/palettes.json";

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let snapshot = sample as unknown as Snapshot;
let profile: Profile = PROFILES[1]!; // Frame rate, because it is the one people arrive for.

/* ---- Rendering ---------------------------------------------------------------------- */

const text = (tag: string, className: string, content: string): HTMLElement => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = content;
  return node;
};

/** The amount column, in the profile's currency and nothing else. A finding that measured
 *  something in another unit says so on the line below, where it cannot be read as part of
 *  the total. */
function amount(finding: Finding): HTMLElement {
  const value = finding.impact.measured[profile.currency];
  if (value == null) {
    const node = text("div", "amount none", "not measured");
    node.title = "Nothing here measured this. That is not the same as zero.";
    return node;
  }
  const unit = UNITS[profile.currency];
  const shown = profile.currency === "bootMs"
    ? `${(value / 1000).toFixed(1)}s`
    : `${value.toFixed(value < 10 ? 2 : 0)}${unit.short}`;
  return text("div", "amount", shown);
}

function metaLine(finding: Finding): string {
  const also = Object.entries(finding.impact.measured)
    .filter(([d]) => d !== profile.currency)
    .map(([d, v]) => `${v.toFixed(v < 10 ? 2 : 0)}${UNITS[d as keyof typeof UNITS].short} of ${UNITS[d as keyof typeof UNITS].label}`);
  const unknown = finding.impact.unquantified.length
    ? `unquantified in ${finding.impact.unquantified.map((d) => UNITS[d].label).join(" and ")}`
    : null;
  return [...also, unknown].filter(Boolean).join(" · ");
}

function renderLine(finding: Finding): HTMLElement {
  const line = document.createElement("article");
  line.className = "line";
  line.append(amount(finding));
  line.append(text("h3", "", finding.title));

  const meta = document.createElement("p");
  meta.className = "meta";
  meta.append(text("span", `tier tier-${finding.tier}`, finding.tier));
  const rest = metaLine(finding);
  if (rest) meta.append(document.createTextNode(` · ${rest}`));
  line.append(meta);

  line.append(text("p", "detail", finding.detail));

  const evidence = document.createElement("p");
  evidence.className = "evidence";
  evidence.append(document.createTextNode("Read from "));
  for (const [index, source] of finding.sources.entries()) {
    if (index) evidence.append(document.createTextNode(", "));
    evidence.append(text("code", "", source.from));
    if (source.note) evidence.append(document.createTextNode(` (${source.note})`));
  }
  line.append(evidence);

  if (finding.remedy) {
    const remedy = document.createElement("p");
    remedy.className = "remedy";
    remedy.append(text("code", "", finding.remedy));
    line.append(remedy);
  }
  return line;
}

function renderAside(className: string, heading: string, items: string[], footer?: string): HTMLElement {
  const aside = document.createElement("section");
  aside.className = `aside ${className}`;
  aside.append(text("h3", "", heading));
  const list = document.createElement("ul");
  for (const item of items) list.append(text("li", "", item));
  aside.append(list);
  if (footer) aside.append(text("p", "note", footer));
  return aside;
}

function render(report: Report) {
  el("summary").textContent = `${profile.summary} Excluded: ${profile.excludes}`;

  const out = el("statement");
  out.replaceChildren();

  if (!report.real) {
    out.append(text(
      "p", "synthetic",
      "This is the bundled sample, and it is synthetic. Every figure below is arithmetic over " +
      "made-up inputs, shown so the page has something to render. It is not a real machine.",
    ));
  }

  if (!report.costs.length) {
    out.append(text("p", "note", "Nothing found for this profile."));
  } else {
    for (const finding of report.costs) out.append(renderLine(finding));

    const total = document.createElement("div");
    total.className = "total";
    const unit = UNITS[report.total.dimension];
    const shown = report.total.from === 0
      ? "no total"
      : report.total.dimension === "bootMs"
        ? `${(report.total.value / 1000).toFixed(1)}s`
        : `${report.total.value.toFixed(report.total.value < 10 ? 2 : 0)}${unit.short}`;
    total.append(text("div", report.total.from ? "amount" : "amount none", shown));
    total.append(text("p", "says", describeTotal(report.total)));
    if (report.total.from) total.append(text("p", "means", profile.totalMeans));
    out.append(total);
  }

  if (report.risks.length) {
    out.append(renderAside(
      "risk",
      "Risks, shown whatever profile you picked",
      report.risks.map((f) => `${f.title}. ${f.detail}`),
    ));
  }

  if (report.gaps.length) {
    out.append(renderAside(
      "",
      "Not read, so not reported on",
      report.gaps,
      `"Found nothing" and "was not allowed to look" are different answers, and only one of them is good news.`,
    ));
  }
}

function show() {
  try {
    render(build(snapshot, profile));
    el("status").textContent = "";
    el("status").className = "note";
  } catch (error) {
    el("statement").replaceChildren(
      text("p", "note bad", error instanceof ReportError ? error.message : String(error)),
    );
  }
}

/* ---- Profiles ------------------------------------------------------------------------ */

const profileRow = el("profiles");
for (const p of PROFILES) {
  const input = document.createElement("input");
  input.type = "radio";
  input.name = "profile";
  input.id = `profile-${p.id}`;
  input.value = p.id;
  input.checked = p.id === profile.id;
  const label = document.createElement("label");
  label.htmlFor = input.id;
  label.textContent = p.label;
  profileRow.append(input, label);
}
// One listener on the container rather than one per input: the group behaves as a unit and
// the browser has already done the arrow keys, the single tab stop and selection-follows-focus.
profileRow.addEventListener("change", (event) => {
  const chosen = (event.target as HTMLInputElement).value;
  profile = profileById(chosen) ?? profile;
  show();
});

/* ---- Paste ---------------------------------------------------------------------------- */

el("read").addEventListener("click", () => {
  const raw = (el<HTMLTextAreaElement>("paste")).value.trim();
  if (!raw) {
    el("status").textContent = "Nothing pasted yet.";
    el("status").className = "note bad";
    return;
  }
  try {
    const parsed = JSON.parse(raw) as Snapshot;
    // Built before it is stored, so a snapshot the analyzer refuses leaves the page showing
    // the one that worked rather than an empty statement and an error.
    build(parsed, profile);
    snapshot = parsed;
    show();
    el("status").textContent = "Read. Nothing left this tab.";
  } catch (error) {
    el("status").textContent = error instanceof SyntaxError
      ? "That is not valid JSON."
      : error instanceof Error ? error.message : String(error);
    el("status").className = "note bad";
  }
});

el("sample").addEventListener("click", () => {
  snapshot = sample as unknown as Snapshot;
  (el<HTMLTextAreaElement>("paste")).value = "";
  show();
  el("status").textContent = "Back to the synthetic sample.";
});

/* ---- Refusals -------------------------------------------------------------------------- */

const refusalsOut = el("refusals");
for (const refusal of REFUSALS) {
  const item = document.createElement("article");
  item.className = "refusal";
  item.append(text("h3", "", refusal.tweak));
  const claim = document.createElement("p");
  claim.className = "claim";
  claim.append(text("span", `verdict verdict-${refusal.verdict}`, refusal.verdict.replace("-", " ")));
  claim.append(document.createTextNode(`Claimed: ${refusal.claim}`));
  item.append(claim);
  item.append(text("p", "why", refusal.why));
  refusalsOut.append(item);
}

/* ---- Palette --------------------------------------------------------------------------- */

const themes = palettes as unknown as Theme[];
const store = createThemeStore(themes, DEFAULT_THEME, "pc-audit:theme");
const paletteRow = el("palette");

for (const group of grouped(themes)) {
  paletteRow.append(text("span", "scheme", group.label));
  for (const theme of group.themes) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.theme = theme.id;
    const dot = text("span", "dot", "");
    dot.style.background = theme.accent;
    button.append(dot, text("span", "", theme.label));
    paletteRow.append(button);
  }
}

// Applied before the keys are wired: wirePalette decides which option carries the single tab
// stop from whatever is on the page when it runs.
store.apply(store.initial());
wirePalette(
  paletteRow,
  [...paletteRow.querySelectorAll<HTMLButtonElement>("button[data-theme]")],
  { select: (id) => store.apply(id), current: () => document.documentElement.dataset.theme ?? "" },
);

show();
