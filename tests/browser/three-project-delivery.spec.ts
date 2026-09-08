import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "./fixture.js";

test("three projects deliver a shared facility through mixed Plan dependencies and navigation", async ({
  workbench,
  page,
}) => {
  test.setTimeout(60_000);
  const cli = (args: string[]) => JSON.parse(workbench.cli([...args, "--json"]));
  for (const project of ["ccp", "mochi", "mochi-write"]) {
    mkdirSync(path.join(workbench.root, project));
    cli(["project", "add", project]);
    cli(["backlog", "init", project]);
  }
  const add = (project: string, title: string, dependencies = "") =>
    cli([
      "backlog",
      "add",
      project,
      "-T",
      title,
      "-c",
      "feature",
      "--priority",
      "P1",
      ...(dependencies ? ["--depends-on", dependencies] : []),
    ]).item;
  const show = (project: string, id: string) => cli(["backlog", "show", project, id]);
  const done = (project: string, id: string) =>
    cli([
      "backlog",
      "update",
      project,
      id,
      "--status",
      "done",
      "--expected-revision",
      show(project, id).revision,
    ]);
  const facility = add("ccp", "Staging facility");
  const facilityRef = `ccp:${facility.id}`;
  const service = add("mochi", "Staging service");
  cli([
    "backlog",
    "update",
    "mochi",
    service.id,
    "--depends-on",
    facilityRef,
    "--expected-revision",
    service.revision,
  ]);
  const consumer = add("mochi-write", "Second facility consumer", facilityRef);
  const upstreamBefore = show("ccp", facility.id);
  const draft = {
    title: "Three project delivery",
    goal: "Isolated facility to service to product acceptance",
    items: [
      {
        key: "client",
        title: "Local client",
        item_type: "task",
        priority: "P1",
        body: "Implement client",
      },
      {
        key: "integration",
        title: "Product integration",
        item_type: "task",
        priority: "P1",
        body: "Verify integration",
        depends_on: ["client", `mochi:${service.id}`, facilityRef],
      },
    ],
  };
  const input = path.join(workbench.root, "delivery.json");
  writeFileSync(input, JSON.stringify(draft));
  const plan = cli(["plan", "create", "mochi-write", "--input", input]).plan;
  cli(["plan", "validate", "mochi-write", plan.id]);
  cli(["plan", "approve", "mochi-write", plan.id, "--review-note", "Isolated fixture approval"]);
  const { mapping } = cli(["plan", "materialize", "mochi-write", plan.id]);
  expect(Object.keys(mapping).sort()).toEqual(["client", "integration"]);
  expect(show("mochi-write", mapping.integration).depends_on).toEqual([
    mapping.client,
    `mochi:${service.id}`,
    facilityRef,
  ]);
  expect(show("ccp", facility.id)).toEqual(upstreamBefore);
  const next = () => cli(["plan", "next", "mochi-write", plan.id]);
  expect(next().ready.map((item: { id: string }) => item.id)).toEqual([mapping.client]);
  expect(next().blocked[0].id).toBe(mapping.integration);

  await page.goto(`${workbench.origin}/#/projects/mochi-write/plans/${plan.id}`);
  const card = page.locator(`[data-plan-id="${plan.id}"]`);
  await expect(card).toContainText("2 项任务 · 1 个项目");
  const integration = page.locator(`[id="${plan.id}--integration"]`);
  await expect(integration).toHaveAttribute("open", "");
  await expect(integration.locator("[data-direct-dependencies]")).toContainText("尚未满足");
  await integration
    .locator("[data-direct-dependencies]")
    .getByRole("link", { name: `Staging facility · ${facilityRef}`, exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`projects/ccp/backlog/${facility.id}`));
  await expect(page.getByRole("heading", { name: "Staging facility", exact: true })).toBeVisible();
  const impact = page
    .getByRole("region", { name: "Backlog item detail" })
    .locator("[data-dependent-tasks]");
  await expect(impact).toContainText(`mochi:${service.id}`);
  await expect(impact).toContainText(`mochi-write:${consumer.id}`);
  await expect(impact).toContainText(`mochi-write:${mapping.integration}`);
  await page.reload();
  await page.getByRole("link", { name: "返回原 Plan" }).click();
  await expect(page).toHaveURL(new RegExp(`projects/mochi-write/plans/${plan.id}`));

  done("ccp", facility.id);
  const relationships = await page.request.get(
    `${workbench.origin}/api/projects/mochi/backlog/${service.id}/dependencies`,
  );
  const relation = (await relationships.json()).data;
  expect(relation.dependencies[0].satisfied).toBe(true);
  done("mochi-write", mapping.client);
  expect(next().blocked[0].reasons.map((reason: { project: string }) => reason.project)).toEqual([
    "mochi",
  ]);
  done("mochi", service.id);
  expect(next().ready.map((item: { id: string }) => item.id)).toEqual([mapping.integration]);
  await page.getByRole("button", { name: "Refresh workspace and project data" }).click();
  await page.getByRole("tab", { name: "执行与结果", exact: true }).click();
  await expect(card.getByRole("region", { name: "可开始任务", exact: true })).toContainText(
    "Product integration",
  );
  await page.getByRole("tab", { name: "审阅计划", exact: true }).click();
  await expect(integration.locator("[data-direct-dependencies]")).not.toContainText("尚未满足");
  expect(cli(["plan", "materialize", "mochi-write", plan.id]).no_op).toBe(true);
});
