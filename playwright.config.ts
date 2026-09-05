import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  globalTimeout: 120_000,
  expect: { timeout: 5_000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    browserName: "chromium",
    headless: true,
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
    launchOptions: { timeout: 10_000 },
    trace: "retain-on-failure",
  },
});
