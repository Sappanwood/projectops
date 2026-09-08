import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { serializeReport } from "../../src/report/report.js";
import { expect, test } from "./fixture.js";

function seed(workbench: import("./fixture.js").WorkbenchFixture, remote = false) {
  const draft = path.join(workbench.root, "navigation.json");
  writeFileSync(
    draft,
    JSON.stringify({
      title: "Navigation",
      goal: "Return to this plan",
      items: [
        {
          key: "first",
          title: "First navigation task",
          item_type: "task",
          priority: "P1",
          body: "First scope",
        },
        {
          key: "second",
          ...(remote ? { project: "empty" } : {}),
          title: "Second navigation task",
          item_type: "task",
          priority: "P1",
          body: "Second scope",
          depends_on: ["first"],
        },
      ],
    }),
  );
  workbench.cli(["plan", "create", "alpha", "--input", draft]);
  workbench.cli([
    "plan",
    "approve",
    "alpha",
    "plan-navigation",
    "--review-note",
    "Fixture approved",
  ]);
  return JSON.parse(workbench.cli(["plan", "materialize", "alpha", "plan-navigation", "--json"]))
    .mapping as { first: string; second: string };
}

test("Plan task links update through Backlog and return to fresh progress and recommendations", async ({
  workbench,
  page,
}) => {
  const mapping = seed(workbench);
  const before = workbench.snapshot();
  const planBytes = before["ops/alpha/plans/plan-navigation.json"];
  await page.goto(`${workbench.origin}/#/projects/alpha/plans/plan-navigation?tab=execution`);
  const plan = page.locator('.plan-card[data-plan-id="plan-navigation"]');
  const ready = plan.getByRole("region", { name: "可开始任务" });
  const blocked = plan.getByRole("region", { name: "受阻任务" });
  await expect(ready).toContainText(mapping.first);
  await expect(blocked).toContainText(mapping.second);
  await expect(blocked).toContainText(`依赖 ${mapping.first}`);
  await ready.getByRole("link", { name: new RegExp(mapping.first) }).click();
  await expect(page).toHaveURL(
    new RegExp(`/backlog/${mapping.first}\\?plan=plan-navigation&from=`),
  );
  const detail = page.getByRole("region", { name: "Backlog item detail" });
  await expect(detail).toContainText("First scope");
  const loaded = JSON.parse(workbench.cli(["backlog", "show", "alpha", mapping.first, "--json"]));
  const patch = page.waitForRequest((r) => r.method() === "PATCH");
  await detail.getByRole("button", { name: "done", exact: true }).click();
  expect((await patch).postDataJSON()).toEqual({
    status: "done",
    expected_revision: loaded.revision,
  });
  await expect(detail).toContainText("Status updated.");
  const afterUpdate = workbench.snapshot();
  expect(afterUpdate["ops/alpha/plans/plan-navigation.json"]).toEqual(planBytes);
  expect(Object.keys(afterUpdate).sort()).toEqual(Object.keys(before).sort());
  expect(
    Object.keys(afterUpdate)
      .filter((key) => afterUpdate[key] !== before[key])
      .sort(),
  ).toEqual(["ops/alpha/backlog/INDEX.md", `ops/alpha/backlog/items/${mapping.first}.md`]);
  await page.getByRole("link", { name: "返回原 Plan" }).click();
  await expect(page).toHaveURL(/\/plans\/plan-navigation\?tab=execution$/);
  await expect(plan.getByRole("region", { name: "执行进度" })).toContainText("1/2 已完成");
  await expect(ready).toContainText(mapping.second);
  await expect(ready).not.toContainText(mapping.first);
  await expect(blocked).toContainText("暂无任务");
  await page.reload();
  await expect(ready).toBeVisible();
  expect(workbench.snapshot()).toEqual(afterUpdate);
});

test("missing deep-linked Backlog target shows error and retains return Plan without stale data", async ({
  workbench,
  page,
}) => {
  const mapping = seed(workbench);
  await page.goto(
    `${workbench.origin}/#/projects/alpha/backlog/${mapping.first}?plan=plan-navigation`,
  );
  await expect(page.getByRole("region", { name: "Backlog item detail" })).toContainText(
    "First scope",
  );
  rmSync(path.join(workbench.root, `ops/alpha/backlog/items/${mapping.second}.md`));
  const before = workbench.snapshot();
  await page.goto(
    `${workbench.origin}/#/projects/alpha/backlog/${mapping.second}?plan=plan-navigation`,
  );
  await expect(
    page.getByRole("region", { name: "Backlog item detail" }).getByRole("alert"),
  ).toContainText("ITEM_NOT_FOUND");
  await expect(page.getByRole("region", { name: "Backlog item detail" })).not.toContainText(
    "First scope",
  );
  await page.getByRole("link", { name: "返回原 Plan" }).click();
  const plan = page.locator('.plan-card[data-plan-id="plan-navigation"]');
  await page.getByRole("tab", { name: "执行与结果", exact: true }).click();
  await expect(plan.getByRole("region", { name: "执行进度" })).toContainText("无法读取 1");
  await expect(plan.getByRole("region", { name: "可开始任务" })).toContainText(mapping.first);
  expect(workbench.snapshot()).toEqual(before);
  await page.goto(
    `${workbench.origin}/#/projects/empty/backlog/${mapping.first}?plan=plan-navigation`,
  );
  await expect(
    page.getByRole("region", { name: "Backlog item detail" }).getByRole("alert"),
  ).toContainText("INVALID_ITEM_ID");
  await expect(page.getByRole("tabpanel").first()).not.toContainText("First scope");
  await page.getByRole("link", { name: "返回原 Plan" }).click();
  await expect(page.getByRole("tabpanel").first().getByRole("alert")).toContainText(
    "Plan 不存在或无法读取",
  );
});

