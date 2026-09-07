import { writeFileSync } from "node:fs";
import { expect, test, type WorkbenchFixture } from "./fixture.js";

function setup(workbench: WorkbenchFixture) {
  workbench.cli([
    "backlog",
    "add",
    "empty",
    "-T",
    "Shared upstream",
    "-c",
    "feature",
    "--priority",
    "P1",
  ]);
  writeFileSync(
    `${workbench.root}/ops/alpha/plans/plan-browser.json`,
    JSON.stringify({
      schema: "plan/Plan@1",
      id: "plan-browser",
      title: "Refresh dependency fixture",
      goal: "Refresh live upstream state",
      status: "draft",
      items: [
        {
          key: "ui",
          title: "Dependent UI",
          item_type: "task",
          priority: "P1",
          body: "Wait for upstream",
          depends_on: ["empty:EMP-001"],
        },
      ],
    }),
  );
  workbench.cli([
    "plan",
    "approve",
    "alpha",
    "plan-browser",
    "--review-note",
    "Reviewed isolated fixture",
  ]);
  return JSON.parse(workbench.cli(["plan", "materialize", "alpha", "plan-browser", "--json"]))
    .mapping.ui as string;
}
function finishUpstream(workbench: WorkbenchFixture) {
  const item = JSON.parse(workbench.cli(["backlog", "show", "empty", "EMP-001", "--json"]));
  workbench.cli([
    "backlog",
    "update",
    "empty",
    "EMP-001",
    "--status",
    "done",
    "--expected-revision",
    item.revision,
  ]);
}

test("global refresh updates Plan relation state and ignores an older pending response", async ({
  workbench,
  page,
}) => {
  const item = setup(workbench);
  await page.goto(`${workbench.origin}/#/projects/alpha/plans/plan-browser`);
  const relation = page.locator('[data-plan-relations="ui"] [data-direct-dependencies]');
  await expect(relation).toContainText("尚未满足");
  let release!: () => void;
  let intercepted!: () => void;
  const started = new Promise<void>((resolve) => {
    intercepted = resolve;
  });
  let first = true;
  await page.route(`**/alpha/backlog/${item}/dependencies`, async (route) => {
    if (!first) return route.continue();
    first = false;
    const response = await route.fetch();
    intercepted();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.fulfill({ response });
  });
  try {
    await page.getByRole("button", { name: "Refresh workspace and project data" }).click();
    await Promise.race([started, new Promise((resolve) => setTimeout(resolve, 1000))]);
    finishUpstream(workbench);
    await page.getByRole("button", { name: "Refresh workspace and project data" }).click();
    await expect(page.getByRole("region", { name: "可开始任务", exact: true })).toContainText(
      "Dependent UI",
    );
    await expect(relation).toContainText("已满足");
    await expect(relation).not.toContainText("尚未满足");
    const pendingResponse = page.waitForResponse((response) =>
      response.url().endsWith(`/backlog/${item}/dependencies`),
    );
    release();
    await (await pendingResponse).finished();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(relation).not.toContainText("尚未满足");
  } finally {
    release?.();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("returning from the external project refreshes Plan dependency relations", async ({
  workbench,
  page,
}) => {
  setup(workbench);
  await page.goto(`${workbench.origin}/#/projects/alpha/plans/plan-browser`);
  const relation = page.locator('[data-plan-relations="ui"] [data-direct-dependencies]');
  await expect(relation).toContainText("尚未满足");
  await relation.getByRole("link", { name: /Shared upstream/ }).click();
  await page.getByRole("button", { name: "done", exact: true }).click();
  await expect(page.getByLabel("Status: done", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "返回原 Plan" }).click();
  await expect(page.getByRole("region", { name: "可开始任务", exact: true })).toContainText(
    "Dependent UI",
  );
  await expect(relation).toContainText("已满足");
  await expect(relation).not.toContainText("尚未满足");
});
