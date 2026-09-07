import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { test, expect } from "./fixture.js";

test("Overview controls independent dev services and keeps polling focus", async ({
  page,
  workbench,
}) => {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const file = workbench.root + "/.pops/workspace.json";
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  manifest.projects.alpha.dev = {
    host: "127.0.0.1",
    endpoints: { web: { port } },
    processes: {
      web: {
        command: [
          process.execPath,
          "-e",
          'console.error("browser service ready");require("http").createServer((q,s)=>s.end("fixture")).listen(Number(process.argv[1]),"127.0.0.1")',
          String(port),
        ],
        cwd: ".",
        env: {},
      },
    },
  };
  writeFileSync(file, JSON.stringify(manifest));
  try {
    await page.goto(workbench.origin + "/#/projects/alpha/overview");
    const panel = page.getByRole("region", { name: "开发服务" });
    await expect(panel).toContainText("manager：未运行");
    expect(existsSync(workbench.root + "/.pops/runtime/dev")).toBe(false);
    await panel.getByRole("button", { name: "查询状态", exact: true }).focus();
    await page.waitForResponse((r) => r.url().endsWith("/alpha/dev"));
    await expect(panel.getByRole("button", { name: "查询状态", exact: true })).toBeFocused();
    workbench.cli(["dev", "start", "alpha", "--json"]);
    await expect(panel).toContainText("项目：running");
    await expect(panel.getByRole("link", { name: "打开成果 · web" })).toHaveAttribute(
      "href",
      `http://127.0.0.1:${port}`,
    );
    await panel.locator("summary").click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await panel.screenshot({ path: "/tmp/pro055-running-1440.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await panel.screenshot({ path: "/tmp/pro055-running-390.png" });
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    const instance = JSON.parse(workbench.cli(["dev", "status", "alpha", "--json"])).instance;
    await panel.getByRole("button", { name: "重启", exact: true }).click();
    await expect(panel).toContainText("项目：running");
    expect(JSON.parse(workbench.cli(["dev", "status", "alpha", "--json"])).instance).not.toBe(
      instance,
    );
    await panel.getByRole("button", { name: "停止", exact: true }).click();
    await expect(panel).toContainText("项目：stopped");
    expect(JSON.parse(workbench.cli(["dev", "status", "alpha", "--json"])).state).toBe("stopped");
    await page.getByLabel("Select active project").selectOption("empty");
    await expect(panel).toContainText("未配置开发服务");
    await expect(panel.getByRole("button", { name: "启动", exact: true })).toBeDisabled();
  } finally {
    workbench.cli(["dev", "manager", "stop", "--json"]);
  }
});

test("dev loading, errors, unknown recovery, duplicate submits and stale project responses", async ({
  page,
  workbench,
}) => {
  let mode = "loading";
  let release: (() => void) | undefined;
  let mutations = 0;
  const snapshot = (state = "failed") => ({
    ok: true,
    data: {
      configured: true,
      hosts_workbench: false,
      problems: [],
      status: {
        ok: state === "running",
        project: "alpha",
        state,
        manager: "running",
        endpoints: [],
        processes: [
          { name: "web", state: "failed", log: "fixture diagnostic <script>unsafe</script>" },
        ],
        issue: "fixture failure",
      },
    },
  });
  await page.route("**/api/projects/alpha/dev", async (route) => {
    if (mode === "loading")
      await new Promise<void>((r) => {
        release = r;
      });
    if (route.request().method() === "POST") {
      mutations++;
      await new Promise<void>((r) => {
        release = r;
      });
    }
    if (mode === "error")
      await route.fulfill({
        status: 503,
        json: { ok: false, error: { message: "fixture connection error" } },
      });
    else
      await route.fulfill({
        json: snapshot(mode === "unknown" ? "unknown" : mode === "running" ? "running" : "failed"),
      });
  });
  await page.goto(workbench.origin + "/#/projects/alpha/overview");
  const panel = page.getByRole("region", { name: "开发服务" });
  await expect(panel).toContainText("正在查询服务");
  await expect(panel.getByRole("button", { name: "启动", exact: true })).toBeDisabled();
  await page.getByLabel("Select active project").selectOption("empty");
  await expect(panel).toContainText("未配置开发服务");
  mode = "unknown";
  release?.();
  await expect(panel).toContainText("未配置开发服务");
  await page.getByLabel("Select active project").selectOption("alpha");
  await expect(panel).toContainText("项目：unknown");
  await expect(panel.getByRole("button", { name: "重启", exact: true })).toBeDisabled();
  mode = "error";
  await panel.getByRole("button", { name: "查询状态", exact: true }).click();
  await expect(panel).toContainText("fixture connection error");
  mode = "failed";
  await panel.getByRole("button", { name: "查询状态", exact: true }).click();
  await expect(panel).toContainText("项目：failed");
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await panel.locator("summary").click();
  await expect(panel).toContainText("fixture diagnostic <script>unsafe</script>");
  expect(await panel.locator("script").count()).toBe(0);
  await panel.screenshot({ path: "/tmp/pro055-failed.png" });
  await panel.getByRole("button", { name: "启动", exact: true }).click();
  await expect(panel).toContainText("正在执行操作");
  await expect(panel.getByRole("button", { name: "启动", exact: true })).toBeDisabled();
  expect(mutations).toBe(1);
  mode = "running";
  release?.();
  await expect(panel).toContainText("项目：running");
  await panel.getByRole("button", { name: "查询状态", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(panel.getByRole("button", { name: "重启", exact: true })).toBeFocused();
  await page.waitForResponse((r) => r.url().endsWith("/alpha/dev"));
  await expect(panel.getByRole("button", { name: "重启", exact: true })).toBeFocused();
  await expect(panel.locator("details")).toHaveAttribute("open", "");
});

for (const boundary of ["link focus", "immediate global refresh", "log scroll"] as const) {
  test(`dev reading preserves ${boundary} across DOM refresh`, async ({ page, workbench }) => {
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    let version = 0;
    await page.route("**/api/projects/alpha/dev", async (route) => {
      version++;
      await route.fulfill({
        json: {
          ok: true,
          data: {
            configured: true,
            hosts_workbench: false,
            problems: [],
            status: {
              ok: true,
              project: "alpha",
              state: "running",
              manager: "running",
              endpoints: [
                {
                  project: "alpha",
                  endpoint: "web",
                  host: "127.0.0.1",
                  port: 45678,
                  origin: "http://127.0.0.1:45678",
                },
              ],
              processes: [
                {
                  name: "web",
                  state: "running",
                  log:
                    `version ${version}\n` +
                    Array.from({ length: 100 }, (_, i) => `log line ${i}`).join("\n"),
                },
              ],
            },
          },
        },
      });
    });
    await page.goto(workbench.origin + "/#/projects/alpha/overview");
    const panel = page.getByRole("region", { name: "开发服务" });
    await expect(panel).toContainText("项目：running");
    await panel.locator("summary").click();
    const log = panel.locator("pre");
    await log.evaluate((el) => {
      el.scrollTop = 180;
    });
    const position = await log.evaluate((el) => el.scrollTop);
    if (boundary === "immediate global refresh") {
      await page.locator("#btn-refresh").click();
      await expect(panel.locator("details")).toHaveAttribute("open", "");
      await expect.poll(() => log.evaluate((el) => el.scrollTop)).toBe(position);
    } else {
      const link = panel.getByRole("link", { name: "打开成果 · web" });
      if (boundary === "link focus") await link.focus();
      const nextVersion = version + 1;
      await page.clock.runFor(2100);
      await expect(log).toContainText(`version ${nextVersion}`);
      if (boundary === "link focus") await expect(link).toBeFocused();
      else await expect.poll(() => log.evaluate((el) => el.scrollTop)).toBe(position);
    }
    await panel.screenshot({ path: `/tmp/pro055-review-${boundary.replaceAll(" ", "-")}.png` });
  });
}
