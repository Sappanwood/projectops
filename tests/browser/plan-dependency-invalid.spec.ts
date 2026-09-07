import { expect, test } from "./fixture.js";

for (const malformed of ["null-item", "invalid-dependencies"]) {
  test(`Plan revision preserves and recovers structurally invalid JSON: ${malformed}`, async ({
    workbench,
    page,
  }) => {
    await page.goto(`${workbench.origin}/#/projects/alpha/plans/plan-browser`);
    const editor = page.locator("[data-foundation-plan]");
    await page.getByRole("button", { name: "修订计划", exact: true }).click();
    const input = page.getByLabel("计划 JSON 草案");
    await expect(input).toHaveValue(/Validate production UI/);
    const valid = JSON.parse(await input.inputValue());
    const broken = structuredClone(valid);
    if (malformed === "null-item") broken.items = [null];
    else broken.items[0].depends_on = "bad";
    const body = JSON.stringify(broken);
    await input.fill(body);
    await page.getByRole("button", { name: "预览修订", exact: true }).click();
    await expect(editor.locator("[role=status]")).toContainText(
      /PLAN_INVALID|PLAN_INPUT_INVALID|INVALID_INPUT|invalid|must/i,
    );
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue(body);
    if (malformed === "null-item") {
      await editor.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: "/tmp/projectops-cross-project-plan/pro062-fix-invalid-structure.png",
      });
    }
    valid.goal = `Recovered ${malformed}`;
    await input.fill(JSON.stringify(valid));
    await page.getByRole("button", { name: "预览修订", exact: true }).click();
    await page.getByRole("button", { name: "确认应用修订", exact: true }).click();
    await expect(editor).toContainText("计划修订已保存");
    await expect(input).toHaveValue(new RegExp(`Recovered ${malformed}`));
  });
}
