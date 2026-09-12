import { defineConfig, devices } from "@playwright/test";

/**
 * Port 4192, and it is not arbitrary. Four repos here once shared two ports with
 * reuseExistingServer and produced a fully green run against a different app. Every repo has
 * its own port now, and the first assertion in every spec names the document that answered.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://localhost:4192", ...devices["Desktop Chrome"] },
  webServer: {
    command: "npm run build && npm run preview",
    url: "http://localhost:4192/site/index.html",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
