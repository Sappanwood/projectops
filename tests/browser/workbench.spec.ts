import { writeFileSync } from "node:fs";
import path from "node:path";
import { test, expect } from "./fixture.js";

test("production Workbench updates Backlog with revisions and recovers from a conflict", async ({ workbench, page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(workbench.origin);
  await expect(page.getByRole("heading", { name: "Workspace Projects" })).toBeVisible();
  await page.getByLabel("Select active project").selectOption("alpha");
  await page.getByRole("tab", { name: /^Backlog/ }).click();
  await page.getByRole("button", { name: /ALP-001 — Browser task/ }).click();
  const detail = page.getByRole("region", { name: "Backlog item detail" });
  await expect(detail).toContainText("Browser authority <script>unsafe</script>");
  await expect(detail.locator("script")).toHaveCount(0);
  const loaded = JSON.parse(workbench.cli(["backlog", "show", "alpha", "ALP-001", "--json"]));
  const request = page.waitForRequest((request) => request.method() === "PATCH");
  await detail.getByRole("button", { name: "done", exact: true }).click();
  expect((await request).postDataJSON()).toEqual({ status: "done", expected_revision: loaded.revision });
  await expect(detail).toContainText("Status updated.");
  const updated = JSON.parse(workbench.cli(["backlog", "show", "alpha", "ALP-001", "--json"]));
  expect(updated.status).toBe("done");
  expect(updated.revision).not.toBe(loaded.revision);

  workbench.cli(["backlog", "update", "alpha", "ALP-001", "--status", "in_progress", "--expected-revision", updated.revision]);
  const beforeConflict = workbench.snapshot();
  const conflict = page.waitForResponse((response) => response.request().method() === "PATCH");
  await detail.getByRole("button", { name: "todo", exact: true }).click();
  expect((await conflict).status()).toBe(409);
  await expect(detail.getByRole("alert")).toContainText("REVISION_MISMATCH");
  await expect(detail.getByRole("button", { name: "done", exact: true })).toBeDisabled();
  expect(workbench.snapshot()).toEqual(beforeConflict);
  await detail.getByRole("button", { name: "Refresh item" }).click();
  await expect(detail).toContainText("Status: in_progress");
  await detail.getByRole("button", { name: "todo", exact: true }).click();
  await expect(detail).toContainText("Status updated.");
  expect(JSON.parse(workbench.cli(["backlog", "show", "alpha", "ALP-001", "--json"])).status).toBe("todo");
  expect(errors).toEqual([]);
});

test("four read-only pages show details, empty states and malformed diagnostics", async ({ workbench, page }) => {
  const before = workbench.snapshot();
  await page.goto(workbench.origin);
  await page.getByLabel("Select active project").selectOption("alpha");
  await page.getByRole("tab", { name: /^Plans/ }).click();
  await page.locator("summary").filter({ hasText: "Browser plan" }).click();
  await expect(page.getByRole("tabpanel")).toContainText("Validate production UI");
  await expect(page.getByRole("tabpanel")).toContainText("Browser review approved");
  await expect(page.getByRole("tabpanel")).toContainText("ALP-001");
  await page.getByRole("tab", { name: /^Reports/ }).click();
  await page.locator("summary").filter({ hasText: "Browser report" }).click();
  for (const text of ["Browser report body", "Browser checks", "Accepted pending task", "Isolated fixtures", "project-ops:plans/plan-browser.json"]) {
    await expect(page.getByRole("tabpanel")).toContainText(text);
  }
  await page.getByRole("tab", { name: /^Docs/ }).click();
  for (const document of ["README.md", "AGENTS.md", "docs/PRODUCT_SPEC.md", "docs/ARCHITECTURE.md"]) {
    await expect(page.getByRole("tabpanel")).toContainText(document);
  }
  await expect(page.getByRole("tabpanel").getByText("Healthy", { exact: true })).toHaveCount(4);
  await page.getByRole("tab", { name: /^Retrospectives/ }).click();
  await page.locator("summary").filter({ hasText: "browser" }).click();
  await expect(page.getByRole("tabpanel")).toContainText("Browser retrospective body");
  await page.getByLabel("Task", { exact: true }).fill("UNKNOWN-001");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("tabpanel")).toContainText("No inbox retrospectives found.");
  await page.getByLabel("Task", { exact: true }).fill("ALP-001");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.locator("summary")).toContainText("browser");

  await page.getByLabel("Select active project").selectOption("empty");
  await expect(page.getByRole("tabpanel")).toContainText("No inbox retrospectives found.");
  for (const [tab, empty] of [["Plans", "No plans found."], ["Reports", "No delivery reports found."], ["Docs", "document is missing"]]) {
    await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
    await expect(page.getByRole("tabpanel")).toContainText(empty!);
  }
  expect(workbench.snapshot()).toEqual(before);

  writeFileSync(path.join(workbench.root, "ops/empty/plans/plan-broken.json"), "{");
  writeFileSync(path.join(workbench.root, "ops/empty/reports/report-broken.md"), "broken");
  writeFileSync(path.join(workbench.root, "retrospectives/inbox/broken.md"), "broken");
  writeFileSync(path.join(workbench.root, "empty/README.md"), "Missing heading");
  const malformed = workbench.snapshot();
  await page.getByRole("button", { name: "Refresh workspace and project data" }).click();
  await expect(page.getByRole("tabpanel")).toContainText("document is missing a level-one Markdown heading");
  for (const tab of ["Plans", "Reports", "Retrospectives"]) {
    await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
    await expect(page.getByRole("tabpanel")).toContainText("ARTIFACT_INVALID");
    await expect(page.getByRole("tabpanel")).toContainText("broken");
  }
  expect(workbench.snapshot()).toEqual(malformed);
});

test("unknown project and disconnected server show errors without authority writes", async ({ workbench, page }) => {
  const before = workbench.snapshot();
  await page.goto(`${workbench.origin}/#/projects/missing/backlog`);
  await expect(page.getByRole("heading", { name: "Project Not Available" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("missing");
  expect(workbench.snapshot()).toEqual(before);
  await page.getByRole("link", { name: "Return to Workspace" }).click();
  await expect(page.getByRole("heading", { name: "Workspace Projects" })).toBeVisible();
  await workbench.stop();
  await page.getByRole("button", { name: "Refresh workspace and project data" }).click();
  await expect(page.getByRole("heading", { name: "Server Connection Error" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry Connection" })).toBeVisible();
  expect(workbench.snapshot()).toEqual(before);
});
