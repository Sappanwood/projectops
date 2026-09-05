import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runCli } from "../src/app.js";
import { startWorkbenchServer } from "../src/server/workbenchServer.js";
import { createApiClient } from "../src/web/apiClient.js";
import { createBacklogController } from "../src/web/backlogController.js";
import { renderBacklogPanel } from "../src/web/backlogView.js";
import { createWorkbenchApp } from "../src/web/app.js";

test("Workbench Backlog lists, reads, updates and recovers from a real HTTP revision conflict", async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "pops-backlog-flow-"));
  function run(args: string[]) {
    const out: string[] = [];
    const errors: string[] = [];
    const code = runCli(args, { stdout: (text) => out.push(text), stderr: (text) => errors.push(text) }, workspace);
    assert.equal(code, 0, errors.join("\n"));
    return out[0]?.startsWith("{") ? JSON.parse(out[0]) : null;
  }
  let server;
  try {
    run(["init"]);
    mkdirSync(path.join(workspace, "alpha"));
    run(["project", "add", "alpha", "--json"]);
    run(["backlog", "init", "alpha", "--json"]);
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      ids.push(run(["backlog", "add", "alpha", "-T", `Task ${i}`, "-c", "feature", "--priority", "P1", "-b", "## Intent\n\n<script>unsafe</script>", "--json"]).item.id);
    }
    server = await startWorkbenchServer({ workspaceDir: workspace, port: 0 });
    let overviewDone = 0;
    const api = createApiClient({ baseUrl: server.origin });
    const controller = createBacklogController(api, () => {}, async () => {
      const result = await api.getProjectOverview("alpha");
      assert.equal(result.ok, true);
      if (result.ok) overviewDone = result.data.backlog.counts.done;
    });
    await controller.load("alpha");
    assert.equal(controller.getState().error, null);
    assert.equal(controller.getState().items.length, 7);
    await controller.select(ids[0]!);
    assert.match(controller.getState().item!.body, /## Intent/);
    assert.match(renderBacklogPanel(controller.getState()), /&lt;script&gt;/);
    assert.doesNotMatch(renderBacklogPanel(controller.getState()), /<script>/);
    await controller.update("done");
    assert.equal(controller.getState().item!.status, "done");
    assert.equal(overviewDone, 1);
    const beforeConflict = controller.getState().item!;
    run(["backlog", "update", "alpha", ids[0]!, "--status", "in_progress", "--expected-revision", beforeConflict.revision, "--json"]);
    await controller.update("todo");
    assert.equal(controller.getState().detailError?.code, "REVISION_MISMATCH");
    assert.equal(controller.getState().selectedItemId, ids[0]);
    assert.equal(run(["backlog", "show", "alpha", ids[0]!, "--json"]).status, "in_progress");
    assert.match(renderBacklogPanel(controller.getState()), /Refresh item/);
    await controller.select(ids[0]!);
    await controller.update("todo");
    assert.equal(controller.getState().item!.status, "todo");
    await controller.update("invalid");
    assert.equal(controller.getState().detailError?.code, "INVALID_STATUS");
    await controller.select("ALP-999");
    assert.equal(controller.getState().detailError?.code, "ITEM_NOT_FOUND");
    controller.destroy();

    const handlers: Record<string, (event: any) => void> = {};
    const container = { innerHTML: "", addEventListener: (name: string, handler: any) => { handlers[name] = handler; }, removeEventListener() {} };
    let route: import("../src/web/types.js").RouteState = { projectId: "alpha", view: "backlog" };
    const app = createWorkbenchApp({ container: container as unknown as HTMLElement, apiClient: api,
      router: (onChange) => ({ getCurrentRoute: () => route, navigate(next) { route = next; onChange(next); }, cleanup() {} }) });
    async function until(predicate: () => boolean) {
      const deadline = Date.now() + 3000;
      while (!predicate()) {
        assert.ok(Date.now() < deadline, "Workbench did not settle");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    function click(selector: string, dataset = {}) {
      handlers.click!({ target: { closest: (candidate: string) => candidate === selector ? { dataset } : null } });
    }
    try {
      await until(() => app.getState().backlog.items.length === 7);
      click("[data-backlog-item]", { backlogItem: ids[1] });
      await until(() => app.getState().backlog.item?.id === ids[1]);
      click("[data-backlog-status]", { backlogStatus: "done" });
      await until(() => app.getState().backlog.message === "Status updated.");
      assert.equal(app.getState().projectOverview?.backlog.counts.done, 1);
      assert.equal(run(["backlog", "show", "alpha", ids[1]!, "--json"]).status, "done");
      await app.refresh();
      assert.equal(app.getState().backlog.selectedItemId, ids[1]);
    } finally { app.destroy(); }
  } finally {
    await server?.close();
    rmSync(workspace, { recursive: true, force: true });
  }
});
