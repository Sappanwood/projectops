import assert from "node:assert/strict";
import test from "node:test";
import { parseItemFile } from "../src/backlog/item.js";
import { createApiClient, type ApiResult } from "../src/web/apiClient.js";
import { createBacklogController } from "../src/web/backlogController.js";
import { renderBacklogPanel } from "../src/web/backlogView.js";
import type { BacklogMutationReceipt } from "../src/application/backlogApi.js";

test("Backlog ignores a pending mutation response after switching projects and prevents double submit", async () => {
  const item = parseItemFile("---\nid: ALP-001\nrevision: old\ntitle: First\ndepends_on: [\"ALP-002\"]\n---\nBody");
  let finish!: (value: ApiResult<BacklogMutationReceipt>) => void;
  let mutations = 0;
  let summaries = 0;
  const api = {
    ...createApiClient(),
    listBacklog: async () => ({ ok: true as const, data: { items: [item] } }),
    showBacklog: async () => ({ ok: true as const, data: { item } }),
    updateBacklog: async () => {
      mutations++;
      return new Promise<ApiResult<BacklogMutationReceipt>>((resolve) => { finish = resolve; });
    },
  };
  const controller = createBacklogController(api, () => {}, async () => { summaries++; });
  await controller.load("alpha");
  await controller.select(item.id);
  assert.match(renderBacklogPanel(controller.getState()), /尚未完成或缺失的依赖：ALP-002/);
  const update = controller.update("done");
  await controller.update("todo");
  assert.equal(mutations, 1);
  controller.reset();
  await controller.load("beta");
  finish({ ok: true, data: { no_op: false, changed_fields: ["status"], revision: "new", before: item, result: { ...item, status: "done", revision: "new" } } });
  await update;
  assert.equal(controller.getState().projectId, "beta");
  assert.equal(controller.getState().item, null);
  assert.equal(controller.getState().message, null);
  assert.equal(summaries, 0);
  controller.destroy();
});

test("Backlog exposes list diagnostics and sorts complete items within each status", async () => {
  let unavailable = true;
  const items = ["ALP-003", "ALP-001", "ALP-002"].map((id) => parseItemFile(`---\nid: ${id}\ntitle: ${id}\n---\nBody`));
  const api = { ...createApiClient(), listBacklog: async () => unavailable
    ? { ok: false as const, error: { code: "ITEM_INVALID", message: "Malformed item" } }
    : { ok: true as const, data: { items } } };
  const controller = createBacklogController(api, () => {}, async () => {});
  await controller.load("alpha");
  assert.match(renderBacklogPanel(controller.getState()), /role="alert"/);
  assert.match(renderBacklogPanel(controller.getState()), /Retry backlog/);
  unavailable = false;
  await controller.load("alpha");
  const html = renderBacklogPanel(controller.getState());
  assert.ok(html.indexOf("ALP-001") < html.indexOf("ALP-002"));
  assert.ok(html.indexOf("ALP-002") < html.indexOf("ALP-003"));
  controller.destroy();
});
