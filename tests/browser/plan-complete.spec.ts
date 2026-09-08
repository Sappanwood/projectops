import { writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "./fixture.js";

test("explicit Web completion handles stale revisions and persists across refresh and CLI reads", async ({
  workbench,
  page,
}) => {
  const input = path.join(workbench.root, "complete.json");
  const draft = {
    title: "Complete in Web",
    goal: "Deliver work",
    items: [{ key: "task", title: "Task", item_type: "task", priority: "P1", body: "Acceptance" }],
  };
  writeFileSync(input, JSON.stringify(draft));
  workbench.cli(["plan", "create", "alpha", "--input", input]);
  const id = "plan-complete-in-web";
  workbench.cli(["plan", "approve", "alpha", id, "--review-note", "Fixture reviewed"]);
  const { mapping } = JSON.parse(workbench.cli(["plan", "materialize", "alpha", id, "--json"]));
  await page.goto(`${workbench.origin}/#/projects/alpha/plans/${id}?tab=execution`);
  const plan = page.locator(`[data-plan-id="${id}"]`);
  const complete = plan.getByRole("button", { name: "标为完成", exact: true });
  await expect(complete).toBeDisabled();
  const item = JSON.parse(workbench.cli(["backlog", "show", "alpha", mapping.task, "--json"]));
  workbench.cli([
    "backlog",
    "update",
    "alpha",
    mapping.task,
    "--status",
    "done",
    "--expected-revision",
    item.revision,
  ]);
  await page.getByRole("button", { name: "Refresh workspace and project data" }).click();
  await expect(complete).toBeEnabled();
  await expect(plan.locator(".plan-summary .badge")).toHaveText("已批准");
  const current = JSON.parse(workbench.cli(["plan", "show", "alpha", id, "--json"]));
  writeFileSync(input, JSON.stringify({ ...draft, goal: "Reviewed goal" }));
  const args = [
    "plan",
    "revise",
    "alpha",
    id,
    "--input",
    input,
    "--expected-revision",
    current.revision,
  ];
  const preview = JSON.parse(workbench.cli([...args, "--json"]));
  workbench.cli([...args, "--confirm", preview.confirmation_token]);
  await complete.click();
  await expect(plan).toContainText("REVISION_MISMATCH");
  expect(JSON.parse(workbench.cli(["plan", "show", "alpha", id, "--json"])).status).toBe(
    "approved",
  );
  await page.getByRole("button", { name: "Refresh workspace and project data" }).click();
  await complete.click();
  await expect(plan.locator(".plan-summary .badge")).toHaveText("已完成");
  await expect(plan.getByRole("button", { name: "修订计划", exact: true })).toHaveCount(0);
  expect(JSON.parse(workbench.cli(["plan", "show", "alpha", id, "--json"])).status).toBe("done");
  await page.reload();
  await expect(plan.locator(".plan-summary .badge")).toHaveText("已完成");
});
