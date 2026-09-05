import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, expect } from "./fixture.js";

function seed(workbench: import("./fixture.js").WorkbenchFixture) {
  const draft = path.join(workbench.root, "navigation.json");
  writeFileSync(draft, JSON.stringify({ title: "Navigation", goal: "Return to this plan", items: [
    { key: "first", title: "First navigation task", item_type: "task", priority: "P1", body: "First scope" },
    { key: "second", title: "Second navigation task", item_type: "task", priority: "P1", body: "Second scope", depends_on: ["first"] },
  ] }));
  workbench.cli(["plan", "create", "alpha", "--input", draft]);
  workbench.cli(["plan", "approve", "alpha", "plan-navigation", "--review-note", "Fixture approved"]);
  return JSON.parse(workbench.cli(["plan", "materialize", "alpha", "plan-navigation", "--json"])).mapping as { first: string; second: string };
}

test("Plan task links update through Backlog and return to fresh progress and recommendations", async ({ workbench, page }) => {
  const mapping = seed(workbench);
  const before = workbench.snapshot();
  const planBytes = before["ops/alpha/plans/plan-navigation.json"];
  await page.goto(`${workbench.origin}/#/projects/alpha/plans/plan-navigation`);
  const plan = page.locator('.plan-card[data-plan-id="plan-navigation"]');
  const ready = plan.getByRole("region", { name: "可开始任务" });
  const blocked = plan.getByRole("region", { name: "受阻任务" });
  await expect(ready).toContainText(mapping.first);
  await expect(blocked).toContainText(mapping.second);
  await expect(blocked).toContainText(`依赖 ${mapping.first}`);
  await ready.getByRole("link", { name: new RegExp(mapping.first) }).click();
  await expect(page).toHaveURL(new RegExp(`/backlog/${mapping.first}\\?plan=plan-navigation$`));
  const detail = page.getByRole("region", { name: "Backlog item detail" });
  await expect(detail).toContainText("First scope");
  const loaded = JSON.parse(workbench.cli(["backlog", "show", "alpha", mapping.first, "--json"]));
  const patch = page.waitForRequest(r => r.method() === "PATCH");
  await detail.getByRole("button", { name: "done", exact: true }).click();
  expect((await patch).postDataJSON()).toEqual({ status: "done", expected_revision: loaded.revision });
  await expect(detail).toContainText("Status updated.");
  const afterUpdate = workbench.snapshot();
  expect(afterUpdate["ops/alpha/plans/plan-navigation.json"]).toEqual(planBytes);
  expect(Object.keys(afterUpdate).sort()).toEqual(Object.keys(before).sort());
  expect(Object.keys(afterUpdate).filter(key => afterUpdate[key] !== before[key]).sort()).toEqual(["ops/alpha/backlog/INDEX.md", `ops/alpha/backlog/items/${mapping.first}.md`]);
  await page.getByRole("link", { name: "返回原 Plan" }).click();
  await expect(page).toHaveURL(/\/plans\/plan-navigation$/);
  await expect(plan.getByRole("region", { name: "执行进度" })).toContainText("1/2 已完成");
  await expect(ready).toContainText(mapping.second);
  await expect(ready).not.toContainText(mapping.first);
  await expect(blocked).toContainText("暂无任务");
  await page.reload();
  await expect(ready).toBeVisible();
  expect(workbench.snapshot()).toEqual(afterUpdate);
});

test("missing deep-linked Backlog target shows error and retains return Plan without stale data", async ({ workbench, page }) => {
  const mapping = seed(workbench);
  await page.goto(`${workbench.origin}/#/projects/alpha/backlog/${mapping.first}?plan=plan-navigation`);
  await expect(page.getByRole("region", { name: "Backlog item detail" })).toContainText("First scope");
  rmSync(path.join(workbench.root, `ops/alpha/backlog/items/${mapping.second}.md`));
  const before = workbench.snapshot();
  await page.goto(`${workbench.origin}/#/projects/alpha/backlog/${mapping.second}?plan=plan-navigation`);
  await expect(page.getByRole("region", { name: "Backlog item detail" }).getByRole("alert")).toContainText("ITEM_NOT_FOUND");
  await expect(page.getByRole("region", { name: "Backlog item detail" })).not.toContainText("First scope");
  await page.getByRole("link", { name: "返回原 Plan" }).click();
  const plan = page.locator('.plan-card[data-plan-id="plan-navigation"]');
  await expect(plan.getByRole("region", { name: "执行进度" })).toContainText("无法读取 1");
  await expect(plan.getByRole("region", { name: "可开始任务" })).toContainText(mapping.first);
  expect(workbench.snapshot()).toEqual(before);
  await page.goto(`${workbench.origin}/#/projects/empty/backlog/${mapping.first}?plan=plan-navigation`);
  await expect(page.getByRole("region", { name: "Backlog item detail" }).getByRole("alert")).toContainText("INVALID_ITEM_ID");
  await expect(page.getByRole("tabpanel")).not.toContainText("First scope");
  await page.getByRole("link", { name: "返回原 Plan" }).click();
  await expect(page.getByRole("tabpanel").getByRole("alert")).toContainText("Plan 不存在或无法读取");
});