test("cross-project Plan shows real identities and returns to owner progress", async ({
  workbench,
  page,
}) => {
  const mapping = seed(workbench, true);
  const remoteId = mapping.second.split(":")[1]!;
  await page.goto(`${workbench.origin}/#/projects/alpha/plans/plan-navigation?tab=execution`);
  const plan = page.locator('[data-plan-id="plan-navigation"]');

  await expect(plan).toContainText("目标项目：empty");
  await expect(plan.getByRole("button", { name: "创建串行执行", exact: true })).toBeDisabled();
  await expect(plan.getByRole("button", { name: "创建有界并行执行", exact: true })).toBeDisabled();
  await expect(plan).toContainText("请在各项目分别执行任务");
  const second = plan.locator('[data-plan-relations="second"]');
  await page.getByRole("tab", { name: "审阅计划", exact: true }).click();
  await expect(plan.locator("#plan-navigation--second")).toHaveAttribute("open", "");
  await expect(second).toContainText(mapping.first);
  await expect(second).not.toContainText("INVALID_ITEM_ID");
  await page.getByRole("tab", { name: "执行与结果", exact: true }).click();
  await plan
    .getByRole("region", { name: "执行进度" })
    .getByRole("link", { name: new RegExp(remoteId) })
    .click();
  await expect(page).toHaveURL(new RegExp(`/projects/empty/backlog/${remoteId}\\?from=`));
  const detail = page.getByRole("region", { name: "Backlog item detail" });
  await detail.getByRole("button", { name: "done", exact: true }).click();
  await expect(detail).toContainText("Status updated.");
  await page.getByRole("link", { name: "返回原 Plan" }).first().click();
  await expect(page).toHaveURL(/projects\/alpha\/plans\/plan-navigation\?tab=execution$/);
  await expect(plan.getByRole("region", { name: "执行进度" })).toContainText("1/2 已完成");
  await page.screenshot({ path: "/tmp/pro070-plan-after.png", fullPage: true });
  await page.getByRole("tab", { name: "审阅计划", exact: true }).click();
  await plan.getByRole("button", { name: "修订计划", exact: true }).click();
  const editor = plan.getByRole("textbox", { name: "计划 JSON 草案" });
  await expect(editor).toContainText('"project": "empty"');
  await expect(plan).toContainText("已物化条目的目标项目不可迁移");
  writeFileSync(
    path.join(workbench.root, "ops/alpha/reports/report-cross.md"),
    serializeReport({
      schema: "report/Report@1",
      id: "report-cross",
      title: "Cross report",
      project: "alpha",
      created_at: "2026-09-08",
      outcome: "partial",
      plan: "project-ops:plans/plan-navigation.json",
      backlog: [{ project: "empty", id: remoteId, status: "done" }],
      verification: ["Browser fixture"],
      deviations: [],
      workarounds: [],
      repo_docs: [],
      body: "Cross project report fixture",
    }),
  );
  await page.goto(`${workbench.origin}/#/projects/alpha/reports/report-cross`);
  await page.getByRole("link", { name: `empty:${remoteId}`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/empty/backlog/${remoteId}`));
  await page.getByRole("link", { name: "返回来源页面" }).click();
  await expect(page).toHaveURL(/projects\/alpha\/reports\/report-cross$/);
});

test("partial materialization exposes known links and CLI recovery without uncreated links", async ({
  workbench,
  page,
}) => {
  seed(workbench, true);
  const file = path.join(workbench.root, "ops/alpha/plans/plan-navigation.json");
  const planData = JSON.parse(readFileSync(file, "utf8"));
  planData.materialization.state = "partial";
  delete planData.materialization.mapping.second;
  writeFileSync(file, JSON.stringify(planData));
  await page.goto(`${workbench.origin}/#/projects/alpha/plans/plan-navigation?tab=execution`);
  const plan = page.locator('[data-plan-id="plan-navigation"]');
  await expect(plan).toContainText("部分物化：已创建 1/2 项");
  await expect(plan).toContainText("pops plan materialize alpha plan-navigation");
  await expect(plan).toContainText("Second navigation task（尚未创建）");
  await expect(plan.locator('a[href*="/backlog/second"]')).toHaveCount(0);
  await page.getByRole("tab", { name: "审阅计划", exact: true }).click();
  await expect(plan.getByRole("button", { name: "修订计划", exact: true })).toBeDisabled();
  await page.getByRole("tab", { name: "执行与结果", exact: true }).click();
  await expect(plan.getByRole("button", { name: "创建串行执行", exact: true })).toBeDisabled();
  await expect(plan.getByRole("button", { name: "创建有界并行执行", exact: true })).toBeDisabled();
  await page.screenshot({ path: "/tmp/pro070-partial.png", fullPage: true });
});
