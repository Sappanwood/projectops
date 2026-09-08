import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "./fixture.js";

test("project links stay visible, preserve the section and support keyboard navigation", async ({
  workbench,
  page,
}) => {
  for (const id of ["mochi-write", "projectops-with-a-long-name"]) {
    mkdirSync(path.join(workbench.root, id));
    workbench.cli(["project", "add", id]);
    workbench.cli(["backlog", "init", id]);
  }
  const before = workbench.snapshot();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${workbench.origin}/#/projects/projectops-with-a-long-name/plans`);
  await expect(page.getByRole("heading", { name: "Plans (0)", exact: true })).toBeVisible();
  mkdirSync("/tmp/projectops-project-navigation", { recursive: true });
  const phase = process.env.PROJECT_NAV_BEFORE ? "before" : "after";
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `/tmp/projectops-project-navigation/${phase}-${width}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  if (process.env.PROJECT_NAV_BEFORE) return;
  const projects = page.getByRole("navigation", { name: "项目切换", exact: true });
  const links = projects.getByRole("link");
  await expect(links).toHaveText(["alpha", "empty", "mochi-write", "projectops-with-a-long-name"]);
  const selected = projects.getByRole("link", { name: "projectops-with-a-long-name", exact: true });
  await expect(selected).toHaveAttribute("aria-current", "true");
  const visible = () =>
    selected.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const container = element.parentElement!.getBoundingClientRect();
      return bounds.left >= container.left - 1 && bounds.right <= container.right + 1;
    });
  expect(await visible()).toBe(true);
  await page.reload();
  await expect(selected).toHaveAttribute("aria-current", "true");
  expect(await visible()).toBe(true);
  await projects.getByRole("link", { name: "alpha", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(projects.getByRole("link", { name: "empty", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#\/projects\/empty\/plans$/);
  await expect(page.getByRole("heading", { name: "Plans (0)", exact: true })).toBeVisible();
  await expect(projects.getByRole("link", { name: "empty", exact: true })).toBeFocused();
  await page.goto(`${workbench.origin}/#/projects/alpha/plans/plan-browser?tab=execution`);
  await projects.getByRole("link", { name: "empty", exact: true }).click();
  await expect(page).toHaveURL(/#\/projects\/empty\/plans$/);
  await page.goBack();
  await expect(page).toHaveURL(/plan-browser\?tab=execution$/);
  await expect(page.getByRole("tab", { name: "执行与结果", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(links).toHaveText(["alpha", "empty", "mochi-write", "projectops-with-a-long-name"]);
  expect(errors).toEqual([]);
  expect(workbench.snapshot()).toEqual(before);
});

test("project navigation remains available while project data fails and recovers", async ({
  workbench,
  page,
}) => {
  await page.goto(`${workbench.origin}/#/projects/alpha/plans/plan-browser`);
  await expect(page.locator(".plan-goal")).toBeVisible();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/projects/empty", async (route) => {
    await pending;
    await route.fulfill({
      status: 500,
      json: { ok: false, error: { code: "READ_FAILED", message: "Project read failed" } },
    });
  });
  const projects = page.getByRole("navigation", { name: "项目切换", exact: true });
  await projects.getByRole("link", { name: "empty", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Loading Project" })).toBeVisible();
  await expect(projects.getByRole("link", { name: "alpha", exact: true })).toBeVisible();
  await expect(page.locator(".plan-goal")).toHaveCount(0);
  release();
  await expect(page.getByRole("heading", { name: "Project Not Available" })).toBeVisible();
  await expect(projects.getByRole("link", { name: "empty", exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await page.unroute("**/api/projects/empty");
  await page.getByRole("button", { name: "Refresh workspace and project data" }).click();
  await expect(page.getByRole("heading", { name: "Plans (0)", exact: true })).toBeVisible();
  await projects.getByRole("link", { name: "alpha", exact: true }).click();
  await expect(page.getByRole("link", { name: /Browser plan/ })).toBeVisible();
});
