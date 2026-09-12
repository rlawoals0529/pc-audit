import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describeFailures, probeContrast } from "./contrast-probe";

const HERE = dirname(fileURLToPath(import.meta.url));
const themes = JSON.parse(readFileSync(resolve(HERE, "../theme/palettes.json"), "utf8")) as { id: string }[];

/*
 * Click the label, not the input.
 *
 * The radios are moved off-screen so the labels can be styled as chips, which is the ordinary
 * way to build this and is what a person actually clicks. Playwright's .check() aims at the
 * input, finds the label sitting on top of it, and retries for thirty seconds - so a test
 * written that way fails against a control that works perfectly.
 */
const pick = (page: Page, id: string) => page.locator(`label[for="profile-${id}"]`).click();

test.beforeEach(async ({ page }) => {
  await page.goto("/site/index.html");
});

test("the document under test is this app", async ({ page }) => {
  await expect(page).toHaveTitle("pc-audit");
  await expect(page.locator("h1")).toHaveText("pc-audit");
  await expect(page.locator(".statement .line").first()).toBeVisible();
});

test("says out loud that the bundled sample is not a real machine", async ({ page }) => {
  // The single most important thing on the page. A demo that reads as somebody's readout is
  // how a synthetic number ends up quoted as a measurement.
  await expect(page.locator(".synthetic")).toContainText("synthetic");
});

test("makes no network requests after it loads", async ({ page }) => {
  // Your snapshot describes your own machine. "We do not upload it" is only worth saying if
  // there is no code that could, and this is the check for that.
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.locator("#paste").fill(JSON.stringify({ schema: 1, collectedAt: "2026-09-12T09:00:00Z", real: true }));
  await page.getByRole("button", { name: "Read it" }).click();
  await expect(page.locator("#status")).toContainText("Nothing left this tab");
  expect(requests, requests.join("\n")).toEqual([]);
});

test.describe("profiles", () => {
  test("are a real radiogroup, so the keyboard works without any code of ours", async ({ page }) => {
    const radios = page.locator("#profiles input[type=radio]");
    await expect(radios).toHaveCount(4);
    await page.locator("#profiles input:checked").focus();
    await page.keyboard.press("ArrowRight");
    // Selection follows focus in a native group, which is what makes arrowing a preview.
    await expect(page.locator("#profiles input:checked")).toHaveValue("boot");
  });

  test("answer different questions about the same machine", async ({ page }) => {
    await pick(page, "fps");
    const fps = await page.locator(".statement .line h3").allTextContents();
    await pick(page, "boot");
    const boot = await page.locator(".statement .line h3").allTextContents();

    expect(fps.some((t) => t.includes("Hz"))).toBe(true);
    expect(boot.some((t) => t.includes("Hz"))).toBe(false);
    expect(boot.some((t) => t.includes("added"))).toBe(true);
    expect(fps.some((t) => t.includes("added"))).toBe(false);
  });

  test("never print a zero where nothing was measured", async ({ page }) => {
    // A zero in a column that gets totalled is a claim, and it would be a false one.
    const unmeasured = page.locator(".statement .amount.none");
    await expect(unmeasured.first()).toBeVisible();
    for (const shown of await unmeasured.allTextContents()) {
      expect(shown.trim()).toBe("not measured");
    }
  });

  test("show the risks whatever profile is picked", async ({ page }) => {
    for (const id of ["fps", "boot", "battery", "default"]) {
      await pick(page, id);
      await expect(page.locator(".aside.risk"), id).toContainText("Real-time protection is off");
    }
  });

  test("say what adding the column up does and does not mean", async ({ page }) => {
    await pick(page, "boot");
    await expect(page.locator(".total .means")).toContainText("upper bound");
  });
});

test("refuses a snapshot from a schema it does not know, without losing the page", async ({ page }) => {
  await page.locator("#paste").fill(JSON.stringify({ schema: 99, collectedAt: "x", real: true }));
  await page.getByRole("button", { name: "Read it" }).click();
  await expect(page.locator("#status")).toContainText("schema 1");
  // And the statement on screen is still the one that worked.
  await expect(page.locator(".statement .line").first()).toBeVisible();
});

test("lists the refusals, which is the argument the repo is making", async ({ page }) => {
  await expect(page.locator(".refusal")).toHaveCount(11);
  await expect(page.locator(".refusal").first()).toContainText("Defender");
});

test.describe("the reasoning folds away", () => {
  test("is closed by default, so the statement can be read as a statement", async ({ page }) => {
    const open = await page.locator(".line details[open]").count();
    expect(open).toBe(0);
    await expect(page.locator(".line details summary").first()).toBeVisible();
  });

  test("opens on the keyboard, because it is a real disclosure", async ({ page }) => {
    const first = page.locator(".line details").first();
    await first.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(first).toHaveAttribute("open", "");
    // And the prose it was hiding is now readable.
    await expect(first.locator(".detail")).toBeVisible();
  });
});

test("commands can be copied, which is the only thing you do with them", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const line = page.locator(".line", { has: page.locator(".remedy") }).first();
  await line.locator("details summary").click();
  const command = (await line.locator(".remedy code").textContent())!;
  await line.locator(".copy").click();
  await expect(line.locator(".copy")).toHaveText("Copied");
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toBe(command);
});

for (const backdrop of ["#ffffff", "#000000"]) {
  test(`clears AA in every palette over ${backdrop}`, async ({ page }) => {
    const probe = await probeContrast(page, themes, { backdrop });
    expect(probe.distinctPalettes).toBeGreaterThanOrEqual(themes.length - 1);
    expect(probe.styles, `only saw: ${probe.samples.join(", ")}`).toBeGreaterThan(9);
    expect(probe.classes.join(" ")).toContain("DIV.amount");
    expect(probe.failures, describeFailures(probe.failures)).toEqual([]);
  });
}

for (const backdrop of ["#ffffff", "#000000"]) {
  test(`clears AA with every disclosure open, over ${backdrop}`, async ({ page }) => {
    /*
     * A second run with the reasoning expanded, and it is not redundant.
     *
     * The probe measures what is VISIBLE, and a closed <details> is not - Chromium does not
     * even run style updates inside one. Every paragraph of reasoning on this page lives
     * inside one of them, so without this run the most text-heavy part of the statement was
     * going unmeasured in all fifteen palettes.
     */
    await page.evaluate(() => {
      for (const d of document.querySelectorAll("details")) d.open = true;
    });
    const probe = await probeContrast(page, themes, { backdrop });
    expect(probe.styles).toBeGreaterThan(12);
    expect(probe.classes.join(" ")).toContain("P.detail");
    expect(probe.failures, describeFailures(probe.failures)).toEqual([]);
  });
}

test("the palette picker is one tab stop and remembers the choice", async ({ page }) => {
  const swatches = page.locator("#palette button[data-theme]");
  await expect(swatches).toHaveCount(themes.length);
  const tabbable = await swatches.evaluateAll((els) => els.filter((e) => (e as HTMLElement).tabIndex === 0).length);
  expect(tabbable).toBe(1);

  await page.locator('#palette button[data-theme="sakura-lake"]').click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "sakura-lake");
});
